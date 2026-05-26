-- ================================================================
-- Migration: Indicadores extendidos en resultados_conciliacion
--
-- Razon: el motor ahora concilia 6 indicadores por frontera:
--   1. ACTIVA            (ya existia: e_fac, e_xm, e_sdl, caso)
--   2. INDUCTIVA         (energia reactiva ind. penalizada fac vs sdl)
--   3. CAPACITIVA        (energia reactiva cap. penalizada fac vs sdl)
--   4. FACTOR M          (entero 1-12, fac vs sdl)
--   5. NIVEL TENSION     (string fac vs sdl)
--   6. PROPIEDAD ACTIVOS (string fac vs sdl)
--
-- Por cada indicador se guarda el valor de Facturacion, el valor del OR,
-- el delta (cuando aplica) y un flag boolean diff_* que marca si hay
-- diferencia segun la regla del indicador.
-- ================================================================

ALTER TABLE resultados_conciliacion
  -- INDUCTIVA
  ADD COLUMN IF NOT EXISTS ind_pen_fac            DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS ind_pen_sdl            DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS ind_pen_delta          DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS diff_inductiva         BOOLEAN NOT NULL DEFAULT FALSE,
  -- CAPACITIVA
  ADD COLUMN IF NOT EXISTS cap_pen_fac            DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS cap_pen_sdl            DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS cap_pen_delta          DECIMAL(18, 6),
  ADD COLUMN IF NOT EXISTS diff_capacitiva        BOOLEAN NOT NULL DEFAULT FALSE,
  -- FACTOR M
  ADD COLUMN IF NOT EXISTS factor_m_fac           DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS factor_m_sdl           DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS diff_factor_m          BOOLEAN NOT NULL DEFAULT FALSE,
  -- NIVEL TENSION
  ADD COLUMN IF NOT EXISTS nivel_tension_fac      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS nivel_tension_sdl      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS diff_nivel_tension     BOOLEAN NOT NULL DEFAULT FALSE,
  -- PROPIEDAD ACTIVOS
  ADD COLUMN IF NOT EXISTS propiedad_activos_fac  VARCHAR(40),
  ADD COLUMN IF NOT EXISTS propiedad_activos_sdl  VARCHAR(40),
  ADD COLUMN IF NOT EXISTS diff_propiedad         BOOLEAN NOT NULL DEFAULT FALSE;

-- Indices opcionales para acelerar consultas por indicador
-- (uno por flag, partial index para solo filas con diff = true)
CREATE INDEX IF NOT EXISTS idx_rc_diff_inductiva
  ON resultados_conciliacion (periodo_id) WHERE diff_inductiva = TRUE;
CREATE INDEX IF NOT EXISTS idx_rc_diff_capacitiva
  ON resultados_conciliacion (periodo_id) WHERE diff_capacitiva = TRUE;
CREATE INDEX IF NOT EXISTS idx_rc_diff_factor_m
  ON resultados_conciliacion (periodo_id) WHERE diff_factor_m = TRUE;
CREATE INDEX IF NOT EXISTS idx_rc_diff_nivel_tension
  ON resultados_conciliacion (periodo_id) WHERE diff_nivel_tension = TRUE;
CREATE INDEX IF NOT EXISTS idx_rc_diff_propiedad
  ON resultados_conciliacion (periodo_id) WHERE diff_propiedad = TRUE;
