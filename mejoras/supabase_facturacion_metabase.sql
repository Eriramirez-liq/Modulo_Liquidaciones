-- ================================================================
-- Migration: Adapt registros_facturacion to Metabase data shape
--
-- Razon: Facturacion BIA ya no se carga por archivo. Ahora se consulta
-- directo a Metabase. Los datos que llegan tienen mas columnas (NT,
-- reactiva ind/cap, factor M) y menos otras (nombre_usuario, operador_red
-- pueden no venir; tarifas G/T/D/PR/R/C ya no son obligatorias).
-- ================================================================

-- 1) Hacer opcionales los campos que ya no son obligatorios
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

-- 2) Agregar columnas nuevas (NT + nivel + propiedad + reactiva + factor M)
ALTER TABLE registros_facturacion
  ADD COLUMN IF NOT EXISTS nt_raw                   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS nivel_tension            VARCHAR(5),
  ADD COLUMN IF NOT EXISTS propiedad_activos        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS energia_reactiva_ind_tot DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS energia_reactiva_cap_tot DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS energia_reactiva_ind_pen DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS energia_reactiva_cap_pen DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS factor_m                 DECIMAL(10, 4);

-- 3) Indices para futuras consultas de conciliacion
CREATE INDEX IF NOT EXISTS idx_facturacion_periodo_frontera
  ON registros_facturacion (periodo_id, codigo_frontera);

CREATE INDEX IF NOT EXISTS idx_facturacion_nivel_propiedad
  ON registros_facturacion (nivel_tension, propiedad_activos)
  WHERE nivel_tension IS NOT NULL;
