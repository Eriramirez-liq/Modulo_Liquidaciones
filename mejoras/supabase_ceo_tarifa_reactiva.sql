-- ================================================================
-- Migration: CEO — agregar tarifa_reactiva al mapeo SDL
--
-- El archivo de preliquidacion de CEO trae la columna
-- "Tarifa Reactiva $/kVAr" pero el mapeo configurado no la capturaba
-- (el parser si la soporta, solo faltaba el binding).
--
-- Esto agrega la entrada al jsonb del mapeo dejando todo lo demas
-- igual. Idempotente: si el key ya existe lo sobreescribe.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = jsonb_set(
      mapeo_sdl_json,
      '{columnas,tarifa_reactiva}',
      '"Tarifa Reactiva $/kVAr"'::jsonb,
      true   -- create_missing
    ),
    "updatedAt" = now()
WHERE codigo = 'CEO';
