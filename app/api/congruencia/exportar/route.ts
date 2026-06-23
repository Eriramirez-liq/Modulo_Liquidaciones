import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import * as XLSX from "xlsx"
import { obtenerReporteCongruencia } from "@/lib/engine/congruencia-reporte"

/**
 * GET /api/congruencia/exportar?periodoId=<CUID>&orCodigo=<opcional>&estado=<opcional>
 *
 * Exporta a .xlsx el reporte de diferencias de congruencia (mismos filtros que
 * /api/congruencia). Reusa `obtenerReporteCongruencia`.
 */
export const runtime = "nodejs"

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
  const periodoStr = periodo
    ? `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`
    : periodoId

  const todas = periodo ? await obtenerReporteCongruencia(periodoStr) : []
  const filas = todas.filter(
    (f) => (!orCodigo || f.or === orCodigo) && (!estado || f.estado === estado),
  )

  // Mapear a las columnas exactas requeridas.
  const data = filas.map((f) => ({
    "SIC": f.sic,
    "OR": f.or ?? "",
    "Estado": f.estado,
    "Diferencia": f.diferencia,
    "Dato errado": f.datoErrado,
    "Dato correcto": f.datoCorrecto,
  }))

  const wb = XLSX.utils.book_new()
  const ws =
    data.length > 0
      ? XLSX.utils.json_to_sheet(data)
      : XLSX.utils.aoa_to_sheet([["Sin diferencias"]])
  XLSX.utils.book_append_sheet(wb, ws, "Diferencias")

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  const fname = `congruencia_${periodoStr}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  })
}
