-- ================================================================
-- Migration: CENS — mapear tarifa_reactiva al archivo
--
-- El archivo SDL de CENS trae la columna "Tarifa Reactiva" con el valor
-- explicito por frontera. Antes el preprocessor la calculaba como
-- valor_reactiva / r_inductiva / factor_m, pero eso fallaba con
-- division por cero cuando r_inductiva = 0 (la frontera quedaba sin
-- tarifa reactiva aunque el archivo la traia).
--
-- Cambios:
-- - Mapeo: agregar tarifa_reactiva -> "Tarifa Reactiva" (binding directo).
-- - Preprocessor: ya no calcula tarifa_reactiva (se removio en codigo).
--
-- Idempotente.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = jsonb_set(
      mapeo_sdl_json,
      '{columnas,tarifa_reactiva}',
      '"Tarifa Reactiva"'::jsonb,
      true
    ),
    "updatedAt" = now()
WHERE codigo = 'CENS';
