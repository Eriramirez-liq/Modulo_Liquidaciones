# Runbook — Operación de la integración NetSuite (Cargos STR)

Procedimientos operativos del módulo NetSuite. Todo el SQL se corre en
**Supabase → SQL Editor**. Las credenciales van en **Vercel → Settings →
Environment Variables** (nunca en el repo ni en chats).

---

## 1. Lote colgado en `EN_PROGRESO`

**Síntoma:** "Crear OC" responde `409 LOTE_EN_CURSO` pero el lote anterior nunca
terminó (su `procesarLote` se cortó: deploy a mitad, error de DB, etc.). Como solo
puede haber un lote `EN_PROGRESO` a la vez, bloquea los nuevos.

**Opción A — desde la UI (preferida):** en Cargos STR, panel "Lote en curso" →
botón **Cancelar** (requiere que ningún envío esté `PROCESANDO`).

**Opción B — por SQL (si el botón no aplica o quedó realmente colgado):**
```sql
-- Inspeccionar
SELECT id, estado, total_envios, iniciado_at FROM lotes_netsuite WHERE estado = 'EN_PROGRESO';

-- Cancelar (conserva auditoría)
UPDATE lotes_netsuite SET estado = 'CANCELADO', finalizado_at = now() WHERE estado = 'EN_PROGRESO';

-- O borrar por completo (pizarra limpia — borrar envíos primero por la FK)
DELETE FROM envios_netsuite_cargo_str WHERE lote_id IN (SELECT id FROM lotes_netsuite WHERE estado = 'EN_PROGRESO');
DELETE FROM lotes_netsuite WHERE estado = 'EN_PROGRESO';
```

---

## 2. Ver qué pasó con un lote / por qué falló un envío

**Desde la UI:** Cargos STR → link **"Historial de envíos"** (`/cargos-str/historial`).
Lista los lotes; al expandir uno muestra cada envío con OR, monto, N° de OC y el
`errorMensaje` real de NetSuite.

**Por SQL (diagnóstico fino, incluye el payload):**
```sql
SELECT o.codigo AS or_codigo, e.estado, e.error_codigo, e.error_mensaje,
       e.error_payload_json, e.numero_oc, e.netsuite_internal_id, e.intentos
FROM envios_netsuite_cargo_str e
JOIN configuracion_or o ON o.id = e.or_id
ORDER BY e."createdAt" DESC LIMIT 20;
```
`error_payload_json` guarda `{ request, response }` — útil para ver el detalle
crudo de NetSuite (`o:errorDetails`).

---

## 3. Activar el modo real / cargar credenciales

En **Vercel → Environment Variables** (Production y/o Preview) + **Redeploy**:
```
NETSUITE_MODE=real
NETSUITE_CONSUMER_KEY=...        NETSUITE_CONSUMER_SECRET=...
NETSUITE_TOKEN_ID=...            NETSUITE_TOKEN_SECRET=...
```
Base URL, account (`8312907`), subsidiary (`2`), item (`488`) ya son defaults en
código (overridables por env). `location` no se envía salvo `NETSUITE_LOCATION_ID`.

**Vendor por OR:** cargá el internalId del vendor desde la UI (Operadores → columna
**Vendor NetSuite** → Editar), o por SQL:
```sql
UPDATE configuracion_or SET netsuite_vendor_id = '<INTERNAL_ID>' WHERE codigo = '<OR>';
```
Sin `netsuite_vendor_id`, el envío sale `ERROR: VENDOR_SIN_ID` (no rompe el lote).

---

## 4. Migraciones pendientes de aplicar (Supabase)

El proyecto adopta `prisma migrate`, pero las migraciones del módulo se aplican
manualmente en Supabase (no se corre `migrate deploy` contra prod). SQL idempotente:

```sql
-- Tablas + enums (migración 20260525000000_netsuite_cargos_str)
-- Ver el migration.sql; usar CREATE TYPE/TABLE/INDEX IF NOT EXISTS.

-- Columna vendor (20260617000000_netsuite_vendor_id)
ALTER TABLE "configuracion_or" ADD COLUMN IF NOT EXISTS "netsuite_vendor_id" TEXT;

-- Valores de enum de auditoría (20260617120000_netsuite_audit_enum)
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'PROCESAR_ENVIO_NETSUITE';
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'REENVIAR_ENVIO_NETSUITE';
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'CANCELAR_LOTE_NETSUITE';
```
> `ALTER TYPE ... ADD VALUE` a veces no corre dentro de una transacción: si Supabase
> se queja, ejecutá cada línea por separado. Mientras el enum no esté aplicado, la
> auditoría de esas acciones se omite (no-throwing) sin romper ningún flujo.

---

## 5. Notas de runtime (Vercel Hobby)

- `maxDuration = 60s` y `MAX_ENVIOS_POR_LOTE = 25` (≈2s/envío → ~50s, con margen).
  Si crece, evaluar Vercel Pro y subir el límite.
- El procesamiento usa `after()` (sobrevive a la respuesta 202). Si un deploy corta
  el lote a mitad, queda colgado → ver §1; el reproceso es idempotente
  (`updateMany` con guard de estado + `idempotency_key`).
- `runtime`/`maxDuration` se declaran inline en cada handler, no en `vercel.json`.
