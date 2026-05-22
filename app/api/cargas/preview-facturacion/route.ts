import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ejecutarCardMetabase, MetabaseError } from "@/lib/integrations/metabase"
import { mapearFilasMetabase } from "@/lib/parsers/facturacion-metabase"

/**
 * POST /api/cargas/preview-facturacion
 *
 * Reemplaza la carga de archivo para Facturacion BIA con una consulta
 * directa a Metabase (card 73360 — validador-sdl).
 *
 * Body: { anio, mes }
 * Response: { preview, filasCompletas, total, alertas, erroresCriticos,
 *             existeCargaPrevia, cargaPreviaId, columnas }
 */

export const runtime    = "nodejs"
export const maxDuration = 60

// ID de la card de Metabase: https://bia.metabaseapp.com/question/73360-validador-sdl
const METABASE_CARD_ID = 73360

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

  // No permitir periodos futuros
  const ahora = new Date()
  if (anio > ahora.getFullYear() || (anio === ahora.getFullYear() && mes > ahora.getMonth() + 1)) {
    return NextResponse.json(
      { error: "No se pueden cargar archivos para periodos futuros." },
      { status: 400 },
    )
  }

  // 1. Ejecutar query en Metabase
  let resultado
  try {
    resultado = await ejecutarCardMetabase({ cardId: METABASE_CARD_ID })
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

  const alertas: string[]         = []
  const erroresCriticos: string[] = []
  const periodoStr = `${anio}-${String(mes).padStart(2, "0")}`

  // 2. Mapear las filas crudas de Metabase al shape FilaFacturacion
  //    (deriva nivel_tension + propiedad_activos del NT, normaliza periodo,
  //    valida columnas requeridas).
  const mapeo = mapearFilasMetabase(resultado.rows, resultado.columnas)
  alertas.push(...mapeo.alertas)
  erroresCriticos.push(...mapeo.erroresCriticos)
  if (mapeo.erroresCriticos.length > 0) {
    return NextResponse.json({
      preview: [], filasCompletas: [], total: 0,
      columnas: resultado.columnas,
      alertas, erroresCriticos,
      existeCargaPrevia: false, cargaPreviaId: undefined,
    })
  }

  // 3. Filtrar por periodo seleccionado en el wizard
  const filtradas = mapeo.filas.filter(f => f.periodo === periodoStr)

  alertas.push(
    `Metabase: ${resultado.rows.length} filas totales, ${filtradas.length} coinciden con period = ${periodoStr}.`,
  )

  if (filtradas.length === 0) {
    alertas.push(
      `No hay registros para el periodo ${periodoStr}. Verifica que la query de Metabase tenga datos cargados para ese mes.`,
    )
  }

  // 3. Verificar carga previa
  let existeCargaPrevia = false
  let cargaPreviaId: string | undefined
  const periodoExistente = await db.periodoConciliacion.findUnique({
    where: { uq_periodo_anio_mes: { anio, mes } },
    select: { id: true },
  })
  if (periodoExistente) {
    const cargaPrevia = await db.cargaFuente.findFirst({
      where: {
        periodo_id: periodoExistente.id,
        tipo_fuente: "FACTURACION",
        estado: "COMPLETADA",
      },
      orderBy: { createdAt: "desc" },
    })
    if (cargaPrevia) {
      existeCargaPrevia = true
      cargaPreviaId = cargaPrevia.id
    }
  }

  return NextResponse.json({
    preview:          filtradas.slice(0, 20),
    filasCompletas:   filtradas,
    total:            filtradas.length,
    columnas:         resultado.columnas,
    alertas,
    erroresCriticos,
    existeCargaPrevia,
    cargaPreviaId,
  })
}
