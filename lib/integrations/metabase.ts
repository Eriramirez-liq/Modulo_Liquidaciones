/**
 * Cliente minimalista para la API de Metabase.
 *
 * Ejecuta una pregunta guardada (card) y retorna las filas como un array
 * de objetos. Autenticacion via X-API-KEY (variable de entorno).
 *
 * Variables de entorno requeridas (Vercel):
 *   - METABASE_API_KEY   (obligatoria) — la API key de la cuenta de servicio
 *   - METABASE_BASE_URL  (opcional)    — default "https://bia.metabaseapp.com"
 */

const DEFAULT_BASE_URL = "https://bia.metabaseapp.com"

export interface MetabaseQueryResult {
  /** Filas como objetos con las columnas como claves */
  rows: Record<string, unknown>[]
  /** Nombres de las columnas en el orden devuelto por Metabase */
  columnas: string[]
}

export interface MetabaseQueryOptions {
  /** ID numérico de la card (pregunta guardada) en Metabase */
  cardId: number
  /**
   * Parámetros opcionales para queries parametrizadas.
   * Cada uno con la estructura que pide Metabase:
   *   { type, target, value }
   * Ver https://www.metabase.com/docs/latest/api/card
   */
  parameters?: Array<Record<string, unknown>>
  /** Timeout en milisegundos (default 30 s) */
  timeoutMs?: number
}

export class MetabaseError extends Error {
  status?: number
  body?: string
  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.name = "MetabaseError"
    this.status = status
    this.body = body
  }
}

function getApiKey(): string {
  const key = process.env.METABASE_API_KEY
  if (!key) {
    throw new MetabaseError("METABASE_API_KEY no configurada en el servidor.")
  }
  return key
}

function getBaseUrl(): string {
  return (process.env.METABASE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "")
}

/** Definición de un parámetro de una card (para queries parametrizadas). */
export interface MetabaseParametro {
  id?: string
  type?: string
  target?: unknown
  slug?: string
  name?: string
  [k: string]: unknown
}

/**
 * Lee la metadata de una card (GET /api/card/{id}) y retorna su lista de
 * parámetros. Sirve para queries parametrizadas: se reutiliza el objeto de
 * cada parámetro (id/type/target) y solo se le inyecta el `value`, evitando
 * adivinar el `target` del template-tag.
 */
export async function obtenerParametrosCard(
  cardId: number,
  timeoutMs = 15_000,
): Promise<MetabaseParametro[]> {
  const apiKey  = getApiKey()
  const baseUrl = getBaseUrl()
  const url = `${baseUrl}/api/card/${cardId}`

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { "X-API-KEY": apiKey },
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(t)
    if ((e as Error).name === "AbortError") {
      throw new MetabaseError(`Timeout al leer la card ${cardId} (>${timeoutMs / 1000}s).`)
    }
    throw new MetabaseError(`Error de red al leer la card ${cardId}: ${(e as Error).message}`)
  }
  clearTimeout(t)

  if (!res.ok) {
    let body = ""
    try { body = await res.text() } catch { /* ignore */ }
    throw new MetabaseError(
      `Metabase respondio ${res.status} al leer la card ${cardId}`,
      res.status,
      body.slice(0, 500),
    )
  }

  let data: unknown
  try { data = await res.json() } catch (e) {
    throw new MetabaseError(`Metadata de card ${cardId} no es JSON valido: ${(e as Error).message}`)
  }
  const params = (data as { parameters?: unknown }).parameters
  return Array.isArray(params) ? (params as MetabaseParametro[]) : []
}

/**
 * Ejecuta una pregunta guardada en Metabase y retorna las filas.
 *
 * Usa el endpoint /api/card/{id}/query/json que retorna un array de objetos
 * (mas conveniente que /query que retorna { rows, cols } por separado).
 */
export async function ejecutarCardMetabase(
  opts: MetabaseQueryOptions,
): Promise<MetabaseQueryResult> {
  const { cardId, parameters = [], timeoutMs = 30_000 } = opts
  const apiKey  = getApiKey()
  const baseUrl = getBaseUrl()

  const url = `${baseUrl}/api/card/${cardId}/query/json`

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY":    apiKey,
      },
      body: JSON.stringify({ parameters }),
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(t)
    if ((e as Error).name === "AbortError") {
      throw new MetabaseError(`Timeout al conectar con Metabase (>${timeoutMs / 1000}s).`)
    }
    throw new MetabaseError(`Error de red al conectar con Metabase: ${(e as Error).message}`)
  }
  clearTimeout(t)

  if (!res.ok) {
    let body = ""
    try { body = await res.text() } catch { /* ignore */ }
    throw new MetabaseError(
      `Metabase respondio ${res.status} ${res.statusText}`,
      res.status,
      body.slice(0, 500),
    )
  }

  let data: unknown
  try {
    data = await res.json()
  } catch (e) {
    throw new MetabaseError(`Respuesta de Metabase no es JSON valido: ${(e as Error).message}`)
  }

  if (!Array.isArray(data)) {
    throw new MetabaseError(
      `Respuesta inesperada de Metabase: se esperaba array, llego ${typeof data}.`,
    )
  }

  const rows = data as Record<string, unknown>[]
  const columnas = rows.length > 0 ? Object.keys(rows[0] ?? {}) : []

  return { rows, columnas }
}
