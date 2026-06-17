/**
 * Cliente NetSuite REAL — autenticación TBA / OAuth 1.0a (HMAC-SHA256).
 *
 * La capa de AUTENTICACIÓN y TRANSPORTE está completa y es estándar para
 * cualquier cuenta NetSuite (ver `oauth-tba.ts`). Lo que depende de la cuenta
 * concreta de BIA está aislado en dos funciones marcadas con `CONFIRMAR`:
 *   - `construirCuerpoOrden(payload)` — el JSON del registro a crear (qué
 *     registro es la "OC" y qué campos lleva).
 *   - `parsearRespuesta(...)` — cómo extraer el internalId y el número de OC
 *     de la respuesta de NetSuite.
 *
 * Credenciales (solo servidor, nunca NEXT_PUBLIC_, nunca loguear — R7):
 *   NETSUITE_BASE_URL     host REST, ej. https://1234567-sb1.suitetalk.api.netsuite.com
 *   NETSUITE_ACCOUNT_ID   realm, ej. 1234567_SB1 (MAYÚSCULAS, guion bajo)
 *   NETSUITE_CONSUMER_KEY / NETSUITE_CONSUMER_SECRET
 *   NETSUITE_TOKEN_ID     / NETSUITE_TOKEN_SECRET
 *   NETSUITE_RECORD_PATH  ruta del registro, ej. /services/rest/record/v1/purchaseOrder
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.3, R4, R7, R9.
 */

import type { NetsuiteClient } from "./client"
import type { NetsuitePayload, NetsuiteResponse } from "./types"
import { NETSUITE_TIMEOUT_MS } from "./config"
import { construirHeaderOAuthTba } from "./oauth-tba"

interface RealClientConfig {
  baseUrl: string
  accountId: string
  consumerKey: string
  consumerSecret: string
  tokenId: string
  tokenSecret: string
  recordPath: string
  // IDs internos NetSuite de la OC (fijos de la cuenta, no por OR).
  subsidiaryId: string
  locationId: string
  itemId: string
  /** Cantidad de la línea; por defecto 1 (cargo a tanto alzado). */
  quantity: number
}

function leerEnv(nombre: string): string {
  const v = process.env[nombre]
  if (!v) {
    throw new Error(
      `RealNetsuiteClient: falta la variable de entorno ${nombre}. ` +
        `Configurarla en Vercel (Settings → Environment Variables), nunca en el repo.`,
    )
  }
  return v
}

export class RealNetsuiteClient implements NetsuiteClient {
  private cfg: RealClientConfig

  constructor() {
    // Cuenta 8312907 (producción). Host y realm derivados del accountId, según
    // la doc de Oracle: <accountID>.suitetalk.api.netsuite.com. Overridables.
    this.cfg = {
      baseUrl: (
        process.env.NETSUITE_BASE_URL ??
        "https://8312907.suitetalk.api.netsuite.com"
      ).replace(/\/$/, ""),
      accountId: process.env.NETSUITE_ACCOUNT_ID ?? "8312907",
      consumerKey: leerEnv("NETSUITE_CONSUMER_KEY"),
      consumerSecret: leerEnv("NETSUITE_CONSUMER_SECRET"),
      tokenId: leerEnv("NETSUITE_TOKEN_ID"),
      tokenSecret: leerEnv("NETSUITE_TOKEN_SECRET"),
      // Default: orden de compra vía REST record API.
      recordPath:
        process.env.NETSUITE_RECORD_PATH ??
        "/services/rest/record/v1/purchaseOrder",
      // IDs de la prueba (subsidiary=2, location=1, item=10); overridables por env.
      subsidiaryId: process.env.NETSUITE_SUBSIDIARY_ID ?? "2",
      locationId: process.env.NETSUITE_LOCATION_ID ?? "1",
      itemId: process.env.NETSUITE_ITEM_ID ?? "10",
      quantity: Number(process.env.NETSUITE_DEFAULT_QUANTITY ?? "1"),
    }
  }

  async enviarOrden(payload: NetsuitePayload): Promise<NetsuiteResponse> {
    if (!payload.vendorId) {
      // El OR no tiene netsuite_vendor_id configurado → no se puede crear la OC.
      return {
        status: "error",
        code: "VENDOR_SIN_ID",
        message: `El operador ${payload.vendor} no tiene netsuite_vendor_id configurado.`,
        raw: { externalId: payload.externalId },
      }
    }

    const url = `${this.cfg.baseUrl}${this.cfg.recordPath}`
    const cuerpo = construirCuerpoOrden(payload, this.cfg)

    const res = await this.fetchFirmado("POST", url, cuerpo)
    return parsearRespuesta(res, payload, (location) =>
      this.fetchFirmado("GET", location),
    )
  }

  /**
   * Ejecuta un fetch firmado con TBA y timeout (AbortController). Devuelve la
   * `Response` cruda; el parseo lo hace el caller según el registro.
   */
  private async fetchFirmado(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<Response> {
    const authorization = construirHeaderOAuthTba({
      method,
      url,
      realm: this.cfg.accountId,
      consumerKey: this.cfg.consumerKey,
      consumerSecret: this.cfg.consumerSecret,
      tokenId: this.cfg.tokenId,
      tokenSecret: this.cfg.tokenSecret,
    })

    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), NETSUITE_TIMEOUT_MS)
    try {
      return await fetch(url, {
        method,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(t)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRMAR (Fase 2) — específico de la cuenta NetSuite de BIA.
// Estas dos funciones son lo único que falta cerrar con el payload/respuesta
// reales de la colección de Postman. La firma TBA y el transporte de arriba ya
// están completos y no cambian.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte el monto (string con 2 decimales) al number que exige el campo
 * numérico `rate` de NetSuite. ÚNICO punto sancionado de conversión a Number:
 * el valor ya es un Decimal finalizado (toFixed(2)) y los montos COP están muy
 * por debajo del rango seguro de enteros de JS (2^53). No usar Number() sobre
 * Decimals en ningún otro lado del módulo (R5).
 */
function montoANumero(amount: string): number {
  return Number(amount)
}

/**
 * Arma el JSON de la Purchase Order para la REST record API de NetSuite.
 *
 * Campos (confirmados para la prueba):
 *   - entity      → vendor por internalId (ConfiguracionOR.netsuite_vendor_id).
 *   - subsidiary  → internalId fijo de la cuenta (env).
 *   - location    → internalId fijo de la cuenta (env).
 *   - item.items[]→ una línea con item (internalId), rate (monto) y quantity.
 */
function construirCuerpoOrden(
  payload: NetsuitePayload,
  cfg: RealClientConfig,
): Record<string, unknown> {
  return {
    // externalId permite idempotencia del lado NetSuite (si la cuenta lo respeta).
    externalId: payload.externalId,
    entity: { id: payload.vendorId },
    subsidiary: { id: cfg.subsidiaryId },
    location: { id: cfg.locationId },
    currency: { refName: payload.currency },
    memo: payload.memo,
    tranDate: payload.date,
    item: {
      items: [
        {
          item: { id: cfg.itemId },
          quantity: cfg.quantity,
          rate: montoANumero(payload.amount),
        },
      ],
    },
  }
}

/**
 * CONFIRMAR: traduce la respuesta de NetSuite al contrato `NetsuiteResponse`.
 *
 * Patrón típico de la REST record API: POST exitoso → 204 No Content con header
 * `Location: .../purchaseOrder/<internalId>` (sin body). El número de OC (tranId)
 * suele requerir un GET posterior. Para errores, NetSuite devuelve un JSON con
 * `o:errorDetails`. AJUSTAR con la respuesta real de la colección.
 */
async function parsearRespuesta(
  res: Response,
  payload: NetsuitePayload,
  getRecord: (location: string) => Promise<Response>,
): Promise<NetsuiteResponse> {
  if (res.ok) {
    const location = res.headers.get("location") ?? ""
    const internalId = location.split("/").filter(Boolean).pop() ?? ""

    // Intentar leer el número de OC (tranId) del registro recién creado.
    let documentNumber = ""
    if (location) {
      try {
        const detalle = await getRecord(location)
        if (detalle.ok) {
          const json = (await detalle.json()) as Record<string, unknown>
          documentNumber = String(json["tranId"] ?? json["tranid"] ?? "")
        }
      } catch {
        /* el internalId basta; el tranId se puede resolver luego */
      }
    }

    if (!internalId) {
      // R4: OK sin identificador → error explícito, mejor que una OC fantasma.
      return {
        status: "error",
        code: "NO_INTERNAL_ID",
        message: "NetSuite respondió OK pero sin internalId (Location ausente).",
        raw: { externalId: payload.externalId, status: res.status },
      }
    }

    return {
      status: "ok",
      internalId,
      documentNumber: documentNumber || internalId, // fallback hasta confirmar tranId
      raw: { externalId: payload.externalId, location },
    }
  }

  // Error HTTP: intentar extraer el detalle de NetSuite.
  let detalle: unknown = null
  try {
    detalle = await res.json()
  } catch {
    try {
      detalle = await res.text()
    } catch {
      /* sin cuerpo */
    }
  }

  // NetSuite devuelve el detalle real en `o:errorDetails[].detail`. Lo usamos
  // como mensaje para que la UI muestre la causa concreta (ej. campo inválido),
  // no solo "400 Bad Request".
  const detalleNs = extraerDetalleNetsuite(detalle)

  return {
    status: "error",
    code: `HTTP_${res.status}`,
    message: detalleNs
      ? `NetSuite ${res.status}: ${detalleNs}`
      : `NetSuite respondió ${res.status} ${res.statusText}`,
    raw: { externalId: payload.externalId, detalle },
  }
}

/** Extrae el primer `o:errorDetails[].detail` (o el `title`) del cuerpo de error. */
function extraerDetalleNetsuite(detalle: unknown): string | null {
  if (!detalle || typeof detalle !== "object") {
    return typeof detalle === "string" && detalle.trim() ? detalle.trim() : null
  }
  const obj = detalle as Record<string, unknown>
  const errores = obj["o:errorDetails"]
  if (Array.isArray(errores) && errores.length > 0) {
    const primero = errores[0] as Record<string, unknown>
    const det = primero?.["detail"]
    if (typeof det === "string" && det.trim()) return det.trim()
  }
  const title = obj["title"]
  return typeof title === "string" && title.trim() ? title.trim() : null
}
