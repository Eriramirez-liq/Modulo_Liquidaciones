-- ================================================================
-- Migration: tabla tarifas_sdl + enum INSUMOS_TARIFAS_SDL
--
-- Tarifas SDL calculadas a partir de los insumos (Cargos ADD + Uso de la
-- red). 5 filas por OR y periodo (NT1 OR/Compartido/Usuario, NT2 Usuario,
-- NT3 Usuario) con tarifa activa y reactiva.
--
-- Idempotente.
-- ================================================================

-- Nuevo valor del enum TipoFuente (para la fuente de carga de insumos).
ALTER TYPE "TipoFuente" ADD VALUE IF NOT EXISTS 'INSUMOS_TARIFAS_SDL';

CREATE TABLE IF NOT EXISTS tarifas_sdl (
  id                TEXT PRIMARY KEY,
  periodo           TEXT NOT NULL,            -- "AAAA-MM"
  or_codigo         TEXT NOT NULL,
  nivel_tension     TEXT NOT NULL,            -- 1 | 2 | 3
  propiedad_activos TEXT NOT NULL,            -- OR | COMPARTIDO | USUARIO
  tarifa_activa     DECIMAL(18, 6) NOT NULL,
  tarifa_reactiva   DECIMAL(18, 6) NOT NULL,
  carga_id          TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tarifa_sdl
  ON tarifas_sdl (periodo, or_codigo, nivel_tension, propiedad_activos);

CREATE INDEX IF NOT EXISTS idx_tarifa_sdl_periodo_or
  ON tarifas_sdl (periodo, or_codigo);
