// Mock data para desarrollo — usados en FE-2 a FE-5 mientras los endpoints no existen
// Importar con: import { MOCK_ESTADOS_ENVIO, MOCK_LOTE_EN_CURSO, ... } from "@/_dev/mocks/netsuite"
//
// NOTA: esta carpeta está en _dev/ (commiteada para Vercel builds). Solo usar en flujos mock.

import type {
  EstadoEnvioKey,
  EstadoEnvioUI,
  LoteEnCursoUI,
  DetalleEnvio,
  CargoParaEnviar,
} from "@/components/cargos-str/types"

// ---------------------------------------------------------------------------
// Tipos de respuesta de los endpoints (shape que tendrá el backend real)
// ---------------------------------------------------------------------------

export interface EnvioDto {
  id: string
  periodoId: string
  orCodigo: string
  estado: "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR"
  numeroOc: string | null
  errorMensaje: string | null
}

export interface LoteResponse {
  loteId: string
  estado: "EN_PROGRESO"
  totalEnvios: number
  envios: EnvioDto[]
}

// ---------------------------------------------------------------------------
// mockPostLote
// Simula POST /api/cargos-str/netsuite/lote
// TODO FE-6: reemplazar por fetch real cuando BE-3 esté listo
// ---------------------------------------------------------------------------

export async function mockPostLote(cargos: CargoParaEnviar[]): Promise<LoteResponse> {
  const delay = 800 + Math.floor(Math.random() * 700) // 800-1500ms
  await new Promise(resolve => setTimeout(resolve, delay))

  const roll = Math.random()

  // 10% → 409 LOTE_EN_CURSO
  if (roll < 0.10) {
    const err = {
      error: "LOTE_EN_CURSO",
      loteEnCursoId: "mock-lote-en-curso-999",
      iniciadoAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      iniciadoPor: { nombre: "Otro usuario" },
    }
    return Promise.reject(err)
  }

  // 5% → 422 MONTO_CERO
  if (roll < 0.15) {
    const err = {
      error: "MONTO_CERO",
      conflictos: cargos.slice(0, 1).map(c => ({
        periodoId: c.periodoId,
        orCodigo: c.orCodigo,
        monto: "0.00",
      })),
    }
    return Promise.reject(err)
  }

  // 5% → 500 genérico
  if (roll < 0.20) {
    const err = {
      error: "INTERNAL_ERROR",
    }
    return Promise.reject(err)
  }

  // 80% → OK
  const loteId = `mock-lote-${Date.now()}`
  const envios: EnvioDto[] = cargos.map((c, idx) => ({
    id: `mock-envio-${idx}`,
    periodoId: c.periodoId,
    orCodigo: c.orCodigo,
    estado: "PENDIENTE",
    numeroOc: null,
    errorMensaje: null,
  }))

  return {
    loteId,
    estado: "EN_PROGRESO",
    totalEnvios: cargos.length,
    envios,
  }
}

// ---------------------------------------------------------------------------
// mockPostProcesar
// Simula POST /api/cargos-str/netsuite/lote/:loteId/procesar
// TODO FE-6: reemplazar por fetch real cuando BE-3 esté listo
// ---------------------------------------------------------------------------

export async function mockPostProcesar(_loteId: string): Promise<void> {
  // Delay mínimo que simula el 202 Accepted del backend
  await new Promise(resolve => setTimeout(resolve, 300))
  // 100% éxito — la simulación del worker (estados cambiando) es responsabilidad de FE-5
}

// ---------------------------------------------------------------------------
// MOCK_ESTADOS_ENVIO
// Simula la respuesta de GET /api/cargos-str/netsuite/estados?orIds=...
// Cubre los cuatro estados posibles para que FE-2/FE-3 puedan probar los colores
// ---------------------------------------------------------------------------

// Período de referencia para los mocks (Mar 2026 = facturación, Feb 2026 = consumo)
const PERIODO_ID = "periodo-2026-03"

export const MOCK_ESTADOS_ENVIO: Record<EstadoEnvioKey, EstadoEnvioUI> = {
  [`${PERIODO_ID}|OR-AFINIA`]: {
    ultimoEnvioId: "envio-001",
    estado: "PENDIENTE",
    numeroOc: null,
    errorMensaje: null,
    loteId: "lote-abc-123",
    fecha: "2026-03-10T08:00:00.000Z",
  },
  [`${PERIODO_ID}|OR-AIRE`]: {
    ultimoEnvioId: "envio-002",
    estado: "PROCESANDO",
    numeroOc: null,
    errorMensaje: null,
    loteId: "lote-abc-123",
    fecha: "2026-03-10T08:01:30.000Z",
  },
  [`${PERIODO_ID}|OR-BAJO-PUTUMAYO`]: {
    ultimoEnvioId: "envio-003",
    estado: "PROCESADO",
    numeroOc: "OC-2026-00412",
    errorMensaje: null,
    loteId: "lote-abc-122",
    fecha: "2026-02-15T14:22:00.000Z",
  },
  [`${PERIODO_ID}|OR-CEDENAR`]: {
    ultimoEnvioId: "envio-004",
    estado: "ERROR",
    numeroOc: null,
    errorMensaje: "NetSuite: vendor no encontrado. Código interno OR-CEDENAR no está registrado como proveedor activo.",
    loteId: "lote-abc-121",
    fecha: "2026-02-15T14:05:00.000Z",
  },
}

// ---------------------------------------------------------------------------
// MOCK_LOTE_EN_CURSO
// Simula la respuesta de GET /api/cargos-str/netsuite/lote/:id
// 23 cargos totales (tamaño típico de un lote de insumos STR)
// ---------------------------------------------------------------------------

export const MOCK_LOTE_EN_CURSO: LoteEnCursoUI = {
  id: "lote-abc-123",
  estado: "EN_PROGRESO",
  iniciadoAt: "2026-03-10T08:00:00.000Z",
  iniciadoPor: { nombre: "Erika Ramírez" },
  totales: {
    total: 23,
    pendientes: 10,
    procesados: 11,
    errores: 2,
  },
  puedeCancelar: true,
}

// ---------------------------------------------------------------------------
// MOCK_DETALLE_ENVIO_OK
// Simula GET /api/cargos-str/netsuite/envio/:id para un envío exitoso
// ---------------------------------------------------------------------------

export const MOCK_DETALLE_ENVIO_OK: DetalleEnvio = {
  id: "envio-003",
  estado: "PROCESADO",
  numeroOc: "OC-2026-00412",
  netsuiteInternalId: "NS-INTERNAL-58291",
  montoSnapshotCop: "1234567890",
  mesConsumo: "2026-02",
  mesFacturacion: "2026-03",
  enviadoAt: "2026-02-15T14:20:00.000Z",
  respondidoAt: "2026-02-15T14:22:18.000Z",
  intentos: 1,
  errorCodigo: null,
  errorMensaje: null,
  requestPayloadJson: {
    vendorId: "OR-BAJO-PUTUMAYO",
    amount: 1234567890,
    currency: "COP",
    period: "2026-03",
  },
  responsePayloadJson: {
    status: "success",
    poNumber: "OC-2026-00412",
    internalId: "NS-INTERNAL-58291",
    createdAt: "2026-02-15T14:22:18.000Z",
  },
}

// ---------------------------------------------------------------------------
// MOCK_DETALLE_ENVIO_ERROR
// Simula GET /api/cargos-str/netsuite/envio/:id para un envío fallido
// ---------------------------------------------------------------------------

export const MOCK_DETALLE_ENVIO_ERROR: DetalleEnvio = {
  id: "envio-004",
  estado: "ERROR",
  numeroOc: null,
  netsuiteInternalId: null,
  montoSnapshotCop: "987654321",
  mesConsumo: "2026-02",
  mesFacturacion: "2026-03",
  enviadoAt: "2026-02-15T14:04:55.000Z",
  respondidoAt: "2026-02-15T14:05:03.000Z",
  intentos: 3,
  errorCodigo: "VENDOR_NOT_FOUND",
  errorMensaje:
    "NetSuite: vendor no encontrado. Código interno OR-CEDENAR no está registrado como proveedor activo.",
  requestPayloadJson: {
    vendorId: "OR-CEDENAR",
    amount: 987654321,
    currency: "COP",
    period: "2026-03",
  },
  responsePayloadJson: {
    status: "error",
    code: "VENDOR_NOT_FOUND",
    message: "Vendor with external ID 'OR-CEDENAR' not found in NetSuite.",
    timestamp: "2026-02-15T14:05:03.000Z",
  },
}
