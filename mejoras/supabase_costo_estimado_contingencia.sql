-- ================================================================
-- Migration: Agregar costo_estimado_cop a contingencias
--
-- Razon: las contingencias tienen energia_kwh pero no se valorizaban
-- hasta que el OR cobra. Ahora persistimos una estimacion al momento
-- de crear la contingencia: energia_kwh × tarifa_sdl. Esto permite
-- mostrar valor en el dashboard y en gestiones.
-- ================================================================

ALTER TABLE contingencias
  ADD COLUMN IF NOT EXISTS costo_estimado_cop DECIMAL(18, 2);
