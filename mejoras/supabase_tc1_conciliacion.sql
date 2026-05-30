-- ================================================================
-- Migration: tabla resultados_conciliacion_tc1
--
-- Guarda el resultado de conciliar TC1 contra Facturacion. Solo se
-- concilian nivel de tension y propiedad de activos, cruzando por
-- codigo de frontera.
--
-- caso: SIN_DIFERENCIA | DIFERENCIA | INCOMPLETA
--
-- Idempotente.
-- ================================================================

CREATE TABLE IF NOT EXISTS resultados_conciliacion_tc1 (
  id                 TEXT PRIMARY KEY,
  periodo_id         TEXT NOT NULL,
  or_id              TEXT,
  codigo_frontera    TEXT NOT NULL,
  nombre_usuario     TEXT,
  operador_red       TEXT,
  nivel_tension_fac  TEXT,
  nivel_tension_tc1  TEXT,
  diff_nivel_tension BOOLEAN NOT NULL DEFAULT FALSE,
  propiedad_fac      TEXT,
  propiedad_tc1      TEXT,
  diff_propiedad     BOOLEAN NOT NULL DEFAULT FALSE,
  caso               TEXT NOT NULL,
  observaciones      TEXT,
  conciliado_por_id  TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tc1_periodo_frontera
  ON resultados_conciliacion_tc1 (periodo_id, codigo_frontera);

CREATE INDEX IF NOT EXISTS idx_tc1_periodo_or
  ON resultados_conciliacion_tc1 (periodo_id, or_id);
