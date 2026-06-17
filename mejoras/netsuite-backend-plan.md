# Plan de Desarrollo Backend — Integración Cargos STR + Oracle NetSuite

> **Modo:** Implementación + Documentación
> **Fecha:** 2026-05-22
> **Alcance:** `app/api/cargos-str/netsuite/**`, `lib/integrations/netsuite/**`, `prisma/schema.prisma`, `prisma/migrations/**`, `lib/validation/netsuite.ts`. No se tocan rutas del dashboard ni componentes React.
> **Input:** `mejoras/netsuite-integration-plan.md` (Arquitecto de Soluciones) + `mejoras/netsuite-frontend-plan.md` (Frontend Specialist)
> **Autor:** Backend Specialist

---

## Decisiones resueltas (2026-05-22)

Erika aprobó los defaults recomendados sobre las 7 decisiones que el análisis previo dejó pendientes. Estas decisiones son vinculantes para el resto del documento y sobreescriben cualquier ambigüedad anterior.

| ID | Decisión | Valor adoptado | Implicancia para backend |
|----|----------|----------------|--------------------------|
| D1+D6 | Campo en POST `/lote` | `orCodigo` explícito (string como `"OR-AFINIA"`). El backend mapea `codigo → id` internamente. | El payload del FE usa `{ periodoId, orCodigo }`. El service.ts hace `ConfiguracionOR.findUnique({ where: { codigo } })` para resolver `or_id` antes de persistir. La respuesta del backend devuelve ambos: `orId` (UUID interno) **y** `orCodigo` (string) para que el FE arme las keys `${periodoId}|${orCodigo}` consistentes con `/estados`. |
| D5 | `GET /api/cargos-str/netsuite/lote/activo` | Sí — implementar en BE-4 | Endpoint adicional. Retorna el último lote `EN_PROGRESO` del tenant (o 204 si no hay). Sin filtro de usuario — cualquier lote activo bloquea. |
| D7 | RLS sobre tablas NetSuite | **Postergar a Fase 3**. Mitigación temporal: verificar en Supabase Dashboard que `anon-key` NO tenga acceso a `lotes_netsuite` ni `envios_netsuite_cargo_str`. Documentar en `docs/audits/` durante BE-1. | No se agregan políticas RLS en la migración inicial. Sí se valida que el rol `anon` no tenga `SELECT/INSERT/UPDATE/DELETE` sobre las tablas nuevas. La auditoría queda registrada para abrir un PR de RLS en Fase 3. |
| D8 | `MAX_ENVIOS_POR_LOTE` | **25** (confirmado 2026-05-25: Vercel Hobby, `maxDuration = 60s`). | Constante exportada desde `lib/integrations/netsuite/config.ts` (BE-3). El handler de `POST /lote` valida `cargos.length <= MAX_ENVIOS_POR_LOTE` antes de tocar la DB. Ya aplicado en frontend (`app/(dashboard)/cargos-str/page.tsx`). |
| D9 | Tests automáticos | Postergar a Fase 3. Validación de Fase 1 = manual en Vercel preview. | No se introduce Vitest/Jest en Fase 1. Los DoD de cada PR incluyen pasos de validación manual en preview. Se conserva el listado de tests sugeridos del plan del Arquitecto para Fase 3. |
| Permisos DB | Verificar antes de BE-0 | Acción: `npx prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script` — si retorna SQL sin error de permisos, OK. | Si falla con `permission denied for schema public` o similar, escalar al admin de Supabase para obtener un `DATABASE_URL` con rol `postgres` (no `service_role` ni `anon`). |
| Backup pre-BE-0 | Sí — snapshot manual en Supabase Dashboard | Antes de aplicar la primera migración versionada, hacer snapshot manual: `Supabase Dashboard → Database → Backups → Create backup`. Anotar el ID en el PR de BE-0. **DIFERIDO** — ver TD-1 en §A.4 (sin plan Pro Supabase). |
| T1 | Timeout HTTP por envío | **30 segundos** (confirmado 2026-05-25). | El cliente NetSuite usa `AbortController` con `setTimeout(() => controller.abort(), 30_000)`. Si vence: envío pasa a `ERROR` con `error_codigo: "TIMEOUT"` y `error_mensaje: "NetSuite no respondió en 30 segundos"`. El worker continúa con el siguiente envío inmediatamente. **Procesamiento estrictamente secuencial — un envío no avanza al siguiente hasta que el actual termina (PROCESADO, ERROR o TIMEOUT).** Implementación en BE-2 (`lib/integrations/netsuite/client.ts` + `service.ts`). El mock de FE-5.6 ya simula este comportamiento. |

---

## Índice de versiones del documento

| Versión | Fecha | Descripción | Estado |
|---------|-------|-------------|--------|
| Versión inicial | 2026-05-22 | Diseño inicial con las 7 decisiones resueltas, defaults aceptados por Erika | **VÁLIDO** |

> **Regla de lectura:** este es el documento de referencia operativo del backend. Si entra en conflicto con `mejoras/netsuite-integration-plan.md` (plan del Arquitecto), **gana este documento** sobre detalles de implementación; el plan del Arquitecto gana sobre principios de arquitectura.

---

## Progreso de ejecución

| PR | Estado | Fecha | Notas |
|----|--------|-------|-------|
| BE-0 — Adoptar `prisma migrate` (baseline) + Zod en handlers `cargas/preview` y `cargas/confirmar` | ✅ Completado | 2026-05-22 | Baseline `20260522000000_baseline` generado; scripts `db:migrate:dev/deploy/status` agregados; Zod en handlers existentes; runbook en `docs/runbooks/prisma-migrate.md`. Erika debe correr `prisma migrate resolve --applied 20260522000000_baseline` contra producción (ver runbook) antes de que BE-1 introduzca migraciones reales. |
| BE-1 — Migración: `lotes_netsuite` + `envios_netsuite_cargo_str` + índices en `registros_str` | ✅ Completado (código) | 2026-05-25 | Schema agregado, migración generada (`prisma/migrations/20260525000000_netsuite_cargos_str/migration.sql`), Prisma client regenerado, audit doc D7 creado (`docs/audits/2026-05-25-rls-netsuite.md`). **PENDIENTE: Erika aplica `migrate resolve --applied baseline` + `migrate deploy` cuando decida.** |
| BE-2 — Capa de servicio + mock determinista | ✅ Completado | 2026-06-17 | `lib/integrations/netsuite/*` (config, types, errors, client+factory, mock determinista, real-client placeholder, mapper, service, audit) + `lib/validation/netsuite.ts`. `crearLote` con advisory lock; `procesarLote` secuencial idempotente; precisión Decimal. tsc limpio. Sin endpoints (BE-3). Commit `7de122e`. **Nota:** `mes_consumo` del snapshot = `MIN(mes_consumo)` de `registros_str` (no especificado en plan — revisar si la regla de negocio difiere). `audit()` queda listo pero no se invoca hasta BE-6. |
| BE-3 — Endpoints POST/GET de lote (1, 2, 3) | ✅ Completado | 2026-06-17 | `app/api/cargos-str/netsuite/lote/route.ts` (POST crear), `[loteId]/procesar/route.ts` (POST 202 fire-and-forget, maxDuration=60), `[loteId]/route.ts` (GET). Auth + Zod + errores de dominio vía `isNetsuiteServiceError→httpStatus/toResponse()`. Params async (Next 15.5). tsc limpio. Commit `e9a8e86`. Desbloquea FE-4. **Cliente real NetSuite (Fase 2) ya implementado en paralelo**: TBA/OAuth1, PO para cuenta 8312907 (entity=netsuite_vendor_id, subsidiary=2/location=1/item=10 defaults, tranId). Falta cargar secretos en Vercel + aplicar migración `netsuite_vendor_id`. |
| BE-4 — Endpoints de estados, lote activo, detalle (4, 7) | ✅ Completado | 2026-06-17 | `estados/route.ts` (GET, Record por `periodoId\|orCodigo`), `lote/activo/route.ts` (GET, 200 o 204). FE conectado: badges por celda, detección de lote activo al montar y modal de detalle con datos reales. Cliente real mejorado: `error_mensaje` incluye `o:errorDetails` de NetSuite. Commits `4dd3b8b`, `22870b1`, `ee55df0`. **Prueba real OK hasta NetSuite**: OAuth/TBA autentica, PO válida salvo `location` id (la usuaria provee el id correcto vía `NETSUITE_LOCATION_ID`). |
| BE-5 — Endpoints de reenvío y cancelación (5, 6) | ✅ Completado | 2026-06-17 | `envio/[envioId]/reenviar/route.ts` (POST síncrono, maxDuration 60) y `lote/[loteId]/cancelar/route.ts` (POST). FE conectado: botón Cancelar y Reenviar reales; `page.tsx` ya NO depende de `_dev/mocks`. Commits `4c7026d`, `a56f639`. |
| BE-6 — Observabilidad: logs estructurados + LogAuditoria | ⏳ Pendiente | — | |
| BE-7 — Validación end-to-end en Vercel preview con FE-5 | ⏳ Pendiente | — | Coordinación con FE |
| BE-8 — `vercel.json` (runtime nodejs, maxDuration) + variables de entorno | ⏳ Pendiente | — | Solo backend, no toca código |

---

## Resumen ejecutivo

El backend debe entregar 7 endpoints REST bajo `app/api/cargos-str/netsuite/**` y una capa de servicio en `lib/integrations/netsuite/**` que aísla la lógica de dominio del HTTP. La integración usa un **mock determinista intercambiable por env** (`NETSUITE_MODE=mock|real`) que permite que el frontend complete Fases 1-2 sin contrato real de NetSuite. La concurrencia se resuelve con **advisory lock de Postgres** (`pg_advisory_xact_lock`) — un solo lote `EN_PROGRESO` global a la vez. La precisión decimal se garantiza con `Prisma.Decimal.toFixed(2)` en todos los bordes (cero `Number()` sobre montos). La idempotencia se logra con `idempotency_key` único + `updateMany` con guard de estado. La adopción de `prisma migrate` (BE-0) es prerequisito **bloqueante** del resto — sin migraciones versionadas no podemos hacer rollback.

---

# PARTE A — Estado actual del backend

## A.1 Qué existe hoy

**Stack confirmado** (de `package.json`):
- Next.js 15.5.15 (App Router) en Node runtime por default
- Prisma 6.19.3 + `@prisma/client`
- Zod 4.3.6 ya instalado pero **no usado** en handlers
- NextAuth v5 beta con Prisma adapter
- Supabase como proveedor de Postgres (no se usa `@supabase/ssr` — todo va por Prisma)

**Route handlers existentes** (`app/api/`):
```
app/api/auth/[...nextauth]/route.ts
app/api/cargas/{route,preview,confirmar,check-previa,preview-facturacion,estado-periodo}/route.ts
app/api/cargos-str/{route,meses}/route.ts
app/api/dashboard/route.ts
app/api/gestiones/route.ts
app/api/operadores/route.ts
app/api/periodos/route.ts
```

Ningún handler usa Zod. Todos castean el body con `as`. Esto es deuda heredada del repo, no del módulo NetSuite, pero hay que incorporar Zod **al menos en los handlers nuevos**.

**`lib/` existente**:
```
lib/{db,auth,utils,legacy-app}.ts
lib/parsers/{balance,facturacion,facturacion-metabase,insumos-str,sdl,types,xm}.ts
lib/integrations/metabase.ts
```

Existe el directorio `lib/integrations/` con un solo archivo. La estructura `lib/integrations/netsuite/` es nueva y se crea en BE-2.

**Persistencia (`prisma/schema.prisma`)**:
- `Decimal(18,2)` y `Decimal(18,6)` correctos en las columnas de monto
- Sin migraciones versionadas (`prisma/migrations/` no existe). El repo usa `prisma db push` (ver `package.json:11`)
- Sin índices en `RegistroSTR.periodo_id`, `RegistroSTR.or_id`, `RegistroSTR.mes_consumo`

## A.2 Deudas técnicas heredadas (del plan del Arquitecto, §A.5)

| # | Deuda | Severidad | Estrategia en este plan |
|---|-------|-----------|--------------------------|
| 1 | Sin migraciones versionadas (`prisma db push`) | **BLOCKER** | **BE-0** adopta `prisma migrate dev` con baseline antes de cualquier otra cosa |
| 2 | Sin validación Zod en handlers | MAJOR | Todos los handlers NetSuite usan Zod desde BE-3. **No** se retrofittean los handlers existentes en este plan (alcance separado) |
| 3 | `Number()` sobre `Decimal` en agregación STR | MAJOR | Mapper de NetSuite usa `Decimal.toFixed(2)` → string. Cero `Number()` sobre montos en código nuevo. Documentado en BE-2 |
| 4 | Sin RLS en Supabase | MAJOR | **Postergado a Fase 3** (D7). Mitigación: verificar permisos del rol `anon` en BE-1 y documentar |
| 5 | Re-carga Insumos STR borra `registros_str` | MAJOR | Resuelta vía `monto_snapshot_cop` en `envios_netsuite_cargo_str` (BE-1) |
| 6 | Lógica de dominio inline en handlers | MINOR | Handlers NetSuite quedan ≤ 50 líneas. Toda la lógica va a `lib/integrations/netsuite/service.ts` |
| 7 | Sin índices en `registros_str` | MINOR | Tapado en la misma migración BE-1 |
| 8 | `as any` en `lib/auth.ts` | NIT | Fuera de alcance |

## A.3 Mitigaciones y orden de ataque

**Bloqueantes que se resuelven antes de tocar lógica de NetSuite:**
1. Snapshot manual de Supabase Dashboard (antes de BE-0).
2. Verificar permisos del `DATABASE_URL` con `prisma migrate diff` (antes de BE-0).
3. Adoptar `prisma migrate dev` con baseline (BE-0).

**Deudas que se mitigan dentro de cada PR:**
- BE-1 tapa #5 (snapshot), #7 (índices) y documenta #4 (RLS) para Fase 3.
- BE-2 fija el patrón `Decimal.toFixed(2)` que tapa #3.
- BE-3 introduce Zod en handlers nuevos, tapando #2 dentro del módulo NetSuite.
- BE-3/BE-4/BE-5 mantienen handlers delgados, tapando #6.

**Deudas que quedan fuera de alcance:**
- #4 RLS completo (Fase 3 con PR dedicado).
- #8 `as any` en auth (módulo de auth, no NetSuite).
- Retrofittear Zod en handlers existentes de `cargas/*` (separado).

---

## A.4 Deuda técnica diferida (aceptada — no bloquea Fase 1)

> **Última actualización:** 2026-05-25 — confirmado con Erika.

### TD-1: Sin plan Pro de Supabase → sin snapshots manuales

**Contexto:** el procedimiento manual de BE-0 (`docs/runbooks/prisma-migrate.md`) pedía crear un backup manual desde Supabase Dashboard antes de aplicar la baseline. Esta feature es exclusiva del plan Pro de Supabase.

**Estado:** el proyecto opera hoy con **Supabase Free**. Erika decidió diferir el paso de backup manual y apoyarse en la red de seguridad existente.

**Mitigación temporal aceptada:**
- Supabase Free incluye **1 backup automático diario** con retención de 7 días.
- Antes de cada migración no trivial (BE-1 en adelante), confirmar visualmente que el backup automático del día existe en Supabase Dashboard → Database → Backups.
- BE-1 solo introduce `CREATE TABLE`/`CREATE TYPE`/`CREATE INDEX` (no `ALTER`/`DROP` sobre tablas existentes) → riesgo bajo, rollback trivial (`DROP TABLE envios_netsuite_cargo_str; DROP TABLE lotes_netsuite; DROP TYPE ...`).
- Alternativa sin plan Pro: dump manual con `pg_dump $DATABASE_URL > backup.sql` antes del PR (documentado en runbook).

**Cuándo retomar:** al contratar Supabase Pro. Acción: actualizar runbook `prisma-migrate.md` § Paso 1 quitando la marca DIFERIDO y restablecer la práctica de snapshot manual antes de cada migración no trivial.

**Riesgo residual aceptado:** si una migración corrompe la DB entre dos backups automáticos diarios y nadie lo detecta a tiempo (~24h), pueden perderse hasta 24h de datos. Para Fase 1 (sin tráfico de usuarios reales mientras NetSuite mock está activo) es aceptable.

### TD-2: Plan de Vercel — RESUELTO (2026-05-25)

**Contexto:** el plan original asumía `maxDuration = 300s` y `MAX_ENVIOS_POR_LOTE = 100` (Vercel Pro). En Hobby el límite es 60s.

**Confirmación de Erika (2026-05-25):** el proyecto opera con **Vercel Hobby**.

**Decisiones aplicadas:**
- `MAX_ENVIOS_POR_LOTE = 25` (ya aplicado en `app/(dashboard)/cargos-str/page.tsx`). Margen: 25 envíos × 2s estimado = 50s, dentro del límite de 60s.
- `maxDuration` en cada handler NetSuite: dejar default (10s) excepto `POST /lote/:id/procesar` que necesita `export const maxDuration = 60`. Configurar en BE-3.
- `runtime = "nodejs"` en todos los endpoints NetSuite (BE-3 también).

**Plan de upgrade:** si la operación crece y 25 cargos por lote no alcanzan, evaluar Vercel Pro ($20/mes) o trocear el procesamiento con cron (Fase 3 — Opción 1 del plan general §B.7).

**Cuándo retomar:** completado. La variable `MAX_ENVIOS_POR_LOTE` quedó fijada al valor de Hobby en código y en este plan. BE-3 hereda este valor.

---

# PARTE B — Plan de implementación

## B.1 Modelo de datos

Confirmamos la **Opción B** del plan del Arquitecto (§B.1): no se crea tabla `cargos_str`. El cargo sigue siendo una agregación virtual `(periodoId, orId)`; la identidad estable vive en `envios_netsuite_cargo_str` con snapshot del monto.

### Tablas nuevas

```prisma
enum EstadoLoteNetsuite {
  EN_PROGRESO
  COMPLETADO
  CANCELADO
}

enum EstadoEnvioNetsuite {
  PENDIENTE
  PROCESANDO
  PROCESADO
  ERROR
}

model LoteNetsuite {
  id              String              @id @default(cuid())
  estado          EstadoLoteNetsuite  @default(EN_PROGRESO)
  total_envios    Int
  total_ok        Int                 @default(0)
  total_error     Int                 @default(0)
  iniciado_por_id String
  iniciado_at     DateTime            @default(now())
  finalizado_at   DateTime?

  iniciado_por User                          @relation(fields: [iniciado_por_id], references: [id])
  envios       EnvioNetsuiteCargoSTR[]

  @@index([estado])
  @@index([iniciado_at])
  @@map("lotes_netsuite")
}

model EnvioNetsuiteCargoSTR {
  id                   String              @id @default(cuid())
  lote_id              String
  periodo_id           String
  or_id                String

  // Snapshot — congela el cargo en el instante del envío
  monto_snapshot_cop   Decimal             @db.Decimal(18, 2)
  mes_consumo          String              // "AAAA-MM"
  mes_facturacion      String              // "AAAA-MM"

  estado               EstadoEnvioNetsuite @default(PENDIENTE)
  intentos             Int                 @default(0)

  numero_oc            String?
  netsuite_internal_id String?
  respuesta_ok_json    Json?

  error_mensaje        String?
  error_codigo         String?
  error_payload_json   Json?

  idempotency_key      String              @unique

  enviado_at           DateTime?
  respondido_at        DateTime?
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @updatedAt

  lote         LoteNetsuite        @relation(fields: [lote_id], references: [id], onDelete: Restrict)
  periodo      PeriodoConciliacion @relation(fields: [periodo_id], references: [id], onDelete: Restrict)
  operador_red ConfiguracionOR     @relation(fields: [or_id], references: [id], onDelete: Restrict)

  @@unique([lote_id, periodo_id, or_id], name: "uq_envio_lote_periodo_or")
  @@index([periodo_id, or_id, createdAt(sort: Desc)])
  @@index([estado])
  @@map("envios_netsuite_cargo_str")
}
```

**Decisiones de diseño puntuales** (complementan el plan del Arquitecto):

- **`onDelete: Restrict` en las 3 FK**: borrar un período de conciliación o un operador con envíos asociados debe fallar. Borrar envíos de auditoría no debe ser posible casualmente.
- **`idempotency_key` único + composite `@@unique(lote_id, periodo_id, or_id)`**: doble cinturón. La key cubre la idempotencia "lógica" (mismo lote + cargo = mismo envío); el composite cubre la idempotencia "estructural" (no se puede insertar dos veces).
- **`monto_snapshot_cop Decimal(18,2)`**: nunca `Float`. El mapper la convierte a string con `.toFixed(2)` antes de mandar a NetSuite.
- **`error_payload_json` guarda `{ request, response }`**: si NetSuite responde mal o tira excepción, guardamos ambos lados para reproducir. Si el payload llega a contener secretos del header de auth, se enmascaran antes de persistir (responsabilidad del cliente real en Fase 2 — el mock no genera secrets).

### Índices adicionales en tabla existente (en la misma migración BE-1)

```sql
CREATE INDEX IF NOT EXISTS "registros_str_periodo_id_idx" ON "registros_str"("periodo_id");
CREATE INDEX IF NOT EXISTS "registros_str_or_id_idx" ON "registros_str"("or_id");
CREATE INDEX IF NOT EXISTS "registros_str_periodo_id_or_id_idx" ON "registros_str"("periodo_id", "or_id");
```

El último es **compuesto** porque el cálculo del snapshot (`SUM(valor_cop) WHERE periodo_id = ? AND or_id = ?`) filtra por ambos. Postgres usará este índice antes que los individuales.

**Índice parcial** para acelerar el polling y el guard de "lote activo":

```sql
CREATE INDEX IF NOT EXISTS "envios_netsuite_activos_idx"
  ON "envios_netsuite_cargo_str"("lote_id", "estado")
  WHERE "estado" IN ('PENDIENTE', 'PROCESANDO');
```

### Rollback plan de BE-1

La migración solo **crea** tipos, tablas e índices. No modifica datos existentes. El `DOWN` es:

```sql
DROP INDEX IF EXISTS "envios_netsuite_activos_idx";
DROP INDEX IF EXISTS "registros_str_periodo_id_or_id_idx";
DROP INDEX IF EXISTS "registros_str_or_id_idx";
DROP INDEX IF EXISTS "registros_str_periodo_id_idx";
DROP TABLE IF EXISTS "envios_netsuite_cargo_str";
DROP TABLE IF EXISTS "lotes_netsuite";
DROP TYPE IF EXISTS "EstadoEnvioNetsuite";
DROP TYPE IF EXISTS "EstadoLoteNetsuite";
```

Cero pérdida de datos sobre tablas preexistentes.

---

## B.2 Contratos de los 7 endpoints

Todos bajo `app/api/cargos-str/netsuite/`. Todos requieren `auth()` (NextAuth v5). Todos validan body con Zod. Todos retornan JSON estructurado `{ data | error, ... }` con códigos HTTP semánticos.

### Tipos compartidos (referencia para el FE)

```ts
// lib/integrations/netsuite/types.ts (extracto público)

export type EstadoLoteNetsuite = "EN_PROGRESO" | "COMPLETADO" | "CANCELADO"
export type EstadoEnvioNetsuite = "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR"

export interface EnvioDto {
  id: string
  periodoId: string
  orId: string             // UUID interno (FK a configuracion_or.id)
  orCodigo: string         // string como "OR-AFINIA" — D1+D6
  orNombre: string
  montoSnapshotCop: string // "123456.78" — string para precisión
  mesConsumo: string       // "AAAA-MM"
  mesFacturacion: string   // "AAAA-MM"
  estado: EstadoEnvioNetsuite
  intentos: number
  numeroOc: string | null
  netsuiteInternalId: string | null
  errorMensaje: string | null
  errorCodigo: string | null
  enviadoAt: string | null
  respondidoAt: string | null
}

export interface LoteDto {
  id: string
  estado: EstadoLoteNetsuite
  iniciadoAt: string
  finalizadoAt: string | null
  iniciadoPor: { id: string; nombre: string }
  totales: {
    total: number
    pendientes: number
    procesados: number
    errores: number
  }
  envios: EnvioDto[]
}

export interface EstadoEnvioPorCargoDto {
  ultimoEnvioId: string
  estado: EstadoEnvioNetsuite
  numeroOc: string | null
  errorMensaje: string | null
  loteId: string
  fecha: string  // ISO 8601
}
```

### Endpoint 1 — `POST /api/cargos-str/netsuite/lote`

Crea un lote nuevo. Es el endpoint más crítico (transacción, advisory lock, snapshot, idempotency_key).

**Request:**
```ts
// lib/validation/netsuite.ts
export const crearLoteSchema = z.object({
  cargos: z
    .array(
      z.object({
        periodoId: z.string().min(1),
        orCodigo: z.string().min(1).max(64), // D1+D6: codigo (string), no UUID
      })
    )
    .min(1)
    .max(MAX_ENVIOS_POR_LOTE), // 100 en Vercel Pro, 25 en Hobby
})
```

**Response 201:**
```ts
{
  loteId: string
  estado: "EN_PROGRESO"
  totalEnvios: number
  envios: EnvioDto[]
}
```

**Errores específicos:**

| HTTP | Código | Body adicional | Causa |
|------|--------|----------------|-------|
| 400 | `VALIDATION_ERROR` | `{ issues: ZodIssue[] }` | Body no cumple schema |
| 400 | `SIN_DATOS` | `{ conflictos: [{ periodoId, orCodigo }] }` | Algún `(periodoId, orCodigo)` no tiene `registros_str` |
| 401 | `UNAUTHENTICATED` | — | Sin sesión |
| 404 | `OR_NO_ENCONTRADO` | `{ orCodigo }` | El `orCodigo` no existe en `configuracion_or` |
| 409 | `LOTE_EN_CURSO` | `{ loteEnCursoId, iniciadoAt, iniciadoPor: { nombre } }` | Ya hay un lote `EN_PROGRESO` |
| 422 | `MONTO_CERO` | `{ conflictos: [{ periodoId, orCodigo, monto: "0.00" }] }` | El monto agregado de un cargo es 0 |
| 422 | `CARGO_YA_PROCESADO` | `{ conflictos: [{ periodoId, orCodigo, numeroOc, loteId }] }` | Al menos un `(periodoId, orCodigo)` ya tiene un envío en estado `PROCESADO`. **Validado dentro de la transacción del `crearLote` después del advisory lock para evitar TOCTOU** (ver §Cross-references, F-B2) |
| 500 | `INTERNAL_ERROR` | — | Error inesperado |

**Comportamiento clave** (servicio `crearLote` en BE-2):
1. Validar body con Zod → 400 si falla.
2. Resolver `orCodigo → or_id` con `findMany({ where: { codigo: { in: orCodigos } } })`. Si falta alguno → 404.
3. Abrir transacción Prisma.
4. `SELECT pg_advisory_xact_lock(${NETSUITE_LOTE_LOCK_KEY})` — bloquea creación concurrente.
5. Verificar `LoteNetsuite.findFirst({ where: { estado: 'EN_PROGRESO' } })` → 409 si existe.
6. Para cada `(periodoId, orId)`:
   - `SUM(valor_cop) FROM registros_str` → si null/0 → 400 SIN_DATOS o 422 MONTO_CERO.
   - Verificar si hay envío previo en estado `PROCESADO` → si sí, acumular en `conflictos`. Si al final hay conflictos → 422 `CARGO_YA_PROCESADO`.
7. Crear `LoteNetsuite` + N `EnvioNetsuiteCargoSTR` en la misma transacción.
8. `idempotency_key = sha256(lote_id|periodo_id|or_id|monto_snapshot_cop)`.
9. Commit. Log de auditoría `accion: 'ENVIAR_LOTE_NETSUITE'`.

### Endpoint 2 — `POST /api/cargos-str/netsuite/lote/:loteId/procesar`

Dispara el procesamiento secuencial. Retorna inmediatamente `202 Accepted` y procesa en background.

**Request:** ninguno (loteId en path).

**Response 202:**
```ts
{ loteId: string, estado: "EN_PROGRESO", totalEnvios: number }
```

**Errores:**

| HTTP | Código | Causa |
|------|--------|-------|
| 401 | `UNAUTHENTICATED` | Sin sesión |
| 404 | `LOTE_NO_ENCONTRADO` | `loteId` inexistente |
| 409 | `LOTE_NO_PROCESABLE` | Lote no está en `EN_PROGRESO` (ya completado o cancelado) |

**Comportamiento:**
- Verifica lote `EN_PROGRESO`.
- Llama a `service.procesarLote(loteId)` con `await` pero sin esperar la promesa completa (fire-and-forget controlado: usa `event.waitUntil()` si está disponible, o promesa no-awaited con catch que logea).
- Retorna 202 al cliente.
- El bucle secuencial itera los envíos en estado `PENDIENTE` o `ERROR` y los procesa uno por uno (ver §B.3).

**Importante sobre Vercel timeouts:** este handler debe declarar:
```ts
export const runtime = "nodejs"
export const maxDuration = 300 // Vercel Pro
```
Si el plan es Hobby (maxDuration = 60s), reducir `MAX_ENVIOS_POR_LOTE` a 25 (estimando 2s por envío real → 50s).

### Endpoint 3 — `GET /api/cargos-str/netsuite/lote/:loteId`

Retorna el lote con sus envíos. Para el polling del FE.

**Response 200:** `LoteDto` (ver tipos arriba).

**Errores:**

| HTTP | Código | Causa |
|------|--------|-------|
| 401 | `UNAUTHENTICATED` | — |
| 404 | `LOTE_NO_ENCONTRADO` | — |

### Endpoint 4 — `GET /api/cargos-str/netsuite/estados?periodoIds=&orCodigos=`

Devuelve el **último envío** por `(periodoId, orCodigo)`. Es lo que pinta los badges en el pivot.

**Query params:**
- `periodoIds`: lista CSV de UUIDs (`?periodoIds=a,b,c`)
- `orCodigos`: lista CSV de códigos (`?orCodigos=OR-AFINIA,OR-AIRE`) — **D1: codigo, no UUID**

**Response 200:**
```ts
Record<`${periodoId}|${orCodigo}`, EstadoEnvioPorCargoDto>
```

**Implementación recomendada** (Postgres-specific con `$queryRaw`):
```sql
SELECT DISTINCT ON (e.periodo_id, c.codigo)
  e.id, e.periodo_id, c.codigo AS or_codigo,
  e.estado, e.numero_oc, e.error_mensaje, e.lote_id, e.createdAt
FROM envios_netsuite_cargo_str e
JOIN configuracion_or c ON c.id = e.or_id
WHERE e.periodo_id = ANY($1::text[])
  AND c.codigo = ANY($2::text[])
ORDER BY e.periodo_id, c.codigo, e.createdAt DESC;
```

Una sola query. Si el resultado se queda lento con miles de filas (no es el caso hoy), considerar vista materializada en Fase 3.

**Errores:**

| HTTP | Código | Causa |
|------|--------|-------|
| 400 | `VALIDATION_ERROR` | Sin params o malformados |
| 401 | `UNAUTHENTICATED` | — |

### Endpoint 5 — `POST /api/cargos-str/netsuite/envio/:envioId/reenviar`

Reenvía un envío individual en estado `ERROR`. Solo permitido si el lote del envío está `EN_PROGRESO` (decisión del Arquitecto en §B.2 confirmada).

**Request:** ninguno.

**Response 200:**
```ts
{ envioId: string, estado: "PROCESANDO" | "PROCESADO" | "ERROR", numeroOc?: string }
```
(Espera la respuesta del cliente NetSuite — re-envío individual es síncrono.)

**Errores:**

| HTTP | Código | Causa |
|------|--------|-------|
| 401 | `UNAUTHENTICATED` | — |
| 404 | `ENVIO_NO_ENCONTRADO` | — |
| 409 | `ENVIO_NO_REENVIABLE` | Estado no es `ERROR`, o lote no está `EN_PROGRESO` |

### Endpoint 6 — `POST /api/cargos-str/netsuite/lote/:loteId/cancelar`

Marca el lote como `CANCELADO`. Válido solo si está `EN_PROGRESO` y ningún envío está en `PROCESANDO`.

**Response 200:**
```ts
{ loteId: string, estado: "CANCELADO" }
```

**Errores:**

| HTTP | Código | Causa |
|------|--------|-------|
| 401 | `UNAUTHENTICATED` | — |
| 404 | `LOTE_NO_ENCONTRADO` | — |
| 409 | `LOTE_NO_CANCELABLE` | No está `EN_PROGRESO`, o hay envíos en `PROCESANDO` |

### Endpoint 7 — `GET /api/cargos-str/netsuite/lote/activo` (D5)

Retorna el último lote `EN_PROGRESO` global, o 204 si no hay.

**Response 200:** `LoteDto` (con `envios` posiblemente vacío si el front no los necesita en el polling inicial — verlo en BE-4).

**Response 204:** sin body. Indica al FE que no hay lote activo.

**Errores:**

| HTTP | Código | Causa |
|------|--------|-------|
| 401 | `UNAUTHENTICATED` | — |

### Forma uniforme de respuesta de error

Todos los endpoints retornan el mismo shape de error:

```ts
{
  error: "CODIGO_DOMINIO",     // string conocido por el FE (tabla arriba)
  message: string,             // human-readable, no internal details
  // Campos opcionales según código:
  loteEnCursoId?: string,
  iniciadoAt?: string,
  iniciadoPor?: { nombre: string },
  conflictos?: Array<{ periodoId: string, orCodigo: string, ... }>,
  issues?: ZodIssue[],
}
```

Sin stack traces. Sin `instanceof Error.message` crudo del servidor.

---

## B.3 Capa de servicio

### Estructura de `lib/integrations/netsuite/`

```
lib/integrations/netsuite/
  config.ts          # Constantes: MAX_ENVIOS_POR_LOTE, NETSUITE_LOTE_LOCK_KEY
  client.ts          # Interface NetsuiteClient + factory getNetsuiteClient()
  mock-client.ts     # MockNetsuiteClient determinista
  real-client.ts     # RealNetsuiteClient — placeholder hasta Fase 2
  mapper.ts          # EnvioNetsuiteCargoSTR → NetsuitePayload
  service.ts         # crearLote, procesarLote, reenviar, cancelarLote, obtenerEstadosPorCargo, obtenerLoteActivo
  errors.ts          # Clases de error tipadas (LoteEnCursoError, MontoCeroError, CargoYaProcesadoError, ...)
  types.ts           # Tipos públicos + Zod schemas de payload/response
  audit.ts           # Helper para escribir en LogAuditoria con shape consistente
```

### Factory por env

```ts
// lib/integrations/netsuite/client.ts

import type { NetsuitePayload, NetsuiteResponse } from "./types"

export interface NetsuiteClient {
  enviarOrden(payload: NetsuitePayload): Promise<NetsuiteResponse>
}

export function getNetsuiteClient(): NetsuiteClient {
  const mode = process.env.NETSUITE_MODE ?? "mock"
  if (mode === "real") {
    return new RealNetsuiteClient({
      baseUrl: process.env.NETSUITE_BASE_URL!,
      tokenId: process.env.NETSUITE_TOKEN_ID!,
      tokenSecret: process.env.NETSUITE_TOKEN_SECRET!,
      consumerKey: process.env.NETSUITE_CONSUMER_KEY!,
      consumerSecret: process.env.NETSUITE_CONSUMER_SECRET!,
    })
  }
  return new MockNetsuiteClient()
}
```

**Por qué env y no inyección manual**: el handler no debería conocer al cliente. `service.ts` llama `getNetsuiteClient()` en cada operación. En tests futuros (Fase 3), se inyecta vía función parámetro.

### Mock determinista

```ts
// lib/integrations/netsuite/mock-client.ts

export class MockNetsuiteClient implements NetsuiteClient {
  async enviarOrden(payload: NetsuitePayload): Promise<NetsuiteResponse> {
    // Delay simulado para que el polling del FE muestre progreso real
    await sleep(200 + Math.random() * 600)

    // Determinismo: el resultado depende del hash del externalId
    const seed = hashStringToInt(payload.externalId)

    // Overrides para testing manual:
    // - x-test-netsuite-mode: "always-ok" → todo OK
    // - x-test-netsuite-mode: "always-error" → todo error
    // (estos headers los lee el handler de procesar y los inyecta en payload.testOverride)

    if (payload.testOverride === "always-error" || (!payload.testOverride && seed % 10 === 0)) {
      return {
        status: "error",
        code: "MOCK_FAIL",
        message: "Mocked failure for testing",
        raw: { externalId: payload.externalId, seed }
      }
    }
    return {
      status: "ok",
      internalId: `MOCK-${seed}`,
      documentNumber: `OC-MOCK-${String(seed).padStart(6, "0")}`,
      raw: { externalId: payload.externalId, seed }
    }
  }
}
```

**Tasa de error fija al 10%** (seed % 10 === 0) para que el FE vea ambos estados durante el desarrollo.

### Mapper con precisión decimal

```ts
// lib/integrations/netsuite/mapper.ts

import type { EnvioNetsuiteCargoSTR, ConfiguracionOR } from "@prisma/client"
import type { NetsuitePayload } from "./types"

export function snapshotToPayload(
  envio: EnvioNetsuiteCargoSTR & { operador_red: ConfiguracionOR }
): NetsuitePayload {
  return {
    externalId: envio.idempotency_key,
    vendor: envio.operador_red.codigo,
    amount: envio.monto_snapshot_cop.toFixed(2), // Decimal → "123456.78" (NO Number())
    currency: "COP",
    memo: `Cargo STR ${envio.operador_red.nombre} ${envio.mes_consumo}`,
    date: `${envio.mes_facturacion}-01`,
  }
}
```

**Regla absoluta del módulo**: `Number()` aplicado a un `Decimal` está prohibido en `lib/integrations/netsuite/**`. En BE-2 se agrega un comentario `// PRECISION: nunca convertir Decimal a Number aquí — usar .toFixed(2) o .toString()` en `mapper.ts` como recordatorio.

### Service.procesarLote (corazón del módulo)

Ya esquematizado en el plan del Arquitecto §B.3. Puntos clave que se conservan:

1. **Bucle secuencial** — un envío a la vez (requerimiento explícito).
2. **`updateMany` con guard de estado** para tomar el envío atómicamente:
   ```ts
   const lock = await db.envioNetsuiteCargoSTR.updateMany({
     where: { id: envio.id, estado: { in: ["PENDIENTE", "ERROR"] } },
     data: { estado: "PROCESANDO", intentos: { increment: 1 }, enviado_at: new Date() },
   })
   if (lock.count === 0) continue // ya lo tomó otro worker
   ```
3. **Try/catch alrededor de `client.enviarOrden`** — excepciones de red se mapean a `ERROR` con código `NETWORK`.
4. **Persistencia idempotente** del resultado.
5. **`actualizarEstadoLote` al final**: si todos los envíos están en `{PROCESADO, ERROR}` → marca el lote `COMPLETADO` + `finalizado_at`.

---

## B.4 Concurrencia: advisory lock de Postgres

### Por qué advisory lock

Postgres ofrece `pg_advisory_xact_lock(bigint)`: un lock arbitrario asociado a la transacción actual que se libera automáticamente al commit/rollback. Es perfecto para "no más de un lote `EN_PROGRESO` a la vez":

- **vs mutex en memoria**: la memoria es por instancia. Vercel corre múltiples instancias serverless. La memoria no cubre nada.
- **vs `SELECT ... FOR UPDATE` sobre `lotes_netsuite`**: requeriría una fila dummy o lockear toda la tabla. Más complejo, mismo efecto.
- **vs columna `is_locked` en una tabla de "config"**: requiere mantener su ciclo de vida y liberarla manualmente. Si el handler crashea, queda colgada.

### Implementación

```ts
// lib/integrations/netsuite/config.ts
export const NETSUITE_LOTE_LOCK_KEY = BigInt("0xCA90577210000001") // constante arbitraria, única para este recurso

// lib/integrations/netsuite/service.ts
export async function crearLote(userId: string, cargos: CargoInput[]): Promise<LoteDto> {
  return await db.$transaction(async (tx) => {
    // 1. Adquirir lock — bloquea hasta que cualquier otra transacción que tenga este lock haga commit/rollback
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NETSUITE_LOTE_LOCK_KEY})`

    // 2. Dentro del lock: verificar lote EN_PROGRESO
    const enCurso = await tx.loteNetsuite.findFirst({
      where: { estado: "EN_PROGRESO" },
      include: { iniciado_por: { select: { id: true, nombre: true } } },
    })
    if (enCurso) throw new LoteEnCursoError(enCurso)

    // 3. Verificar CARGO_YA_PROCESADO (dentro de la transacción + lock — evita TOCTOU)
    // 4. Calcular snapshots + crear lote + envíos
    // ...
  })
  // Al salir del $transaction (commit o rollback), el lock se libera automáticamente
}
```

**Comportamiento bajo carga**: si dos usuarios cliquean "Crear OC" en la misma ventana de ms, la segunda transacción **espera** (no falla) hasta que la primera haga commit. Después la segunda ve el lote recién creado y devuelve 409 `LOTE_EN_CURSO`. Comportamiento correcto.

**Tiempo de espera**: si el primer crearLote es lento (no debería ser — solo lee y escribe), la segunda transacción puede colgar. Postgres no tiene timeout default en advisory locks; si se vuelve problema, agregar `SET LOCAL statement_timeout = '5s'` al inicio de la transacción.

---

## B.5 Diagrama de estados

Sin cambios respecto al plan del Arquitecto §B.5. Reglas duras:

| De | A | Permitido si | Mecanismo |
|----|---|--------------|-----------|
| `PENDIENTE` | `PROCESANDO` | lote `EN_PROGRESO` | `procesarLote` toma el envío |
| `PROCESANDO` | `PROCESADO` | `client.ok` | `service.persistirOk` |
| `PROCESANDO` | `ERROR` | `client.error` o excepción | `service.persistirError` |
| `ERROR` | `PROCESANDO` | lote `EN_PROGRESO` + endpoint 5 | re-envío individual |
| `PROCESADO` | * | **nunca** | terminal, irreversible |

| LoteDe | LoteA | Cuándo |
|--------|-------|--------|
| `EN_PROGRESO` | `COMPLETADO` | todos los envíos en `{PROCESADO, ERROR}` y ninguno en `{PENDIENTE, PROCESANDO}` |
| `EN_PROGRESO` | `CANCELADO` | endpoint 6 + ningún envío en `PROCESANDO` |

---

## B.6 Plan de PRs detallado

Cada PR se valida en Vercel preview (sin tests locales — D9). Cada PR se commitea con conventional commit y se mergea solo después de validación en preview.

### BE-0 — Adoptar `prisma migrate` (baseline)

**Título:** `feat(db): adoptar prisma migrate dev con baseline del schema actual`

**Descripción:** Crear el directorio `prisma/migrations/` con una migración inicial que refleje el estado actual de la DB. Reemplazar `db push` por `migrate dev` en `package.json` para nuevos cambios.

**Archivos a crear/modificar:**
- `prisma/migrations/<TS>_baseline/migration.sql` (generado con `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migration.sql`)
- `prisma/migrations/migration_lock.toml`
- `package.json`: agregar `"db:migrate": "prisma migrate dev"`, mantener `db:push` pero deprecarlo en el README.

**Pre-requisitos:**
- Snapshot manual en Supabase Dashboard (anotar ID en el PR).
- `prisma migrate diff` retorna SQL sin error de permisos.

**Dependencias:** ninguna.

**Complejidad:** Media. El riesgo es el baseline: la primera vez que se aplica `migrate resolve` debe ser cuidadoso para no recrear tablas.

**Validación post-deploy en Vercel:**
- El build sigue funcionando (`prisma generate && next build`).
- `prisma migrate status` localmente muestra "Database schema is up to date".
- La DB de preview no se ve afectada (migración marca el baseline como aplicado sin recrear nada).

**Qué FE desbloquea:** ninguno directamente. Es prerequisito de BE-1.

**Rollback:** revertir el PR. La migración baseline no toca datos.

---

### BE-1 — Migración: tablas NetSuite + índices en `registros_str`

**Título:** `feat(netsuite,db): tablas lotes_netsuite y envios_netsuite_cargo_str con indices`

**Descripción:** Crear las dos tablas nuevas y los índices del módulo. Verificar permisos del rol `anon` en Supabase Dashboard y documentar la auditoría de RLS para Fase 3.

**Archivos a crear/modificar:**
- `prisma/schema.prisma` — agregar enums + modelos + relaciones inversas en `User`, `PeriodoConciliacion`, `ConfiguracionOR`
- `prisma/migrations/<TS>_netsuite_cargos_str/migration.sql` (generada con `prisma migrate dev --name netsuite_cargos_str`)
- `docs/audits/2026-05-22-rls-netsuite-tables.md` — verificación manual de que `anon` no tiene acceso a las tablas nuevas

**Dependencias:** BE-0.

**Complejidad:** Baja. Solo crea estructura.

**Validación post-deploy en Vercel:**
- Build de Vercel pasa.
- En Supabase Dashboard:
  - Tabla `lotes_netsuite` existe con 0 filas.
  - Tabla `envios_netsuite_cargo_str` existe con 0 filas.
  - Índices visibles en `Database → Indexes`.
  - Roles `anon` y `authenticated`: NO tienen privilegios sobre las nuevas tablas (verificar en SQL Editor: `SELECT * FROM information_schema.role_table_grants WHERE table_name = 'lotes_netsuite';`).

**Qué FE desbloquea:** prerequisito para BE-2.

**Rollback:** `prisma migrate resolve --rolled-back <migration_name>` + ejecutar el SQL de DOWN documentado en §B.1.

---

### BE-2 — Capa de servicio + mock determinista

**Título:** `feat(netsuite): capa de servicio con cliente mock y mapper de precision decimal`

**Descripción:** Crear `lib/integrations/netsuite/` completo. Sin endpoints todavía — solo la capa de servicio que será consumida por los handlers de BE-3 a BE-5.

**Archivos a crear:**
- `lib/integrations/netsuite/config.ts`
- `lib/integrations/netsuite/types.ts`
- `lib/integrations/netsuite/errors.ts`
- `lib/integrations/netsuite/client.ts`
- `lib/integrations/netsuite/mock-client.ts`
- `lib/integrations/netsuite/real-client.ts` (placeholder con `throw new Error("RealNetsuiteClient: contrato pendiente Fase 2")`)
- `lib/integrations/netsuite/mapper.ts`
- `lib/integrations/netsuite/service.ts` (`crearLote`, `procesarLote`, `reenviar`, `cancelarLote`, `obtenerEstadosPorCargo`, `obtenerLoteActivo`)
- `lib/integrations/netsuite/audit.ts`
- `lib/validation/netsuite.ts` (Zod schemas)

**Dependencias:** BE-1.

**Complejidad:** Alta. Es el corazón del módulo. Cuidado con:
- Decimal vs Number (regla absoluta).
- Advisory lock dentro del transaction.
- `updateMany` con guard de estado en `procesarLote`.

**Validación post-deploy en Vercel:**
- Build pasa.
- No hay endpoints aún — la validación es indirecta vía BE-3.

**Qué FE desbloquea:** nada todavía (sin endpoints).

**Rollback:** revertir el PR. Sin impacto en DB porque no hay endpoints.

---

### BE-3 — Endpoints POST/GET de lote (endpoints 1, 2, 3)

**Título:** `feat(netsuite,api): endpoints crear lote, procesar y get lote`

**Descripción:** Tres handlers HTTP delgados que delegan en `service.ts`. Cada uno con Zod, auth, manejo de errores estructurado.

**Archivos a crear:**
- `app/api/cargos-str/netsuite/lote/route.ts` (POST — endpoint 1)
- `app/api/cargos-str/netsuite/lote/[loteId]/route.ts` (GET — endpoint 3)
- `app/api/cargos-str/netsuite/lote/[loteId]/procesar/route.ts` (POST — endpoint 2)

**Cada handler declara:**
```ts
export const runtime = "nodejs"
export const maxDuration = 300 // verificar plan Vercel antes del merge
```

**Dependencias:** BE-2.

**Complejidad:** Media. Los handlers son delgados pero hay 7 códigos de error específicos en endpoint 1.

**Validación post-deploy en Vercel:**

Verificar plan Vercel real antes de merge:
- Si **Pro** (`maxDuration` hasta 300s): mantener `MAX_ENVIOS_POR_LOTE = 100`.
- Si **Hobby** (`maxDuration` máximo 60s): cambiar a 25 antes de merge.

Smoke test manual en preview con `NETSUITE_MODE=mock`:
1. `POST /api/cargos-str/netsuite/lote` con body válido (2-3 cargos) → 201 con `loteId`.
2. `GET /api/cargos-str/netsuite/lote/:id` → estado `EN_PROGRESO`, envíos en `PENDIENTE`.
3. `POST /api/cargos-str/netsuite/lote/:id/procesar` → 202.
4. Esperar ~10s. `GET /api/cargos-str/netsuite/lote/:id` → estado `COMPLETADO` con mix de PROCESADO/ERROR (10% error por mock).
5. `POST /api/cargos-str/netsuite/lote` segundo intento mientras hay uno EN_PROGRESO → 409 `LOTE_EN_CURSO`.

**Qué FE desbloquea:** FE-4 (`ModalConfirmarLote` + creación lote).

**Rollback:** revertir el PR. Sin migración asociada.

---

### BE-4 — Endpoints de estados, lote activo y detalle (endpoints 4, 7)

**Título:** `feat(netsuite,api): endpoints estados (badges), lote activo y detalle de envio`

**Descripción:** Endpoints de lectura que el FE consume para pintar badges y detectar lote en curso al montar la página.

**Archivos a crear:**
- `app/api/cargos-str/netsuite/estados/route.ts` (GET — endpoint 4)
- `app/api/cargos-str/netsuite/lote/activo/route.ts` (GET — endpoint 7, **D5**)

> **Nota:** el FE en §2.4 menciona un posible `GET /api/cargos-str/netsuite/envio/:id` (Opción A de la decisión D4 del plan FE). En este plan se opta por **Opción B**: el FE extrae el envío del `LoteDto` que retorna el endpoint 3 (no necesitamos endpoint adicional). Si el FE necesita Opción A explícita, se agrega en BE-6 con costo bajo. Confirmar con Frontend Specialist antes de cerrar BE-4.

**Dependencias:** BE-2.

**Complejidad:** Baja-Media. El endpoint 4 usa `$queryRaw` con `DISTINCT ON` (Postgres-specific).

**Validación post-deploy en Vercel:**
- `GET /api/cargos-str/netsuite/lote/activo` sin lote activo → 204.
- Crear un lote vía BE-3, luego `GET /lote/activo` → 200 con el `LoteDto`.
- `GET /api/cargos-str/netsuite/estados?periodoIds=...&orCodigos=OR-AFINIA,OR-AIRE` → retorna mapa con shape correcto.

**Qué FE desbloquea:** FE-5 (`PanelLoteEnCurso` + polling) y FE-6 (integración real).

**Rollback:** revertir el PR.

---

### BE-5 — Endpoints de reenvío y cancelación (endpoints 5, 6)

**Título:** `feat(netsuite,api): endpoints reenviar envio individual y cancelar lote`

**Descripción:** Acciones secundarias del flujo: reintentar un envío que falló y cancelar un lote colgado.

**Archivos a crear:**
- `app/api/cargos-str/netsuite/envio/[envioId]/reenviar/route.ts` (POST — endpoint 5)
- `app/api/cargos-str/netsuite/lote/[loteId]/cancelar/route.ts` (POST — endpoint 6)

**Dependencias:** BE-2.

**Complejidad:** Baja. La lógica ya está en `service.ts`.

**Validación post-deploy en Vercel:**
- Crear lote, procesarlo, identificar un envío `ERROR`.
- `POST /envio/:id/reenviar` → respuesta inline con nuevo estado.
- Crear lote, intentar cancelar mientras hay envíos `PROCESANDO` → 409 `LOTE_NO_CANCELABLE`.

**Qué FE desbloquea:** botón "Reenviar" en `DetalleEnvioModal` (FE-3) y botón "Cancelar lote" en `PanelLoteEnCurso` (FE-5).

**Rollback:** revertir el PR.

---

### BE-6 — Observabilidad: logs estructurados + LogAuditoria

**Título:** `feat(netsuite,obs): logs estructurados de envios y entradas en LogAuditoria`

**Descripción:** Toda operación crítica logea JSON estructurado (Vercel Runtime Logs los recoge) y persiste en `LogAuditoria` para trazabilidad permanente.

**Archivos a modificar:**
- `lib/integrations/netsuite/audit.ts` (completar)
- `lib/integrations/netsuite/service.ts` (agregar llamadas a `audit()` en eventos clave)
- `prisma/schema.prisma` — agregar valores al enum `AccionAuditoria`:
  - `ENVIAR_LOTE_NETSUITE`
  - `PROCESAR_ENVIO_NETSUITE`
  - `REENVIAR_ENVIO_NETSUITE`
  - `CANCELAR_LOTE_NETSUITE`
- `prisma/migrations/<TS>_netsuite_audit_enum/migration.sql`

**Eventos logeados:**
| Evento | Nivel | Contexto |
|--------|-------|----------|
| `lote.creado` | info | `loteId, totalEnvios, iniciadoPorId` |
| `envio.procesando` | info | `envioId, loteId, intentos` |
| `envio.procesado_ok` | info | `envioId, numeroOc, durationMs` |
| `envio.procesado_error` | warn | `envioId, errorCodigo, errorMensaje, durationMs` |
| `lote.completado` | info | `loteId, totalOk, totalError` |
| `lote.cancelado` | warn | `loteId, motivo: 'manual'` |
| `lote.en_curso_conflicto` | warn | `loteEnCursoId, intentadoPorId` |

**Reglas duras:**
- Nunca logear `payload.amount` solo: logear `monto_snapshot_cop` desde el envío (auditoría completa).
- Nunca logear tokens de auth NetSuite (filtrar headers en `audit.ts`).
- Nunca logear `respuesta_ok_json.raw` completo en INFO — solo en DEBUG / persistido en DB.

**Dependencias:** BE-2, BE-3, BE-4, BE-5.

**Complejidad:** Media. Cuidado con no romper los handlers existentes que ya escriben en `LogAuditoria`.

**Validación post-deploy en Vercel:**
- Crear un lote → ver evento `lote.creado` en Vercel Runtime Logs.
- `LogAuditoria.findMany({ where: { accion: 'ENVIAR_LOTE_NETSUITE' } })` retorna registros.

**Qué FE desbloquea:** opcional — habilita una vista futura de "Histórico de lotes" (Fase 3).

**Rollback:** revertir el PR + reaplicar `migration_lock` si toca el enum.

---

### BE-7 — Validación end-to-end en Vercel preview con FE-5

**Título:** No es un PR de código. Es la coordinación con Frontend Specialist.

**Descripción:** Sentarse con FE durante el merge de FE-5 (Panel + polling) y FE-6 (integración real). Verificar:
1. El polling cada 2.5s no satura el backend (logs muestran requests normales).
2. Los `orCodigo` que envía el FE matchean los que persiste el BE (D1+D6).
3. `GET /lote/activo` retorna 204 cuando corresponde y 200 con shape correcto cuando hay lote.
4. Las animaciones del FE coinciden con los timestamps reales del backend (no hay "saltos" de progreso).

**Entregable:** una entrada en `docs/audits/2026-MM-DD-e2e-netsuite-preview.md` con resultado de cada caso.

**Dependencias:** BE-3, BE-4, BE-5, FE-5.

---

### BE-8 — `vercel.json` (runtime nodejs, maxDuration) + variables de entorno

**Título:** `chore(netsuite,ops): vercel.json con runtime y variables de entorno documentadas`

**Descripción:** Asegurar la configuración de runtime en cada endpoint y documentar las variables de entorno requeridas.

**Archivos a crear/modificar:**
- `vercel.json` — si no existe, crear con configuración de runtime para los handlers NetSuite. Si existe, agregar la sección sin tocar las otras.
- `.env.example` — agregar:
  ```
  NETSUITE_MODE=mock
  # NETSUITE_BASE_URL=https://<account>.suitetalk.api.netsuite.com
  # NETSUITE_TOKEN_ID=
  # NETSUITE_TOKEN_SECRET=
  # NETSUITE_CONSUMER_KEY=
  # NETSUITE_CONSUMER_SECRET=
  ```
- `docs/backend/api/netsuite-cargos-str.md` — documentación de los 7 endpoints (contratos, ejemplos, errores).
- `docs/runbooks/netsuite-lote-colgado.md` — qué hacer si un lote queda en `EN_PROGRESO` con envíos `PROCESANDO` y el worker se murió (paso a paso para cancelar manualmente).

**Variables de entorno a configurar en Vercel Dashboard** (sin commitear):
| Var | Preview | Production | Notas |
|-----|---------|------------|-------|
| `NETSUITE_MODE` | `mock` | `mock` (Fase 1), luego `real` (Fase 2) | Cambio de mock a real es solo cambio de env, no requiere deploy |
| `NETSUITE_BASE_URL` | — | (Fase 2) | Solo en Fase 2 |
| `NETSUITE_TOKEN_ID` | — | (Fase 2) | Secret rotable |
| `NETSUITE_TOKEN_SECRET` | — | (Fase 2) | Secret rotable |
| `NETSUITE_CONSUMER_KEY` | — | (Fase 2) | Secret rotable |
| `NETSUITE_CONSUMER_SECRET` | — | (Fase 2) | Secret rotable |

**Dependencias:** BE-3 (los handlers ya existen y declaran `maxDuration`).

**Complejidad:** Baja.

**Validación post-deploy en Vercel:**
- En Vercel Dashboard → Function logs → cada endpoint NetSuite muestra `runtime: nodejs`, `maxDuration: 300` (o 60 si Hobby).
- `process.env.NETSUITE_MODE` se lee correctamente en preview (logear en el primer request).

**Qué FE desbloquea:** ninguno directamente. Sella la Fase 1.

**Rollback:** revertir el PR.

---

## B.7 Riesgos y mitigaciones

Tabla extraída del análisis previo (alineada con §B.8 del plan del Arquitecto), con responsable y PR donde se mitiga:

| # | Riesgo | Severidad | Mitigación | Mitigado en PR |
|---|--------|-----------|------------|----------------|
| R1 | NetSuite rate-limits (típico 4-10 req/seg en TBA) | MAJOR | Bucle secuencial ya respeta esto. En Fase 2, si NetSuite especifica límite, agregar `await sleep(150)` entre envíos en `procesarLote` | BE-2 (estructura) + Fase 2 |
| R2 | Doble envío del mismo cargo (race condition o re-click) | MAJOR | `idempotency_key` único + `updateMany` con guard de estado + advisory lock al crear lote | BE-1, BE-2, BE-3 |
| R3 | Lote queda colgado en `EN_PROGRESO` con envíos `PROCESANDO` | MAJOR | Endpoint 6 (cancelar manual) + runbook en `docs/runbooks/`. Cron de limpieza en Fase 3 | BE-5, BE-8 |
| R4 | NetSuite responde OK pero sin `documentNumber` | MAJOR | Zod valida la respuesta y la marca como ERROR si no cumple schema. Mejor un error explícito que una OC fantasma | BE-2 (Fase 2 — cuando llegue contrato) |
| R5 | Diferencia entre monto enviado y monto en NetSuite por redondeo | **BLOCKER** | `Decimal.toFixed(2)` como string, **nunca `Number()`**. Comentario explícito en `mapper.ts` | BE-2 |
| R6 | Usuario re-carga Insumos STR DESPUÉS de enviar — el monto del envío ya no coincide con la suma actual | MEDIO | Snapshot en `monto_snapshot_cop`. El FE muestra advertencia visual si los datos actuales difieren del snapshot (responsabilidad del FE en FE-3) | BE-1 |
| R7 | Secret de NetSuite filtrado en logs o frontend | **BLOCKER** | `NETSUITE_*` vars solo se leen en `getNetsuiteClient()` (server). Nunca exponer. Documentación explícita en `.env.example`. Lint mental: prohibido `NEXT_PUBLIC_NETSUITE_*` | BE-2, BE-8 |
| R8 | Vercel timeout corta el lote a mitad | MAJOR | `maxDuration = 300` + `MAX_ENVIOS_POR_LOTE = 100` (Pro) o 25 (Hobby). Verificación de plan antes del merge BE-3 | BE-3 |
| R9 | Mapeo OR → vendor de NetSuite incorrecto | MAJOR | Tabla `mapeo_or_vendor_netsuite` o campo `vendor_netsuite_id` en `ConfiguracionOR`. **Postergado a Fase 2** cuando se sepa qué identificador usa NetSuite. En Fase 1 mock usa `or.codigo` directo | Fase 2 |
| R10 | Pérdida de auditoría: NetSuite error sin payload exacto | MEDIO | `error_payload_json` guarda `{ request, response }`. Encriptación at-rest cubierta por Supabase. Enmascarar tokens en `audit.ts` antes de persistir | BE-2, BE-6 |
| R11 | Worker `procesarLote` se ejecuta dos veces (Vercel retry, doble dispatch del FE) | MAJOR | `procesarLote` es idempotente: solo procesa envíos en `{PENDIENTE, ERROR}`. Si todos están en otro estado, no hace nada. Guard `updateMany` evita doble write | BE-2 |

---

## Cross-references al plan de frontend

### Qué BE desbloquea qué FE

| FE | Depende de BE | Cuándo |
|----|---------------|--------|
| FE-1 (skeleton) | nada | Independiente |
| FE-2 (tabla + selección con mocks) | nada | Usa `_dev/mocks/netsuite.ts` |
| FE-3 (badges + DetalleEnvioModal con mocks) | nada | Usa mocks |
| FE-4 (creación de lote real) | **BE-3** | POST `/lote` + POST `/procesar` |
| FE-5 (panel + polling) | **BE-3, BE-4** | GET `/lote/:id` + GET `/lote/activo` |
| FE-6 (integración real, quitar mocks) | **BE-3, BE-4, BE-5** | Los 7 endpoints |
| FE-7 (pulido) | nada | Independiente |

### Códigos de error que consume el frontend

El FE en §5 maneja estos códigos. Este backend los emite con el shape descrito en §B.2:

| Código | Endpoint emisor | Manejo FE (de `netsuite-frontend-plan.md` §5) |
|--------|-----------------|-----------------------------------------------|
| `LOTE_EN_CURSO` | endpoint 1 | Error dentro de `ModalConfirmarLote` con CTA "Ver lote activo" (§5.1) |
| `SIN_DATOS` | endpoint 1 | Error en el modal con lista de cargos sin datos (§5.2) |
| `MONTO_CERO` | endpoint 1 | Validación cliente-side primero; si llega del backend, mensaje genérico (§5.3) |
| `CARGO_YA_PROCESADO` | endpoint 1 | Mensaje "X cargos ya tenían OC y fueron omitidos" + reabrir modal con selección reducida (extensión del §5 del plan FE — coordinar con FE en BE-3) |
| `VALIDATION_ERROR` | todos | Toast genérico (§5.4) |
| `LOTE_NO_PROCESABLE` | endpoint 2 | Toast |
| `ENVIO_NO_REENVIABLE` | endpoint 5 | Mensaje dentro de `DetalleEnvioModal` |
| `LOTE_NO_CANCELABLE` | endpoint 6 | Mensaje dentro de `PanelLoteEnCurso` |
| `500 INTERNAL_ERROR` | todos | Toast con botón "Reintentar" (§5.4) |

### Decisión F-B2 — Validación de CARGO_YA_PROCESADO

El plan de frontend (FE) sugirió en su Addendum 2026-05-20 (§ "Implicancia para el backend"):

> "El plan del Arquitecto en §B.2 endpoint `POST /api/cargos-str/netsuite/lote` ya tiene un error `400 SIN_DATOS`. Hay que **agregar** un nuevo error `422 CARGO_YA_PROCESADO`. Esto debe validarse dentro de la transacción del `crearLote`, después del advisory lock, para evitar TOCTOU."

**Confirmación en este plan de backend:**

- El error `CARGO_YA_PROCESADO` se emite con HTTP 422 (tabla §B.2 endpoint 1).
- La validación se ejecuta **dentro de la transacción `crearLote` y después del advisory lock**. Concretamente:

```ts
// Pseudocódigo del orden en service.crearLote:
await db.$transaction(async (tx) => {
  // 1. pg_advisory_xact_lock
  // 2. Verificar lote EN_PROGRESO → 409
  // 3. Validar CARGO_YA_PROCESADO:
  const conflictos = await tx.envioNetsuiteCargoSTR.findMany({
    where: {
      estado: "PROCESADO",
      OR: cargosInput.map(c => ({ periodo_id: c.periodoId, or_id: c.orId }))
    },
    select: { periodo_id: true, or_id: true, numero_oc: true, lote_id: true, operador_red: { select: { codigo: true } } }
  })
  if (conflictos.length > 0) throw new CargoYaProcesadoError(conflictos)
  // 4. Calcular snapshots + crear lote + envíos
})
```

**Por qué dentro de la transacción y después del lock**: TOCTOU (Time-Of-Check-To-Time-Of-Use). Si se valida antes del lock o fuera de la transacción, un envío podría pasar a PROCESADO entre el check y el insert. Con el lock + la validación dentro, la transacción es atómica respecto al estado de los envíos previos.

Esta decisión vive aquí (en el plan de backend), no en el plan FE. El FE solo conoce el error code y lo maneja en su capa de UI.

---

## Próximos pasos

Checklist tipo "PR 0" del plan general, adaptado a las decisiones aprobadas:

- [ ] **Confirmar plan Vercel** (Hobby vs Pro). Si es Hobby, bajar `MAX_ENVIOS_POR_LOTE` a 25 y `maxDuration` a 60 antes del merge de BE-3.
- [ ] **Confirmar permisos en `DATABASE_URL`**: ejecutar `npx prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script` — debe retornar SQL sin "permission denied".
- [ ] **Hacer snapshot manual en Supabase Dashboard** (Database → Backups → Create backup) antes del merge de BE-0. Anotar ID en el PR.
- [ ] **Arrancar BE-0**: crear `prisma/migrations/` con baseline, modificar `package.json`. Validar build de Vercel. Mergear.
- [ ] **BE-1**: crear migración de tablas NetSuite + índices. Verificar permisos del rol `anon` en Supabase Dashboard y documentar en `docs/audits/`.
- [ ] **BE-2**: capa de servicio + mock. Sin endpoints aún.
- [ ] **BE-3**: endpoints 1, 2, 3. Notificar al FE que FE-4 está desbloqueado.
- [ ] **BE-4**: endpoints 4 y 7. Notificar al FE que FE-5 está desbloqueado.
- [ ] **BE-5**: endpoints 5 y 6.
- [ ] **BE-6**: observabilidad y enum de `LogAuditoria`.
- [ ] **BE-7**: validación e2e con FE en preview.
- [ ] **BE-8**: `vercel.json` + variables + documentación final en `docs/backend/api/` y `docs/runbooks/`.

**Pendientes con stakeholders de NetSuite (para Fase 2):**
- [ ] Método de auth (OAuth1/TBA vs JWT vs API Key).
- [ ] URL base de sandbox vs producción.
- [ ] Payload exacto y campos requeridos.
- [ ] Formato de número de OC.
- [ ] Idempotencia del lado de NetSuite (¿respetan `externalId`?).
- [ ] Rate limits y cuotas.
- [ ] Mapeo `OR → vendor` (R9): ¿hay tabla maestra de vendors en NetSuite? ¿qué identificador esperan?

---

## Archivos relevantes consultados

- `C:\Users\User\Documents\GitHub\App_Liquidaciones\mejoras\netsuite-integration-plan.md`
- `C:\Users\User\Documents\GitHub\App_Liquidaciones\mejoras\netsuite-frontend-plan.md`
- `C:\Users\User\Documents\GitHub\App_Liquidaciones\package.json`
- `C:\Users\User\Documents\GitHub\App_Liquidaciones\prisma\schema.prisma`
- `C:\Users\User\Documents\GitHub\App_Liquidaciones\app\api\cargos-str\route.ts`
- `C:\Users\User\Documents\GitHub\App_Liquidaciones\app\api\cargos-str\meses\route.ts`
- `C:\Users\User\Documents\GitHub\App_Liquidaciones\app\api\cargas\confirmar\route.ts`
- `C:\Users\User\Documents\GitHub\App_Liquidaciones\lib\db.ts`
- `C:\Users\User\Documents\GitHub\App_Liquidaciones\lib\auth.ts`
- `C:\Users\User\Documents\GitHub\App_Liquidaciones\lib\integrations\metabase.ts`
- `C:\Users\User\Documents\GitHub\App_Liquidaciones\_dev\mocks\netsuite.ts`
