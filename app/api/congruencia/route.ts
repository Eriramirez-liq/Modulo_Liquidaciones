import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  obtenerReporteCongruencia,
  type FilaReporteCongruencia,
} from "@/lib/engine/congruencia-reporte"

/**
 * GET /api/congruencia?periodoId=<CUID>&orCodigo=<opcional>&estado=<opcional>
 *
 * Reporte de diferencias de congruencia entre Facturación, SDL y TC1.
 * Reusa `obtenerReporteCongruencia` (que a su vez reusa `clasificarCongruencia`).
 * Idempotente: solo lectura.
 */
export const runtime = "nodejs"

interface RespuestaCongruencia {
  rows: FilaReporteCongruencia[]
  total: number
  operadores: string[]
  estados: string[]
}

const VACIO: RespuestaCongruencia = { rows: [], total: 0, operadores: [], estados: [] }

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoId = searchParams.get("periodoId")
  const orCodigo = searchParams.get("orCodigo") ?? undefined
  const estado = searchParams.get("estado") ?? undefined
  if (!periodoId) return NextResponse.json({ error: "periodoId requerido" }, { status: 400 })

  const periodo = await db.periodoConciliacion.findUnique({
    where: { id: periodoId },
    select: { anio: true, mes: true },
  })
  if (!periodo) return NextResponse.json(VACIO)
  const periodoStr = `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`

  const todas = await obtenerReporteCongruencia(periodoStr)

  // Valores distintos sobre el set SIN filtrar (para poblar los filtros del frontend).
  const operadoresDistintos = [
    ...new Set(todas.map((f) => f.or).filter((v): v is string => v !== null)),
  ].sort((a, b) => a.localeCompare(b))
  const estadosDistintos = [...new Set(todas.map((f) => f.estado))].sort((a, b) =>
    a.localeCompare(b),
  )

  // Aplicar filtros opcionales.
  const rows = todas.filter(
    (f) => (!orCodigo || f.or === orCodigo) && (!estado || f.estado === estado),
  )

  return NextResponse.json({
    rows,
    total: rows.length,
    operadores: operadoresDistintos,
    estados: estadosDistintos,
  })
}
