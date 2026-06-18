/**
 * Tests del cliente NetSuite mock.
 *
 * Sin DB ni red: el mock no hace fetch. El RESULTADO es determinista (deriva del
 * hash del externalId); solo el delay usa Math.random y NO debe afectar el
 * resultado. Estos tests verifican ese contrato.
 */
import { describe, it, expect } from "vitest"
import { MockNetsuiteClient } from "@/lib/integrations/netsuite/mock-client"
import type { NetsuitePayload } from "@/lib/integrations/netsuite/types"

function payload(overrides?: Partial<NetsuitePayload>): NetsuitePayload {
  return {
    externalId: "idem-key-determinista",
    vendorId: "9001",
    vendor: "OR-AFINIA",
    amount: "1000.00",
    currency: "COP",
    memo: "Cargo STR test",
    date: "2026-05-01",
    ...overrides,
  }
}

describe("MockNetsuiteClient.enviarOrden", () => {
  const client = new MockNetsuiteClient()

  it("es determinista: mismo externalId → mismo resultado en dos llamadas", async () => {
    const a = await client.enviarOrden(payload({ externalId: "abc-123" }))
    const b = await client.enviarOrden(payload({ externalId: "abc-123" }))
    expect(a).toEqual(b)
  })

  it('testOverride "always-error" → siempre error', async () => {
    const r1 = await client.enviarOrden(
      payload({ externalId: "x", testOverride: "always-error" }),
    )
    const r2 = await client.enviarOrden(
      payload({ externalId: "y", testOverride: "always-error" }),
    )
    expect(r1.status).toBe("error")
    expect(r2.status).toBe("error")
    if (r1.status === "error") {
      expect(r1.code).toBe("MOCK_FAIL")
      expect(r1.message).toBeTruthy()
    }
  })

  it('testOverride "always-ok" → siempre ok con documentNumber e internalId', async () => {
    const r = await client.enviarOrden(
      payload({ externalId: "z", testOverride: "always-ok" }),
    )
    expect(r.status).toBe("ok")
    if (r.status === "ok") {
      expect(r.internalId).toBeTruthy()
      expect(r.documentNumber).toContain("OC-MOCK-")
    }
  })

  it("el resultado no depende del delay aleatorio (estabilidad entre runs)", async () => {
    const externalId = "estable-seed-42"
    const results = await Promise.all([
      client.enviarOrden(payload({ externalId })),
      client.enviarOrden(payload({ externalId })),
      client.enviarOrden(payload({ externalId })),
    ])
    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
  })

  it("distintos externalId pueden dar resultados distintos (sin override)", async () => {
    // Buscamos al menos un caso OK y uno ERROR variando el externalId,
    // demostrando que el resultado se deriva del hash (no es constante).
    // Se ejecutan en paralelo: el delay (200-800ms) es por-llamada, así el
    // total es ~1 delay y no se acumula a varios segundos.
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        client.enviarOrden(payload({ externalId: `seed-${i}` })),
      ),
    )
    const estados = new Set(results.map((r) => r.status))
    expect(estados.has("ok")).toBe(true)
    expect(estados.has("error")).toBe(true)
  })
})
