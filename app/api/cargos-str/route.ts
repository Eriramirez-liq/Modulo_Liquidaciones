import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/cargos-str?periodoIds=id1,id2&orIds=id1,id2
 *
 * Devuelve los cargos STR agregados por (operador, periodo_facturacion).
 * Cada período del response incluye su mes de facturación y el de consumo
 * (= facturación - 1 mes).
 *
 * Response shape:
 * {
 *   periodos: [{ id, facturacion: "2026-02", consumo: "2026-01" }, ...]
 *   operadores: [{ codigo, nombre, totales: { [periodoId]: 12345.6 }, total: 9999 }]
 *   totalPorPeriodo: { [periodoId]: 100 }
 *   totalGeneral: 300
 * }
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoIdsParam = searchParams.get("periodoIds")
  const orIdsParam      = searchParams.get("orIds")

  const periodoIds = periodoIdsParam ? periodoIdsParam.split(",").filter(Boolean) : null
  const orIds      = orIdsParam      ? orIdsParam.split(",").filter(Boolean)      : null

  // Traer la data de los períodos (necesitamos anio/mes para los headers)
  const periodosRaw = await db.periodoConciliacion.findMany({
    where: periodoIds && periodoIds.length > 0 ? { id: { in: periodoIds } } : {},
    select: { id: true, anio: true, mes: true },
    orderBy: [{ anio: "asc" }, { mes: "asc" }],
  })

  // Traer los registros STR filtrados
  const registros = await db.registroSTR.findMany({
    where: {
      ...(periodoIds && periodoIds.length > 0 ? { periodo_id: { in: periodoIds } } : {}),
      ...(orIds      && orIds.length      > 0 ? { or_id:      { in: orIds }      } : {}),
    },
    select: {
      periodo_id:  true,
      valor_cop:   true,
      operador_red: { select: { codigo: true, nombre: true } },
    },
  })

  // Agregar por (or, periodo)
  const byOR     = new Map<string, { codigo: string; nombre: string; totales: Map<string, number> }>()
  const porPer   = new Map<string, number>()
  let totalGen   = 0
  for (const r of registros) {
    const codigo = r.operador_red.codigo
    const nombre = r.operador_red.nombre
    const pId    = r.periodo_id
    const valor  = Number(r.valor_cop)
    porPer.set(pId, (porPer.get(pId) ?? 0) + valor)
    totalGen += valor
    if (!byOR.has(codigo)) byOR.set(codigo, { codigo, nombre, totales: new Map() })
    byOR.get(codigo)!.totales.set(pId, (byOR.get(codigo)!.totales.get(pId) ?? 0) + valor)
  }

  // El período guardado en registros_str.periodo_id es el de CONSUMO
  // (lo que selecciona el usuario al cargar Insumos STR). La facturación
  // se deriva como consumo + 1 mes.
  function facturacionDe(anio: number, mes: number): { anio: number; mes: number } {
    if (mes === 12) return { anio: anio + 1, mes: 1 }
    return { anio, mes: mes + 1 }
  }
  const incluirSinDatos = !!(periodoIds && periodoIds.length > 0)
  const periodos = periodosRaw
    .filter(p => incluirSinDatos || (porPer.get(p.id) ?? 0) !== 0)
    .map(p => {
      const f = facturacionDe(p.anio, p.mes)
      return {
        id:          p.id,
        consumo:     `${p.anio}-${String(p.mes).padStart(2, "0")}`,
        facturacion: `${f.anio}-${String(f.mes).padStart(2, "0")}`,
      }
    })

  const operadores = Array.from(byOR.values())
    .map(o => {
      const totales: Record<string, number> = {}
      let total = 0
      for (const p of periodos) {
        const v = o.totales.get(p.id) ?? 0
        totales[p.id] = v
        total += v
      }
      return { codigo: o.codigo, nombre: o.nombre, totales, total }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  const totalPorPeriodo: Record<string, number> = {}
  for (const p of periodos) totalPorPeriodo[p.id] = porPer.get(p.id) ?? 0

  return NextResponse.json({
    periodos,
    operadores,
    totalPorPeriodo,
    totalGeneral: totalGen,
  })
}
