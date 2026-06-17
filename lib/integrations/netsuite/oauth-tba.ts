/**
 * Firma TBA / OAuth 1.0a (HMAC-SHA256) para la API REST de NetSuite.
 *
 * NetSuite autentica las llamadas REST con Token-Based Authentication, que es
 * OAuth 1.0a de una sola pata (no hay intercambio de tokens en runtime: el
 * Token ID/Secret se generan una vez en NetSuite). Cada request se firma así:
 *
 *   1. Se arman los parámetros oauth_* (+ los query params de la URL, si hay).
 *   2. Base string = METHOD & pct(baseUrl_sin_query) & pct(paramString_ordenado).
 *   3. Signing key  = pct(consumerSecret) & pct(tokenSecret).
 *   4. signature    = base64( HMAC-SHA256(baseString, signingKey) ).
 *   5. Header Authorization: OAuth realm="<ACCOUNT>", oauth_*="...", todo
 *      percent-encoded y entre comillas.
 *
 * El `realm` es el Account ID en MAYÚSCULAS con guion bajo (ej. "1234567_SB1"),
 * mientras que el host de la URL usa minúsculas con guion (ej. "1234567-sb1").
 *
 * Estas credenciales (consumer/token) son secretas: este módulo solo corre en
 * servidor y nunca debe loguear sus valores (R7).
 */

import { createHmac, randomBytes } from "node:crypto"

export interface OAuthTbaParams {
  method: string // "GET" | "POST" | ...
  url: string // URL completa (puede incluir query string)
  realm: string // Account ID, ej. "1234567_SB1"
  consumerKey: string
  consumerSecret: string
  tokenId: string
  tokenSecret: string
  /** Inyectables para pruebas deterministas; en producción se generan. */
  nonce?: string
  timestamp?: string
}

/**
 * Percent-encoding según RFC 3986 (el que exige OAuth 1.0a): además de lo que
 * hace `encodeURIComponent`, escapa `!*'()` y deja sin escapar `-_.~`.
 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

function generarNonce(): string {
  // 32 hex chars; alfanumérico puro, válido como nonce OAuth.
  return randomBytes(16).toString("hex")
}

/**
 * Construye el valor completo del header `Authorization` para una llamada TBA.
 * No realiza la petición — solo firma.
 */
export function construirHeaderOAuthTba(params: OAuthTbaParams): string {
  const {
    method,
    url,
    realm,
    consumerKey,
    consumerSecret,
    tokenId,
    tokenSecret,
  } = params

  const nonce = params.nonce ?? generarNonce()
  const timestamp =
    params.timestamp ?? String(Math.floor(Date.now() / 1000))

  // Separar la URL base (sin query) de sus parámetros.
  const u = new URL(url)
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`

  // Parámetros oauth_* obligatorios.
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_token: tokenId,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: "1.0",
  }

  // Para la FIRMA se incluyen también los query params de la URL.
  const allParams: Array<[string, string]> = [
    ...Object.entries(oauthParams),
    ...Array.from(u.searchParams.entries()),
  ]

  // Ordenar por clave (y valor) ya percent-encodeados, y unir con &.
  const parameterString = allParams
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")

  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(parameterString),
  ].join("&")

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`

  const signature = createHmac("sha256", signingKey)
    .update(baseString)
    .digest("base64")

  // El header solo lleva los oauth_* (NO los query params) + realm + signature.
  const headerParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  }

  const headerKv = Object.entries(headerParams)
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ")

  // El realm NO entra en la firma, pero sí en el header.
  return `OAuth realm="${percentEncode(realm)}", ${headerKv}`
}
