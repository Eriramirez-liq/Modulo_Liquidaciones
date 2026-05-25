# Runbook — Adopción de `prisma migrate` (baseline + flujo nuevo)

> **Audiencia:** Erika (finanzas@bia.app) y cualquier persona con acceso al `DATABASE_URL` de producción Supabase.
> **Última actualización:** 2026-05-22
> **PR que lo introduce:** BE-0 (`feat(db): adoptar prisma migrate con baseline del schema actual`)

---

## Resumen ejecutivo

Hasta ahora el repo usaba `prisma db push` (sin historial de migraciones). En este PR se adopta `prisma migrate` con una migración **baseline** que refleja el estado actual de la DB de producción. La baseline NO debe ejecutarse contra Supabase (las tablas ya existen); en su lugar, se marca como aplicada con `prisma migrate resolve --applied`.

Una vez aplicado el procedimiento de esta página, todas las migraciones futuras del proyecto se versionan en `prisma/migrations/` y se aplican con `prisma migrate deploy` desde Vercel build (paso que **no** se activa todavía — eso lo hará BE-1 cuando agregue las primeras migraciones reales del módulo NetSuite).

---

## Estado al cierre de BE-0

| Cosa | Estado |
|------|--------|
| `prisma/migrations/20260522000000_baseline/migration.sql` | Creado, refleja schema completo |
| `prisma/migrations/migration_lock.toml` | Creado, provider `postgresql` |
| Scripts npm `db:migrate:dev`, `db:migrate:deploy`, `db:migrate:status` | Agregados |
| Build command Vercel (`prisma generate && next build`) | **Sin cambios** — BE-1 lo modificará si corresponde |
| Migración aplicada a producción Supabase | **NO** — depende del paso manual descrito abajo |
| `prisma db push` | Aún disponible (`npm run db:push`); su uso queda **deprecado** a partir de BE-1 |

---

## Procedimiento manual para Erika — UNA SOLA VEZ tras mergear BE-0

> Estos pasos se ejecutan **una vez** apuntando al `DATABASE_URL` de producción Supabase. NO requieren ambiente local de Next/Vercel — solo la CLI de Prisma + acceso al `DATABASE_URL`.

### Paso 1 — Snapshot de seguridad de Supabase ⏸️ DIFERIDO (deuda técnica)

> **Estado al 2026-05-25:** Paso DIFERIDO porque el proyecto no cuenta con plan Pro de Supabase (los snapshots manuales son feature de Pro). Se acepta el riesgo apoyándose en los **backups automáticos diarios** del plan Free de Supabase como red de seguridad.
>
> **Mitigación temporal aceptada:**
> - Supabase Free guarda 1 backup automático diario por 7 días (retención).
> - Antes de aplicar cualquier migración destructiva (BE-1 en adelante), confirmar manualmente que el backup automático del día existe en Supabase Dashboard → Database → Backups.
> - Si BE-1 introduce solo `CREATE TABLE` y `CREATE TYPE` (sin `ALTER` ni `DROP`), el riesgo es bajo y el rollback es trivial (DROP TABLE de las tablas nuevas).
>
> **Acción recomendada cuando se contrate Supabase Pro:** retomar este paso y crear backups manuales antes de cada migración no trivial. Ver `mejoras/netsuite-backend-plan.md` § Deuda técnica.

Pasos originales (a ejecutar cuando se tenga plan Pro):

1. Abrir Supabase Dashboard → proyecto de producción.
2. Ir a **Database → Backups**.
3. Click en **Create backup** (botón superior derecho).
4. Anotar el ID/timestamp del backup en el PR.

> Alternativa con `pg_dump` (sirve incluso sin plan Pro): correr `pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql` y guardar en un sitio seguro.

### Paso 2 — Verificar que la baseline coincide con la DB real

Antes de marcarla como aplicada, conviene confirmar que el SQL generado coincide con lo que hay en Supabase. Desde una terminal con `DATABASE_URL` apuntando a producción (o a una copia restaurada del backup):

```powershell
npx prisma migrate status
```

Resultado esperado:

```
Database schema is out of sync with the migration history.
The following migration(s) have not yet been applied:
20260522000000_baseline
```

Esto es lo correcto: la migración existe en disco pero la DB todavía no la reconoce como aplicada (aunque sus tablas ya existen).

> **Si en lugar de "not yet been applied" el comando reporta "drift" o sugiere ejecutar `prisma migrate reset`, NO ejecutar reset.** Detenerse y abrir un issue. `reset` borra todos los datos.

### Paso 3 — Marcar la baseline como aplicada (NO ejecuta SQL)

```powershell
npx prisma migrate resolve --applied "20260522000000_baseline"
```

Esto inserta una fila en la tabla `_prisma_migrations` (Prisma la crea automáticamente la primera vez) marcando la baseline como ya aplicada, **sin ejecutar el SQL**. Las tablas existentes en producción quedan intactas.

### Paso 4 — Verificar el estado final

```powershell
npx prisma migrate status
```

Resultado esperado:

```
Database schema is up to date!
```

A partir de este momento, la DB de producción tiene el historial de migraciones inicializado.

---

## Procedimiento para crear futuras migraciones (sub-tareas de BE-1 en adelante)

> A diferencia del baseline, las migraciones futuras SÍ modifican la DB.

### Flujo recomendado

1. Modificar `prisma/schema.prisma` con los cambios deseados (nueva tabla, nueva columna, nuevo enum, etc.).
2. Generar el SQL versionado con:

   ```powershell
   npx prisma migrate dev --name <nombre_descriptivo_en_snake_case>
   ```

   Ejemplo: `npx prisma migrate dev --name netsuite_cargos_str`.

   Esto crea `prisma/migrations/<timestamp>_<nombre>/migration.sql` con el diff y lo aplica contra el `DATABASE_URL` actual. **Si el `DATABASE_URL` apunta a producción, el SQL se ejecuta en producción.**

3. Revisar el SQL generado antes de commitear. Si destruye datos sin querer, ajustar el schema y reintentar.
4. Commitear `schema.prisma` + el nuevo directorio de migración.
5. En el deploy de Vercel, agregar `prisma migrate deploy` al build (lo hace BE-1).

### Flujo seguro recomendado para este proyecto (sin Postgres local)

Como Erika no tiene Postgres local, las opciones son:

- **Opción A — Branch de Supabase:** crear una rama de DB en Supabase (`Database → Branches`), apuntar `DATABASE_URL` ahí, generar la migración con `migrate dev`, validar, mergear la rama a producción.
- **Opción B — Dev DB efímera:** usar un Postgres descartable (Neon free tier, Supabase proyecto separado) solo para generar el SQL. Una vez generado el `migration.sql`, ese archivo se commitea y se aplica a producción con `migrate deploy` desde Vercel.

> Ambas opciones requieren coordinación una sola vez. La elección queda fuera de alcance de este runbook — se decide al ejecutar BE-1.

---

## Cómo aplicar migraciones en producción desde Vercel

> **No activado en BE-0.** Documentado para BE-1.

Cuando BE-1 agregue las primeras migraciones reales, el `buildCommand` de Vercel pasará de:

```
prisma generate && next build
```

a:

```
prisma migrate deploy && prisma generate && next build
```

`prisma migrate deploy`:
- NO crea migraciones nuevas (eso solo lo hace `migrate dev`).
- Solo aplica las migraciones pendientes en `prisma/migrations/` que aún no estén marcadas como aplicadas en `_prisma_migrations`.
- Si falla, el build de Vercel falla. NO hay riesgo de aplicar parcial — cada migración corre en su propia transacción.

### Variables de entorno requeridas en Vercel

- `DATABASE_URL`: apunta al Postgres de Supabase con permisos suficientes para crear tablas, índices y constraints. Si el `DATABASE_URL` actual de Vercel está restringido a `service_role` (que no permite DDL), hay que pedir al admin de Supabase un connection string con rol `postgres`.

---

## Verificación del estado en cualquier momento

```powershell
npm run db:migrate:status
# equivalente a: npx prisma migrate status
```

Salidas posibles:

| Salida | Significado | Acción |
|--------|-------------|--------|
| `Database schema is up to date!` | DB y migraciones sincronizadas | Nada |
| `Following migration have not yet been applied: …` | Hay migraciones nuevas en disco que aún no se aplicaron | Aplicar con `migrate deploy` o (manual) `migrate resolve --applied` |
| `Drift detected: …` | El estado de la DB no coincide con el historial | **Detenerse, abrir issue.** No usar `migrate reset` sobre producción |
| `Following migration(s) are applied to the database but missing from the local migrations directory: …` | Alguien aplicó una migración manualmente y no la commiteó | Recuperar el SQL y commitearlo retroactivamente; coordinar con el equipo |

---

## Plan de rollback de la baseline

> La baseline no ejecuta SQL — solo se marca como aplicada. Por eso el "rollback" es trivial.

Si después de aplicar `migrate resolve --applied` algo sale mal (poco probable porque no toca datos):

1. Eliminar la fila correspondiente de la tabla `_prisma_migrations` apuntando al `DATABASE_URL` de producción:

   ```sql
   DELETE FROM "_prisma_migrations"
   WHERE migration_name = '20260522000000_baseline';
   ```

2. Verificar con `npx prisma migrate status`.
3. Si se quiere volver al estado pre-BE-0, revertir el PR de BE-0 (elimina `prisma/migrations/` y los scripts npm).

> Nada de esto borra tablas de negocio. Solo afecta la tabla de control de Prisma.

---

## Plan de rollback de futuras migraciones (referencia para BE-1+)

Para migraciones que SÍ ejecutan DDL:

1. Si el deploy de Vercel falla por una migración, revertir el PR que la introdujo.
2. **`prisma migrate deploy` no tiene `--rollback` nativo.** Cada migración debe documentar su SQL inverso en un comentario al inicio del archivo, o en una sección "Rollback" del PR. Ejecutar ese SQL manualmente apuntando a producción.
3. Eliminar la fila de `_prisma_migrations` correspondiente con `DELETE FROM _prisma_migrations WHERE migration_name = '<nombre>'` para que Prisma deje de considerarla aplicada.

---

## Tests manuales post-deploy de BE-0

Después de mergear BE-0 a `main` y de que Vercel termine el deploy:

| # | Test | Resultado esperado |
|---|------|---------------------|
| 1 | Build de Vercel en `main` | ✔ verde — `prisma generate && next build` sin errores |
| 2 | Probar `POST /api/cargas/preview` con body válido (FormData típico desde la UI) | 200 con preview, igual que antes de BE-0 |
| 3 | Probar `POST /api/cargas/preview` con FormData sin `anio` ni `mes` | 400 con `{ error: "VALIDATION_ERROR", message: "Parámetros incompletos", details: {...} }` |
| 4 | Probar `POST /api/cargas/confirmar` con body válido | 200, comportamiento idéntico al pre-BE-0 |
| 5 | Probar `POST /api/cargas/confirmar` con body `{}` | 400 con `{ error: "VALIDATION_ERROR", details: {...} }` |
| 6 | Probar `POST /api/cargas/confirmar` con body NO-JSON (ej. texto plano) | 400 con `{ error: "VALIDATION_ERROR", message: "Body inválido: JSON malformado" }` |
| 7 | Ejecutar `npx prisma migrate status` apuntando al `DATABASE_URL` de producción | Reporta la baseline como pendiente (antes del paso manual) o `Database schema is up to date!` (después) |

---

## Observaciones / deudas conocidas

1. **`registros_facturacion`, `registros_xm`, `registros_tc1`, `registros_cot` no tienen FK declarada a `cargas_fuente.id` en el schema de Prisma.** La baseline refleja esto fielmente (sin las FKs). Es deuda heredada — no es bug introducido por BE-0. Si se quiere agregar, se hace en una migración futura con `prisma migrate dev --name add_fk_registros_to_cargas`.
2. **`db:push` permanece en `package.json` por compatibilidad** durante la transición. Se eliminará en BE-1 una vez activado `migrate deploy` en el build de Vercel.
3. **La baseline asume que la DB de producción coincide exactamente con `prisma/schema.prisma` en el HEAD actual.** Si hay drift (alguna columna creada manualmente en Supabase no reflejada en el schema), `migrate status` lo reportará en el paso 2 y habrá que decidir caso por caso. NO arreglar el drift dentro de BE-0.
