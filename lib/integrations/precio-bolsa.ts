/**
 * Obtiene la "G de bolsa" (precio de bolsa nacional promedio) desde Metabase
 * para un mes de CONSUMO. Se usa en las fórmulas de Pérdida de la conciliación
 * SDL: (xm - fac) × (g_bolsa + t + d + pr + r).
 *
 * Card de Metabase 1237 — "Precio_Bolsa_Nacional_Dia -jpq":
 *   https://bia.metabaseapp.com/question/1237-precio-bolsa-nacional-dia-jpq
 *
 * Parámetros (fijos salvo la fecha):
 *   - date_type = "month"  (siempre)
 *   - version   = "TxF"    (siempre)
 *   - date      = rango del mes de consumo, ej. "2026-05-01~2026-05-31"
 *
 * Devuelve la columna `promedio_precio_bolsa_nacional` (una sola fila por mes).
 */

import {
  ejecutarCardMetabase,
  obtenerParametrosCard,
  type MetabaseParametro,
} from "@/lib/integrations/metabase"

/** ID de la card de precio de bolsa nacional. */
export const CARD_PRECIO_BOLSA = 1237

/** Nombre de la columna con el valor promedio de precio de bolsa. */
const COL_PRECIO = "promedio_precio_bolsa_nacional"

/** Valores fijos que exige la card, por slug de parámetro. */
type ValoresPorSlug = Record<string, string>

/**
 * Construye el rango de fechas "AAAA-MM-01~AAAA-MM-<ultimoDia>" para el mes.
 * @param anio año de consumo
 * @param mes  mes de consumo (1..12)
 */
export function rangoMesConsumo(anio: number, mes: number): string {
  const mm = String(mes).padStart(2, "0")
  // new Date(anio, mes, 0) = último día del mes `mes` (mes es 1-based aquí).
  const ultimoDia = new Date(anio, mes, 0).getDate()
  const dd = String(ultimoDia).padStart(2, "0")
  return `${anio}-${mm}-01~${anio}-${mm}-${dd}`
}

/**
 * Arma el array de parámetros para la card. Reutiliza la metadata real de la
 * card (id/type/target por slug) e inyecta los valores. Si la card no expone
 * esos slugs, cae a una construcción por template-tag (best-effort).
 */
function construirParametros(
  metadata: MetabaseParametro[],
  valores: ValoresPorSlug,
): Array<Record<string, unknown>> {
  const porMetadata = metadata
    .filter((p) => typeof p.slug === "string" && p.slug in valores)
    .map((p) => ({ ...p, value: valores[p.slug as string] }))

  if (porMetadata.length > 0) return porMetadata

  // Fallback: construir por template-tag si la metadata no trajo los parámetros.
  return [
    { type: "category",   target: ["variable", ["template-tag", "date_type"]], value: valores.date_type },
    { type: "category",   target: ["variable", ["template-tag", "version"]],   value: valores.version },
    { type: "date/range", target: ["variable", ["template-tag", "date"]],      value: valores.date },
  ]
}

export interface GBolsaResultado {
  /** Precio de bolsa promedio (COP/kWh). null si la query no devolvió valor. */
  valor: number | null
  /** Rango de fecha usado en la query. */
  rango: string
  /** Período de consumo "AAAA-MM". */
  periodoConsumo: string
}

/**
 * Consulta la card 1237 y devuelve la G de bolsa del mes de consumo dado.
 * Lanza MetabaseError si Metabase falla; devuelve valor=null si no hay fila.
 */
export async function obtenerGBolsaNacional(
  anio: number,
  mes: number,
  timeoutMs = 30_000,
): Promise<GBolsaResultado> {
  const rango = rangoMesConsumo(anio, mes)
  const periodoConsumo = `${anio}-${String(mes).padStart(2, "0")}`

  const valores: ValoresPorSlug = { date_type: "month", version: "TxF", date: rango }

  const metadata = await obtenerParametrosCard(CARD_PRECIO_BOLSA, Math.min(timeoutMs, 15_000))
  const parameters = construirParametros(metadata, valores)

  const { rows } = await ejecutarCardMetabase({
    cardId: CARD_PRECIO_BOLSA,
    parameters,
    timeoutMs,
  })

  const fila = rows[0]
  if (!fila) return { valor: null, rango, periodoConsumo }

  // Buscar la columna por nombre exacto y, si no, por coincidencia laxa.
  let raw = fila[COL_PRECIO]
  if (raw == null) {
    const clave = Object.keys(fila).find((k) =>
      k.toLowerCase().replace(/[^a-z]/g, "").includes("preciobolsa"),
    )
    if (clave) raw = fila[clave]
  }

  const n = Number(raw)
  return { valor: Number.isFinite(n) ? n : null, rango, periodoConsumo }
}
