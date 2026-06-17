// Helpers de fetch para los endpoints de cargos STR / NetSuite.
// Solo usa la anon key implícita (cookie de sesión same-origin) — NUNCA service role aquí.
// Shape de respuesta idéntico al LoteResponse del backend (BE-3).

import type { EstadoEnvioUI } from "@/components/cargos-str/types"
import type { LoteResumenDto, EnvioDto } from "@/lib/integrations/netsuite/types"

// Re-exportar tipos del módulo canónico para que las páginas los importen desde aquí
export type { LoteResumenDto, EnvioDto }

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

// ---------------------------------------------------------------------------
// getEstadosReal
// GET /api/cargos-str/netsuite/estados?periodoIds=a,b&orCodigos=X,Y
// Respuesta 200: Record<`${periodoId}|${orCodigo}`, EstadoEnvioUI>
// Si no hay datos devuelve {} (objeto vacío).
// ---------------------------------------------------------------------------

export async function getEstadosReal(
  periodoIds: string[],
  orCodigos: string[],
): Promise<Record<string, EstadoEnvioUI>> {
  const params = new URLSearchParams({
    periodoIds: periodoIds.map(encodeURIComponent).join(","),
    orCodigos: orCodigos.map(encodeURIComponent).join(","),
  })
  const res = await fetch(`/api/cargos-str/netsuite/estados?${params}`)
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = { error: "NETWORK_ERROR", message: res.statusText }
    }
    throw body
  }
  return res.json() as Promise<Record<string, EstadoEnvioUI>>
}

// ---------------------------------------------------------------------------
// getLoteActivoReal
// GET /api/cargos-str/netsuite/lote/activo
// Respuesta 200: LoteResponse con el lote en curso
// Respuesta 204: sin body → devuelve null (no hay lote activo)
// ---------------------------------------------------------------------------

export async function getLoteActivoReal(): Promise<LoteResponse | null> {
  const res = await fetch("/api/cargos-str/netsuite/lote/activo")
  if (res.status === 204) return null
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = { error: "NETWORK_ERROR", message: res.statusText }
    }
    throw body
  }
  return res.json() as Promise<LoteResponse>
}

// ---------------------------------------------------------------------------
// listarLotesReal
// GET /api/cargos-str/netsuite/lotes?limite=N
// Respuesta 200: { lotes: LoteResumenDto[] }
// ---------------------------------------------------------------------------

export async function listarLotesReal(limite = 50): Promise<LoteResumenDto[]> {
  const res = await fetch(`/api/cargos-str/netsuite/lotes?limite=${limite}`)
  await throwIfNotOk(res)
  const data = await res.json() as { lotes: LoteResumenDto[] }
  return data.lotes
}

// ---------------------------------------------------------------------------
// cancelarLoteReal
// POST /api/cargos-str/netsuite/lote/:loteId/cancelar
// Sin body. Respuesta 200: { loteId, estado: "CANCELADO" }
// Errores: 404 LOTE_NO_ENCONTRADO, 409 LOTE_NO_CANCELABLE, 401, 500
// ---------------------------------------------------------------------------

export async function cancelarLoteReal(
  loteId: string,
): Promise<{ loteId: string; estado: string }> {
  const res = await fetch(`/api/cargos-str/netsuite/lote/${loteId}/cancelar`, {
    method: "POST",
  })
  await throwIfNotOk(res)
  return res.json() as Promise<{ loteId: string; estado: string }>
}

// ---------------------------------------------------------------------------
// reenviarEnvioReal
// POST /api/cargos-str/netsuite/envio/:envioId/reenviar
// Sin body. Respuesta 200: EnvioDto (síncrono, puede tardar ~30s)
// Errores: 404 ENVIO_NO_ENCONTRADO, 409 ENVIO_NO_REENVIABLE, 401, 500
// ---------------------------------------------------------------------------

export async function reenviarEnvioReal(envioId: string): Promise<EnvioDto> {
  const res = await fetch(`/api/cargos-str/netsuite/envio/${envioId}/reenviar`, {
    method: "POST",
  })
  await throwIfNotOk(res)
  return res.json() as Promise<EnvioDto>
}
