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

/** Acciones de auditoría disponibles para el módulo NetSuite (BE-2 + BE-6). */
type AccionNetsuite =
  | "ENVIAR_LOTE_NETSUITE"
  | "PROCESAR_ENVIO_NETSUITE"
  | "REENVIAR_ENVIO_NETSUITE"
  | "CANCELAR_LOTE_NETSUITE"

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
 * BEST-EFFORT / NO-THROWING (BE-6): la auditoría es secundaria y NUNCA debe
 * tumbar la operación de negocio (crearLote/procesar/reenviar/cancelar). Si el
 * insert falla —p.ej. porque la migración del enum AccionAuditoria aún no se
 * aplicó en la DB y el valor de `accion` no existe— se logea el error y se
 * continúa sin relanzar.
 */
export async function auditNetsuite(input: AuditNetsuiteInput): Promise<void> {
  const detalleSeguro = input.detalle ? enmascarar(input.detalle) : undefined

  try {
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
  } catch (e) {
    // No relanzar: la auditoría es secundaria. Dejar rastro en Runtime Logs.
    console.error("[netsuite audit] no se pudo persistir:", e)
    return
  }
}

// ─── Logger estructurado ──────────────────────────────────────────────────────────

/** Nivel del log estructurado. */
type NivelLog = "info" | "warn" | "error"

/**
 * Emite UNA línea JSON estructurada que Vercel Runtime Logs recoge.
 *
 * Shape: `{ mod: "netsuite", evento, nivel, ...ctx, ts }`.
 *
 * REGLAS DE SEGURIDAD (BE-6, R10):
 *  - NUNCA loguear tokens/secrets ni el `amount` suelto sin contexto.
 *  - El `ctx` debe ser data de negocio: loteId, envioId, orCodigo, estado,
 *    errorCodigo, durationMs, totales. No incluir `respuesta_ok_json.raw`.
 *
 * El emisor (console.log/warn/error) se elige por nivel para que Vercel
 * clasifique correctamente la severidad.
 */
export function logNetsuite(
  evento: string,
  nivel: NivelLog,
  ctx: Record<string, unknown>,
): void {
  const linea = JSON.stringify({
    mod: "netsuite",
    evento,
    nivel,
    ...ctx,
    ts: new Date().toISOString(),
  })

  if (nivel === "error") {
    console.error(linea)
  } else if (nivel === "warn") {
    console.warn(linea)
  } else {
    console.log(linea)
  }
}
