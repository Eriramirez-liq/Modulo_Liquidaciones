/**
 * Helper de auditoría del módulo NetSuite.
 *
 * Escribe una entrada inmutable en `log_auditoria` con shape consistente. En
 * BE-2 solo se usa la acción `ENVIAR_LOTE_NETSUITE` (los otros valores del enum
 * llegan en BE-6). El `detalle` JSON se enmascara para nunca persistir tokens
 * de auth (el mock no genera secrets, pero el helper queda listo para Fase 2).
 *
 * Auditoría = append-only: este helper solo crea, nunca actualiza ni borra.
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.3, §B.6 (BE-6), R10.
 */

import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"

/** Acciones de auditoría disponibles para el módulo NetSuite en BE-2. */
type AccionNetsuite = "ENVIAR_LOTE_NETSUITE"

export interface AuditNetsuiteInput {
  usuarioId: string
  accion: AccionNetsuite
  /** Entidad afectada. Por defecto "LoteNetsuite". */
  entidad?: string
  entidadId: string
  /** Detalle libre. Se enmascara antes de persistir. */
  detalle?: Record<string, unknown>
  ip?: string
}

/** Claves cuyo valor se enmascara si aparecen en el detalle (case-insensitive). */
const CLAVES_SENSIBLES = [
  "token",
  "secret",
  "password",
  "authorization",
  "consumerkey",
  "consumersecret",
  "tokenid",
  "tokensecret",
  "apikey",
]

function esSensible(clave: string): boolean {
  const lower = clave.toLowerCase()
  return CLAVES_SENSIBLES.some((s) => lower.includes(s))
}

/**
 * Recorre el detalle y reemplaza por "***" el valor de cualquier clave sensible.
 * Recursivo sobre objetos planos. Arrays se recorren elemento a elemento.
 */
function enmascarar(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map((v) => enmascarar(v))
  }
  if (valor !== null && typeof valor === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      out[k] = esSensible(k) ? "***" : enmascarar(v)
    }
    return out
  }
  return valor
}

/**
 * Escribe una entrada de auditoría del módulo NetSuite.
 *
 * No lanza si falla: la auditoría no debe tumbar la operación de negocio, pero
 * el error se relanza al caller para que decida (el caller suele logearlo). Si
 * preferís fire-and-forget, el caller envuelve en try/catch.
 */
export async function auditNetsuite(input: AuditNetsuiteInput): Promise<void> {
  const detalleSeguro = input.detalle ? enmascarar(input.detalle) : undefined

  await db.logAuditoria.create({
    data: {
      usuario_id: input.usuarioId,
      accion: input.accion,
      entidad: input.entidad ?? "LoteNetsuite",
      entidad_id: input.entidadId,
      detalle:
        detalleSeguro === undefined
          ? Prisma.JsonNull
          : (detalleSeguro as Prisma.InputJsonValue),
      ip: input.ip ?? null,
    },
  })
}
