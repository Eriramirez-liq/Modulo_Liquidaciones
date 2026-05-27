-- ================================================================
-- Migration: CHEC — split de frontera + tarifa_reactiva
--
-- Cambios al mapeo SDL de CHEC:
-- 1. codigo_frontera_split = "-"
--    La columna FRONTERA del archivo trae "Frt59357-ALTIPAL".
--    El parser debe extraer "Frt59357" como codigo_frontera y
--    "ALTIPAL" como nombre_frontera (cuando no hay otra columna
--    mapeada para nombre, el parser usa la parte posterior al split).
-- 2. tarifa_reactiva = "CARGO REACTIVO"
--    Faltaba el binding; el parser ya soporta tarifa_reactiva.
--
-- Idempotente: si los keys ya existen los sobreescribe.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = jsonb_set(
      jsonb_set(
        mapeo_sdl_json,
        '{columnas,tarifa_reactiva}',
        '"CARGO REACTIVO"'::jsonb,
        true
      ),
      '{codigo_frontera_split}',
      '"-"'::jsonb,
      true
    ),
    "updatedAt" = now()
WHERE codigo = 'CHEC';
