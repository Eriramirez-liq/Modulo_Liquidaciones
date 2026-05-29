-- ================================================================
-- Migration: RUITOQUE — mapear tarifa_sdl y tarifa_reactiva
--
-- El archivo SDL de Ruitoque trae las columnas "Tarifa Activa" y
-- "Tarifa Reactiva" con el valor explicito por frontera. Faltaban los
-- bindings (el preprocessor preRuitoque no las toca; el parser las lee
-- directo del mapeo). tarifa_sdl antes se calculaba como valor/energia;
-- ahora se toma del archivo.
--
-- Idempotente.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = jsonb_set(
      jsonb_set(
        mapeo_sdl_json,
        '{columnas,tarifa_sdl}',
        '"Tarifa Activa"'::jsonb,
        true
      ),
      '{columnas,tarifa_reactiva}',
      '"Tarifa Reactiva"'::jsonb,
      true
    ),
    "updatedAt" = now()
WHERE codigo = 'RUITOQUE';
