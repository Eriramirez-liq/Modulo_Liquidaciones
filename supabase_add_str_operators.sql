-- ================================================================
-- Migration: Insert 6 operators used ONLY for Cargos STR.
--
-- Estos operadores no tienen mapeo SDL configurado (no se cargan
-- archivos SDL para ellos), pero existen como ConfiguracionOR para
-- que los registros_str puedan referenciarlos por FK.
-- ================================================================

INSERT INTO configuracion_or (id, codigo, nombre, activo, mapeo_sdl_json, mapeo_balance_json, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'BAJO_PUTUMAYO',   'Bajo Putumayo',   true, NULL, NULL, now(), now()),
  (gen_random_uuid()::text, 'DISPAC',          'Dispac',           true, NULL, NULL, now(), now()),
  (gen_random_uuid()::text, 'ELECTROCAQUETA',  'Electrocaquetá',  true, NULL, NULL, now(), now()),
  (gen_random_uuid()::text, 'ENELAR',          'Enelar',           true, NULL, NULL, now(), now()),
  (gen_random_uuid()::text, 'ENERGUAVIARE',    'Energuaviare',     true, NULL, NULL, now(), now()),
  (gen_random_uuid()::text, 'PUTUMAYO',        'Putumayo',         true, NULL, NULL, now(), now())
ON CONFLICT (codigo) DO UPDATE SET
  nombre      = EXCLUDED.nombre,
  activo      = EXCLUDED.activo,
  "updatedAt" = now();
