import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/cargos-str?periodoIds=id1,id2&orIds=id1,id2
 *
 * Devuelve los cargos STR agregados por (operador, mes_consumo) para los
 * filtros indicados.
 *
 * Response shape:
 * {
 *   meses: string[]               // ["2026-01", "2026-02", ...] ordenado asc
 *   operadores: [
 *     { codigo, nombre, totales: { "2026-01": 12345.6, ... }, total: 9999 }
 *   ]
 *   totalPorMes: { "2026-01": 100, "2026-02": 200, ... }
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

  const registros = await db.registroSTR.findMany({
    where: {
      ...(periodoIds && periodoIds.length > 0 ? { periodo_id: { in: periodoIds } } : {}),
      ...(orIds      && orIds.length      > 0 ? { or_id:      { in: orIds      } } : {}),
    },
    select: {
      mes_consumo: true,
      valor_cop:   true,
      operador_red: { select: { codigo: true, nombre: true } },
    },
  })

  type Row = (typeof registros)[number]
  const byOR    = new Map<string, { codigo: string; nombre: string; totales: Map<string, number> }>()
  const meses   = new Set<string>()
  const porMes  = new Map<string, number>()
  let totalGen = 0

  for (const r of registros as Row[]) {
    const codigo = r.operador_red.codigo
    const nombre = r.operador_red.nombre
    const mes    = r.mes_consumo
    const valor  = Number(r.valor_cop)
    meses.add(mes)
    porMes.set(mes, (porMes.get(mes) ?? 0) + valor)
    totalGen += valor
    if (!byOR.has(codigo)) byOR.set(codigo, { codigo, nombre, totales: new Map() })
    const orEntry = byOR.get(codigo)!
    orEntry.totales.set(mes, (orEntry.totales.get(mes) ?? 0) + valor)
  }

  const mesesSorted = Array.from(meses).sort()
  const operadores = Array.from(byOR.values())
    .map(o => {
      const totales: Record<string, number> = {}
      let total = 0
      for (const m of mesesSorted) {
        const v = o.totales.get(m) ?? 0
        totales[m] = v
        total += v
      }
      return { codigo: o.codigo, nombre: o.nombre, totales, total }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  const totalPorMes: Record<string, number> = {}
  for (const m of mesesSorted) totalPorMes[m] = porMes.get(m) ?? 0

  return NextResponse.json({
    meses: mesesSorted,
    operadores,
    totalPorMes,
    totalGeneral: totalGen,
  })
}
