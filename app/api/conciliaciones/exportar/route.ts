import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import * as XLSX from "xlsx"

/**
 * GET /api/conciliaciones/exportar?periodoId=X&orId=Y
 *
 * Genera un .xlsx con el resultado de la conciliacion del periodo. Una hoja
 * por indicador, mostrando las fronteras con diferencia:
 *   - Resumen          (conteos por indicador)
 *   - Activa           (fronteras con diferencia en activa + tipo y valor)
 *   - Inductiva        (reactiva inductiva fac vs or + delta)
 *   - Capacitiva       (reactiva capacitiva fac vs or + delta)
 *   - Factor M         (fac vs or)
 *   - Nivel Tension    (fac vs or)
 *   - Propiedad        (fac vs or)
 *   - Incompletas      (sin match en alguna fuente)
 *
 * Requiere auth (cookie). Devuelve el archivo como descarga.
 */
export const runtime = "nodejs"

const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoId = searchParams.get("periodoId")
  const orId      = searchParams.get("orId") ?? undefined
  if (!periodoId) {
    return NextResponse.json({ error: "periodoId requerido" }, { status: 400 })
  }

  const periodo = await db.periodoConciliacion.findUnique({
    where: { id: periodoId },
    select: { anio: true, mes: true },
  })
  const periodoStr = periodo ? `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}` : periodoId

  const rows = await db.resultadoConciliacion.findMany({
    where: {
      periodo_id: periodoId,
      ...(orId ? { or_id: orId } : {}),
    },
    include: { or_obj: { select: { codigo: true, nombre: true } } },
    orderBy: { codigo_frontera: "asc" },
  })

  const operadorDe = (r: typeof rows[number]) => r.or_obj?.nombre ?? r.operador_red ?? ""

  // ── Hoja Activa ────────────────────────────────────────────────────────────
  const activaRows = rows
    .filter(r => r.caso !== "A1" && r.caso !== "INCOMPLETA" && r.caso !== "ERROR")
    .map(r => {
      let tipo = r.caso as string
      let valor: number | null = null
      if (r.resultado_l1 === "PROVISION_L1")        { tipo = "Provisión"; valor = num(r.impacto_financiero_l1) }
      else if (r.resultado_l1 === "CONTINGENCIA_L1") { tipo = "Pérdida";   valor = num(r.impacto_financiero_l1) }
      else if (r.resultado_l2 === "DISPUTA_L2")      { tipo = "Disputa";   valor = num(r.impacto_financiero_l2) }
      const eFac = num(r.e_fac), eOr = num(r.e_sdl), eXm = num(r.e_xm)
      return {
        "SIC": r.codigo_frontera,
        "Operador": operadorDe(r),
        "Nombre": r.nombre_usuario ?? "",
        "Activa Facturada (kWh)": eFac,
        "Activa OR (kWh)":        eOr,
        "Activa XM (kWh)":        eXm,
        "Dif Fac-XM (kWh)":       (eFac != null && eXm != null) ? eFac - eXm : null,
        "Dif Fac-OR (kWh)":       (eFac != null && eOr != null) ? eFac - eOr : null,
        "Caso": r.caso,
        "Tipo": tipo,
        "Valor (COP)": valor,
        "Observaciones": r.observaciones ?? "",
      }
    })

  // ── Hojas reactivas ──────────────────────────────────────────────────────
  const inductivaRows = rows.filter(r => r.diff_inductiva).map(r => ({
    "SIC": r.codigo_frontera,
    "Operador": operadorDe(r),
    "Inductiva Pen. Facturada (kWh)": num(r.ind_pen_fac),
    "Inductiva Pen. OR (kWh)":        num(r.ind_pen_sdl),
    "Dif Fac-OR (kWh)":               num(r.ind_pen_delta),
  }))

  const capacitivaRows = rows.filter(r => r.diff_capacitiva).map(r => ({
    "SIC": r.codigo_frontera,
    "Operador": operadorDe(r),
    "Capacitiva Pen. Facturada (kWh)": num(r.cap_pen_fac),
    "Capacitiva Pen. OR (kWh)":        num(r.cap_pen_sdl),
    "Dif Fac-OR (kWh)":                num(r.cap_pen_delta),
  }))

  const factorMRows = rows.filter(r => r.diff_factor_m).map(r => ({
    "SIC": r.codigo_frontera,
    "Operador": operadorDe(r),
    "Factor M Facturado": num(r.factor_m_fac),
    "Factor M OR":        num(r.factor_m_sdl),
  }))

  const nivelTRows = rows.filter(r => r.diff_nivel_tension).map(r => ({
    "SIC": r.codigo_frontera,
    "Operador": operadorDe(r),
    "Nivel Tensión Facturado": r.nivel_tension_fac ?? "",
    "Nivel Tensión OR":        r.nivel_tension_sdl ?? "",
  }))

  const propiedadRows = rows.filter(r => r.diff_propiedad).map(r => ({
    "SIC": r.codigo_frontera,
    "Operador": operadorDe(r),
    "Propiedad Activos Facturado": r.propiedad_activos_fac ?? "",
    "Propiedad Activos OR":        r.propiedad_activos_sdl ?? "",
  }))

  const incompletasRows = rows
    .filter(r => r.caso === "INCOMPLETA" || r.caso === "ERROR")
    .map(r => ({
      "SIC": r.codigo_frontera,
      "Operador": operadorDe(r),
      "Motivo": r.observaciones ?? "",
      "Activa Facturada (kWh)": num(r.e_fac),
      "Activa OR (kWh)":        num(r.e_sdl),
      "Activa XM (kWh)":        num(r.e_xm),
    }))

  // ── Hoja Resumen ─────────────────────────────────────────────────────────
  const sinDif = rows.filter(r =>
    r.caso === "A1" && !r.diff_inductiva && !r.diff_capacitiva &&
    !r.diff_factor_m && !r.diff_nivel_tension && !r.diff_propiedad
  ).length
  const resumenRows = [
    { "Indicador": "Total fronteras",        "Cantidad": rows.length },
    { "Indicador": "Sin diferencia",         "Cantidad": sinDif },
    { "Indicador": "Activa (con diferencia)", "Cantidad": activaRows.length },
    { "Indicador": "Inductiva",              "Cantidad": inductivaRows.length },
    { "Indicador": "Capacitiva",             "Cantidad": capacitivaRows.length },
    { "Indicador": "Factor M",               "Cantidad": factorMRows.length },
    { "Indicador": "Nivel de Tensión",       "Cantidad": nivelTRows.length },
    { "Indicador": "Propiedad de Activos",   "Cantidad": propiedadRows.length },
    { "Indicador": "Incompletas / Error",    "Cantidad": incompletasRows.length },
  ]

  // ── Armar workbook ─────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()
  const addSheet = (name: string, data: Record<string, unknown>[]) => {
    // Si no hay filas, igual creamos la hoja con un encabezado informativo.
    const ws = data.length > 0
      ? XLSX.utils.json_to_sheet(data)
      : XLSX.utils.aoa_to_sheet([["Sin fronteras en este indicador"]])
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  addSheet("Resumen", resumenRows)
  addSheet("Activa", activaRows)
  addSheet("Inductiva", inductivaRows)
  addSheet("Capacitiva", capacitivaRows)
  addSheet("Factor M", factorMRows)
  addSheet("Nivel Tension", nivelTRows)
  addSheet("Propiedad Activos", propiedadRows)
  addSheet("Incompletas", incompletasRows)

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer

  const fname = `conciliacion_${periodoStr}${orId ? "_" + (rows[0]?.or_obj?.codigo ?? "OR") : ""}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  })
}
