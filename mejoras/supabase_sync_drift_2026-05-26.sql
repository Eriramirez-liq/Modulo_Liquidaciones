-- ================================================================
-- Script consolidado de sincronización DB ↔ schema.prisma
-- Fecha: 2026-05-26
--
-- Razón: durante el trabajo de BE-0 (adopción de prisma migrate) se
-- detectó drift entre schema.prisma y la DB de Supabase. Hay 3 SQLs
-- en mejoras/ que pudieron no haberse aplicado todos. Este script los
-- consolida y los re-aplica de forma idempotente (si ya están
-- aplicados, no hace nada; si faltan, los agrega).
--
-- Es 100% seguro correr este script — no borra datos ni modifica
-- columnas existentes con datos.
--
-- DESPUÉS de correr este script:
--   1. La app debería funcionar sin "column does not exist".
--   2. Recién entonces se puede ejecutar el runbook de BE-0
--      (prisma migrate resolve --applied baseline + migrate deploy).
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- 1) supabase_g_bolsa_bia.sql  (commit ad79341, 2026-05-26)
--    Erika ya aplicó esto manualmente. Lo dejamos por idempotencia.
-- ────────────────────────────────────────────────────────────────

ALTER TABLE registros_facturacion
  ADD COLUMN IF NOT EXISTS g_bolsa_bia DECIMAL(18, 6);

-- ────────────────────────────────────────────────────────────────
-- 2) supabase_costo_estimado_contingencia.sql  (commit 9f3d5f0)
--    Agrega costo_estimado_cop a contingencias para valorizar
--    contingencias al momento de crearlas (energia × tarifa_sdl).
--    Usado en dashboard, gestiones y orchestrator.
-- ────────────────────────────────────────────────────────────────

ALTER TABLE contingencias
  ADD COLUMN IF NOT EXISTS costo_estimado_cop DECIMAL(18, 2);

-- ────────────────────────────────────────────────────────────────
-- 3) supabase_facturacion_metabase.sql  (commit 0c2673b)
--    Adapta registros_facturacion al nuevo shape de Metabase:
--    relaja NOT NULL en campos opcionales + agrega NT, reactiva,
--    factor_m, e índices nuevos.
-- ────────────────────────────────────────────────────────────────

-- 3a) Hacer opcionales los campos que ya no son obligatorios.
-- (DROP NOT NULL es idempotente en Postgres — si la columna ya es
-- nullable, no falla.)
ALTER TABLE registros_facturacion
  ALTER COLUMN nombre_usuario   DROP NOT NULL,
  ALTER COLUMN operador_red     DROP NOT NULL,
  ALTER COLUMN g_bia            DROP NOT NULL,
  ALTER COLUMN t_bia            DROP NOT NULL,
  ALTER COLUMN d_bia            DROP NOT NULL,
  ALTER COLUMN pr_bia           DROP NOT NULL,
  ALTER COLUMN r_bia            DROP NOT NULL,
  ALTER COLUMN c_bia            DROP NOT NULL,
  ALTER COLUMN tarifa_total_bia DROP NOT NULL;

-- 3b) Agregar columnas nuevas (NT + nivel + propiedad + reactiva + factor M).
ALTER TABLE registros_facturacion
  ADD COLUMN IF NOT EXISTS nt_raw                   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS nivel_tension            VARCHAR(5),
  ADD COLUMN IF NOT EXISTS propiedad_activos        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS energia_reactiva_ind_tot DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS energia_reactiva_cap_tot DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS energia_reactiva_ind_pen DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS energia_reactiva_cap_pen DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS factor_m                 DECIMAL(10, 4);

-- 3c) Índices nuevos para consultas de conciliación.
CREATE INDEX IF NOT EXISTS idx_facturacion_periodo_frontera
  ON registros_facturacion (periodo_id, codigo_frontera);

CREATE INDEX IF NOT EXISTS idx_facturacion_nivel_propiedad
  ON registros_facturacion (nivel_tension, propiedad_activos)
  WHERE nivel_tension IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 4) Verificación post-aplicación
--    Ejecutá esta query al final para confirmar que las columnas
--    críticas existen.
-- ────────────────────────────────────────────────────────────────

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'registros_facturacion'
  AND column_name IN (
    'g_bolsa_bia',
    'nt_raw',
    'nivel_tension',
    'propiedad_activos',
    'energia_reactiva_ind_tot',
    'energia_reactiva_cap_tot',
    'energia_reactiva_ind_pen',
    'energia_reactiva_cap_pen',
    'factor_m'
  )
ORDER BY column_name;

-- Debería retornar 9 filas. Si retorna menos, hay un problema.

SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'contingencias'
  AND column_name = 'costo_estimado_cop';

-- Debería retornar 1 fila.
