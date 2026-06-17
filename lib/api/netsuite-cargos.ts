// Helpers de fetch para los endpoints de cargos STR / NetSuite.
// Solo usa la anon key implícita (cookie de sesión same-origin) — NUNCA service role aquí.
// Shape de respuesta idéntico al LoteResponse del backend (BE-3).

// ---------------------------------------------------------------------------
// Tipos
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

export interface CargoParaEnviar {
  periodoId: string
  orCodigo: string
}

// ---------------------------------------------------------------------------
// Helper interno: lanza el JSON de error si la respuesta no es 2xx,
// para que el catch del caller pueda leer errObj.error (contrato del backend).
// ---------------------------------------------------------------------------

async function throwIfNotOk(res: Response): Promise<void> {
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = { error: "NETWORK_ERROR", message: res.statusText }
    }
    throw body
  }
}

// ---------------------------------------------------------------------------
// crearLoteReal
// POST /api/cargos-str/netsuite/lote
// Body: { cargos: [{ periodoId, orCodigo }, ...] }
// Respuesta 201: LoteResponse
// Error no-2xx: lanza el JSON del body (ej. { error: "LOTE_EN_CURSO", iniciadoPor: {...} })
// ---------------------------------------------------------------------------

export async function crearLoteReal(cargos: CargoParaEnviar[]): Promise<LoteResponse> {
  const res = await fetch("/api/cargos-str/netsuite/lote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cargos }),
  })
  await throwIfNotOk(res)
  return res.json() as Promise<LoteResponse>
}

// ---------------------------------------------------------------------------
// procesarLoteReal
// POST /api/cargos-str/netsuite/lote/:loteId/procesar
// Sin body. Responde 202 Accepted (fire-and-forget desde el frontend).
// ---------------------------------------------------------------------------

export async function procesarLoteReal(loteId: string): Promise<void> {
  const res = await fetch(`/api/cargos-str/netsuite/lote/${loteId}/procesar`, {
    method: "POST",
  })
  await throwIfNotOk(res)
}

// ---------------------------------------------------------------------------
// getLoteReal
// GET /api/cargos-str/netsuite/lote/:loteId
// Respuesta 200: LoteResponse
// ---------------------------------------------------------------------------

export async function getLoteReal(loteId: string): Promise<LoteResponse> {
  const res = await fetch(`/api/cargos-str/netsuite/lote/${loteId}`)
  await throwIfNotOk(res)
  return res.json() as Promise<LoteResponse>
}
