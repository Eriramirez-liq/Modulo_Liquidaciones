import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import * as XLSX from "xlsx"
import { listarGestiones, type ConceptoGestionStr, type FilaGestion } from "@/lib/engine/gestiones"

/**
 * GET /api/gestiones/exportar?concepto=SDL|TC1|COT&periodoId=<CUID>&orId=<opcional>
 *
 * Exporta a .xlsx las fronteras con diferencias del concepto (mismos filtros que
 * /api/gestiones). Reusa `listarGestiones`.
 */
export const runtime = "nodejs"

const ACCION_LABEL: Record<string, string> = {
  CAMBIO_SOLICITADO_OR: "Cambio solicitado al OR",
  AJUSTE_NO_PROCEDE:    "Ajuste no procede",
  ERROR_BIA:            "Error BIA",
  AJUSTE_APLICADO:      "Ajuste aplicado",
}
const CAMPO_LABEL: Record<string, string> = {
  activa: "Activa", inductiva: "Inductiva", capacitiva: "Capacitiva",
  factor_m: "Factor M", nivel_tension: "Nivel tensión", propiedad: "Propiedad",
  incompleta: "Incompleta",
}

function diffsTexto(f: FilaGestion): string {
  return f.diffs
    .map((d) =>
      d.campo === "incompleta"
        ? "Incompleta"
        : `${CAMPO_LABEL[d.campo] ?? d.campo}: ${d.fac ?? "—"} → ${d.or ?? "—"}`,
    )
    .join(" | ")
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const concepto = (searchParams.get("concepto") ?? "SDL") as ConceptoGestionStr
  const periodoId = searchParams.get("periodoId") ?? undefined
  const orId = searchParams.get("orId") ?? undefined

  const filas = await listarGestiones(concepto, periodoId, orId)

  const data = filas.map((f) => ({
    "Frontera": f.codigoFrontera,
    "Operador": f.operadorNombre ?? "",
    "Caso": f.caso,
    "Diferencias (BIA → OR)": diffsTexto(f),
    "Accionable": f.gestion ? (ACCION_LABEL[f.gestion.accion] ?? f.gestion.accion) : "Sin gestionar",
    "Datos ajustados": f.gestion
      ? f.gestion.datosAjustados.map((d) => CAMPO_LABEL[d] ?? d).join(", ")
      : "",
    "Observación": f.gestion?.observacion ?? "",
  }))

  const wb = XLSX.utils.book_new()
  const ws =
    data.length > 0
      ? XLSX.utils.json_to_sheet(data)
      : XLSX.utils.aoa_to_sheet([["Sin fronteras con diferencias"]])
  XLSX.utils.book_append_sheet(wb, ws, `Gestiones ${concepto}`)

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  const fname = `gestiones_${concepto}_${periodoId ?? "todos"}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  })
}
