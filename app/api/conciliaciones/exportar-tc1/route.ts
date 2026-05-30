import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import * as XLSX from "xlsx"

/**
 * GET /api/conciliaciones/exportar-tc1?periodoId&orId
 *
 * Genera un .xlsx con el resultado de la conciliacion TC1: una hoja por
 * indicador (Resumen, Nivel Tension, Propiedad, Incompletas).
 */
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoId = searchParams.get("periodoId")
  const orId      = searchParams.get("orId") ?? undefined
  if (!periodoId) return NextResponse.json({ error: "periodoId requerido" }, { status: 400 })

  const periodo = await db.periodoConciliacion.findUnique({
    where: { id: periodoId }, select: { anio: true, mes: true },
  })
  const periodoStr = periodo ? `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}` : periodoId

  const rows = await db.resultadoConciliacionTC1.findMany({
    where: { periodo_id: periodoId, ...(orId ? { or_id: orId } : {}) },
    orderBy: { codigo_frontera: "asc" },
  })

  const nivelRows = rows.filter(r => r.diff_nivel_tension).map(r => ({
    "SIC": r.codigo_frontera, "Operador": r.operador_red ?? "",
    "Nombre": r.nombre_usuario ?? "",
    "Nivel Tensión Facturación": r.nivel_tension_fac ?? "",
    "Nivel Tensión TC1":         r.nivel_tension_tc1 ?? "",
  }))
  const propRows = rows.filter(r => r.diff_propiedad).map(r => ({
    "SIC": r.codigo_frontera, "Operador": r.operador_red ?? "",
    "Nombre": r.nombre_usuario ?? "",
    "Propiedad Facturación": r.propiedad_fac ?? "",
    "Propiedad TC1":         r.propiedad_tc1 ?? "",
  }))
  const incompletasRows = rows.filter(r => r.caso === "INCOMPLETA").map(r => ({
    "SIC": r.codigo_frontera, "Operador": r.operador_red ?? "",
    "Nombre": r.nombre_usuario ?? "",
    "Motivo": r.observaciones ?? "",
    "Nivel Fac": r.nivel_tension_fac ?? "", "Nivel TC1": r.nivel_tension_tc1 ?? "",
    "Propiedad Fac": r.propiedad_fac ?? "", "Propiedad TC1": r.propiedad_tc1 ?? "",
  }))
  const sinDif = rows.filter(r => r.caso === "SIN_DIFERENCIA").length
  const resumenRows = [
    { "Indicador": "Total fronteras",     "Cantidad": rows.length },
    { "Indicador": "Sin diferencia",      "Cantidad": sinDif },
    { "Indicador": "Nivel de Tensión",    "Cantidad": nivelRows.length },
    { "Indicador": "Propiedad de Activos", "Cantidad": propRows.length },
    { "Indicador": "Incompletas",         "Cantidad": incompletasRows.length },
  ]

  const wb = XLSX.utils.book_new()
  const add = (name: string, data: Record<string, unknown>[]) => {
    const ws = data.length > 0
      ? XLSX.utils.json_to_sheet(data)
      : XLSX.utils.aoa_to_sheet([["Sin fronteras en este indicador"]])
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  add("Resumen", resumenRows)
  add("Nivel Tension", nivelRows)
  add("Propiedad", propRows)
  add("Incompletas", incompletasRows)

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  const fname = `conciliacion_tc1_${periodoStr}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  })
}
