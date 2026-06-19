// Tipos compartidos para la integración Cargos STR + Oracle NetSuite
// FE-1: skeleton de tipos — sin lógica de negocio

// Key del mapa de estados: identifica de forma única un (período, operador)
// Formato: "${periodoId}|${orCodigo}"  (D1 resuelto: usa codigo, no UUID)
export type EstadoEnvioKey = `${string}|${string}`

// Los cuatro estados posibles del ciclo de vida de un envío
export type EstadoEnvio = "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR"

// Estado de envío tal como lo consume la UI (resultado de GET /estados)
export interface EstadoEnvioUI {
  ultimoEnvioId: string
  estado: EstadoEnvio
  numeroOc: string | null
  errorMensaje: string | null
  loteId: string
  fecha: string
}

// Estado del lote
export type EstadoLote = "EN_PROGRESO" | "COMPLETADO" | "CANCELADO"

// Lote en curso tal como lo consume el PanelLoteEnCurso
export interface LoteEnCursoUI {
  id: string
  estado: EstadoLote
  iniciadoAt: string
  iniciadoPor: { nombre: string }
  totales: {
    total: number
    pendientes: number
    procesados: number
    errores: number
  }
  puedeCancelar: boolean
}

// Cargo seleccionado por el usuario para incluir en un lote
// Contiene los campos que necesita el ModalConfirmarLote para mostrar la previsualización
export interface CargoSeleccionado {
  periodoId: string
  orCodigo: string
  orNombre: string
  mesConsumo: string
  mesFacturacion: string
  montoCop: number
  /** true cuando el OR no tiene netsuite_vendor_id configurado — se usa para la advertencia del modal */
  sinVendorId?: boolean
}

// Payload mínimo que se manda al backend en POST /lote
export interface CargoParaEnviar {
  periodoId: string
  orCodigo: string
}

// Detalle completo de un envío individual (GET /envio/:id)
export interface DetalleEnvio {
  id: string
  estado: EstadoEnvio
  numeroOc: string | null
  netsuiteInternalId: string | null
  montoSnapshotCop: string
  mesConsumo: string
  mesFacturacion: string
  enviadoAt: string | null
  respondidoAt: string | null
  intentos: number
  errorCodigo: string | null
  errorMensaje: string | null
  requestPayloadJson: unknown
  responsePayloadJson: unknown
}
