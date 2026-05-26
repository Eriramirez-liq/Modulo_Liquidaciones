# Auditoría RLS — Tablas NetSuite Cargos STR

> **Modo:** Auditoría
> **Fecha:** 2026-05-25
> **Alcance:** Migración `20260525000000_netsuite_cargos_str` — tablas `lotes_netsuite` y `envios_netsuite_cargo_str`
> **Autor:** Backend Specialist (BE-1)

## Resumen ejecutivo

La migración BE-1 crea dos tablas nuevas (`lotes_netsuite`, `envios_netsuite_cargo_str`) **sin políticas RLS**. Esta decisión está alineada con D7 del plan backend (`mejoras/netsuite-backend-plan.md`) — RLS completo se posterga a Fase 3. Este documento registra el riesgo aceptado, las mitigaciones temporales y el plan de remediación.

## Tablas afectadas

| Tabla | Propósito | Contiene dinero | Sensibilidad |
|-------|-----------|------------------|--------------|
| `lotes_netsuite` | Cabecera de cada lote de envíos a NetSuite (estado agregado, totales, quién lo inició) | No directo (totales agregados como `Int`) | Media — revela cadencia operativa |
| `envios_netsuite_cargo_str` | Detalle de cada envío individual: snapshot del monto (`Decimal(18,2)`), idempotency key, payload de error, número OC de NetSuite | **Sí** — `monto_snapshot_cop` | **Alta** — montos por OR/período + IDs externos de NetSuite (`netsuite_internal_id`, `numero_oc`) |

## Estado actual de seguridad (sin RLS)

Hoy el repo **no** usa `@supabase/ssr` ni el cliente JS de Supabase con `anon-key`. Toda la lectura/escritura va por **Prisma** con el `DATABASE_URL` configurado en Vercel (Pooler de Supabase con credenciales de Postgres). Esto significa:

- **Backend (Vercel handlers):** acceso completo vía Prisma — comportamiento esperado.
- **Frontend (React Server Components / Client Components):** **no** llama directamente a PostgREST/Supabase. Toda interacción pasa por route handlers en `app/api/cargos-str/netsuite/**` (a crear en BE-3 a BE-5) que ya autentican con NextAuth.
- **anon-key de PostgREST:** Supabase la genera automáticamente. Si alguien la obtuviese **y** las nuevas tablas estuvieran expuestas en PostgREST (schema `public`), podría leer/escribir las tablas saltando NextAuth.

## Acción de mitigación temporal (a ejecutar por Erika cuando aplique la migración)

**Verificación manual obligatoria post-deploy de la migración**, en Supabase Dashboard:

### Paso 1 — Verificar privilegios de los roles `anon` y `authenticated`

En **Supabase Dashboard → SQL Editor**, ejecutar:

```sql
SELECT
  grantee,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('lotes_netsuite', 'envios_netsuite_cargo_str')
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, table_name, privilege_type;
```

**Resultado esperado:** 0 filas. Si hay filas, ir a Paso 2.

### Paso 2 — Si hay privilegios indebidos, revocarlos

```sql
REVOKE ALL ON TABLE "lotes_netsuite" FROM anon, authenticated;
REVOKE ALL ON TABLE "envios_netsuite_cargo_str" FROM anon, authenticated;
```

(Esto NO afecta a `service_role` ni al rol `postgres` que usa Prisma.)

### Paso 3 — Verificar que PostgREST no exponga las tablas en API pública

En **Supabase Dashboard → Settings → API → Exposed schemas**: confirmar que el esquema `public` está expuesto pero verificar en **Database → API Docs** que las tablas nuevas **no** aparecen con métodos disponibles para anon. (Si aparecen pero el Paso 1 dio 0 privilegios, PostgREST las devuelve con 401/403 — comportamiento correcto.)

### Paso 4 — Confirmar que el `anon-key` de Supabase NO está expuesto al cliente

Verificar que `NEXT_PUBLIC_SUPABASE_ANON_KEY` **no** existe en `.env.production` ni en variables de entorno de Vercel marcadas como públicas. Solo `DATABASE_URL` debe estar configurada como variable server-side.

## Plan de Fase 3 — RLS completo

Cuando se aborde la deuda técnica completa de RLS:

1. **Activar RLS en ambas tablas:**
   ```sql
   ALTER TABLE "lotes_netsuite" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "envios_netsuite_cargo_str" ENABLE ROW LEVEL SECURITY;
   ```

2. **Política por defecto = denegar todo** (sin políticas explícitas, RLS bloquea).

3. **Crear política para `service_role`** (el rol que usa Prisma vía DATABASE_URL no aplica RLS por default; pero si se migra a usar `service_role` explícito, debe haber bypass):
   ```sql
   -- service_role es bypass por default en Supabase, pero documentamos explícitamente:
   CREATE POLICY "service_role_full_access_lotes" ON "lotes_netsuite"
     FOR ALL TO service_role USING (true) WITH CHECK (true);
   CREATE POLICY "service_role_full_access_envios" ON "envios_netsuite_cargo_str"
     FOR ALL TO service_role USING (true) WITH CHECK (true);
   ```

4. **Revocar acceso a `anon` y `authenticated` explícitamente** (defensa en profundidad):
   ```sql
   REVOKE ALL ON TABLE "lotes_netsuite" FROM anon, authenticated;
   REVOKE ALL ON TABLE "envios_netsuite_cargo_str" FROM anon, authenticated;
   ```

5. **Replicar la misma estrategia para `registros_str` y demás tablas existentes** (deuda técnica #4 del plan backend) — fuera de alcance de Fase 1.

## Riesgo residual aceptado

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Anon-key de Supabase filtrado + tablas accesibles vía PostgREST | Baja (el proyecto no expone anon-key al cliente hoy) | Alto (lectura de montos por OR y números OC) | Pasos 1-4 de la mitigación temporal arriba |
| Bug futuro que exponga anon-key (ej: agregar `@supabase/ssr` sin RLS) | Media si se incorpora `@supabase/ssr` antes de Fase 3 | Alto | Code review obligatorio + checklist en cualquier PR que toque variables de entorno `NEXT_PUBLIC_*` |
| Inserción directa de envíos vía bypass de handler (ej: empleado interno con acceso a `DATABASE_URL`) | Baja | Medio (rompe idempotencia y auditoría) | Auditoría en `LogAuditoria` (BE-6) detecta inserciones sin acción `ENVIAR_LOTE_NETSUITE` |

## Próximos pasos

- [ ] Erika ejecuta los Pasos 1-4 inmediatamente después de aplicar la migración a producción (`prisma migrate deploy`).
- [ ] Erika anota en este documento los resultados del Paso 1 (output del SQL de verificación) bajo una sección "Resultado de verificación post-deploy" con fecha.
- [ ] Crear ticket "Fase 3 — RLS para módulo NetSuite" en el backlog con referencia a este documento.

## Referencias

- Plan backend: `mejoras/netsuite-backend-plan.md` §D7, §A.2 (deuda #4)
- Migración: `prisma/migrations/20260525000000_netsuite_cargos_str/migration.sql`
- Schema: `prisma/schema.prisma` (comentario `TODO RLS Fase 3` arriba del modelo `LoteNetsuite`)
