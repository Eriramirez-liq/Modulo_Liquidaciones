/**
 * Cliente NetSuite mock determinista.
 *
 * El RESULTADO (ok/error) es determinista: depende del hash del `externalId`
 * (que a su vez deriva de la `idempotency_key`), NO de Math.random(). Esto hace
 * que reenviar el mismo cargo dé el mismo resultado, y que el frontend pueda
 * validar ambos estados de forma reproducible.
 *
 * El DELAY sí es aleatorio: solo afecta el tiempo de respuesta para que el
 * polling del FE muestre progreso real, no el resultado.
 *
 * Tasa de error fija: 10% (`hash % 10 === 0`). Overrides de testing manual via
 * `payload.testOverride` ("always-ok" | "always-error").
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.3 (Mock determinista).
 */

import type { NetsuiteClient } from "./client"
import type { NetsuitePayload, NetsuiteResponse } from "./types"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Hash determinista de un string a entero no negativo (variante djb2).
 * No es criptográfico: solo sirve para derivar un seed estable del externalId.
 */
function hashStringToInt(input: string): number {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    // hash * 33 + char, forzado a entero de 32 bits sin signo
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export class MockNetsuiteClient implements NetsuiteClient {
  async enviarOrden(payload: NetsuitePayload): Promise<NetsuiteResponse> {
    // Delay simulado (200-800ms) — solo afecta latencia, no el resultado.
    await sleep(200 + Math.floor(Math.random() * 600))

    const seed = hashStringToInt(payload.externalId)

    // Override de testing manual: fuerza error.
    if (payload.testOverride === "always-error") {
      return this.buildError(payload, seed)
    }

    // Override de testing manual: fuerza OK.
    if (payload.testOverride === "always-ok") {
      return this.buildOk(payload, seed)
    }

    // Determinismo: 10% de fallo según el hash del externalId.
    if (seed % 10 === 0) {
      return this.buildError(payload, seed)
    }

    return this.buildOk(payload, seed)
  }

  private buildOk(payload: NetsuitePayload, seed: number): NetsuiteResponse {
    return {
      status: "ok",
      internalId: `MOCK-${seed}`,
      documentNumber: `OC-MOCK-${String(seed).padStart(6, "0")}`,
      raw: { externalId: payload.externalId, seed },
    }
  }

  private buildError(payload: NetsuitePayload, seed: number): NetsuiteResponse {
    return {
      status: "error",
      code: "MOCK_FAIL",
      message: "Mocked failure for testing",
      raw: { externalId: payload.externalId, seed },
    }
  }
}
