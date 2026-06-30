import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  ACTIVA_NT,
  REACTIVA_PCT,
  REACTIVA_NT,
  STR_PCT,
  calcularMes,
  mesFacturacionDe,
  mesesSiguientes,
  promedio,
  type PorNT,
  type PreciosMes,
  type SalidaMes,
} from "@/lib/engine/proyeccion-cargos-or"

/**
 * GET /api/proyeccion-cargos-or?mesesProyeccion=N
 *
 * Devuelve la matriz por mes (columnas = meses de consumo) del modulo
 * "Proyeccion Cargos OR":
 *  - Meses REALES: los periodos con datos de Facturacion cargados. Demanda y
 *    valorizacion calculadas a partir de la facturacion, las tarifas SDL y el STR.
 *  - Meses PROYECTADOS: los N meses siguientes al ultimo real. Precios = promedio
 *    de los ultimos 6 meses reales; demanda pendiente (null) hasta tener Metabase.
 *
 * Resolucion de periodos:
 *  - Facturacion (RegistroFacturacion.periodo_id) = string "AAAA-MM" (consumo).
 *  - Tarifas (tarifas_sdl.periodo)               = string "AAAA-MM" (consumo).
 *  - STR (registros_str.periodo_id)              = CUID de PeriodoConciliacion.
 *    Para el total STR de un mes de consumo resolvemos "AAAA-MM" -> CUID via
 *    PeriodoConciliacion(anio, mes) y sumamos valor_cop de ese periodo.
 */
export const runtime = "nodejs"

/** Tope de meses a proyectar para evitar abusos de query. */
const MAX_MESES_PROYECCION = 24
/** Cantidad de meses reales usados para promediar precios proyectados. */
const VENTANA_PROMEDIO = 6

/** Triplete de precios resueltos (COP/kWh) por NT para un mes. */
interface MesReal {
  periodoConsumo: string
  sdlEnergy: number
  precioActivaNT: PorNT<number | null>
  precioReactivaNT: PorNT<number | null>
  precioStr: number | null
  strTotalCop: number | null
}

/** Fila de salida del endpoint (real o proyectada). */
interface FilaMes {
  periodoConsumo: string
  periodoFacturacion: string
  esProyectado: boolean
  demandaPendiente: boolean
  sdlEnergy: number | null
  activaNT: PorNT<number> | null
  reactivaTotal: number | null
  reactivaNT: PorNT<number> | null
  strEnergy: number | null
  precioActivaNT: PorNT<number | null>
  precioReactivaNT: PorNT<number | null>
  precioStr: number | null
  strTotalCop: number | null
  salida: SalidaMes | null
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  // --- Param: meses a proyectar (entero, default 0, cap MAX) ---
  const { searchParams } = new URL(request.url)
  const rawMeses = Number(searchParams.get("mesesProyeccion") ?? "0")
  const mesesProyeccion = Number.isFinite(rawMeses)
    ? Math.min(Math.max(Math.trunc(rawMeses), 0), MAX_MESES_PROYECCION)
    : 0

  // --- 1) Meses reales = periodos distintos con datos de Facturacion ---
  const periodosFacturacion = await db.registroFacturacion.findMany({
    select: { periodo_id: true },
    distinct: ["periodo_id"],
  })
  const mesesRealesStr = periodosFacturacion
    .map((p) => p.periodo_id)
    .filter((p): p is string => typeof p === "string" && /^\d{4}-\d{2}$/.test(p))
    .sort() // "AAAA-MM" ordena lexicograficamente == cronologicamente

  // Sin datos de facturacion: matriz vacia (no hay base para proyectar).
  if (mesesRealesStr.length === 0) {
    return NextResponse.json({ porcentajes: porcentajesPayload(), meses: [] })
  }

  // --- 2) Cargar insumos de TODOS los meses reales en pocas queries ---
  const [filasFacturacion, filasTarifas, periodosConc] = await Promise.all([
    db.registroFacturacion.findMany({
      where: { periodo_id: { in: mesesRealesStr } },
      select: { periodo_id: true, codigo_frontera: true, energia_kwh: true },
    }),
    db.tarifaSDL.findMany({
      where: { periodo: { in: mesesRealesStr } },
      select: {
        periodo: true,
        nivel_tension: true,
        tarifa_activa: true,
        tarifa_reactiva: true,
      },
    }),
    // PeriodoConciliacion para mapear consumo "AAAA-MM" -> CUID del STR.
    db.periodoConciliacion.findMany({ select: { id: true, anio: true, mes: true } }),
  ])

  // --- 2a) sdlEnergy por mes: Σ energia_kwh deduplicando por codigo_frontera ---
  // El codigo de frontera completo se normaliza (trim + upper). Fronteras "_N"
  // distintas SI suman (codigos distintos); filas identicas repetidas NO.
  const energiaPorMes = new Map<string, Map<string, number>>() // mes -> (fronteraNorm -> energia)
  for (const f of filasFacturacion) {
    const mes = f.periodo_id
    const frontera = f.codigo_frontera.trim().toUpperCase()
    let porFrontera = energiaPorMes.get(mes)
    if (!porFrontera) {
      porFrontera = new Map<string, number>()
      energiaPorMes.set(mes, porFrontera)
    }
    // Sobrescribe (no acumula): filas duplicadas de la misma frontera cuentan 1 vez.
    porFrontera.set(frontera, Number(f.energia_kwh))
  }
  const sdlEnergyPorMes = new Map<string, number>()
  for (const [mes, porFrontera] of energiaPorMes) {
    let total = 0
    for (const energia of porFrontera.values()) total += energia
    sdlEnergyPorMes.set(mes, total)
  }

  // --- 2b) Precios SDL por mes y NT = AVG sobre todas las filas de ese NT ---
  // acumuladores: mes -> nt("1"|"2"|"3") -> { sumActiva, sumReactiva, count }
  type Acc = { sumA: number; sumR: number; count: number }
  const tarifaPorMesNT = new Map<string, Map<string, Acc>>()
  for (const t of filasTarifas) {
    const nt = t.nivel_tension
    if (nt !== "1" && nt !== "2" && nt !== "3") continue
    let porNT = tarifaPorMesNT.get(t.periodo)
    if (!porNT) {
      porNT = new Map<string, Acc>()
      tarifaPorMesNT.set(t.periodo, porNT)
    }
    const acc = porNT.get(nt) ?? { sumA: 0, sumR: 0, count: 0 }
    acc.sumA += Number(t.tarifa_activa)
    acc.sumR += Number(t.tarifa_reactiva)
    acc.count += 1
    porNT.set(nt, acc)
  }
  function precioActivaDe(mes: string): PorNT<number | null> {
    const porNT = tarifaPorMesNT.get(mes)
    return {
      nt1: avgActiva(porNT, "1"),
      nt2: avgActiva(porNT, "2"),
      nt3: avgActiva(porNT, "3"),
    }
  }
  function precioReactivaDe(mes: string): PorNT<number | null> {
    const porNT = tarifaPorMesNT.get(mes)
    return {
      nt1: avgReactiva(porNT, "1"),
      nt2: avgReactiva(porNT, "2"),
      nt3: avgReactiva(porNT, "3"),
    }
  }
  function avgActiva(porNT: Map<string, Acc> | undefined, nt: string): number | null {
    const acc = porNT?.get(nt)
    return acc && acc.count > 0 ? acc.sumA / acc.count : null
  }
  function avgReactiva(porNT: Map<string, Acc> | undefined, nt: string): number | null {
    const acc = porNT?.get(nt)
    return acc && acc.count > 0 ? acc.sumR / acc.count : null
  }

  // --- 2c) STR total por mes de consumo: resolver "AAAA-MM" -> CUID ---
  const cuidPorConsumo = new Map<string, string>()
  for (const p of periodosConc) {
    const clave = `${p.anio}-${String(p.mes).padStart(2, "0")}`
    cuidPorConsumo.set(clave, p.id)
  }
  const cuidsRelevantes = mesesRealesStr
    .map((mes) => cuidPorConsumo.get(mes))
    .filter((id): id is string => typeof id === "string")

  const strPorCuid = new Map<string, number>()
  if (cuidsRelevantes.length > 0) {
    const agregadoStr = await db.registroSTR.groupBy({
      by: ["periodo_id"],
      where: { periodo_id: { in: cuidsRelevantes } },
      _sum: { valor_cop: true },
    })
    for (const g of agregadoStr) {
      strPorCuid.set(g.periodo_id, g._sum.valor_cop ? Number(g._sum.valor_cop) : 0)
    }
  }
  function strTotalDe(mesConsumo: string): number | null {
    const cuid = cuidPorConsumo.get(mesConsumo)
    if (!cuid) return null // no existe el periodo en conciliacion
    return strPorCuid.get(cuid) ?? null // existe periodo pero sin registros STR
  }

  // --- 3) Construir meses reales (modelo intermedio) ---
  const reales: MesReal[] = mesesRealesStr.map((mes) => {
    const sdlEnergy = sdlEnergyPorMes.get(mes) ?? 0
    const strTotalCop = strTotalDe(mes)
    const strEnergy = sdlEnergy * (1 + STR_PCT)
    const precioStr = strTotalCop !== null && strEnergy > 0 ? strTotalCop / strEnergy : null
    return {
      periodoConsumo: mes,
      sdlEnergy,
      precioActivaNT: precioActivaDe(mes),
      precioReactivaNT: precioReactivaDe(mes),
      precioStr,
      strTotalCop,
    }
  })

  // --- 4) Filas reales valorizadas (funcion pura por mes) ---
  const filasReales: FilaMes[] = reales.map((r) => {
    const precios: PreciosMes = {
      precioActivaNT: r.precioActivaNT,
      precioReactivaNT: r.precioReactivaNT,
      precioStr: r.precioStr,
    }
    const calc = calcularMes(r.sdlEnergy, precios)
    return {
      periodoConsumo: r.periodoConsumo,
      periodoFacturacion: mesFacturacionDe(r.periodoConsumo),
      esProyectado: false,
      demandaPendiente: false,
      sdlEnergy: r.sdlEnergy,
      activaNT: calc.activaNT,
      reactivaTotal: calc.reactivaTotal,
      reactivaNT: calc.reactivaNT,
      strEnergy: calc.strEnergy,
      precioActivaNT: r.precioActivaNT,
      precioReactivaNT: r.precioReactivaNT,
      precioStr: r.precioStr,
      strTotalCop: r.strTotalCop,
      salida: calc.salida,
    }
  })

  // --- 5) Meses proyectados: precios = promedio de ultimos 6 reales ---
  // Garantizado no-undefined: arriba retornamos si mesesRealesStr esta vacio.
  const ultimoMesReal = mesesRealesStr[mesesRealesStr.length - 1] as string
  const ventana = reales.slice(-VENTANA_PROMEDIO) // hasta los ultimos 6 reales
  const precioProyectado: PreciosMes = {
    precioActivaNT: {
      nt1: promedio(ventana.map((m) => m.precioActivaNT.nt1)),
      nt2: promedio(ventana.map((m) => m.precioActivaNT.nt2)),
      nt3: promedio(ventana.map((m) => m.precioActivaNT.nt3)),
    },
    precioReactivaNT: {
      nt1: promedio(ventana.map((m) => m.precioReactivaNT.nt1)),
      nt2: promedio(ventana.map((m) => m.precioReactivaNT.nt2)),
      nt3: promedio(ventana.map((m) => m.precioReactivaNT.nt3)),
    },
    precioStr: promedio(ventana.map((m) => m.precioStr)),
  }
  const filasProyectadas: FilaMes[] = mesesSiguientes(ultimoMesReal, mesesProyeccion).map(
    (mes) => ({
      periodoConsumo: mes,
      periodoFacturacion: mesFacturacionDe(mes),
      esProyectado: true,
      demandaPendiente: true,
      // Demanda pendiente: vendra de una query Metabase aun no disponible.
      sdlEnergy: null,
      activaNT: null,
      reactivaTotal: null,
      reactivaNT: null,
      strEnergy: null,
      precioActivaNT: precioProyectado.precioActivaNT,
      precioReactivaNT: precioProyectado.precioReactivaNT,
      precioStr: precioProyectado.precioStr,
      strTotalCop: null,
      salida: null,
    })
  )

  // --- 6) Respuesta: reales (asc) primero, luego proyectados (asc) ---
  return NextResponse.json({
    porcentajes: porcentajesPayload(),
    meses: [...filasReales, ...filasProyectadas],
  })
}

/** Bloque de porcentajes/constantes que el frontend usa para encabezados. */
function porcentajesPayload() {
  return {
    activaNT: { nt1: ACTIVA_NT.nt1, nt2: ACTIVA_NT.nt2, nt3: ACTIVA_NT.nt3 },
    reactivaPct: REACTIVA_PCT,
    reactivaNT: { nt1: REACTIVA_NT.nt1, nt2: REACTIVA_NT.nt2, nt3: REACTIVA_NT.nt3 },
    strPct: STR_PCT,
  }
}
