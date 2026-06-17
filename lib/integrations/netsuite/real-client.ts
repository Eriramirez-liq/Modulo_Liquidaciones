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
    this.cfg = {
      baseUrl: leerEnv("NETSUITE_BASE_URL").replace(/\/$/, ""),
      accountId: leerEnv("NETSUITE_ACCOUNT_ID"),
      consumerKey: leerEnv("NETSUITE_CONSUMER_KEY"),
      consumerSecret: leerEnv("NETSUITE_CONSUMER_SECRET"),
      tokenId: leerEnv("NETSUITE_TOKEN_ID"),
      tokenSecret: leerEnv("NETSUITE_TOKEN_SECRET"),
      // Default: orden de compra vía REST record API. CONFIRMAR el registro real.
      recordPath:
        process.env.NETSUITE_RECORD_PATH ??
        "/services/rest/record/v1/purchaseOrder",
    }
  }

  async enviarOrden(payload: NetsuitePayload): Promise<NetsuiteResponse> {
    const url = `${this.cfg.baseUrl}${this.cfg.recordPath}`
    const cuerpo = construirCuerpoOrden(payload)

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
 * CONFIRMAR: arma el JSON del registro que NetSuite espera para crear la OC.
 *
 * El payload genérico trae { externalId, vendor (or.codigo), amount (string),
 * currency, memo, date }. Falta saber:
 *   - Qué registro es (purchaseOrder / vendorBill / RESTlet custom).
 *   - Cómo se identifica el vendor (internalId / externalId) → mapeo OR→vendor (R9).
 *   - Campos obligatorios de la cuenta (subsidiary, location, item/expense lines…).
 *
 * Estructura tentativa para purchaseOrder REST (AJUSTAR con el ejemplo real):
 */
function construirCuerpoOrden(payload: NetsuitePayload): Record<string, unknown> {
  return {
    // externalId permite idempotencia del lado NetSuite (si la cuenta lo respeta).
    externalId: payload.externalId,
    entity: { refName: payload.vendor }, // CONFIRMAR: ¿internalId o externalId del vendor?
    currency: { refName: payload.currency },
    memo: payload.memo,
    tranDate: payload.date,
    // CONFIRMAR: líneas (item/expense) y monto. amount es string → NUNCA Number().
    // item: { items: [{ amount: payload.amount, ... }] },
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

  return {
    status: "error",
    code: `HTTP_${res.status}`,
    message: `NetSuite respondió ${res.status} ${res.statusText}`,
    raw: { externalId: payload.externalId, detalle },
  }
}
