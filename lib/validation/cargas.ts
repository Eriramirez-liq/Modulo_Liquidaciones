/**
 * Zod schemas para los handlers de /api/cargas/*.
 *
 * IMPORTANTE: estos schemas derivan del shape que el handler actual YA acepta.
 * No tightenan validación (si el handler tolera un campo opcional o un valor
 * raro, el schema también). El objetivo de BE-0 es agregar un primer borde
 * de validación runtime sin cambiar el comportamiento funcional.
 *
 * Cualquier endurecimiento adicional debe hacerse en un PR posterior con
 * pruebas explícitas en Vercel preview.
 */

import { z } from "zod"

/**
 * Enum de tipos de fuente aceptados por /api/cargas/preview y
 * /api/cargas/confirmar. Coincide 1:1 con el `switch (tipoFuente)` de
 * los handlers actuales.
 */
export const tipoFuenteSchema = z.enum([
  "FACTURACION",
  "XM",
  "SDL",
  "BALANCE",
  "INSUMOS_STR",
])
export type TipoFuenteInput = z.infer<typeof tipoFuenteSchema>

// ─── /api/cargas/preview ──────────────────────────────────────────────────────
//
// El handler recibe FormData (no JSON) con los siguientes campos:
//   - file: File | null              (modo single-file)
//   - files: File[]                  (modo multi-file, usado por INSUMOS_STR)
//   - anio: number                   (parseado con Number())
//   - mes: number                    (parseado con Number())
//   - tipoFuente: string             (del enum)
//   - orId: string | null            (requerido para SDL/BALANCE — validado en handler)
//
// El schema valida el objeto plano luego de extraer los campos del FormData.
// Las validaciones condicionales (SDL requiere orId, INSUMOS_STR requiere
// filesMulti, etc.) permanecen en el handler porque dependen del shape
// completo + files.

/**
 * Shape plano del body de /api/cargas/preview luego de extraer FormData.
 * No valida los `File` (Zod no tiene tipo nativo para File en runtime
 * de Node; el handler ya verifica `file != null || filesMulti.length > 0`).
 */
export const previewBodySchema = z.object({
  anio: z
    .number()
    .int()
    .min(1900)
    .max(9999),
  mes: z
    .number()
    .int()
    .min(1)
    .max(12),
  tipoFuente: tipoFuenteSchema,
  // El handler hace `orId as string | null`. Aceptamos null, undefined o string.
  orId: z.string().min(1).nullable().optional(),
})
export type PreviewBody = z.infer<typeof previewBodySchema>

/**
 * Helper para construir el objeto a validar a partir de un FormData de Next.
 * NO consume los File* — esos quedan en el FormData original.
 */
export function extractPreviewBody(formData: FormData): unknown {
  const anioRaw = formData.get("anio")
  const mesRaw = formData.get("mes")
  const tipoFuente = formData.get("tipoFuente")
  const orId = formData.get("orId")
  return {
    anio: anioRaw != null ? Number(anioRaw) : NaN,
    mes: mesRaw != null ? Number(mesRaw) : NaN,
    tipoFuente: tipoFuente,
    orId: orId === null || orId === "" ? null : orId,
  }
}

// ─── /api/cargas/confirmar ────────────────────────────────────────────────────
//
// El handler actual define un tipo TypeScript local:
//   interface ConfirmarBody {
//     meta: {
//       anio: number
//       mes: number
//       tipoFuente: "FACTURACION" | "XM" | "SDL" | "BALANCE" | "INSUMOS_STR"
//       orId?: string
//       nombreArchivo: string
//     }
//     filasCompletas: unknown[]
//     justificacion?: string
//     cargaPreviaId?: string
//   }
//
// Replico ese shape sin endurecer:
//   - filasCompletas queda como array de unknown (cada tipoFuente las castea)
//   - justificacion y cargaPreviaId quedan opcionales
//   - El handler ya valida `cargaPreviaId && !justificacion` por su cuenta.

export const confirmarMetaSchema = z.object({
  anio: z
    .number()
    .int()
    .min(1900)
    .max(9999),
  mes: z
    .number()
    .int()
    .min(1)
    .max(12),
  tipoFuente: tipoFuenteSchema,
  orId: z.string().min(1).optional(),
  // El flow de Facturacion-Metabase no tiene archivo fisico; WizardCarga.tsx
  // envia `file?.name ?? ""`. Aceptamos string vacio para preservar el
  // comportamiento previo a BE-0.
  nombreArchivo: z.string(),
})

/**
 * Accion a tomar cuando ya existe una carga COMPLETADA para
 * (periodo, tipoFuente, orId):
 *   - "reemplazar" (default): borra los registros de la carga previa
 *     y la marca como reemplazada en audit trail. Requiere justificacion.
 *   - "agregar": solo permitido para EEP_PEREIRA SDL — la nueva carga
 *     coexiste con la previa (fronteras complementarias por NT).
 */
export const accionCargaPreviaSchema = z.enum(["reemplazar", "agregar"])

export const confirmarBodySchema = z.object({
  meta: confirmarMetaSchema,
  // unknown[] preservado: cada handler interno hace su propio cast a FilaXxx.
  // default([]) mantiene compatibilidad con INSUMOS_STR cuando el FE no envía filas.
  filasCompletas: z.array(z.unknown()).default([]),
  justificacion: z.string().optional(),
  cargaPreviaId: z.string().min(1).optional(),
  accionCargaPrevia: accionCargaPreviaSchema.optional(),
})
export type ConfirmarBody = z.infer<typeof confirmarBodySchema>
