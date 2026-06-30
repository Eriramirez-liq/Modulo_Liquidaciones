import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { normalizar, construirBaseClasif, clasifConHerencia, claveBase, clasificarCongruencia } from "@/lib/engine/congruencia"

/**
 * GET /api/dashboard?periodoId=...
 *
 * KPIs del módulo Inicio. El período recibido es el de CONSUMO
 * (PeriodoConciliacion.{anio,mes}); el dashboard lo MUESTRA como mes en curso /
 * facturación (consumo + 1) — esa derivación la hace el frontend.
 *
 * KPIs:
 *  - Cargo STR    = Σ registros_str.valor_cop del período.
 *  - Cargo SDL    = Σ (valor_sdl_cop + valor_reactiva_cop) de registros_sdl
 *                   (preliquidación activa + reactiva, sin duplicados).
 *  - Pérdidas     = contingencias pendientes (lógica existente).
 *  - Provisiones  = lógica existente.
 *  - Compensaciones = placeholder (lógica pendiente de definir).
 *  - Congruencia  = % de fronteras FACTURADAS cuyo nivel de tensión y propiedad
 *                   de activos coinciden con SDL y TC1 (las ausentes en SDL/TC1
 *                   cuentan como NO congruentes).
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoId = searchParams.get("periodoId") ?? undefined

  const empty = {
    totalFronteras: 0, sinDiferencia: 0,
    provisiones: 0, valorProvisiones: 0,
    contingenciasAbiertas: 0, valorContingencias: 0,
    disputas: 0, valorDisputas: 0,
    alertasManuales: 0, incompletas: 0, errores: 0,
    impactoEstimado: 0,
    // KPIs del panel principal
    cargoStrCop: 0,
    cargoSdlCop: 0, cargoSdlActivaCop: 0, cargoSdlReactivaCop: 0,
    compensacionesCop: null as number | null,
    congruenciaPct: 0, congruentes: 0, fronterasFacturadas: 0, fronterasFacturadasKwh: 0,
    facturacionTotalCop: 0, provisionesKwh: 0, perdidasKwh: 0,
    topFronteras: [] as Array<{ codigoFrontera: string; provisionCop: number; perdidaCop: number; totalCop: number }>,
  }

  if (!periodoId) return NextResponse.json(empty)

  // OJO con la clave de período: registros_str / provisiones / contingencias /
  // resultados usan el CUID (periodo.id), pero registros_facturacion / sdl / tc1
  // se guardan con el string "AAAA-MM". Hay que consultar cada fuente con su
  // clave correcta o la congruencia y el Cargo SDL salen en 0.
  const periodo = await db.periodoConciliacion.findUnique({
    where: { id: periodoId },
    select: { anio: true, mes: true },
  })
  if (!periodo) return NextResponse.json(empty)
  const periodoStr = `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`

  const [
    resultados, provisionesAgg, contingenciasAgg, disputas,
    strAgg, sdlAgg, facturacion, sdlClasif, tc1Clasif,
    provPorFrontera, contPorFrontera,
  ] = await Promise.all([
    db.resultadoConciliacion.findMany({
      where: { periodo_id: periodoId },
      select: {
        caso: true, resultado_l1: true,
        impacto_financiero_l1: true, impacto_financiero_l2: true,
        requiere_alerta_manual: true,
      },
    }),
    db.provision.aggregate({
      where: { periodo_id: periodoId },
      _count: { _all: true },
      _sum:   { energia_kwh: true },
    }),
    db.contingencia.aggregate({
      where: { periodo_id: periodoId, estado: "PENDIENTE" },
      _count: { _all: true },
      _sum:   { costo_estimado_cop: true, energia_kwh: true },
    }),
    db.disputa.count({ where: { periodo_id: periodoId } }),
    // Cargo STR
    db.registroSTR.aggregate({
      where: { periodo_id: periodoId },
      _sum: { valor_cop: true },
    }),
    // Cargo SDL (activa + reactiva), excluyendo duplicados — clave string
    db.registroSDL.aggregate({
      where: { periodo_id: periodoStr, es_duplicado: false },
      _sum: { valor_sdl_cop: true, valor_reactiva_cop: true },
    }),
    // Congruencia — clasificación por frontera en las 3 fuentes (clave string)
    db.registroFacturacion.findMany({
      where: { periodo_id: periodoStr },
      select: { codigo_frontera: true, nivel_tension: true, propiedad_activos: true, energia_kwh: true, tarifa_total_bia: true },
    }),
    db.registroSDL.findMany({
      where: { periodo_id: periodoStr, es_duplicado: false },
      select: { codigo_frontera: true, nivel_tension: true, propiedad_activos: true },
    }),
    db.registroTC1.findMany({
      where: { periodo_id: periodoStr },
      select: { codigo_frontera: true, nivel_tension: true, propiedad_activos: true },
    }),
    // Impacto por frontera — provisión y pérdida (contingencia)
    db.provision.groupBy({
      by: ["codigo_frontera"],
      where: { periodo_id: periodoId },
      _sum: { valor_provisionado_cop: true },
    }),
    db.contingencia.groupBy({
      by: ["codigo_frontera"],
      where: { periodo_id: periodoId },
      _sum: { costo_estimado_cop: true },
    }),
  ])

  const totalFronteras   = resultados.length
  const sinDiferencia    = resultados.filter(r => r.caso === "A1").length
  const alertasManuales  = resultados.filter(r => r.requiere_alerta_manual).length
  const incompletas      = resultados.filter(r => r.caso === "INCOMPLETA").length
  const errores          = resultados.filter(r => r.caso === "ERROR").length
  const valorProvisiones = resultados.reduce((s, r) => s + Number(r.impacto_financiero_l1 ?? 0), 0)
  const valorDisputas    = resultados.reduce((s, r) => s + Number(r.impacto_financiero_l2 ?? 0), 0)
  const valorContingencias = Number(contingenciasAgg._sum.costo_estimado_cop ?? 0)
  // kWh de diferencia (energía) de provisiones y pérdidas (contingencias).
  const provisiones        = provisionesAgg._count._all
  const provisionesKwh     = Number(provisionesAgg._sum.energia_kwh ?? 0)
  const perdidasKwh        = Number(contingenciasAgg._sum.energia_kwh ?? 0)

  // ── Cargo STR / SDL ──────────────────────────────────────────────────────
  const cargoStrCop        = Number(strAgg._sum.valor_cop ?? 0)
  const cargoSdlActivaCop  = Number(sdlAgg._sum.valor_sdl_cop ?? 0)
  const cargoSdlReactivaCop = Number(sdlAgg._sum.valor_reactiva_cop ?? 0)
  const cargoSdlCop        = cargoSdlActivaCop + cargoSdlReactivaCop

  // ── Congruencia (NT + propiedad entre facturación, SDL y TC1) ────────────
  // Usa la MISMA lógica que el reporte de diferencias (clasificarCongruencia):
  // las "_N" se colapsan en su base, y un valor vacío = sin dato (no diferencia).
  const norm = (v: string | null | undefined) => normalizar(v)
  type Clasif = { nt: string; prop: string }
  const baseClasif = construirBaseClasif([
    facturacion.map(f => ({ clave: norm(f.codigo_frontera), nt: norm(f.nivel_tension), prop: norm(f.propiedad_activos) })),
    sdlClasif.map(s => ({ clave: norm(s.codigo_frontera), nt: norm(s.nivel_tension), prop: norm(s.propiedad_activos) })),
    tc1Clasif.map(t => ({ clave: norm(t.codigo_frontera), nt: norm(t.nivel_tension), prop: norm(t.propiedad_activos) })),
  ])
  // Indexa por clave BASE (colapsa "_N"); el clasif hereda de la base.
  const indexar = (rows: { codigo_frontera: string; nivel_tension: string | null; propiedad_activos: string | null }[]) => {
    const m = new Map<string, Clasif>()
    for (const r of rows) {
      const full = norm(r.codigo_frontera)
      const k = claveBase(full)
      if (!k || m.has(k)) continue
      m.set(k, clasifConHerencia(full, { nt: norm(r.nivel_tension), prop: norm(r.propiedad_activos) }, baseClasif))
    }
    return m
  }
  const sdlMap = indexar(sdlClasif)
  const tc1Map = indexar(tc1Clasif)

  // Denominador = fronteras facturadas (base, distintas). Congruente si
  // clasificarCongruencia devuelve null (sin diferencia, ignorando vacíos).
  const facVistas = new Set<string>()
  let congruentes = 0
  for (const f of facturacion) {
    const full = norm(f.codigo_frontera)
    const k = claveBase(full)
    if (!k || facVistas.has(k)) continue
    facVistas.add(k)
    const facc = clasifConHerencia(full, { nt: norm(f.nivel_tension), prop: norm(f.propiedad_activos) }, baseClasif)
    const sdlc = sdlMap.get(k) ?? null
    const tc1c = tc1Map.get(k) ?? null
    if (clasificarCongruencia(facc, sdlc, tc1c) === null) congruentes++
  }
  const fronterasFacturadas = facVistas.size
  const congruenciaPct = fronterasFacturadas > 0
    ? Math.round((congruentes / fronterasFacturadas) * 100)
    : 0

  // kWh activa facturada y VALOR total facturado (energía × tarifa total) del
  // período. Dedupe por código completo para no doblar filas repetidas; las "_N"
  // sí suman porque son códigos distintos.
  const fullVistas = new Set<string>()
  let fronterasFacturadasKwh = 0
  let facturacionTotalCop = 0
  for (const f of facturacion) {
    const full = norm(f.codigo_frontera)
    if (!full || fullVistas.has(full)) continue
    fullVistas.add(full)
    const kwh = Number(f.energia_kwh ?? 0)
    fronterasFacturadasKwh += kwh
    facturacionTotalCop += kwh * Number(f.tarifa_total_bia ?? 0)
  }

  // ── Top 10 fronteras por impacto (provisión + pérdida) ───────────────────
  const impactoPorFrontera = new Map<string, { provisionCop: number; perdidaCop: number }>()
  for (const p of provPorFrontera) {
    const k = p.codigo_frontera
    if (!k) continue
    const cur = impactoPorFrontera.get(k) ?? { provisionCop: 0, perdidaCop: 0 }
    cur.provisionCop += Number(p._sum.valor_provisionado_cop ?? 0)
    impactoPorFrontera.set(k, cur)
  }
  for (const c of contPorFrontera) {
    const k = c.codigo_frontera
    if (!k) continue
    const cur = impactoPorFrontera.get(k) ?? { provisionCop: 0, perdidaCop: 0 }
    cur.perdidaCop += Number(c._sum.costo_estimado_cop ?? 0)
    impactoPorFrontera.set(k, cur)
  }
  const topFronteras = Array.from(impactoPorFrontera.entries())
    .map(([codigoFrontera, v]) => ({
      codigoFrontera,
      provisionCop: v.provisionCop,
      perdidaCop: v.perdidaCop,
      totalCop: v.provisionCop + v.perdidaCop,
    }))
    .filter(f => f.totalCop > 0)
    .sort((a, b) => b.totalCop - a.totalCop)
    .slice(0, 10)

  return NextResponse.json({
    totalFronteras, sinDiferencia,
    provisiones, valorProvisiones,
    contingenciasAbiertas: contingenciasAgg._count._all,
    valorContingencias,
    disputas, valorDisputas,
    alertasManuales, incompletas, errores,
    impactoEstimado: valorProvisiones + valorDisputas + valorContingencias,
    // Panel principal
    cargoStrCop,
    cargoSdlCop, cargoSdlActivaCop, cargoSdlReactivaCop,
    compensacionesCop: null, // placeholder — lógica pendiente
    congruenciaPct, congruentes, fronterasFacturadas, fronterasFacturadasKwh,
    facturacionTotalCop, provisionesKwh, perdidasKwh,
    topFronteras,
  })
}
