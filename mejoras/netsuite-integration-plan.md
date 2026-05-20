# Integración Cargos STR ↔ Oracle NetSuite

> **Modo:** Auditoría + Plan
> **Fecha:** 2026-05-20
> **Alcance:** Análisis del estado actual del repo + diseño completo para enviar cargos STR a NetSuite con manejo de estados, lote secuencial y trazabilidad
> **Autor:** Arquitecto de Soluciones

---

## Resumen ejecutivo

El módulo Cargos STR está bien encapsulado: parser + persistencia + agregado pivot funcionan y son verificables. La integración con NetSuite es **factible sin refactors profundos**, pero hay tres deudas técnicas que deben tocarse en el camino: (1) los IDs de "cargo" que el front pivota son agregaciones efímeras `(or_id, periodo_id)` — necesitamos darles identidad estable; (2) `lib/db.ts` no usa `Prisma.Decimal` en ningún borde, todo se hace `Number()` — riesgo de precisión que en pagos a OC es inaceptable; (3) no existe validación con Zod en los endpoints, los body se castean. La integración se entrega en **3 fases** con un cliente NetSuite stub que permite avanzar UI/estados antes de tener el contrato real.

---

# PARTE A — Análisis del estado actual

## A.1 Calidad general del código

**Estructura de carpetas — Buena**
```
app/
  (auth)/login/          # ruta pública
  (dashboard)/<modulo>/  # rutas protegidas por layout
  api/<recurso>/         # route handlers Next 15 (App Router)
lib/
  db.ts, auth.ts         # singletons
  parsers/<fuente>.ts    # parsers de Excel por tipo de fuente
components/
  cargas/, layout/, ui/  # componentes por dominio
prisma/schema.prisma     # schema único
```
Separación de capas correcta: route handler → service implícito (transacción Prisma inline) → repositorio (Prisma). Falta una capa de **servicios de dominio** explícita (hoy la lógica vive dentro del handler de `confirmar/route.ts`, que ya tiene 230 líneas y va a crecer).

**TypeScript — Estricto, salvo dos zonas**
- `lib/auth.ts:17` usa `as any` para destipar la sesión de NextAuth. Justificable como parche pero conviene tipar `AppSession` extendiendo los tipos de NextAuth.
- Los body de los POST se destipean por *type assertion* (`const body: ConfirmarBody = await request.json()`). No hay validación runtime → veneno latente.

**Estilos inline — Consistentes**
Aunque hay Tailwind instalado (`tailwindcss: ^4.2.2`) y `components/ui/` usa shadcn, las páginas de dominio (`cargos-str/page.tsx`, `(dashboard)/page.tsx`, `cargas/`) usan estilo inline con la misma paleta (`#07c5a8` teal, azules `#1e3a8a`/`#dbeafe`, grises). Inconsistente con la presencia de Tailwind pero **internamente coherente**. Mantener la convención inline para el módulo NetSuite — no introducir Tailwind en la página solo por esto.

## A.2 Estado de la integración Prisma + Supabase

**Lo que funciona bien**
- Singleton `db.ts` con hot-reload guard correcto.
- Decimal en DB (`Decimal(18,2)` y `Decimal(18,6)`) — schema sólido.
- `@@unique` en `periodos_conciliacion.(anio, mes)` con upsert idempotente en `confirmar/route.ts:66`.
- Transacciones con `db.$transaction` (`confirmar/route.ts:64`).
- Soft fallback en `cargos-str/meses/route.ts:23` por si la tabla aún no existe (defensivo, sensato).

**Lo que preocupa**
- **`prisma/schema.prisma` carece de índices en columnas de filtro frecuente:** `RegistroSTR.periodo_id`, `RegistroSTR.or_id`, `RegistroSTR.mes_consumo`. La query de `/api/cargos-str` filtra por estos campos y va a escanear cuando crezca. Hoy hay ~23 filas/período, en 2 años son ~552 — viable pero los índices son baratos.
- **No hay RLS configurada en Supabase.** El repo asume que toda la lógica se ejecuta server-side autenticada vía NextAuth. Aceptable mientras todos los accesos pasen por Next.js, pero **riesgo si alguien expone PostgREST o se conecta directo**. Riesgo MAJOR — recomiendo activar RLS en una migración paralela y dejar políticas explícitas para `service_role`.
- **`Number(r.valor_cop)` en `cargos-str/route.ts:59`.** Convierte `Decimal` Prisma a `number` JS. Para sumar 23 valores está bien (53 bits de mantisa), pero cuando se envíe a NetSuite — y NetSuite contabilice céntimos — esto es un riesgo. Detalle abajo.
- **`detalle_json: f.detalle as Prisma.InputJsonValue ?? Prisma.JsonNull`** en `confirmar/route.ts:192`. El `??` se evalúa sobre el resultado del cast — si `f.detalle` es `undefined` el cast lo deja como `undefined`, no como `null`. Funciona por casualidad porque `undefined ?? Prisma.JsonNull = Prisma.JsonNull`, pero es frágil. MINOR.
- **No hay migraciones versionadas en `prisma/migrations/`.** El repo usa `prisma db push` (ver `package.json:11`). Funcional para desarrollo pero **catastrófico para producción**: no hay forma de revertir, ni de saber qué cambió cuándo. Riesgo BLOCKER si se sube a producción tal cual. Antes de NetSuite hay que adoptar `prisma migrate` formal.

## A.3 Estado del módulo Cargos STR específicamente

**Lo bueno**
- `cargos-str/route.ts` es legible, agrega bien, deriva facturación correctamente desde consumo.
- El front pivota con un patrón claro y los filtros gemelos funcionan.
- La whitelist `STR_OPERADORES` está en `app/api/operadores/route.ts:7` — fácil de mantener.

**Lo problemático para NetSuite**
1. **Los "cargos" no tienen ID propio.** Lo que en la UI es una celda `(operador, período)` se calcula al vuelo agregando N filas de `registros_str`. Para mandar a NetSuite necesitamos:
   - Una identidad estable del cargo (`cargo_str_id` o composite `(periodo_id, or_id)` con tabla espejo).
   - **Decisión obligada (ver Parte B §B.1):** crear tabla `cargos_str` con un row por `(periodo_id, or_id)` o usar el composite como clave natural. Recomiendo composite + tabla de "envíos" referenciándolo.
2. **Re-cargas de Insumos STR borran y reinsertan `registros_str` del período.** Esto es problema para idempotencia: si un cargo ya se mandó a NetSuite con OC 12345 y el usuario vuelve a cargar el insumo (cambia el valor), el cargo enviado deja de tener relación con el dato actual. **Necesitamos congelar el snapshot del cargo en el momento del envío.**

## A.4 Puntos fuertes

- Wizard de cargas con justificación obligatoria + validación de períodos futuros — buen patrón a replicar en NetSuite ("justificación de re-envío" si quisiéramos auditarlo, aunque el requerimiento dice "mismo flujo").
- `logAuditoria` ya está modelada — extender para NetSuite es trivial.
- Auth bloquea dominio `@bia.app` — sano para SaaS interno.
- Parser STR robusto: detecta header automáticamente, normaliza dashes Unicode, busca pestañas con tolerancia a espacios/underscores. Patrón a replicar.

## A.5 Deudas técnicas que afectan a la integración NetSuite

| # | Deuda | Severidad | Impacto sobre NetSuite |
|---|-------|-----------|------------------------|
| 1 | Sin migraciones versionadas (`prisma db push`) | **BLOCKER** | No podríamos rollback de la nueva tabla `envios_netsuite` ante incidente. **Fix obligatorio antes de Fase 1.** |
| 2 | Sin validación Zod en handlers | MAJOR | Body de `enviar-lote` debe validarse — un array vacío o un ID malformado debe fallar antes de tocar Postgres. |
| 3 | `Number()` sobre `Decimal` en agregación STR | MAJOR | El monto enviado a NetSuite debe ser `string` (formato `"123456.78"`) o número-entero-de-centavos. Hoy se redondea silenciosamente. |
| 4 | Sin RLS en Supabase | MAJOR | Si alguien expone la DB directamente, los lotes y OCs quedan visibles. Mitigar antes de producción. |
| 5 | Re-carga Insumos STR borra `registros_str` | MAJOR | Si se manda un cargo y luego se re-carga el período, el monto enviado a NetSuite queda huérfano. Necesita snapshot. |
| 6 | Lógica de dominio inline en route handlers | MINOR | El handler `enviar-lote` no debe contener la lógica del bucle secuencial. Extraer a `lib/integrations/netsuite/service.ts`. |
| 7 | Sin índices en `registros_str` | MINOR | Hoy no duele. Aprovechar la migración de NetSuite para agregarlos. |
| 8 | `as any` en `lib/auth.ts` | NIT | Tipar `AppSession` cuando se toque auth. |

## A.6 Refactors recomendados ANTES o DURANTE esta integración

**Antes (semana 1, una sola PR previa):**
- Migrar de `prisma db push` a `prisma migrate dev`. Generar el baseline.
- Agregar Zod schemas a los body de POST existentes (al menos `cargas/preview` y `cargas/confirmar`). Patrón compartido en `lib/validation/`.
- Definir `lib/money.ts` con utilidades de conversión `Prisma.Decimal ↔ string ↔ centavos` y prohibir `Number()` sobre montos por convención (lint custom si quieren ir más lejos; lo mínimo es documentarlo en CLAUDE.md).

**Durante (en cada PR de la integración):**
- Extraer la lógica de inserción de `RegistroSTR` de `confirmar/route.ts` a `lib/services/insumos-str.ts`. Justificación: vamos a agregar la transición "cargo enviado → no se puede borrar al re-cargar" y eso no cabe en un handler.
- Agregar `@@index([periodo_id])` y `@@index([or_id])` en `RegistroSTR` (en la misma migración que crea las tablas NetSuite).

---

# PARTE B — Plan de implementación NetSuite

## B.1 Modelo de datos

### Decisión de diseño: ¿Tabla `cargos_str` o solo `envios`?

**Opción A — Tabla `cargos_str` (un row por celda del pivot)**
- Pros: identidad estable; permite borrar registros_str sin huérfanos; el front itera sobre rows reales.
- Contras: hay que mantener `cargos_str` sincronizada con `registros_str` (trigger o regeneración después de cada carga). Es una desnormalización con costo de mantenimiento.

**Opción B — Solo `envios_netsuite_cargo_str` con composite key + snapshot**
- Pros: simple, no requiere mantenimiento adicional, una sola tabla nueva (más la cabecera de lote).
- Contras: el front sigue calculando los cargos al vuelo. Pero esto ya es lo que hace hoy.

**Recomendación: Opción B.** Razones:
1. La tabla `registros_str` ya tiene el dato. Crear una segunda tabla que la duplique es complejidad.
2. La idempotencia se logra con un `@@unique` sobre `(periodo_id, or_id, lote_id)` en `envios_netsuite_cargo_str` + **un snapshot del monto en el momento del envío** (`monto_snapshot_cop`). Si después de enviar se re-carga el insumo, el monto enviado queda registrado tal cual era.
3. El "estado" de cada cargo (PENDIENTE/PROCESADO/ERROR) vive en la tabla de envíos, no en el cargo "virtual".
4. Para mostrar el badge en la celda, el endpoint del pivot puede hacer LEFT JOIN al **último envío** por `(periodo_id, or_id)`.

### Schema Prisma (agregar a `prisma/schema.prisma`)

```prisma
enum EstadoLoteNetsuite {
  EN_PROGRESO   // hay envíos pendientes o procesando
  COMPLETADO    // todos los envíos terminaron (PROCESADO o ERROR)
  CANCELADO     // abortado manualmente
}

enum EstadoEnvioNetsuite {
  PENDIENTE     // creado, no enviado aún
  PROCESANDO    // request en curso (lock para no reenviar)
  PROCESADO     // NetSuite respondió OK + nro de OC guardado
  ERROR         // falló — re-envío permitido
}

model LoteNetsuite {
  id              String              @id @default(cuid())
  estado          EstadoLoteNetsuite  @default(EN_PROGRESO)
  total_envios    Int                 // count(envios) al crear el lote
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
  id                  String              @id @default(cuid())
  lote_id             String
  periodo_id          String              // FK a periodos_conciliacion (período de consumo)
  or_id               String              // FK a configuracion_or

  // Snapshot del cargo en el momento del envío — NO depende de registros_str posteriores
  monto_snapshot_cop  Decimal             @db.Decimal(18, 2)
  mes_consumo         String              // "AAAA-MM", redundante pero útil para auditoría
  mes_facturacion     String              // "AAAA-MM", derivado al snapshot

  estado              EstadoEnvioNetsuite @default(PENDIENTE)
  intentos            Int                 @default(0)

  // Resultado exitoso
  numero_oc           String?             // p.ej. "OC-2026-00123"
  netsuite_internal_id String?            // ID interno de NetSuite si lo retorna
  respuesta_ok_json   Json?               // payload completo de respuesta exitosa (auditoría)

  // Resultado fallido
  error_mensaje       String?
  error_codigo        String?
  error_payload_json  Json?               // payload de la request que falló (para reproducir)

  // Idempotency
  idempotency_key     String              @unique  // hash(periodo_id|or_id|monto|lote_id)

  enviado_at          DateTime?           // timestamp del intento
  respondido_at       DateTime?           // timestamp de la respuesta
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  lote         LoteNetsuite        @relation(fields: [lote_id], references: [id])
  periodo      PeriodoConciliacion @relation(fields: [periodo_id], references: [id])
  operador_red ConfiguracionOR     @relation(fields: [or_id], references: [id])

  // Un lote no puede tener dos envíos del mismo cargo
  @@unique([lote_id, periodo_id, or_id], name: "uq_envio_lote_periodo_or")
  // Para el badge: último envío por cargo
  @@index([periodo_id, or_id, createdAt])
  @@index([estado])
  @@map("envios_netsuite_cargo_str")
}

// Extender User, PeriodoConciliacion y ConfiguracionOR con las relaciones inversas
```

**Decisiones específicas y tradeoffs:**

- **¿Por qué `idempotency_key` como columna y no solo el unique compuesto?** Permite incluir el `lote_id` en la key (un mismo cargo puede reenviarse en otro lote tras un error) y darle a NetSuite la misma key si ellos soportan idempotencia. Si NetSuite no la soporta, igual nos protege a nosotros de dobles inserts en caso de race condition.
- **¿Por qué snapshot del monto?** Aislamos del problema de re-cargas (deuda #5). Si el usuario re-carga Insumos STR tras enviar, el envío queda fiel a lo que efectivamente se envió.
- **`mes_consumo` y `mes_facturacion` redundantes:** sí, pero NetSuite va a referenciar estos strings y querer auditar 6 meses después no debe requerir recalcular la lógica de "+1 mes".
- **¿Por qué `EN_PROGRESO` y no `PROCESANDO` en el lote?** Para distinguir claramente: lote en progreso = hay envíos por hacer; envío procesando = request HTTP en vuelo.
- **No agrego campos de retry exponencial.** Por requerimiento, re-envío es manual ("mismo flujo"). Si después se quiere automatizar, se extiende con `proximo_reintento_at` y un cron.

### Migración (single PR)

```
prisma/migrations/20260520_netsuite_cargos_str/
  migration.sql
```

Contenido SQL clave:
- `CREATE TYPE estado_lote_netsuite AS ENUM (...)`
- `CREATE TYPE estado_envio_netsuite AS ENUM (...)`
- `CREATE TABLE lotes_netsuite (...)`
- `CREATE TABLE envios_netsuite_cargo_str (...)`
- `CREATE UNIQUE INDEX ... ON envios_netsuite_cargo_str (idempotency_key)`
- `CREATE UNIQUE INDEX ... ON envios_netsuite_cargo_str (lote_id, periodo_id, or_id)`
- `CREATE INDEX ... ON envios_netsuite_cargo_str (periodo_id, or_id, "createdAt" DESC)`
- `CREATE INDEX ... ON envios_netsuite_cargo_str (estado) WHERE estado IN ('PENDIENTE','PROCESANDO')` (índice parcial — solo necesitamos buscar los activos)
- `ALTER TABLE registros_str ADD INDEX (...)` — aprovechar para tapar la deuda #7

**Rollback plan:** la migración solo crea tablas e índices. `DOWN` es `DROP TABLE envios_netsuite_cargo_str; DROP TABLE lotes_netsuite; DROP TYPE ...;`. Cero pérdida de datos sobre tablas existentes.

---

## B.2 API endpoints (Next.js Route Handlers)

Todos en `app/api/cargos-str/netsuite/`. Todos requieren `auth()`. Todos validan body con Zod.

### 1) `POST /api/cargos-str/netsuite/lote`

Crea un lote nuevo. Recibe la selección del usuario, valida que no haya lote en curso, **arma los snapshots** de monto desde `registros_str` agregados, crea el lote + N envíos en una transacción.

**Request:**
```ts
// lib/validation/netsuite.ts
export const crearLoteSchema = z.object({
  cargos: z.array(z.object({
    periodoId: z.string().min(1),
    orId:      z.string().min(1),
  })).min(1).max(500), // límite defensivo
})
```

**Response 201:**
```ts
{
  loteId: string
  totalEnvios: number
  envios: Array<{
    id: string
    periodoId: string
    orId: string
    montoSnapshotCop: string  // "123456.78" — string para preservar precisión
    estado: "PENDIENTE"
  }>
}
```

**Errores específicos:**
- `409 LOTE_EN_CURSO` — ya hay un lote `EN_PROGRESO`. Body: `{ error, loteEnCursoId, iniciadoAt, iniciadoPor }`.
- `400 SIN_DATOS` — algún `(periodoId, orId)` no tiene `registros_str`.
- `422 MONTO_CERO` — el monto agregado de un cargo seleccionado es 0 (regla de negocio: no enviar 0 — confirmar con usuario).

**Comportamiento clave:**
1. `SELECT ... FOR UPDATE` o **advisory lock de Postgres** sobre `lotes_netsuite` para evitar dos lotes simultáneos (ver §B.6).
2. Verificar que no exista lote con `estado = EN_PROGRESO`.
3. Para cada `(periodoId, orId)`, ejecutar `SUM(valor_cop) FROM registros_str WHERE periodo_id = ? AND or_id = ?`. Si es null o 0, error.
4. Crear `LoteNetsuite` + N `EnvioNetsuiteCargoSTR` en `db.$transaction`.
5. Generar `idempotency_key = sha256(lote_id|periodo_id|or_id|monto)`.
6. Log de auditoría: `accion: ENVIAR_LOTE_NETSUITE` (agregar a enum `AccionAuditoria`).

### 2) `POST /api/cargos-str/netsuite/lote/:loteId/procesar`

Dispara el procesamiento secuencial. Devuelve **inmediatamente** un `202 Accepted` y procesa en background (ver §B.7 sobre Vercel timeouts). El front polea `/estados` para ver progreso.

**Request:** ninguno (loteId en path).

**Response 202:**
```ts
{ loteId, estado: "EN_PROGRESO", totalEnvios }
```

**Comportamiento:**
1. Verificar que el lote exista y esté `EN_PROGRESO`.
2. Tomar todos los envíos `PENDIENTE` o `ERROR` del lote.
3. Iterar secuencialmente. Por cada uno:
   - Marcar `PROCESANDO` + `intentos += 1` (transacción corta).
   - Llamar al servicio NetSuite.
   - Marcar `PROCESADO` (con `numero_oc`) o `ERROR` (con detalles).
4. Cuando todos terminan, actualizar `LoteNetsuite.estado = COMPLETADO` y `finalizado_at`.

### 3) `GET /api/cargos-str/netsuite/lote/:loteId`

Retorna el lote con sus envíos. Para el polling del front.

**Response:**
```ts
{
  id: string
  estado: "EN_PROGRESO" | "COMPLETADO" | "CANCELADO"
  iniciadoAt: string
  iniciadoPor: { nombre: string }
  totales: { total: number, pendientes: number, procesados: number, errores: number }
  envios: Array<{
    id, periodoId, orId, orCodigo, orNombre,
    montoSnapshotCop: string,
    estado: "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR",
    intentos: number,
    numeroOc: string | null,
    errorMensaje: string | null,
    enviadoAt: string | null,
    respondidoAt: string | null,
  }>
}
```

### 4) `GET /api/cargos-str/netsuite/estados?periodoIds=&orIds=`

**Crítico para la UI del pivot.** Devuelve, por cada `(periodo, or)`, el estado del **último envío** (si existe). Esto pinta los badges en la tabla pivot.

**Response:**
```ts
{
  [`${periodoId}|${orId}`]: {
    ultimoEnvioId: string,
    estado: "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR",
    numeroOc: string | null,
    errorMensaje: string | null,
    loteId: string,
    fecha: string,
  }
}
```

Query: por cada par, hacer un `findFirst` ordenado por `createdAt desc`. Si el set es grande, hacer una sola query con `DISTINCT ON (periodo_id, or_id)` vía `$queryRaw` (Postgres-specific).

### 5) `POST /api/cargos-str/netsuite/envio/:envioId/reenviar`

Reenvía un envío individual en estado `ERROR`. **No crea un nuevo lote.** Vuelve a marcarlo `PROCESANDO` y dispara el servicio una vez. Sólo permitido si **el lote del envío está `EN_PROGRESO` o si no hay otro lote en curso** (decisión: el re-envío puede ocurrir aún si el lote ya está `COMPLETADO`, siempre que no haya otro lote `EN_PROGRESO` que bloquee).

Tradeoff: ¿reabrir el lote `COMPLETADO` al reintentar, o dejarlo cerrado y reflejar el reintento solo en el envío? **Recomendación: dejar el lote cerrado.** El lote es la "tanda original"; los reintentos posteriores quedan registrados en el envío (`intentos`, `enviado_at`). Para reabrir, el usuario crea un lote nuevo seleccionando los cargos en `ERROR`.

> **Corrección a esto:** si el lote queda cerrado, un re-envío de un envío en `ERROR` no debería "mejorar" el lote. Mejor: **el re-envío individual solo aplica a envíos cuyo lote está `EN_PROGRESO`**. Si el lote está `COMPLETADO`, el usuario debe crear un lote nuevo con esos cargos. Esto es más limpio y resuelve la ambigüedad. Lo dejo así en el plan.

### 6) `POST /api/cargos-str/netsuite/lote/:loteId/cancelar`

Marca el lote como `CANCELADO`. Solo válido si está `EN_PROGRESO` y no hay envíos en `PROCESANDO`. Los envíos `PENDIENTE` quedan como `PENDIENTE` (no se mandan), los `PROCESADO`/`ERROR` quedan como están. Útil para limpiar lotes "huérfanos" si el worker se rompe.

### Resumen de endpoints

| Método | Path | Propósito |
|--------|------|-----------|
| POST | `/api/cargos-str/netsuite/lote` | Crear lote desde selección |
| POST | `/api/cargos-str/netsuite/lote/:id/procesar` | Disparar procesamiento secuencial |
| GET | `/api/cargos-str/netsuite/lote/:id` | Estado completo del lote |
| GET | `/api/cargos-str/netsuite/estados` | Estados por `(periodo,or)` para pintar badges |
| POST | `/api/cargos-str/netsuite/envio/:id/reenviar` | Reintento individual |
| POST | `/api/cargos-str/netsuite/lote/:id/cancelar` | Cancelar lote en curso |

---

## B.3 Capa de servicio

### Estructura

```
lib/
  integrations/
    netsuite/
      client.ts          # HTTP client — placeholder hasta tener contrato
      mapper.ts          # RegistroSTR → payload NetSuite
      service.ts         # Orquestación: snapshot, lote, secuencial, persistencia
      types.ts           # Tipos compartidos + Zod schemas de payload/response
      errors.ts          # Clases de error tipadas
      mock-client.ts     # Mock determinista para Fase 1
```

### `lib/integrations/netsuite/types.ts`

```ts
// Tipos del payload — placeholders. Reemplazar cuando llegue el contrato.
export interface NetsuitePayload {
  // Placeholder — se completa en Fase 2
  externalId: string         // idempotency_key del envío
  vendor: string             // código OR mapeado al vendor en NetSuite
  amount: string             // "123456.78" — string para precisión
  currency: "COP"
  memo: string               // "Cargo STR <or> <mes_consumo>"
  date: string               // ISO yyyy-mm-dd — derivado de mes_facturacion
  // [otros campos definidos en Fase 2]
}

export interface NetsuiteResponseOk {
  internalId: string
  documentNumber: string     // → numero_oc
  status: "ok"
  raw: Record<string, unknown>
}

export interface NetsuiteResponseError {
  status: "error"
  code: string
  message: string
  raw: Record<string, unknown>
}

export type NetsuiteResponse = NetsuiteResponseOk | NetsuiteResponseError

// Zod schemas para validar la respuesta de NetSuite cuando llegue
export const netsuiteResponseOkSchema = z.object({...})
export const netsuiteResponseErrorSchema = z.object({...})
```

### `lib/integrations/netsuite/client.ts`

Contrato del cliente — implementación switch via env:

```ts
import { NetsuitePayload, NetsuiteResponse } from "./types"

export interface NetsuiteClient {
  enviarOrden(payload: NetsuitePayload): Promise<NetsuiteResponse>
}

// Factory según env. En Fase 1: siempre mock. En Fase 2: real.
export function getNetsuiteClient(): NetsuiteClient {
  if (process.env.NETSUITE_MODE === "real") {
    return new RealNetsuiteClient({
      baseUrl: process.env.NETSUITE_BASE_URL!,
      tokenId: process.env.NETSUITE_TOKEN_ID!,
      tokenSecret: process.env.NETSUITE_TOKEN_SECRET!,
      // ... auth OAuth1/TBA según contrato real
    })
  }
  return new MockNetsuiteClient()
}
```

**Por qué un factory por env:** Permite a Fase 1 funcionar con un mock determinista sin tocar el código de service.ts cuando llegue la integración real. Esto es el punto de extensión clave que pediste.

### `lib/integrations/netsuite/mock-client.ts`

```ts
// Mock determinista para Fase 1
// - Por defecto: 90% éxito, 10% error
// - Override via header `x-test-netsuite-mode`: "always-ok" | "always-error"
// - Demora simulada de 200-800ms para que la UI muestre progreso real
export class MockNetsuiteClient implements NetsuiteClient {
  async enviarOrden(payload: NetsuitePayload): Promise<NetsuiteResponse> {
    await sleep(200 + Math.random() * 600)
    const seed = hash(payload.externalId)
    if (seed % 10 === 0) {
      return { status: "error", code: "MOCK_FAIL", message: "Mocked failure for testing", raw: {} }
    }
    return {
      status: "ok",
      internalId: `MOCK-${seed}`,
      documentNumber: `OC-MOCK-${seed.toString().padStart(6, "0")}`,
      raw: { payload },
    }
  }
}
```

### `lib/integrations/netsuite/mapper.ts`

```ts
import { Prisma } from "@prisma/client"
import { EnvioNetsuiteCargoSTR, ConfiguracionOR } from "@prisma/client"

export function snapshotToPayload(
  envio: EnvioNetsuiteCargoSTR & { operador_red: ConfiguracionOR }
): NetsuitePayload {
  return {
    externalId: envio.idempotency_key,
    vendor: envio.operador_red.codigo,  // mapeo OR→vendor — puede ser tabla aparte en Fase 2
    amount: envio.monto_snapshot_cop.toFixed(2),  // Prisma.Decimal → "123456.78"
    currency: "COP",
    memo: `Cargo STR ${envio.operador_red.nombre} ${envio.mes_consumo}`,
    date: `${envio.mes_facturacion}-01`,
    // ... resto cuando llegue contrato
  }
}
```

**Punto crítico:** `envio.monto_snapshot_cop.toFixed(2)` — Prisma devuelve `Decimal` (no number). Usar `.toFixed(2)` o `.toString()`. **Nunca `Number(monto)`**. Esto resuelve la deuda #3 dentro del módulo NetSuite.

### `lib/integrations/netsuite/service.ts`

Es el corazón. Responsabilidades:
1. `crearLote(userId, cargos)` — valida lote en curso, calcula snapshots, persiste lote + envíos.
2. `procesarLote(loteId)` — bucle secuencial llamando al cliente.
3. `reenviar(envioId)` — reenvío individual.
4. `cancelarLote(loteId)` — cancelar.
5. `obtenerEstadosPorCargo(periodoIds, orIds)` — query para el pivot.

Esqueleto del bucle secuencial (lo más crítico):

```ts
export async function procesarLote(loteId: string): Promise<void> {
  const client = getNetsuiteClient()

  // 1. Tomar envíos a procesar (PENDIENTE o ERROR)
  const envios = await db.envioNetsuiteCargoSTR.findMany({
    where: { lote_id: loteId, estado: { in: ["PENDIENTE", "ERROR"] } },
    include: { operador_red: true },
    orderBy: { createdAt: "asc" },
  })

  for (const envio of envios) {
    // 2. Marcar PROCESANDO atómicamente (lock-light vía updateMany con guard)
    const lock = await db.envioNetsuiteCargoSTR.updateMany({
      where: { id: envio.id, estado: { in: ["PENDIENTE", "ERROR"] } },
      data: { estado: "PROCESANDO", intentos: { increment: 1 }, enviado_at: new Date() },
    })
    if (lock.count === 0) continue // otro worker ya lo tomó

    // 3. Llamar al cliente
    const payload = snapshotToPayload(envio)
    let response: NetsuiteResponse
    try {
      response = await client.enviarOrden(payload)
    } catch (e) {
      response = { status: "error", code: "NETWORK", message: String(e), raw: {} }
    }

    // 4. Persistir resultado
    if (response.status === "ok") {
      await db.envioNetsuiteCargoSTR.update({
        where: { id: envio.id },
        data: {
          estado: "PROCESADO",
          numero_oc: response.documentNumber,
          netsuite_internal_id: response.internalId,
          respuesta_ok_json: response.raw,
          respondido_at: new Date(),
        },
      })
    } else {
      await db.envioNetsuiteCargoSTR.update({
        where: { id: envio.id },
        data: {
          estado: "ERROR",
          error_codigo: response.code,
          error_mensaje: response.message,
          error_payload_json: { request: payload, response: response.raw },
          respondido_at: new Date(),
        },
      })
    }
  }

  // 5. Actualizar totales del lote y marcar COMPLETADO si todo terminó
  await actualizarEstadoLote(loteId)
}
```

**Por qué `updateMany` con guard y no `update` directo:** evita reescribir un envío que otro worker ya tomó. Es un lock optimista barato.

**Tradeoff: ¿llamadas paralelas?** Requerimiento explícito: **secuencial**. Lo respetamos. Si después se quisiera paralelizar con concurrency = N, el patrón `updateMany` ya está listo para usar como semáforo.

### Desacople del cliente HTTP

La clave es: **`service.ts` solo conoce `NetsuiteClient` (la interface)**, nunca el cliente real. Esto permite:
- Tests unitarios: pasar un mock que retorna lo que quiero.
- Fase 1: `MockNetsuiteClient` por env.
- Fase 2: `RealNetsuiteClient` se inyecta cuando llega el contrato.
- Tests de integración futuros: cliente con grabaciones (`nock`-style).

---

## B.4 Cambios al UI

### Decisión: selección por celda vs selección por fila

**Por celda** (`operador × período`) es lo natural: cada celda es un cargo. **Recomendado.**

Si la selección fuera por fila (todo el OR a través de todos los períodos visibles), perderíamos granularidad y el usuario no podría enviar solo un período de un OR.

### Layout del módulo Cargos STR (modificado)

```
┌──────────────────────────────────────────────────────────────────┐
│  Cargos STR                                                       │
│  Cargos calculados a partir de los Insumos STR, totalizados...   │
├──────────────────────────────────────────────────────────────────┤
│  [Filtros: Facturación] [Consumo] [Operador]    [Filtrar]        │
│                                              [Generar OC (3)] ◀──┤ Nuevo
├──────────────────────────────────────────────────────────────────┤
│  Mes facturación    │ Feb 2026 │ Mar 2026 │ Abr 2026 │ Total    │
│  Mes Consumo        │ Ene 2026 │ Feb 2026 │ Mar 2026 │           │
├─────────────────────┼──────────┼──────────┼──────────┼──────────┤
│ ☐ AFINIA            │ ☐ $1.2M  │ ☑ $1.5M ●│ ✓ $1.8M  │ $4.5M    │
│ ☐ AIRE              │ ✓ $0.8M  │ ☐ $0.9M  │ ☐ $1.1M  │ $2.8M    │
│ ...                 │          │          │          │           │
└──────────────────────────────────────────────────────────────────┘

Badge en celda:
  ☐ = pendiente de selección (sin envío previo)
  ☑ = seleccionado para nuevo lote
  ● amarillo  = PENDIENTE/PROCESANDO en lote actual
  ✓ verde     = PROCESADO (con OC) — hover muestra "OC-2026-00123"
  ✗ rojo      = ERROR — hover muestra el error
```

**Componentes nuevos a crear:**
- `components/cargos-str/CeldaCargo.tsx` — checkbox + badge + tooltip.
- `components/cargos-str/BotonGenerarOC.tsx` — botón habilitado cuando `seleccion.size > 0`, abre modal de confirmación.
- `components/cargos-str/ModalConfirmarLote.tsx` — modal con lista de cargos seleccionados + suma + botón "Enviar".
- `components/cargos-str/PanelLoteEnCurso.tsx` — banner pegajoso arriba de la tabla cuando hay un lote `EN_PROGRESO` con progreso (`3 / 12 procesados`).
- `components/cargos-str/DetalleEnvioModal.tsx` — modal lateral al click en celda con envío: muestra OC o error completo, payload de request, fecha, intentos, botón "Reenviar" si error.

### Flujo del usuario

1. Usuario aplica filtros + pulsa **Filtrar** (sin cambios respecto a hoy).
2. Tabla pivot se renderiza con badges según `/api/cargos-str/netsuite/estados`.
3. Usuario marca checkboxes en celdas que quiere enviar.
   - Si una celda tiene badge ✓ (ya enviada con OC) → checkbox deshabilitado.
   - Si tiene ✗ (error) → checkbox habilitado, pero al marcar muestra warning "este cargo ya fue enviado y falló — al re-enviar usa el botón Reenviar de la celda".
   - Si tiene ● (en curso) → checkbox deshabilitado.
4. Botón **Generar OC (N)** muestra contador. Habilitado si N ≥ 1.
5. Click → modal de confirmación con tabla de cargos seleccionados (OR | mes | monto), suma total al pie, botón "Confirmar envío".
6. POST `/api/cargos-str/netsuite/lote` → si error `LOTE_EN_CURSO`, mostrar dialog "Hay un lote del usuario X iniciado el ... — espera a que termine o ve a Lotes."
7. Si OK, POST `/api/cargos-str/netsuite/lote/:id/procesar` (fire-and-forget desde el front), cerrar modal, mostrar `PanelLoteEnCurso` sticky con progreso.
8. Polling cada 2-3s a `/api/cargos-str/netsuite/lote/:id` mientras `estado === "EN_PROGRESO"`.
9. Cada actualización pinta los badges en la tabla.
10. Cuando estado pasa a `COMPLETADO`, mostrar toast "Lote completado: X procesados, Y errores".

### Cómo se renderiza el detalle de error y el número de OC

- **Tooltip en hover** sobre la celda: ya muestra OC o "Error: <primeros 60 chars>".
- **Click en celda con badge ✓ o ✗** → `DetalleEnvioModal`:
  - ✓ verde: OC, internal_id NetSuite, fecha de envío, payload enviado (collapsible), respuesta (collapsible).
  - ✗ rojo: código de error, mensaje, fecha, intentos previos, payload (collapsible), botón **Reenviar este cargo**.

### Cómo se muestra el progreso del lote en curso

`PanelLoteEnCurso` (banner amarillo sticky en top del módulo):

```
┌─────────────────────────────────────────────────────────────────┐
│ ● Lote en curso (iniciado por Erika R. — 12:34)                 │
│   ████████░░░░░░░░░  8 / 23                                     │
│   ✓ 6 procesados   ✗ 2 errores   ⋯ 15 pendientes               │
│                                              [Ver detalle] [×]  │
└─────────────────────────────────────────────────────────────────┘
```

**Decisión:** el panel también aparece para **otros usuarios** que entren al módulo mientras el lote esté en curso. Así se enteran sin sorpresas. Si quieren cancelar pero no son el iniciador, el botón está deshabilitado (solo admin o el iniciador puede cancelar).

---

## B.5 Diagrama de estados y transiciones

```
EnvioNetsuiteCargoSTR:

           ┌──────────┐
           │ (created)│
           └────┬─────┘
                │ POST /lote (crea envíos)
                ▼
         ┌──────────────┐
         │  PENDIENTE   │
         └────┬─────────┘
              │ procesarLote() toma este envío
              ▼
         ┌──────────────┐
         │  PROCESANDO  │ ◀── intentos++
         └────┬────┬────┘
              │    │
   client.ok  │    │  client.error
              ▼    ▼
       ┌──────────┐  ┌─────────┐
       │PROCESADO │  │  ERROR  │
       │ (terminal│  └────┬────┘
       │  para el │       │
       │  lote)   │       │ POST /envio/:id/reenviar
       └──────────┘       │ (solo si lote EN_PROGRESO)
                          ▼
                    ┌──────────────┐
                    │  PROCESANDO  │
                    └──────────────┘

LoteNetsuite:

       ┌──────────────┐
       │  EN_PROGRESO │
       └──┬───────────┘
          │
          │  todos los envíos en {PROCESADO, ERROR}
          │  AND ninguno en {PENDIENTE, PROCESANDO}
          ▼
       ┌──────────────┐
       │  COMPLETADO  │
       └──────────────┘

       EN_PROGRESO ──(POST /cancelar)──▶ CANCELADO
       (solo si no hay envíos PROCESANDO)
```

### Reglas duras

| De | A | Permitido si | Cómo |
|----|---|--------------|------|
| `PENDIENTE` | `PROCESANDO` | lote `EN_PROGRESO` | worker toma el envío |
| `PROCESANDO` | `PROCESADO` | client.ok | servicio escribe |
| `PROCESANDO` | `ERROR` | client.error o excepción | servicio escribe |
| `ERROR` | `PROCESANDO` | lote `EN_PROGRESO` | re-envío individual |
| `PROCESADO` | * | **nunca** | terminal — no se revierte (sería complicación contable) |

### Reglas blandas (validadas en service.ts)

- Si todos los envíos del lote están en `{PROCESADO, ERROR}` → lote pasa a `COMPLETADO` automáticamente.
- Un envío `PROCESADO` no se "deshace": si la OC en NetSuite hay que cancelarla, eso es manual en NetSuite. **Razón:** no queremos crear un estado "REVERTIDO" sin saber el flujo financiero/contable real. Dejarlo para iteración futura cuando llegue el contrato.

---

## B.6 Concurrencia y validación de "lote anterior completo"

### El problema

Dos usuarios cliquean "Generar OC" en una ventana de 200ms. Sin protección, se crean dos lotes en `EN_PROGRESO` simultáneamente.

### Solución recomendada: Advisory Lock de Postgres

Postgres tiene `pg_advisory_xact_lock(key)` que dura solo lo que dure la transacción. Es ideal para este caso.

```ts
// En service.ts → crearLote()
await db.$transaction(async (tx) => {
  // 1. Lock global del recurso "creación de lotes netsuite"
  // El key es arbitrario pero único para este recurso.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NETSUITE_LOTE_LOCK_KEY})`

  // 2. Verificar dentro del lock que no hay lote EN_PROGRESO
  const enCurso = await tx.loteNetsuite.findFirst({
    where: { estado: "EN_PROGRESO" },
    include: { iniciado_por: { select: { nombre: true } } },
  })
  if (enCurso) {
    throw new LoteEnCursoError(enCurso)
  }

  // 3. Crear el lote y los envíos
  ...
})
// Al salir de la transacción, el advisory lock se libera automáticamente.

const NETSUITE_LOTE_LOCK_KEY = 0xCA90STR1n // bigint constante
```

**Tradeoffs:**
- **vs lock a nivel de aplicación (mutex en memoria):** el advisory lock funciona aunque haya múltiples instancias de Vercel. La memoria de aplicación no.
- **vs columna `is_locked` en una tabla "config":** funciona pero requiere mantener su vida útil (release manual). Advisory lock se libera con la transacción — cero leaks.
- **vs `SELECT ... FOR UPDATE` sobre `lotes_netsuite`:** funcionaría pero requiere una fila "dummy" para bloquear.

**Recomendación firme: advisory lock.** Es el patrón limpio.

### Definición de "lote completado al 100%"

```sql
LoteNetsuite.estado = 'EN_PROGRESO'
  AND ningún envio del lote está en {'PENDIENTE', 'PROCESANDO'}
  → transición a 'COMPLETADO' (escrita por service.actualizarEstadoLote)
```

Equivalente: `total_envios = total_ok + total_error`.

**Importante:** la transición a `COMPLETADO` no se hace por estado en cada envío individual — se hace al final del bucle del worker en `procesarLote`. Si el worker se muere a mitad, el lote queda en `EN_PROGRESO` con envíos en `PROCESANDO`. Para esto:
- El frontend muestra el panel con timeout: "Este lote está en progreso desde hace > 10 min — puede que haya quedado colgado. Cancelar lote."
- Permitir cancelar manualmente cuando hay envíos `PROCESANDO` (con confirmación: "estos envíos quedarán en estado indeterminado").
- En iteración futura: cron job que detecta lotes "colgados" y los marca para revisión.

---

## B.7 Plan de implementación incremental

### Fase 1 — Schema + Servicio Mock + UI completa (≈ 7-9 días-persona)

**Objetivo:** todo el flujo funcionando con el mock — el usuario puede seleccionar, generar lote, ver estados, ver progreso, reenviar — sin contrato real de NetSuite.

| Tarea | Días | Notas |
|-------|------|-------|
| Pre-trabajo: adoptar `prisma migrate` (resuelve deuda #1) | 1 | PR separada |
| Pre-trabajo: introducir Zod en handlers existentes (cargas) | 0.5 | PR separada |
| Migración Prisma: `lotes_netsuite`, `envios_netsuite_cargo_str`, índices en `registros_str` | 0.5 | |
| `lib/integrations/netsuite/{types,client,mock-client,mapper,errors}.ts` | 1 | |
| `lib/integrations/netsuite/service.ts` con crearLote / procesarLote / reenviar / cancelar | 2 | Incluye advisory lock |
| 6 endpoints API con Zod | 1 | |
| UI: `CeldaCargo`, `BotonGenerarOC`, `ModalConfirmarLote`, `DetalleEnvioModal`, `PanelLoteEnCurso` | 2-3 | |
| Modificación de `page.tsx` para integrar selección, polling, estados | 1 | |
| Tests unitarios del service (con mock) | 1 | |

**Salida de Fase 1:** demo navegable. El usuario selecciona cargos, ve un panel de progreso, los badges se pintan, puede reenviar errores mock. **Cero dependencia del contrato real.**

### Fase 2 — Integración real (≈ 3-5 días, depende del contrato)

**Disparador:** llega documentación de NetSuite (auth, URL, payload, response schema).

| Tarea | Días | Notas |
|-------|------|-------|
| Documentar contrato en `docs/integrations/netsuite/contrato.md` | 0.5 | |
| `RealNetsuiteClient` con auth (probablemente OAuth1/TBA o JWT — depende) | 1-2 | |
| Validación Zod de respuesta real (`netsuiteResponseOkSchema`) | 0.5 | |
| Ajustar `mapper.ts` con campos reales | 0.5 | |
| Configurar variables de entorno en Vercel (preview + production separadas) | 0.5 | Rotación de secrets |
| Testing en sandbox de NetSuite | 1 | |
| Switch `NETSUITE_MODE=real` en production | — | |

**Decisión Vercel:** todos los endpoints de NetSuite deben correr en **Node.js runtime**, no Edge. Razones:
1. La librería de auth NetSuite (probablemente OAuth1 con HMAC-SHA256) no garantiza compatibilidad Edge.
2. El worker `procesarLote` puede durar > 30s para 23 envíos secuenciales (Edge tiene 30s, Node tiene 60s en Pro, 300s en función background con `vercel.json` correctamente configurado).

Configurar en cada handler:
```ts
export const runtime = "nodejs"
export const maxDuration = 300 // Vercel Pro plan
```

Si el lote excede el `maxDuration`, hay dos opciones:
- **Opción 1 — Trocear el procesamiento:** el endpoint procesa N envíos por invocación y se re-llama vía Vercel Cron o un job queue (mejor pero más complejo).
- **Opción 2 — Forzar lote pequeño:** validar en `crearLote` que `envios.length * tiempoEsperado < maxDuration`. Si estimamos 2s por envío real, 23 envíos = 46s < 300s. OK.

**Recomendación:** Opción 2 con un guard `MAX_ENVIOS_POR_LOTE = 100`. Si después escala, opción 1.

### Fase 3 — Re-envíos, edge cases, observabilidad (≈ 3-4 días)

| Tarea | Días | Notas |
|-------|------|-------|
| Vista "Histórico de lotes" en `/cargos-str/lotes` | 1 | Lista paginada |
| Detección de lotes colgados (banner con CTA "Cancelar") | 0.5 | |
| Logs estructurados de cada envío (incluye payload y respuesta) en `LogAuditoria` | 0.5 | |
| Cron job opcional: `/api/cargos-str/netsuite/cleanup` que pasa a CANCELADO los lotes EN_PROGRESO con >24h sin actividad | 0.5 | `vercel.json` cron |
| Exportar lote a Excel (auditoría) | 0.5 | Reutilizar `xlsx` |
| Métricas básicas en el dashboard: tasa de éxito, tiempo promedio por envío | 0.5 | Opcional |

---

## B.8 Riesgos específicos a la integración + mitigaciones

| # | Riesgo | Severidad | Mitigación |
|---|--------|-----------|------------|
| R1 | NetSuite rate-limits (típico: 4-10 req/seg en TBA) | MAJOR | Bucle secuencial ya respeta esto. Si NetSuite específica un límite, añadir `await sleep(150)` entre envíos. |
| R2 | Doble envío del mismo cargo (race condition o re-click) | MAJOR | `idempotency_key` único + `updateMany` con guard de estado + advisory lock al crear lote |
| R3 | Lote queda colgado en `EN_PROGRESO` con envíos en `PROCESANDO` (timeout, deploy en medio) | MAJOR | Botón cancelar manual + cron de limpieza (Fase 3). Cada envío tiene `enviado_at` — si > X min, marcar como ERROR_TIMEOUT |
| R4 | NetSuite responde OK pero no devuelve `documentNumber` | MAJOR | Zod valida la respuesta y la marca como ERROR si no cumple schema. Mejor un error explícito que una OC fantasma |
| R5 | Diferencia entre monto enviado y monto en NetSuite por redondeo | BLOCKER | `Decimal.toFixed(2)` como string, **nunca Number()**. Tests numéricos con casos límite (.005, .995, valores grandes) |
| R6 | Usuario re-carga Insumos STR DESPUÉS de enviar — el monto del envío ya no coincide con la suma actual de registros_str | MEDIO | Snapshot en el envío (`monto_snapshot_cop`). El UI debe **mostrar advertencia visual** ("este cargo fue enviado con $X — los datos actuales suman $Y"). |
| R7 | Secret de NetSuite filtrado en logs o frontend | BLOCKER | `NETSUITE_*` vars solo se leen en `getNetsuiteClient()` (server). Nunca exponer. Lint rule: prohibir `NEXT_PUBLIC_NETSUITE_*`. |
| R8 | Vercel timeout corta el lote a mitad | MAJOR | `maxDuration = 300` + `MAX_ENVIOS_POR_LOTE = 100`. Para lotes mayores: Fase 3 trocea |
| R9 | Mapeo OR → vendor de NetSuite incorrecto | MAJOR | Tabla `mapeo_or_vendor_netsuite` o campo `vendor_netsuite_id` en `ConfiguracionOR`. Validar antes de enviar. Si falta, error explícito. (Sugerencia: añadir esta tabla en Fase 2 cuando se sepa qué identificador usa NetSuite.) |
| R10 | Pérdida de auditoría: NetSuite responde error pero no guardamos el payload exacto | MEDIO | `error_payload_json` guarda request + response. **Encriptación at-rest de Postgres ya cubierta por Supabase**. Si el payload contiene info sensible, considerar enmascarar tokens. |
| R11 | Concurrencia: el job worker se ejecuta dos veces (Vercel retry, doble dispatch del front) | MAJOR | El `procesarLote` debe ser idempotente: solo procesa envíos en `{PENDIENTE, ERROR}`. Si todos están en otro estado, no hace nada. El guard `updateMany` evita doble write. |

---

## B.9 Tests sugeridos

### Unit tests (Vitest o Jest — el repo no tiene framework configurado, recomiendo Vitest por velocidad)

**`lib/integrations/netsuite/service.test.ts`** (con mock cliente):
- `crearLote_sinSeleccion_lanzaError`
- `crearLote_conLoteEnCurso_lanzaLoteEnCursoError`
- `crearLote_con3Cargos_creaLoteY3Envios`
- `crearLote_calculaMontoSnapshotCorrectoDeRegistrosSTR`
- `crearLote_generaIdempotencyKeyUnico`
- `crearLote_montoCero_lanzaError`
- `procesarLote_clienteSiempreOK_pasaTodosAProcesado`
- `procesarLote_clienteSiempreError_pasaTodosAError`
- `procesarLote_mix_persisteCorrectamente`
- `procesarLote_marcaLoteCompletadoCuandoTermina`
- `procesarLote_actualizaTotalesOkYError`
- `reenviar_envioEnError_loProcesaNuevamente`
- `reenviar_envioEnProcesado_lanzaError` (terminal — no reenviar)
- `reenviar_envioEnLoteCompletado_lanzaError`
- `cancelarLote_conEnvioProcesando_requiereConfirmacion`

**`lib/integrations/netsuite/mapper.test.ts`** (precisión numérica):
- `snapshotToPayload_montoConDecimales_serializaCorrecto`
  - Inputs: `123.45`, `0.005`, `999999.99`, `0`, negativos
  - Verifica que el string sea `"123.45"`, etc.
- `snapshotToPayload_montoComoDecimal_nuncaUsaNumber`
- `snapshotToPayload_calculaMesFacturacionDesdeMesConsumo`

### Tests de transiciones de estado

**`lib/integrations/netsuite/state-machine.test.ts`** (función pura `transicionValida(de, a)`):
- `PENDIENTE → PROCESANDO: ok`
- `PROCESANDO → PROCESADO: ok`
- `PROCESANDO → ERROR: ok`
- `PROCESADO → cualquier cosa: error`  ← crítico
- `ERROR → PROCESANDO: ok`
- `PENDIENTE → ERROR: error` (no es transición válida)

### Tests del "lote anterior completo" + advisory lock

**Integration tests con Postgres real (Testcontainers o `pg-mem`):**
- `dosLotesSimultaneos_segundoEsperaLockYRecibeError`
- `loteEnProgreso_intentarCrearOtro_lanza409`
- `loteCompletado_permiteCrearOtro`
- `loteCancelado_permiteCrearOtro`
- `actualizarEstadoLote_todosOK_pasaACompletado`
- `actualizarEstadoLote_unEnvioPendiente_quedaEnProgreso`

### Tests E2E del flujo UI (Playwright — opcional, recomendado para Fase 3)

- Usuario selecciona 3 cargos → ve modal con suma → confirma → ve progreso → al terminar, 2 badges verdes + 1 rojo
- Click en badge rojo → modal con error → "Reenviar" → badge pasa a procesando → verde
- Dos pestañas del mismo navegador: la segunda intenta crear lote → ve 409 LOTE_EN_CURSO

---

## Próximos pasos

- [ ] **Validar el plan en review con el equipo.** Especialmente las decisiones sobre snapshot, advisory lock y lote secuencial.
- [ ] **PR 0 (preparación):** introducir `prisma migrate dev` con baseline de la DB actual + Zod en handlers existentes. **Bloquea el resto.**
- [ ] **PR 1 (schema):** crear migración con `lotes_netsuite`, `envios_netsuite_cargo_str` y los índices en `registros_str`.
- [ ] **PR 2 (servicio + mock):** `lib/integrations/netsuite/` completo con mock determinista.
- [ ] **PR 3 (API):** los 6 endpoints con Zod + advisory lock.
- [ ] **PR 4 (UI):** selección, modal, panel de progreso, modal de detalle, reenviar.
- [ ] **PR 5 (tests):** suite de unit tests del service.
- [ ] **PR 6+ (Fase 2):** cliente real cuando llegue el contrato.
- [ ] **Pendiente con stakeholders de NetSuite:** confirmar (a) método de auth (OAuth1/TBA vs JWT vs API Key), (b) URL base de sandbox vs producción, (c) payload exacto y campos requeridos, (d) formato de número de OC, (e) idempotencia del lado de NetSuite, (f) rate limits y cuotas.

---

## Archivos relevantes consultados

- `prisma/schema.prisma`
- `app/(dashboard)/cargos-str/page.tsx`
- `app/api/cargos-str/route.ts`
- `app/api/cargos-str/meses/route.ts`
- `app/api/cargas/preview/route.ts`
- `app/api/cargas/confirmar/route.ts`
- `app/api/cargas/route.ts`
- `app/api/operadores/route.ts`
- `lib/db.ts`
- `lib/auth.ts`
- `lib/parsers/insumos-str.ts`
- `auth.ts`
- `package.json`
