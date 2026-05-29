-- ================================================================
-- Migration: ESSA — mapear tarifa_reactiva y tarifa_sdl
--
-- El archivo SDL de ESSA trae las columnas "TARIFA REACTIVA" y
-- "TARIFA ACTIVA" con el valor explicito por frontera. Faltaban los
-- bindings (el preprocessor preEssa no las toca; el parser las lee
-- directo del mapeo). tarifa_sdl antes se calculaba como valor/energia;
-- ahora se toma del archivo.
--
-- Idempotente.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = jsonb_set(
      jsonb_set(
        mapeo_sdl_json,
        '{columnas,tarifa_reactiva}',
        '"TARIFA REACTIVA"'::jsonb,
        true
      ),
      '{columnas,tarifa_sdl}',
      '"TARIFA ACTIVA"'::jsonb,
      true
    ),
    "updatedAt" = now()
WHERE codigo = 'ESSA';
