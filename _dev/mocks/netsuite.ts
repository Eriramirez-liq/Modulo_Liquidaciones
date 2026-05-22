// Mock data para desarrollo — usados en FE-2 a FE-5 mientras los endpoints no existen
// Importar con: import { MOCK_ESTADOS_ENVIO, MOCK_LOTE_EN_CURSO, ... } from "@/_dev/mocks/netsuite"
//
// NOTA: esta carpeta está en .gitignore. No usar en producción.

import type {
  EstadoEnvioKey,
  EstadoEnvioUI,
  LoteEnCursoUI,
  DetalleEnvio,
} from "@/components/cargos-str/types"

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
