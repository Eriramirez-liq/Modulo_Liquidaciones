-- ================================================================
-- Migration: Agregar g_bolsa_bia a registros_facturacion
--
-- Razon: las formulas de Perdida (casos B1 y B1-ext) usan la tarifa G
-- de bolsa, distinta de la G regular (g_bia). Ambas vienen de
-- Facturacion BIA. Esta columna almacena la G de bolsa.
-- ================================================================

ALTER TABLE registros_facturacion
  ADD COLUMN IF NOT EXISTS g_bolsa_bia DECIMAL(18, 6);
