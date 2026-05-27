-- ================================================================
-- Migration: EEP_PEREIRA — mismos 3 bindings que EEP_CARTAGO
--
-- El archivo de EEP Pereira tiene el mismo formato que EEP Cartago.
--
-- 1. nombre_frontera = "Cliente"
-- 2. tarifa_sdl      = "Tarifa Activa"   (no calcular valor/energia)
-- 3. tarifa_reactiva = "Tarifa Reactiva"
--
-- Idempotente.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = jsonb_set(
      jsonb_set(
        jsonb_set(
          mapeo_sdl_json,
          '{columnas,nombre_frontera}',
          '"Cliente"'::jsonb,
          true
        ),
        '{columnas,tarifa_sdl}',
        '"Tarifa Activa"'::jsonb,
        true
      ),
      '{columnas,tarifa_reactiva}',
      '"Tarifa Reactiva"'::jsonb,
      true
    ),
    "updatedAt" = now()
WHERE codigo = 'EEP_PEREIRA';
