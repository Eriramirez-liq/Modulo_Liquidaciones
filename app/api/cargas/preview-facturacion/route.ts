import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ejecutarCardMetabase, MetabaseError } from "@/lib/integrations/metabase"

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
  const todasFilas = resultado.rows

  // 2. (Pendiente confirmar con el usuario) Filtrar por periodo si la query
  //    retorna multiples meses. Por ahora se devuelve todo; si el usuario
  //    confirma como columna se filtra, se ajusta aqui.
  alertas.push(
    `Metabase devolvio ${todasFilas.length} filas con ${resultado.columnas.length} columnas. ` +
    `Si la query no esta filtrada por periodo (${anio}-${String(mes).padStart(2, "0")}), avisame que columna usar.`,
  )

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
    preview:          todasFilas.slice(0, 20),
    filasCompletas:   todasFilas,
    total:            todasFilas.length,
    columnas:         resultado.columnas,
    alertas,
    erroresCriticos,
    existeCargaPrevia,
    cargaPreviaId,
  })
}
