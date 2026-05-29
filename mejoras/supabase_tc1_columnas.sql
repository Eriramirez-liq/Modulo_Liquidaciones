-- ================================================================
-- Migration: registros_tc1 — columnas para carga y conciliacion TC1
--
-- El modulo TC1 carga el archivo de configuracion tecnica por OR, filtra
-- por ID_COMERCIALIZADOR = 62371, mapea las columnas conocidas y concilia
-- contra Facturacion (nivel_tension y propiedad_activos).
--
-- Columnas nuevas:
--   - or_id              : OR al que pertenece la carga.
--   - propiedad_activos  : derivado de PORC_PROPIEDAD_DEL_ACTIVO
--                          (0/101 -> USUARIO, 50 -> COMPARTIDO, 100 -> OR).
--   - detalle_json       : todas las columnas conocidas del archivo (JSON),
--                          base para el futuro push a Metabase.
--
-- Idempotente.
-- ================================================================

ALTER TABLE registros_tc1
  ADD COLUMN IF NOT EXISTS or_id              TEXT,
  ADD COLUMN IF NOT EXISTS propiedad_activos  TEXT,
  ADD COLUMN IF NOT EXISTS detalle_json       JSONB;
