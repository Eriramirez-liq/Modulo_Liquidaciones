-- ================================================================
-- Migration: ESSA — mapear tarifa_reactiva
--
-- El archivo SDL de ESSA trae la columna "TARIFA REACTIVA" con el valor
-- explicito por frontera. Faltaba el binding al campo tarifa_reactiva
-- del parser (el preprocessor preEssa no la toca, asi que el parser la
-- lee directo del mapeo).
--
-- Idempotente.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = jsonb_set(
      mapeo_sdl_json,
      '{columnas,tarifa_reactiva}',
      '"TARIFA REACTIVA"'::jsonb,
      true
    ),
    "updatedAt" = now()
WHERE codigo = 'ESSA';
