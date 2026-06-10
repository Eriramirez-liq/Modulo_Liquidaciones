import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ejecutarCardMetabase, MetabaseError } from "@/lib/integrations/metabase"
import { mapearFilasXMMetabase } from "@/lib/parsers/xm-metabase"
import { esPeriodoPermitido } from "@/lib/utils/periodos"

/**
 * POST /api/cargas/preview-xm-metabase
 *
 * Reemplaza la carga de archivo XM por una consulta a Metabase
 * (card 76099 — aenc-xm-final). Filtra por mes de consumo (fecha_inicio /
 * fecha_fin), version=TxF y todos los codigos SIC. El dato es la columna
 * "total aenc_div_perdidas".
 *
 * Body: { anio, mes }
 */
export const runtime    = "nodejs"
export const maxDuration = 60

// https://bia.metabaseapp.com/question/76099-aenc-xm-final
const METABASE_CARD_ID = 76099

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  let body: { anio?: number; mes?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 })
  }
  const anio = Number(body.anio)
  const mes  = Number(body.mes)
  if (!anio || !mes) {
    return NextResponse.json({ error: "Parametros anio y mes son obligatorios." }, { status: 400 })
  }
  if (!esPeriodoPermitido(anio, mes)) {
    return NextResponse.json(
      { error: "Solo se puede cargar hasta el mes anterior (mes de consumo)." },
      { status: 400 },
    )
  }

  const periodoStr   = `${anio}-${String(mes).padStart(2, "0")}`
  const mm           = String(mes).padStart(2, "0")
  const ultimoDia    = new Date(anio, mes, 0).getDate()
  const fechaInicio  = `${anio}-${mm}-01`
  const fechaFin     = `${anio}-${mm}-${String(ultimoDia).padStart(2, "0")}`

  // Parametros de la card (template-tags). El tipo debe coincidir con el widget
  // de cada template-tag: fecha_inicio/fecha_fin son de tipo fecha
  // (date/single); version es de tipo texto (string/=, segun exige Metabase).
  // codigo_sic se omite para traer todos.
  const parameters = [
    { type: "date/single", target: ["variable", ["template-tag", "fecha_inicio"]], value: fechaInicio },
    { type: "date/single", target: ["variable", ["template-tag", "fecha_fin"]],    value: fechaFin },
    { type: "string/=",    target: ["variable", ["template-tag", "version"]],      value: "TxF" },
  ] as Array<Record<string, unknown>>

  let resultado
  try {
    // La card de XM (todos los SIC del mes) puede tardar; subimos el timeout
    // del cliente a 55s (dentro del maxDuration de 60s de la funcion).
    resultado = await ejecutarCardMetabase({ cardId: METABASE_CARD_ID, parameters, timeoutMs: 55_000 })
  } catch (e) {
    if (e instanceof MetabaseError) {
      return NextResponse.json(
        { error: e.message, detalle: e.body ?? undefined, status: e.status },
        { status: 502 },
      )
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Error al consultar Metabase: ${msg}` }, { status: 500 })
  }

  const alertas: string[] = []
  const mapeo = mapearFilasXMMetabase(resultado.rows, resultado.columnas, periodoStr)
  alertas.push(...mapeo.alertas)
  if (mapeo.erroresCriticos.length > 0) {
    return NextResponse.json({
      preview: [], filasCompletas: [], total: 0,
      columnas: resultado.columnas,
      alertas, erroresCriticos: mapeo.erroresCriticos,
      existeCargaPrevia: false, cargaPreviaId: undefined,
    })
  }

  alertas.push(
    `Metabase: ${resultado.rows.length} filas (${fechaInicio} a ${fechaFin}, version TxF) → ${mapeo.filas.length} fronteras.`,
  )

  // Verificar carga previa de XM para el periodo.
  let existeCargaPrevia = false
  let cargaPreviaId: string | undefined
  const periodoExistente = await db.periodoConciliacion.findUnique({
    where: { uq_periodo_anio_mes: { anio, mes } },
    select: { id: true },
  })
  if (periodoExistente) {
    const cargaPrevia = await db.cargaFuente.findFirst({
      where: { periodo_id: periodoExistente.id, tipo_fuente: "XM", estado: "COMPLETADA" },
      orderBy: { createdAt: "desc" },
    })
    if (cargaPrevia) {
      existeCargaPrevia = true
      cargaPreviaId = cargaPrevia.id
    }
  }

  return NextResponse.json({
    preview:        mapeo.filas.slice(0, 20),
    filasCompletas: mapeo.filas,
    total:          mapeo.filas.length,
    columnas:       resultado.columnas,
    alertas,
    erroresCriticos: [],
    existeCargaPrevia,
    cargaPreviaId,
  })
}
