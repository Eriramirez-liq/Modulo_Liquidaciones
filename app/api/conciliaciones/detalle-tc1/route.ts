import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"

/**
 * GET /api/conciliaciones/detalle-tc1?periodoId&orId&indicador
 *
 * Filas de resultados_conciliacion_tc1 filtradas por indicador:
 *   sin_diferencia | nivel_tension | propiedad | incompletas
 */
export const runtime = "nodejs"

const INDICADORES = ["sin_diferencia", "nivel_tension", "propiedad", "incompletas"] as const
type Indicador = typeof INDICADORES[number]
function isIndicador(s: string | null): s is Indicador {
  return s !== null && (INDICADORES as readonly string[]).includes(s)
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoId = searchParams.get("periodoId")
  const orId      = searchParams.get("orId") ?? undefined
  const indicador = searchParams.get("indicador")

  if (!periodoId) return NextResponse.json({ error: "periodoId requerido" }, { status: 400 })
  if (!isIndicador(indicador)) {
    return NextResponse.json(
      { error: `indicador invalido. Validos: ${INDICADORES.join(", ")}` },
      { status: 400 },
    )
  }

  const base: Prisma.ResultadoConciliacionTC1WhereInput = {
    periodo_id: periodoId,
    ...(orId ? { or_id: orId } : {}),
  }
  const where: Prisma.ResultadoConciliacionTC1WhereInput = (() => {
    switch (indicador) {
      case "sin_diferencia": return { ...base, caso: "SIN_DIFERENCIA" }
      case "nivel_tension":  return { ...base, diff_nivel_tension: true }
      case "propiedad":      return { ...base, diff_propiedad: true }
      case "incompletas":    return { ...base, caso: "INCOMPLETA" }
    }
  })()

  const rows = await db.resultadoConciliacionTC1.findMany({
    where,
    orderBy: { codigo_frontera: "asc" },
    take: 500,
  })
  return NextResponse.json({ rows, total: rows.length })
}
