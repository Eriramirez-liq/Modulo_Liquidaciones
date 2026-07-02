/**
 * Obtiene la demanda PROYECTADA por mes de consumo desde Metabase, para los
 * meses proyectados del módulo "Proyección Cargos OR".
 *
 * Card 77419 — "proyeccion demanda":
 *   https://bia.metabaseapp.com/question/77419-proyeccion-demanda
 *
 * Sin parámetros (trae todos los meses). Columnas: `mes` (fecha; mes de
 * consumo) y `total_kwh` (demanda total). Se toma `total_kwh`.
 */

import { ejecutarCardMetabase } from "@/lib/integrations/metabase"

/** ID de la card de proyección de demanda. */
export const CARD_PROYECCION_DEMANDA = 77419

/** Normaliza una columna: lowercase alfanumérico. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Busca en una fila la primera columna cuyo nombre normalizado matchee. */
function valorCol(fila: Record<string, unknown>, ...claves: string[]): unknown {
  const keys = Object.keys(fila)
  for (const clave of claves) {
    const k = keys.find((kk) => norm(kk) === norm(clave))
    if (k !== undefined) return fila[k]
  }
  return undefined
}

/**
 * Convierte el valor de la columna `mes` a "AAAA-MM" (mes de consumo).
 * Acepta ISO ("2026-06-01"...) y strings de fecha ("June 1, 2026").
 */
export function mesAPeriodo(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  // ISO: AAAA-MM(-DD...) — camino más probable del JSON de Metabase.
  const m = s.match(/^(\d{4})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}`
  // Fallback: parseo de fecha (ej. "June 1, 2026"). Usa componentes locales
  // para no correr el mes por zona horaria.
  const d = new Date(s)
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  }
  return null
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""))
  return Number.isFinite(n) ? n : null
}

/**
 * Devuelve un mapa `periodoConsumo ("AAAA-MM") -> total_kwh`.
 * Lanza MetabaseError si Metabase falla.
 */
export async function obtenerDemandaProyectada(
  timeoutMs = 30_000,
): Promise<Map<string, number>> {
  const { rows } = await ejecutarCardMetabase({ cardId: CARD_PROYECCION_DEMANDA, timeoutMs })
  const map = new Map<string, number>()
  for (const r of rows) {
    const periodo = mesAPeriodo(valorCol(r, "mes", "periodo", "month"))
    const total = toNum(valorCol(r, "total_kwh", "totalkwh", "total", "demanda_total"))
    if (periodo && total != null) map.set(periodo, total)
  }
  return map
}
