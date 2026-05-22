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

  // 2. Filtrar por la columna "period" usando el periodo seleccionado en el
  //    wizard. La columna puede venir como "period", "Period", "PERIOD"
  //    (busqueda case-insensitive).
  const periodoStr = `${anio}-${String(mes).padStart(2, "0")}`

  const colPeriod = resultado.columnas.find(c => c.toLowerCase() === "period")
  if (!colPeriod) {
    erroresCriticos.push(
      `La query de Metabase no devolvio una columna "period". ` +
      `Columnas disponibles: [${resultado.columnas.join(", ")}]`,
    )
    return NextResponse.json({
      preview: [], filasCompletas: [], total: 0,
      columnas: resultado.columnas,
      alertas, erroresCriticos,
      existeCargaPrevia: false, cargaPreviaId: undefined,
    })
  }

  // Normaliza un valor de la columna "period" a "AAAA-MM".
  // Acepta formatos:
  //   - "2026-04", "2026-04-01", "2026-04-01T..."  → YYYY-MM[-...]
  //   - "2026/04", "2026/04/01"                    → YYYY/MM[/...]
  //   - "04-2026", "04/2026"                       → MM-YYYY o MM/YYYY (formato Metabase)
  function normalizarPeriodo(v: unknown): string | null {
    if (v == null) return null
    const s = String(v).trim()
    if (!s) return null
    // YYYY-MM o YYYY/MM (año primero, 4 digitos)
    let m = s.match(/^(\d{4})[-/](\d{1,2})/)
    if (m) return `${m[1]}-${(m[2] ?? "").padStart(2, "0")}`
    // MM-YYYY o MM/YYYY (mes primero, 1-2 digitos; año 4 digitos)
    m = s.match(/^(\d{1,2})[-/](\d{4})/)
    if (m) return `${m[2]}-${(m[1] ?? "").padStart(2, "0")}`
    return null
  }

  const filtradas = todasFilas.filter(r => normalizarPeriodo(r[colPeriod]) === periodoStr)

  alertas.push(
    `Metabase: ${todasFilas.length} filas totales, ${filtradas.length} coinciden con period = ${periodoStr}.`,
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
