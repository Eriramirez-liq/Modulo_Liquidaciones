/**
 * Tests deterministas de la firma TBA / OAuth 1.0a (HMAC-SHA256).
 *
 * Sin DB, sin red: solo lógica pura de firma. Los `nonce`/`timestamp` se
 * inyectan fijos para que el header sea estable y verificable (known-answer).
 */
import { describe, it, expect } from "vitest"
import { percentEncode, construirHeaderOAuthTba } from "@/lib/integrations/netsuite/oauth-tba"

describe("percentEncode (RFC 3986)", () => {
  it("escapa espacios como %20 (no '+')", () => {
    expect(percentEncode("a b")).toBe("a%20b")
  })

  it("escapa los caracteres !*'() que encodeURIComponent deja pasar", () => {
    expect(percentEncode("!")).toBe("%21")
    expect(percentEncode("*")).toBe("%2A")
    expect(percentEncode("'")).toBe("%27")
    expect(percentEncode("(")).toBe("%28")
    expect(percentEncode(")")).toBe("%29")
    expect(percentEncode("!*'()")).toBe("%21%2A%27%28%29")
  })

  it("NO escapa los caracteres no reservados -_.~", () => {
    expect(percentEncode("-_.~")).toBe("-_.~")
  })

  it("deja sin tocar caracteres alfanuméricos normales", () => {
    expect(percentEncode("abcXYZ0189")).toBe("abcXYZ0189")
  })

  it("escapa reservados habituales (=, &, /, espacio combinados)", () => {
    expect(percentEncode("a=b&c/d e")).toBe("a%3Db%26c%2Fd%20e")
  })
})

const baseParams = {
  method: "POST",
  url: "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/record/v1/purchaseOrder",
  realm: "1234567_SB1",
  consumerKey: "ck-example",
  consumerSecret: "cs-example",
  tokenId: "ti-example",
  tokenSecret: "ts-example",
  nonce: "fixednonce123456",
  timestamp: "1700000000",
} as const

describe("construirHeaderOAuthTba", () => {
  it("es estable: mismo input → mismo output", () => {
    const a = construirHeaderOAuthTba({ ...baseParams })
    const b = construirHeaderOAuthTba({ ...baseParams })
    expect(a).toBe(b)
  })

  it("incluye el realm y los componentes OAuth obligatorios", () => {
    const header = construirHeaderOAuthTba({ ...baseParams })
    expect(header.startsWith('OAuth realm="1234567_SB1"')).toBe(true)
    expect(header).toContain('oauth_signature_method="HMAC-SHA256"')
    expect(header).toContain('oauth_consumer_key="ck-example"')
    expect(header).toContain('oauth_token="ti-example"')
    expect(header).toContain('oauth_version="1.0"')
    expect(header).toContain('oauth_nonce="fixednonce123456"')
    expect(header).toContain('oauth_timestamp="1700000000"')
    expect(header).toContain("oauth_signature=")
  })

  it("NO filtra los secretos (consumerSecret/tokenSecret) en el header", () => {
    const header = construirHeaderOAuthTba({ ...baseParams })
    expect(header).not.toContain("cs-example")
    expect(header).not.toContain("ts-example")
  })

  it("known-answer: la firma para los inputs fijos es estable", () => {
    const header = construirHeaderOAuthTba({ ...baseParams })
    // Calculado de forma independiente con HMAC-SHA256 sobre la base string OAuth.
    expect(header).toContain(
      'oauth_signature="sm9CgKt6dIfQkT5Cvxyo03wppd4gopca5mtFUl27Vso%3D"',
    )
  })

  it("cambiar el método HTTP cambia la firma", () => {
    const post = construirHeaderOAuthTba({ ...baseParams, method: "POST" })
    const get = construirHeaderOAuthTba({ ...baseParams, method: "GET" })
    expect(extraerSignature(post)).not.toBe(extraerSignature(get))
  })

  it("cambiar la URL cambia la firma", () => {
    const a = construirHeaderOAuthTba({ ...baseParams })
    const b = construirHeaderOAuthTba({
      ...baseParams,
      url: "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/record/v1/vendorBill",
    })
    expect(extraerSignature(a)).not.toBe(extraerSignature(b))
  })

  it("cambiar el nonce cambia la firma", () => {
    const a = construirHeaderOAuthTba({ ...baseParams })
    const b = construirHeaderOAuthTba({ ...baseParams, nonce: "otrononcefijo999" })
    expect(extraerSignature(a)).not.toBe(extraerSignature(b))
  })

  it("incluye en la firma los query params de la URL", () => {
    const sin = construirHeaderOAuthTba({ ...baseParams })
    const con = construirHeaderOAuthTba({
      ...baseParams,
      url: `${baseParams.url}?foo=bar`,
    })
    // Los query params NO aparecen como oauth_* en el header, pero SÍ alteran la firma.
    expect(con).not.toContain("foo")
    expect(extraerSignature(sin)).not.toBe(extraerSignature(con))
  })
})

/** Extrae el valor percent-encodeado de oauth_signature del header. */
function extraerSignature(header: string): string {
  const m = header.match(/oauth_signature="([^"]*)"/)
  if (!m) throw new Error("oauth_signature no encontrado en el header")
  return m[1] as string
}
