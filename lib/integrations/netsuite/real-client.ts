/**
 * Cliente NetSuite real — PLACEHOLDER hasta Fase 2.
 *
 * El contrato real de NetSuite (auth OAuth1/TBA, URL base, payload exacto,
 * formato de OC, rate limits, mapeo OR→vendor) aún no está definido. Ver
 * "Pendientes con stakeholders de NetSuite" en el plan.
 *
 * Implementación de referencia para Fase 2 (NO activar todavía):
 *   - Leer credenciales de env en el constructor (NETSUITE_BASE_URL, TOKEN_ID,
 *     TOKEN_SECRET, CONSUMER_KEY, CONSUMER_SECRET) — solo en servidor (R7).
 *   - `fetch` con AbortController y timeout = NETSUITE_TIMEOUT_MS.
 *   - Enmascarar tokens antes de cualquier log/persistencia.
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.3, R7, R9.
 */

import type { NetsuiteClient } from "./client"
import type { NetsuitePayload, NetsuiteResponse } from "./types"

export class RealNetsuiteClient implements NetsuiteClient {
  constructor() {
    throw new Error("RealNetsuiteClient: contrato pendiente Fase 2")
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async enviarOrden(_payload: NetsuitePayload): Promise<NetsuiteResponse> {
    throw new Error("RealNetsuiteClient: contrato pendiente Fase 2")
  }
}
