/**
 * Zod schemas para los handlers de `/api/cargos-str/netsuite/*` (BE-3+).
 *
 * Sigue el estilo de `lib/validation/cargas.ts`: schemas explícitos en el borde,
 * tipos derivados con `z.infer`. La validación corre ANTES de tocar la DB.
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.2 (endpoint 1, endpoint 4).
 */

import { z } from "zod"
import { MAX_ENVIOS_POR_LOTE } from "@/lib/integrations/netsuite/config"

// ─── POST /api/cargos-str/netsuite/lote ────────────────────────────────────────
//
// El frontend envía `orCodigo` (string como "OR-AFINIA", D1+D6), no el UUID.
// El servicio resuelve `orCodigo → or_id` internamente.

export const cargoInputSchema = z.object({
  periodoId: z.string().min(1),
  orCodigo: z.string().min(1).max(64),
})
export type CargoInputBody = z.infer<typeof cargoInputSchema>

export const crearLoteSchema = z.object({
  cargos: z.array(cargoInputSchema).min(1).max(MAX_ENVIOS_POR_LOTE),
})
export type CrearLoteBody = z.infer<typeof crearLoteSchema>

// ─── GET /api/cargos-str/netsuite/estados ──────────────────────────────────────
//
// Query params CSV: ?periodoIds=a,b,c&orCodigos=OR-AFINIA,OR-AIRE
// El handler extrae los strings crudos del searchParams y los pasa por este
// helper para obtener arrays limpios (sin vacíos) y validados.

/** Convierte un CSV crudo en lista de strings no vacíos (trim + filtro). */
function csvToList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export const estadosQuerySchema = z.object({
  periodoIds: z.array(z.string().min(1)).min(1),
  orCodigos: z.array(z.string().min(1).max(64)).min(1),
})
export type EstadosQuery = z.infer<typeof estadosQuerySchema>

/**
 * Construye el objeto a validar a partir de los searchParams crudos del handler.
 * El handler luego hace `estadosQuerySchema.safeParse(extractEstadosQuery(sp))`.
 */
export function extractEstadosQuery(searchParams: URLSearchParams): unknown {
  return {
    periodoIds: csvToList(searchParams.get("periodoIds")),
    orCodigos: csvToList(searchParams.get("orCodigos")),
  }
}
