// Mock data para desarrollo — usados en FE-2 a FE-5 mientras los endpoints no existen
// Importar con: import { mockGetLote, mockGetEstados, mockGetLoteActivo, ... } from "@/_dev/mocks/netsuite"
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
  orNombre: string
  montoSnapshotCop: string
  mesConsumo: string
  mesFacturacion: string
  estado: "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR"
  intentos: number
  numeroOc: string | null
  errorMensaje: string | null
  enviadoAt: string | null
  respondidoAt: string | null
}

export interface LoteResponse {
  loteId: string
  estado: "EN_PROGRESO" | "COMPLETADO" | "CANCELADO"
  totalEnvios: number
  iniciadoAt: string
  iniciadoPor: { nombre: string }
  totales: {
    total: number
    pendientes: number
    procesados: number
    errores: number
  }
  envios: EnvioDto[]
}

// ---------------------------------------------------------------------------
// Estado compartido in-memory (singleton de módulo)
// Simula la base de datos del backend durante el ciclo de vida de la sesión
// ---------------------------------------------------------------------------

interface MockLoteState {
  id: string
  iniciadoAt: string
  iniciadoPor: { nombre: string }
  envios: EnvioDto[]
  estado: "EN_PROGRESO" | "COMPLETADO" | "CANCELADO"
  // Campos internos extendidos (no expuestos en EnvioDto base, usados para detalle)
  _respuestaOkJson?: Record<string, unknown>[]
  _errorPayloadJson?: Record<string, unknown>[]
  _netsuiteInternalId?: (string | null)[]
}

// Map singleton — persiste entre renders porque los módulos de Node/Edge se cachean
const mockLotes = new Map<string, MockLoteState>()

/** Limpia todo el estado mock. Útil para tests y reset de dev. NO llamar en producción. */
export function resetMockState(): void {
  mockLotes.clear()
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

  // 80% → OK: crear el lote en el estado compartido
  const loteId = `mock-lote-${Date.now()}`
  const ahora = new Date().toISOString()

  const envios: EnvioDto[] = cargos.map((c, idx) => ({
    id: `mock-envio-${loteId}-${idx}`,
    periodoId: c.periodoId,
    orCodigo: c.orCodigo,
    orNombre: c.orCodigo, // el nombre completo no está en CargoParaEnviar (payload mínimo)
    montoSnapshotCop: "0",
    mesConsumo: "",
    mesFacturacion: "",
    estado: "PENDIENTE",
    intentos: 0,
    numeroOc: null,
    errorMensaje: null,
    enviadoAt: null,
    respondidoAt: null,
  }))

  const loteState: MockLoteState = {
    id: loteId,
    iniciadoAt: ahora,
    iniciadoPor: { nombre: "Erika Ramírez" },
    envios,
    estado: "EN_PROGRESO",
  }

  mockLotes.set(loteId, loteState)

  return {
    loteId,
    estado: "EN_PROGRESO",
    totalEnvios: cargos.length,
    iniciadoAt: ahora,
    iniciadoPor: { nombre: "Erika Ramírez" },
    totales: {
      total: cargos.length,
      pendientes: cargos.length,
      procesados: 0,
      errores: 0,
    },
    envios,
  }
}

// ---------------------------------------------------------------------------
// Helpers internos del procesamiento secuencial
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Duración simulada de la llamada a NetSuite para el envío en posición `idx`.
 *
 * Casos deterministas para que Erika pueda validar los 3 estados visuales:
 *   idx=0 →  500ms  → PROCESADO casi instantáneo
 *   idx=1 → 5000ms  → PROCESANDO visible ~5s → PROCESADO
 *   idx=2 → 32000ms → > 30s → fuerza TIMEOUT (ERROR_TIMEOUT a los 30s exactos)
 *   resto → aleatorio 800-2500ms → 90% PROCESADO / 10% ERROR
 */
function simularDuracionNetSuite(idx: number): number {
  if (idx === 0) return 500
  if (idx === 1) return 5_000
  if (idx === 2) return 32_000  // > 30s → dispara timeout
  return 800 + Math.random() * 1_700
}

/**
 * Procesa los envíos del lote de forma estrictamente secuencial.
 * Equivale al `procesarLote` del backend (§B.3 del plan del arquitecto):
 *   PENDIENTE → PROCESANDO → (esperar NetSuite, máx 30s) → PROCESADO | ERROR
 *
 * El loop revisa `lote.estado === "CANCELADO"` al inicio de cada iteración
 * y después de cada await, para respetar cancelaciones en vuelo.
 */
async function processEnvioSecuencial(loteId: string): Promise<void> {
  const lote = mockLotes.get(loteId)
  if (!lote) return

  const TIMEOUT_MS = 30_000

  // Helper local: leer estado sin que TypeScript aplique narrowing entre awaits
  const estaCancelado = (): boolean => mockLotes.get(loteId)?.estado === "CANCELADO"

  for (let i = 0; i < lote.envios.length; i++) {
    // Respetar cancelación antes de empezar cada envío
    if (estaCancelado()) break

    const envio = lote.envios[i]!
    const ahora = new Date().toISOString()

    // 1. Marcar PROCESANDO
    envio.estado = "PROCESANDO"
    envio.enviadoAt = ahora
    envio.intentos += 1

    // 2. Simular request a NetSuite con duración variable
    const duration = simularDuracionNetSuite(i)

    if (duration > TIMEOUT_MS) {
      // Caso TIMEOUT: esperar exactamente 30s y marcar ERROR
      await sleep(TIMEOUT_MS)
      if (estaCancelado()) break

      envio.estado = "ERROR"
      envio.errorMensaje = "NetSuite no respondió en 30 segundos"
      envio.respondidoAt = new Date().toISOString()
      // El frontend detecta TIMEOUT por el prefijo del mensaje
    } else {
      // Caso normal: esperar duration completo
      await sleep(duration)
      if (estaCancelado()) break

      const exito = Math.random() < 0.9  // 90% éxito, 10% error simulado
      const respondidoAt = new Date().toISOString()

      if (exito) {
        const oc = `OC-MOCK-${String(i + 1).padStart(6, "0")}`
        envio.estado = "PROCESADO"
        envio.numeroOc = oc
        envio.respondidoAt = respondidoAt
      } else {
        envio.estado = "ERROR"
        envio.errorMensaje = `Validación fallida en NetSuite (mock idx=${i}): proveedor no encontrado`
        envio.respondidoAt = respondidoAt
      }
    }
  }

  // 3. Marcar lote COMPLETADO si no fue cancelado durante el loop
  if (lote.estado === "EN_PROGRESO") {
    lote.estado = "COMPLETADO"
  }
}

// ---------------------------------------------------------------------------
// mockPostProcesar
// Simula POST /api/cargos-str/netsuite/lote/:loteId/procesar
// Retorna pronto (202 Accepted). El procesamiento corre en background.
// El frontend hace polling con mockGetLote para ver el progreso.
// TODO FE-6: reemplazar por fetch real cuando BE-3 esté listo
// ---------------------------------------------------------------------------

export async function mockPostProcesar(loteId: string): Promise<void> {
  // Simular el 202 Accepted: retorna rápido
  await sleep(300)
  // Disparar procesamiento en background — no se hace await
  processEnvioSecuencial(loteId).catch(console.error)
}

// ---------------------------------------------------------------------------
// mockGetLote
// Simula GET /api/cargos-str/netsuite/lote/:loteId
// TODO FE-6: reemplazar por fetch real cuando BE-4 esté listo
// ---------------------------------------------------------------------------

export async function mockGetLote(loteId: string): Promise<LoteResponse> {
  const delay = 100 + Math.floor(Math.random() * 100) // 100-200ms
  await new Promise(resolve => setTimeout(resolve, delay))

  const lote = mockLotes.get(loteId)
  if (!lote) {
    return Promise.reject({ status: 404, error: "LOTE_NOT_FOUND" })
  }

  // Calcular totales en tiempo real desde los envíos
  const pendientes  = lote.envios.filter(e => e.estado === "PENDIENTE").length
  const procesando  = lote.envios.filter(e => e.estado === "PROCESANDO").length
  const procesados  = lote.envios.filter(e => e.estado === "PROCESADO").length
  const errores     = lote.envios.filter(e => e.estado === "ERROR").length

  return {
    loteId: lote.id,
    estado: lote.estado,
    totalEnvios: lote.envios.length,
    iniciadoAt: lote.iniciadoAt,
    iniciadoPor: lote.iniciadoPor,
    totales: {
      total:      lote.envios.length,
      pendientes: pendientes + procesando, // PROCESANDO cuenta como "en vuelo", aún no terminado
      procesados,
      errores,
    },
    envios: lote.envios,
  }
}

// ---------------------------------------------------------------------------
// mockGetEstados
// Simula GET /api/cargos-str/netsuite/estados?periodoIds=...&orCodigos=...
// Busca en todos los lotes el último estado de cada (periodoId, orCodigo).
// PROCESADO/ERROR ganan sobre PENDIENTE/PROCESANDO.
// TODO FE-6: reemplazar por fetch real cuando BE-2 esté listo
// ---------------------------------------------------------------------------

export async function mockGetEstados(
  periodoIds: string[],
  orCodigos: string[]
): Promise<Record<EstadoEnvioKey, EstadoEnvioUI>> {
  const delay = 100 + Math.floor(Math.random() * 100)
  await new Promise(resolve => setTimeout(resolve, delay))

  const resultado: Record<EstadoEnvioKey, EstadoEnvioUI> = {}

  // Prioridad de estado: PROCESADO > ERROR > PROCESANDO > PENDIENTE
  const prioridad = (estado: string): number => {
    if (estado === "PROCESADO")  return 4
    if (estado === "ERROR")      return 3
    if (estado === "PROCESANDO") return 2
    return 1 // PENDIENTE
  }

  for (const lote of mockLotes.values()) {
    for (const envio of lote.envios) {
      if (!periodoIds.includes(envio.periodoId)) continue
      if (!orCodigos.includes(envio.orCodigo)) continue

      const key: EstadoEnvioKey = `${envio.periodoId}|${envio.orCodigo}`
      const existente = resultado[key]

      // Solo sobreescribir si el nuevo estado tiene mayor prioridad
      if (existente && prioridad(existente.estado) >= prioridad(envio.estado)) continue

      resultado[key] = {
        ultimoEnvioId: envio.id,
        estado: envio.estado,
        numeroOc: envio.numeroOc,
        errorMensaje: envio.errorMensaje,
        loteId: lote.id,
        fecha: envio.enviadoAt ?? lote.iniciadoAt,
      }
    }
  }

  return resultado
}

// ---------------------------------------------------------------------------
// mockGetLoteActivo
// Simula GET /api/cargos-str/netsuite/lote/activo
// Devuelve el único lote EN_PROGRESO si existe (máximo 1 por advisory lock).
// TODO FE-6: reemplazar por fetch real cuando BE-5 esté listo
// ---------------------------------------------------------------------------

export async function mockGetLoteActivo(): Promise<LoteEnCursoUI | null> {
  await new Promise(resolve => setTimeout(resolve, 100))

  for (const lote of mockLotes.values()) {
    if (lote.estado === "EN_PROGRESO") {
      const pendientes  = lote.envios.filter(e => e.estado === "PENDIENTE").length
      const procesando  = lote.envios.filter(e => e.estado === "PROCESANDO").length
      const procesados  = lote.envios.filter(e => e.estado === "PROCESADO").length
      const errores     = lote.envios.filter(e => e.estado === "ERROR").length

      return {
        id: lote.id,
        estado: "EN_PROGRESO",
        iniciadoAt: lote.iniciadoAt,
        iniciadoPor: lote.iniciadoPor,
        totales: {
          total:      lote.envios.length,
          pendientes: pendientes + procesando,
          procesados,
          errores,
        },
        puedeCancelar: true,
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// mockPostCancelar
// Simula POST /api/cargos-str/netsuite/lote/:loteId/cancelar
// Si hay envíos PROCESANDO, retorna 409 (el frontend debe manejarlo).
// TODO FE-6: reemplazar por fetch real cuando BE-6 esté listo
// ---------------------------------------------------------------------------

export async function mockPostCancelar(loteId: string): Promise<void> {
  await sleep(200)

  const lote = mockLotes.get(loteId)
  if (!lote) {
    return Promise.reject({ status: 404, error: "LOTE_NOT_FOUND" })
  }

  // Si hay envíos en PROCESANDO → 409 (el backend real haría lo mismo)
  // El envío PROCESANDO queda en estado indeterminado — correcto por diseño
  const hayProcesando = lote.envios.some(e => e.estado === "PROCESANDO")
  if (hayProcesando) {
    return Promise.reject({ status: 409, error: "CANCELACION_IMPOSIBLE_CON_PROCESANDO" })
  }

  // Marcar lote como CANCELADO — el loop en processEnvioSecuencial lo detecta
  // en la siguiente iteración y rompe el ciclo
  lote.estado = "CANCELADO"

  // Marcar los envíos PENDIENTES que aún no arrancaron
  lote.envios.forEach(e => {
    if (e.estado === "PENDIENTE") {
      e.estado = "ERROR"
      e.errorMensaje = "Cancelado por el usuario"
      e.respondidoAt = new Date().toISOString()
    }
  })
}

// ---------------------------------------------------------------------------
// MOCK_ESTADOS_ENVIO
// Constante estática para FE-2/FE-3 — compatible con el useEffect de carga
// TODO FE-6: esta constante ya no se necesita cuando mockGetEstados es el source
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
// Constante estática — compatibilidad con FE-4 (ya no se usa en FE-5+)
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
