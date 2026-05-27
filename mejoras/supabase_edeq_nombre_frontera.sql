-- ================================================================
-- Migration: EDEQ — mapear nombre_frontera
--
-- El archivo SDL de EDEQ trae la columna "DESCRIPCIÓN CLIENTE" con el
-- nombre/descripcion de cada frontera. Faltaba el binding al campo
-- nombre_frontera del parser.
--
-- Idempotente.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = jsonb_set(
      mapeo_sdl_json,
      '{columnas,nombre_frontera}',
      '"DESCRIPCIÓN CLIENTE"'::jsonb,
      true
    ),
    "updatedAt" = now()
WHERE codigo = 'EDEQ';
