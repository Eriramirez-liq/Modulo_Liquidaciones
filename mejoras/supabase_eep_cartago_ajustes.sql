-- ================================================================
-- Migration: EEP_CARTAGO — agregar 3 bindings al mapeo SDL
--
-- 1. nombre_frontera = "Cliente"
--    Faltaba traer el nombre/descripcion de la frontera.
-- 2. tarifa_sdl = "Tarifa Activa"
--    El archivo trae la tarifa activa explicita, no hay que calcularla
--    con valor/energia. El parser respeta el binding si esta definido.
-- 3. tarifa_reactiva = "Tarifa Reactiva"
--    El archivo trae la tarifa reactiva explicita en una columna.
--
-- Idempotente: jsonb_set con create_missing=true.
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
WHERE codigo = 'EEP_CARTAGO';
