/**
 * Interface del cliente NetSuite + factory por variable de entorno.
 *
 * El servicio NO conoce la implementación concreta: llama `getNetsuiteClient()`
 * y obtiene un `NetsuiteClient`. El modo se decide con `NETSUITE_MODE`:
 *   - "mock" (default): MockNetsuiteClient — determinista, sin red real.
 *   - "real": RealNetsuiteClient — placeholder hasta Fase 2.
 *
 * Las credenciales NetSuite (NETSUITE_*) se leen SOLO aquí, en servidor.
 * Prohibido el prefijo NEXT_PUBLIC_ (filtraría secretos al cliente — R7).
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.3.
 */

import type { NetsuitePayload, NetsuiteResponse } from "./types"
import { MockNetsuiteClient } from "./mock-client"
import { RealNetsuiteClient } from "./real-client"

export interface NetsuiteClient {
  enviarOrden(payload: NetsuitePayload): Promise<NetsuiteResponse>
}

/**
 * Retorna el cliente NetSuite según `NETSUITE_MODE` (default "mock").
 *
 * El servicio invoca esta factory en cada operación. En Fase 3 (tests) se
 * inyectará el cliente por parámetro; por ahora la factory es suficiente.
 */
export function getNetsuiteClient(): NetsuiteClient {
  const mode = process.env.NETSUITE_MODE ?? "mock"

  if (mode === "real") {
    return new RealNetsuiteClient()
  }

  return new MockNetsuiteClient()
}
