/**
 * Validacion Zod del modulo Gestiones (POST /api/gestiones/accionable).
 *
 * Se valida en el borde ANTES de tocar la DB. La regla condicional de
 * AJUSTE_APLICADO (datosAjustados obligatorio y subconjunto de campos
 * ajustables) se resuelve con superRefine.
 */

import { z } from "zod"
import { ConceptoGestion, AccionGestion } from "@prisma/client"
import { CAMPOS_AJUSTABLES } from "@/lib/engine/gestiones"

// z.enum a partir de la tupla de campos ajustables (comparte fuente con el engine).
const campoAjustableSchema = z.enum(CAMPOS_AJUSTABLES)

export const accionableSchema = z
  .object({
    periodoId: z.string().min(1, "periodoId requerido"),
    concepto: z.nativeEnum(ConceptoGestion),
    codigoFrontera: z.string().min(1, "codigoFrontera requerido"),
    orId: z.string().min(1).nullish(),
    accion: z.nativeEnum(AccionGestion),
    datosAjustados: z.array(campoAjustableSchema).optional(),
    observacion: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.accion === AccionGestion.AJUSTE_APLICADO) {
      // Debe traer al menos un campo ajustable (el z.enum ya garantiza que sean
      // del subconjunto valido).
      if (!data.datosAjustados || data.datosAjustados.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["datosAjustados"],
          message: "AJUSTE_APLICADO requiere al menos un campo en datosAjustados.",
        })
      }
    }
  })

export type AccionableInput = z.infer<typeof accionableSchema>
