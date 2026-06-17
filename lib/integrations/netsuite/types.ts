/**
 * Tipos públicos del módulo de integración NetSuite (Cargos STR) + tipos del
 * cliente HTTP (payload/respuesta) y los Zod schemas que validan la RESPUESTA
 * de NetSuite.
 *
 * Los DTOs (EnvioDto, LoteDto, EstadoEnvioPorCargoDto) son el contrato que el
 * frontend YA consume (ver `_dev/mocks/netsuite.ts` y `components/cargos-str/
 * types.ts`). Deben coincidir EXACTO. Los handlers de BE-3+ los serializan tal
 * cual; cualquier adaptación de forma (p.ej. `loteId`/`totalEnvios` sueltos del
 * mock) la arma el handler, no la capa de servicio.
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.2 (contrato canónico = LoteDto
 * con `id`), §B.3, R4.
 */

import { z } from "zod"

// ─── Estados (espejo de los enums de Prisma como union de strings) ─────────────

export type EstadoLoteNetsuite = "EN_PROGRESO" | "COMPLETADO" | "CANCELADO"
export type EstadoEnvioNetsuite = "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR"

// ─── DTOs (contrato con el frontend) ───────────────────────────────────────────

/**
 * Un envío individual tal como lo consume la UI.
 *
 * `montoSnapshotCop` es SIEMPRE string (ej. "123456.78") para preservar la
 * precisión decimal: nunca se serializa como Number.
 */
export interface EnvioDto {
  id: string
  periodoId: string
  orId: string
  orCodigo: string
  orNombre: string
  montoSnapshotCop: string
  mesConsumo: string
  mesFacturacion: string
  estado: EstadoEnvioNetsuite
  intentos: number
  numeroOc: string | null
  netsuiteInternalId: string | null
  errorMensaje: string | null
  errorCodigo: string | null
  enviadoAt: string | null
  respondidoAt: string | null
}

/**
 * Un lote con sus envíos. Contrato canónico del plan §B.2: usa `id` (no `loteId`)
 * y `finalizadoAt`. Los totales se calculan a partir de los envíos.
 */
export interface LoteDto {
  id: string
  estado: EstadoLoteNetsuite
  iniciadoAt: string
  finalizadoAt: string | null
  iniciadoPor: { id: string; nombre: string }
  totales: {
    total: number
    pendientes: number
    procesados: number
    errores: number
  }
  envios: EnvioDto[]
}

/**
 * Último estado de envío por cargo `(periodoId, orCodigo)`.
 * Lo consume el endpoint 4 para pintar los badges del pivot.
 */
export interface EstadoEnvioPorCargoDto {
  ultimoEnvioId: string
  estado: EstadoEnvioNetsuite
  numeroOc: string | null
  errorMensaje: string | null
  loteId: string
  fecha: string // ISO 8601
}

/**
 * Entrada de un cargo en `crearLote`. El frontend envía `orCodigo` (string como
 * "OR-AFINIA", D1+D6); el servicio lo resuelve a `or_id` internamente.
 */
export interface CargoInput {
  periodoId: string
  orCodigo: string
}

// ─── Cliente HTTP: payload de salida ───────────────────────────────────────────

/**
 * Override de comportamiento del mock para testing manual.
 * El handler de `procesar` lo inyecta a partir de un header de test.
 */
export type NetsuiteTestOverride = "always-ok" | "always-error"

/**
 * Payload que el cliente envía a NetSuite por cada orden.
 *
 * `amount` es string ("123456.78"): el mapper lo produce con `Decimal.toFixed(2)`,
 * NUNCA con Number(). Ver `mapper.ts`.
 */
export interface NetsuitePayload {
  externalId: string
  /** internalId del vendor en NetSuite (de ConfiguracionOR.netsuite_vendor_id). */
  vendorId: string
  /** codigo del OR (ej. "OR-AFINIA") — para memo/auditoría, no para el entity. */
  vendor: string
  amount: string
  currency: string
  memo: string
  date: string // "AAAA-MM-DD"
  testOverride?: NetsuiteTestOverride
}

// ─── Cliente HTTP: respuesta de NetSuite (validada con Zod, R4) ────────────────

/**
 * Schema de la respuesta OK. R4: si NetSuite responde "ok" pero sin
 * `internalId`/`documentNumber`, NO valida → se trata como error explícito
 * (mejor que una OC fantasma).
 */
export const netsuiteOkResponseSchema = z.object({
  status: z.literal("ok"),
  internalId: z.string().min(1),
  documentNumber: z.string().min(1),
  raw: z.unknown().optional(),
})

/** Schema de la respuesta de error de NetSuite. */
export const netsuiteErrorResponseSchema = z.object({
  status: z.literal("error"),
  code: z.string().min(1),
  message: z.string(),
  raw: z.unknown().optional(),
})

/**
 * Respuesta de NetSuite (unión discriminada por `status`).
 * El servicio valida lo que llega del cliente contra este schema antes de
 * persistir; si no cumple, lo trata como ERROR (R4).
 */
export const netsuiteResponseSchema = z.discriminatedUnion("status", [
  netsuiteOkResponseSchema,
  netsuiteErrorResponseSchema,
])

export type NetsuiteOkResponse = z.infer<typeof netsuiteOkResponseSchema>
export type NetsuiteErrorResponse = z.infer<typeof netsuiteErrorResponseSchema>
export type NetsuiteResponse = z.infer<typeof netsuiteResponseSchema>
