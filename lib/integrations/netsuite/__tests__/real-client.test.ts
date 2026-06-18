/**
 * Tests de los helpers PUROS del cliente real NetSuite.
 *
 * Sin DB ni red: NO se instancia `RealNetsuiteClient` (su constructor exige env
 * y haría fetch). Se testean solo las funciones puras exportadas para este fin:
 * `extraerDetalleNetsuite`, `construirCuerpoOrden`, `montoANumero`.
 */
import { describe, it, expect } from "vitest"
import {
  extraerDetalleNetsuite,
  construirCuerpoOrden,
  montoANumero,
  type RealClientConfig,
} from "@/lib/integrations/netsuite/real-client"
import type { NetsuitePayload } from "@/lib/integrations/netsuite/types"

describe("montoANumero", () => {
  it('"142265108.00" → 142265108 (number)', () => {
    const n = montoANumero("142265108.00")
    expect(n).toBe(142265108)
    expect(typeof n).toBe("number")
  })

  it("preserva los decimales como number", () => {
    expect(montoANumero("1234.56")).toBe(1234.56)
  })
})

describe("extraerDetalleNetsuite", () => {
  it('extrae el primer o:errorDetails[].detail', () => {
    const detalle = {
      "o:errorDetails": [{ detail: "campo X invalido" }, { detail: "otro" }],
    }
    expect(extraerDetalleNetsuite(detalle)).toBe("campo X invalido")
  })

  it("hace trim del detail", () => {
    const detalle = { "o:errorDetails": [{ detail: "  con espacios  " }] }
    expect(extraerDetalleNetsuite(detalle)).toBe("con espacios")
  })

  it("cae al title cuando no hay o:errorDetails", () => {
    expect(extraerDetalleNetsuite({ title: "Bad Request" })).toBe("Bad Request")
  })

  it("string crudo no vacío → su contenido trimmeado", () => {
    expect(extraerDetalleNetsuite("  texto plano  ")).toBe("texto plano")
  })

  it("null / undefined / objeto sin campos conocidos → null", () => {
    expect(extraerDetalleNetsuite(null)).toBeNull()
    expect(extraerDetalleNetsuite(undefined)).toBeNull()
    expect(extraerDetalleNetsuite({})).toBeNull()
    expect(extraerDetalleNetsuite({ foo: "bar" })).toBeNull()
    expect(extraerDetalleNetsuite("   ")).toBeNull()
  })

  it("o:errorDetails vacío sin title → null", () => {
    expect(extraerDetalleNetsuite({ "o:errorDetails": [] })).toBeNull()
  })

  it("detail no-string o vacío sin title → null", () => {
    expect(extraerDetalleNetsuite({ "o:errorDetails": [{ detail: 123 }] })).toBeNull()
    expect(extraerDetalleNetsuite({ "o:errorDetails": [{ detail: "  " }] })).toBeNull()
  })
})

function payload(): NetsuitePayload {
  return {
    externalId: "idem-abc",
    vendorId: "9001",
    vendor: "OR-AFINIA",
    amount: "142265108.00",
    currency: "COP",
    memo: "Cargo STR Afinia 2026-04",
    date: "2026-05-01",
  }
}

function cfg(overrides?: Partial<RealClientConfig>): RealClientConfig {
  return {
    baseUrl: "https://8312907.suitetalk.api.netsuite.com",
    accountId: "8312907",
    consumerKey: "ck",
    consumerSecret: "cs",
    tokenId: "ti",
    tokenSecret: "ts",
    recordPath: "/services/rest/record/v1/purchaseOrder",
    subsidiaryId: "2",
    locationId: null,
    itemId: "488",
    quantity: 1,
    departmentId: "129",
    categoriaProveedorId: "27",
    ...overrides,
  }
}

describe("construirCuerpoOrden", () => {
  it("arma entity/subsidiary/department/categoría/currency/memo/tranDate", () => {
    const body = construirCuerpoOrden(payload(), cfg())
    expect(body.entity).toEqual({ id: "9001" })
    expect(body.subsidiary).toEqual({ id: "2" })
    expect(body.department).toEqual({ id: "129" })
    expect(body.custbody_nso_categoria_proveedor_bia).toEqual({ id: "27" })
    expect(body.currency).toEqual({ refName: "COP" })
    expect(body.memo).toBe("Cargo STR Afinia 2026-04")
    expect(body.tranDate).toBe("2026-05-01")
    expect(body.externalId).toBe("idem-abc")
  })

  it("la línea tiene item, quantity y rate como number", () => {
    const body = construirCuerpoOrden(payload(), cfg())
    const item = body.item as { items: Array<Record<string, unknown>> }
    const linea = item.items[0]
    expect(linea?.item).toEqual({ id: "488" })
    expect(linea?.quantity).toBe(1)
    expect(linea?.rate).toBe(142265108)
    expect(typeof linea?.rate).toBe("number")
  })

  it("location NO está presente si locationId es null", () => {
    const body = construirCuerpoOrden(payload(), cfg({ locationId: null }))
    expect(body).not.toHaveProperty("location")
  })

  it("location SÍ está presente si locationId tiene valor", () => {
    const body = construirCuerpoOrden(payload(), cfg({ locationId: "55" }))
    expect(body.location).toEqual({ id: "55" })
  })
})
