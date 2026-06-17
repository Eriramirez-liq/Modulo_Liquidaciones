# API — Integración Cargos STR → Oracle NetSuite

Documentación de los endpoints del módulo NetSuite (Cargos STR). Todos viven bajo
`app/api/cargos-str/netsuite/**`, requieren sesión (NextAuth) y corren en runtime
`nodejs`. El `runtime` y el `maxDuration` se declaran **inline** en cada handler
(forma canónica de Next.js App Router) — no en `vercel.json`.

- **Plan de referencia:** `mejoras/netsuite-backend-plan.md`.
- **Capa de servicio:** `lib/integrations/netsuite/` (toda la lógica de dominio).
- **Modo mock/real:** variable de entorno `NETSUITE_MODE` (`mock` por defecto, `real`
  activa el cliente con auth TBA/OAuth1). Ver `.env.example`.

## Forma de error (uniforme)

```jsonc
{ "error": "CODIGO_DOMINIO", "message": "texto", /* + campos según el caso */ }
```
Los 500 devuelven `{ "error": "INTERNAL_ERROR", "message": "Error interno" }`
(el detalle real va a `console.error` → Vercel Runtime Logs, nunca al cliente).

---

## 1. POST `/api/cargos-str/netsuite/lote` — crear lote

Crea un lote con un envío PENDIENTE por cargo. Transacción con `pg_advisory_xact_lock`
(un solo lote `EN_PROGRESO` global). `maxDuration = 60`.

**Body:** `{ "cargos": [{ "periodoId": "<uuid>", "orCodigo": "AFINIA" }, ...] }`
(1..25 cargos — `MAX_ENVIOS_POR_LOTE`).

**201:** `{ loteId, estado: "EN_PROGRESO", totalEnvios, iniciadoAt, finalizadoAt, iniciadoPor, totales, envios }`

**Errores:** 400 `VALIDATION_ERROR` (`issues`) · 400 `SIN_DATOS` (`conflictos`) ·
404 `OR_NO_ENCONTRADO` (`orCodigo`) · 409 `LOTE_EN_CURSO` (`loteEnCursoId`, `iniciadoAt`, `iniciadoPor`) ·
422 `MONTO_CERO` (`conflictos`) · 422 `CARGO_YA_PROCESADO` (`conflictos`) · 401 · 500.

## 2. POST `/api/cargos-str/netsuite/lote/:loteId/procesar` — procesar

Dispara el procesamiento secuencial en background con `after()` de Next.js
(sobrevive a la respuesta dentro de `maxDuration = 60`). Responde de inmediato.

**202:** `{ loteId, estado: "EN_PROGRESO", totalEnvios }`
**Errores:** 404 `LOTE_NO_ENCONTRADO` · 409 `LOTE_NO_PROCESABLE` · 401 · 500.

## 3. GET `/api/cargos-str/netsuite/lote/:loteId` — detalle (polling)

**200:** `{ loteId, estado, totalEnvios, iniciadoAt, finalizadoAt, iniciadoPor, totales, envios[] }`.
Cada envío (`EnvioDto`): `{ id, periodoId, orId, orCodigo, orNombre, montoSnapshotCop (string),
mesConsumo, mesFacturacion, estado, intentos, numeroOc, netsuiteInternalId, errorMensaje, errorCodigo, enviadoAt, respondidoAt }`.
**Errores:** 404 `LOTE_NO_ENCONTRADO` · 401 · 500.

## 4. GET `/api/cargos-str/netsuite/estados` — badges por cargo

**Query:** `?periodoIds=a,b&orCodigos=AFINIA,AIRE` (CSV).
**200:** `Record<"${periodoId}|${orCodigo}", EstadoEnvioPorCargoDto>` donde
`EstadoEnvioPorCargoDto = { ultimoEnvioId, estado, numeroOc, errorMensaje, loteId, fecha }`.
**Errores:** 400 `VALIDATION_ERROR` · 401 · 500.

## 5. GET `/api/cargos-str/netsuite/lote/activo` — lote en curso

**200:** mismo shape que el endpoint 3 (el lote `EN_PROGRESO`).
**204:** sin body (no hay lote activo).
**Errores:** 401 · 500.

## 6. POST `/api/cargos-str/netsuite/envio/:envioId/reenviar` — reenviar

Reenvío **síncrono** (espera la respuesta de NetSuite, hasta ~30s). `maxDuration = 60`.
Solo si el envío está `ERROR` y su lote `EN_PROGRESO`.

**200:** `EnvioDto` actualizado.
**Errores:** 404 `ENVIO_NO_ENCONTRADO` · 409 `ENVIO_NO_REENVIABLE` · 401 · 500.

## 7. POST `/api/cargos-str/netsuite/lote/:loteId/cancelar` — cancelar

Solo si el lote está `EN_PROGRESO` y ningún envío en `PROCESANDO`.

**200:** `{ loteId, estado: "CANCELADO" }`
**Errores:** 404 `LOTE_NO_ENCONTRADO` · 409 `LOTE_NO_CANCELABLE` · 401 · 500.

## 8. GET `/api/cargos-str/netsuite/lotes` — historial

**Query:** `?limite=50` (default 50, cap 200).
**200:** `{ lotes: LoteResumenDto[] }` donde
`LoteResumenDto = { id, estado, totalEnvios, totalOk, totalError, iniciadoAt, finalizadoAt, iniciadoPor }`.
El detalle de cada lote se obtiene con el endpoint 3.

## Auxiliar — PATCH `/api/operadores/:id` — vendor id NetSuite

Edita el internalId del vendor de un OR (para el `entity` de la PO).

**Body:** `{ "netsuite_vendor_id": "53301" | null }`
**200:** `{ id, codigo, nombre, netsuite_vendor_id }`
**Errores:** 400 `VALIDATION_ERROR` · 404 `OR_NO_ENCONTRADO` · 401 · 500.

---

## Cliente real NetSuite (Fase 2)

`lib/integrations/netsuite/real-client.ts` + `oauth-tba.ts`. Auth **TBA / OAuth 1.0a
(HMAC-SHA256)**. La OC es una **Purchase Order** (`/services/rest/record/v1/purchaseOrder`).

**Payload PO:**
```jsonc
{
  "externalId": "<idempotency_key>",
  "entity":     { "id": "<ConfiguracionOR.netsuite_vendor_id>" },
  "subsidiary": { "id": "<NETSUITE_SUBSIDIARY_ID, default 2>" },
  "currency":   { "refName": "COP" },
  "memo":       "Cargo STR <OR> <AAAA-MM>",
  "tranDate":   "<AAAA-MM>-01",
  "item": { "items": [ { "item": { "id": "<NETSUITE_ITEM_ID, default 488>" }, "quantity": 1, "rate": <monto> } ] }
  // "location" solo si NETSUITE_LOCATION_ID está set (esta transacción NO la requiere)
}
```
Número de OC = `tranId` (GET posterior al record creado). Si el OR no tiene
`netsuite_vendor_id` → el envío sale `ERROR` con código `VENDOR_SIN_ID`. El
`errorMensaje` de un 400 incluye el `o:errorDetails` real de NetSuite.

## Variables de entorno (Vercel — nunca en el repo)

| Var | Default (código) | Notas |
|-----|------------------|-------|
| `NETSUITE_MODE` | `mock` | `real` activa el cliente con OAuth |
| `NETSUITE_BASE_URL` | `https://8312907.suitetalk.api.netsuite.com` | host REST |
| `NETSUITE_ACCOUNT_ID` | `8312907` | realm OAuth |
| `NETSUITE_CONSUMER_KEY` / `_SECRET` | — (secret) | solo en Vercel |
| `NETSUITE_TOKEN_ID` / `_SECRET` | — (secret) | solo en Vercel |
| `NETSUITE_SUBSIDIARY_ID` | `2` | internalId subsidiaria |
| `NETSUITE_LOCATION_ID` | — (no se envía) | opcional |
| `NETSUITE_ITEM_ID` | `488` | internalId ítem de la línea |
| `NETSUITE_DEFAULT_QUANTITY` | `1` | cantidad de la línea |

## Observabilidad

- **Logs estructurados** (JSON, Vercel Runtime Logs): `logNetsuite` emite eventos
  `lote.creado`, `envio.procesado_ok|error`, `lote.completado`, `envio.reenviado`,
  `lote.cancelado`, `lote.en_curso_conflicto`. Nunca tokens ni montos sueltos.
- **Auditoría** (`log_auditoria`, best-effort/no-throwing): acciones
  `ENVIAR_LOTE_NETSUITE`, `PROCESAR_ENVIO_NETSUITE`, `REENVIAR_ENVIO_NETSUITE`,
  `CANCELAR_LOTE_NETSUITE`.
