/**
 * Tests del mapper persistencia → payload NetSuite / DTO de frontend.
 *
 * Sin DB: importamos SOLO `Prisma` de @prisma/client (para `Prisma.Decimal`,
 * que es la clase real de montos y aporta `.toFixed(2)`). No se abre conexión:
 * `lib/db` / PrismaClient nunca se instancian aquí.
 *
 * Foco: precisión decimal (R5 — el monto SIEMPRE string con 2 decimales) y la
 * forma exacta del payload/DTO que el frontend ya consume.
 */
import { describe, it, expect } from "vitest"
import { Prisma } from "@prisma/client"
import type { EnvioConOperador } from "@/lib/integrations/netsuite/mapper"
import { snapshotToPayload, envioToDto } from "@/lib/integrations/netsuite/mapper"

/**
 * Construye un `EnvioConOperador` de prueba. Solo se especifican los campos que
 * leen los mappers; el resto se completa con valores neutros. El cast a través
 * de los tipos de Prisma mantiene el tipado estricto (sin `any`).
 */
function makeEnvio(overrides?: {
  vendorId?: string | null
  monto?: string
  mesFacturacion?: string
  enviadoAt?: Date | null
  respondidoAt?: Date | null
}): EnvioConOperador {
  const operador_red = {
    id: "or-1",
    codigo: "OR-AFINIA",
    nombre: "Afinia",
    netsuite_vendor_id:
      overrides?.vendorId === undefined ? "9001" : overrides.vendorId,
  } as unknown as EnvioConOperador["operador_red"]

  const envio = {
    id: "env-1",
    periodo_id: "per-1",
    or_id: "or-1",
    idempotency_key: "idem-key-abc",
    monto_snapshot_cop: new Prisma.Decimal(overrides?.monto ?? "142265108.5"),
    mes_consumo: "2026-04",
    mes_facturacion: overrides?.mesFacturacion ?? "2026-05",
    estado: "PENDIENTE",
    intentos: 0,
    numero_oc: null,
    netsuite_internal_id: null,
    error_mensaje: null,
    error_codigo: null,
    enviado_at: overrides?.enviadoAt ?? null,
    respondido_at: overrides?.respondidoAt ?? null,
    operador_red,
  } as unknown as EnvioConOperador

  return envio
}

describe("snapshotToPayload", () => {
  it("amount es string con exactamente 2 decimales (precisión R5)", () => {
    const payload = snapshotToPayload(makeEnvio({ monto: "142265108.5" }))
    expect(payload.amount).toBe("142265108.50")
    expect(typeof payload.amount).toBe("string")
  })

  it("redondea/fija a 2 decimales sin perder precisión a Number", () => {
    const payload = snapshotToPayload(makeEnvio({ monto: "0.005" }))
    // Decimal.toFixed(2) — comportamiento de la librería decimal, no de float.
    expect(payload.amount).toBe("0.01")
  })

  it("mapea vendorId, vendor, currency, externalId y date correctamente", () => {
    const payload = snapshotToPayload(makeEnvio({ mesFacturacion: "2026-05" }))
    expect(payload.vendorId).toBe("9001")
    expect(payload.vendor).toBe("OR-AFINIA")
    expect(payload.currency).toBe("COP")
    expect(payload.externalId).toBe("idem-key-abc")
    expect(payload.date).toBe("2026-05-01")
    expect(payload.memo).toContain("Afinia")
  })

  it("OR sin netsuite_vendor_id (null) produce vendorId vacío", () => {
    const payload = snapshotToPayload(makeEnvio({ vendorId: null }))
    expect(payload.vendorId).toBe("")
  })
})

describe("envioToDto", () => {
  it("montoSnapshotCop es string con 2 decimales (nunca Number)", () => {
    const dto = envioToDto(makeEnvio({ monto: "999.9" }))
    expect(dto.montoSnapshotCop).toBe("999.90")
    expect(typeof dto.montoSnapshotCop).toBe("string")
  })

  it("fechas null → null", () => {
    const dto = envioToDto(makeEnvio({ enviadoAt: null, respondidoAt: null }))
    expect(dto.enviadoAt).toBeNull()
    expect(dto.respondidoAt).toBeNull()
  })

  it("fechas Date → ISO string", () => {
    const fecha = new Date("2026-05-10T12:34:56.000Z")
    const dto = envioToDto(makeEnvio({ enviadoAt: fecha }))
    expect(dto.enviadoAt).toBe("2026-05-10T12:34:56.000Z")
  })

  it("propaga identificadores y estado del envío", () => {
    const dto = envioToDto(makeEnvio())
    expect(dto.id).toBe("env-1")
    expect(dto.periodoId).toBe("per-1")
    expect(dto.orId).toBe("or-1")
    expect(dto.orCodigo).toBe("OR-AFINIA")
    expect(dto.orNombre).toBe("Afinia")
    expect(dto.estado).toBe("PENDIENTE")
  })
})
