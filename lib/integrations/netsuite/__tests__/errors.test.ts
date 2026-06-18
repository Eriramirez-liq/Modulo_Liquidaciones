/**
 * Tests de los errores de dominio del módulo NetSuite.
 *
 * Sin DB ni red: clases puras. Verifican `httpStatus`, `codigo` y el shape de
 * `toResponse()` (contrato §B.2: `{ error, message, ...campos }`), además del
 * type guard `isNetsuiteServiceError`.
 */
import { describe, it, expect } from "vitest"
import {
  LoteEnCursoError,
  SinDatosError,
  MontoCeroError,
  CargoYaProcesadoError,
  OrNoEncontradoError,
  LoteNoEncontradoError,
  LoteNoProcesableError,
  EnvioNoEncontradoError,
  EnvioNoReenviableError,
  LoteNoCancelableError,
  isNetsuiteServiceError,
  type ConflictoCargo,
} from "@/lib/integrations/netsuite/errors"

const conflictos: ConflictoCargo[] = [
  { periodoId: "per-1", orCodigo: "OR-AFINIA", monto: "0.00" },
]

describe("LoteEnCursoError", () => {
  it("httpStatus 409 y toResponse incluye lote/iniciadoAt/iniciadoPor", () => {
    const err = new LoteEnCursoError("lote-1", "2026-05-01T00:00:00.000Z", {
      nombre: "Erika",
    })
    expect(err.httpStatus).toBe(409)
    expect(err.codigo).toBe("LOTE_EN_CURSO")
    expect(err.toResponse()).toEqual({
      error: "LOTE_EN_CURSO",
      message: err.message,
      loteEnCursoId: "lote-1",
      iniciadoAt: "2026-05-01T00:00:00.000Z",
      iniciadoPor: { nombre: "Erika" },
    })
  })
})

describe("SinDatosError", () => {
  it("httpStatus 400 y toResponse incluye conflictos", () => {
    const err = new SinDatosError(conflictos)
    expect(err.httpStatus).toBe(400)
    expect(err.codigo).toBe("SIN_DATOS")
    expect(err.toResponse()).toEqual({
      error: "SIN_DATOS",
      message: err.message,
      conflictos,
    })
  })
})

describe("MontoCeroError", () => {
  it("httpStatus 422 y toResponse incluye conflictos", () => {
    const err = new MontoCeroError(conflictos)
    expect(err.httpStatus).toBe(422)
    expect(err.codigo).toBe("MONTO_CERO")
    expect(err.toResponse()).toEqual({
      error: "MONTO_CERO",
      message: err.message,
      conflictos,
    })
  })
})

describe("CargoYaProcesadoError", () => {
  it("httpStatus 422 y toResponse incluye conflictos", () => {
    const err = new CargoYaProcesadoError(conflictos)
    expect(err.httpStatus).toBe(422)
    expect(err.codigo).toBe("CARGO_YA_PROCESADO")
    expect(err.toResponse()).toEqual({
      error: "CARGO_YA_PROCESADO",
      message: err.message,
      conflictos,
    })
  })
})

describe("OrNoEncontradoError", () => {
  it("httpStatus 404 y toResponse incluye orCodigo", () => {
    const err = new OrNoEncontradoError("OR-DESCONOCIDO")
    expect(err.httpStatus).toBe(404)
    expect(err.codigo).toBe("OR_NO_ENCONTRADO")
    expect(err.toResponse()).toEqual({
      error: "OR_NO_ENCONTRADO",
      message: err.message,
      orCodigo: "OR-DESCONOCIDO",
    })
  })
})

describe("errores de lote/envío con toResponse base", () => {
  it("LoteNoEncontradoError → 404, shape base", () => {
    const err = new LoteNoEncontradoError()
    expect(err.httpStatus).toBe(404)
    expect(err.toResponse()).toEqual({
      error: "LOTE_NO_ENCONTRADO",
      message: err.message,
    })
  })

  it("LoteNoProcesableError → 409", () => {
    expect(new LoteNoProcesableError().httpStatus).toBe(409)
    expect(new LoteNoProcesableError().codigo).toBe("LOTE_NO_PROCESABLE")
  })

  it("EnvioNoEncontradoError → 404", () => {
    expect(new EnvioNoEncontradoError().httpStatus).toBe(404)
    expect(new EnvioNoEncontradoError().codigo).toBe("ENVIO_NO_ENCONTRADO")
  })

  it("EnvioNoReenviableError → 409", () => {
    expect(new EnvioNoReenviableError().httpStatus).toBe(409)
    expect(new EnvioNoReenviableError().codigo).toBe("ENVIO_NO_REENVIABLE")
  })

  it("LoteNoCancelableError → 409", () => {
    expect(new LoteNoCancelableError().httpStatus).toBe(409)
    expect(new LoteNoCancelableError().codigo).toBe("LOTE_NO_CANCELABLE")
  })
})

describe("isNetsuiteServiceError", () => {
  it("true para errores de dominio", () => {
    expect(isNetsuiteServiceError(new MontoCeroError(conflictos))).toBe(true)
    expect(isNetsuiteServiceError(new LoteNoEncontradoError())).toBe(true)
  })

  it("false para Error genérico, objetos y null", () => {
    expect(isNetsuiteServiceError(new Error("boom"))).toBe(false)
    expect(isNetsuiteServiceError({ error: "MONTO_CERO" })).toBe(false)
    expect(isNetsuiteServiceError(null)).toBe(false)
    expect(isNetsuiteServiceError("MONTO_CERO")).toBe(false)
  })

  it("toResponse NUNCA expone stack ni detalles internos", () => {
    const body = new MontoCeroError(conflictos).toResponse()
    expect(body).not.toHaveProperty("stack")
    expect(Object.keys(body).sort()).toEqual(["conflictos", "error", "message"])
  })
})
