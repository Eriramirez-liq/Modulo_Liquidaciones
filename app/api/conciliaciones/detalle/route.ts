import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"

/**
 * GET /api/conciliaciones/detalle
 *
 * Devuelve las filas de ResultadoConciliacion filtradas por indicador.
 * Pensado para el panel inferior de la pagina de Conciliaciones, que se
 * abre al hacer click en una KPI del resumen.
 *
 * Query params:
 *   - periodoId (requerido)
 *   - orId      (opcional)
 *   - indicador (requerido): activa | inductiva | capacitiva | factor_m
 *                          | nivel_tension | propiedad
 *                          | sin_diferencia | incompletas | alertas_manuales
 *
 * Respuesta: { rows: ResultadoConciliacion[], total: number }
 *
 * El frontend decide que columnas mostrar segun el indicador.
 */

const INDICADORES = [
  "activa", "inductiva", "capacitiva", "factor_m",
  "nivel_tension", "propiedad",
  "sin_diferencia", "incompletas", "alertas_manuales",
] as const
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

  if (!periodoId) {
    return NextResponse.json({ error: "periodoId requerido" }, { status: 400 })
  }
  if (!isIndicador(indicador)) {
    return NextResponse.json(
      { error: `indicador invalido. Validos: ${INDICADORES.join(", ")}` },
      { status: 400 },
    )
  }

  const baseWhere: Prisma.ResultadoConciliacionWhereInput = {
    periodo_id: periodoId,
    ...(orId ? { or_id: orId } : {}),
  }

  const where: Prisma.ResultadoConciliacionWhereInput = (() => {
    switch (indicador) {
      case "activa":
        // Activa con diff = todas las que NO son A1, INCOMPLETA o ERROR.
        return { ...baseWhere, caso: { notIn: ["A1", "INCOMPLETA", "ERROR"] } }
      case "inductiva":     return { ...baseWhere, diff_inductiva: true }
      case "capacitiva":    return { ...baseWhere, diff_capacitiva: true }
      case "factor_m":      return { ...baseWhere, diff_factor_m: true }
      case "nivel_tension": return { ...baseWhere, diff_nivel_tension: true }
      case "propiedad":     return { ...baseWhere, diff_propiedad: true }
      case "sin_diferencia":
        return {
          ...baseWhere,
          caso: "A1",
          diff_inductiva:     false,
          diff_capacitiva:    false,
          diff_factor_m:      false,
          diff_nivel_tension: false,
          diff_propiedad:     false,
        }
      case "incompletas":
        return { ...baseWhere, caso: { in: ["INCOMPLETA", "ERROR"] } }
      case "alertas_manuales":
        return { ...baseWhere, requiere_alerta_manual: true }
    }
  })()

  const rows = await db.resultadoConciliacion.findMany({
    where,
    include: {
      or_obj: { select: { codigo: true, nombre: true } },
    },
    orderBy: { codigo_frontera: "asc" },
    take: 500,
  })

  return NextResponse.json({ rows, total: rows.length })
}
