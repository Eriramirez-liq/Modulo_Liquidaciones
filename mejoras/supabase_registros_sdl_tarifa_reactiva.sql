-- ================================================================
-- Migration: registros_sdl — agregar columna tarifa_reactiva
--
-- El parser SDL ya extrae tarifa_reactiva (ej. CHEC = 'CARGO REACTIVO',
-- CEO = 'Tarifa Reactiva $/kVAr') pero la tabla no tenia la columna,
-- por lo que el INSERT del confirmar de cargas fallaba con
-- PrismaClientValidationError.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ================================================================

ALTER TABLE registros_sdl
  ADD COLUMN IF NOT EXISTS tarifa_reactiva DECIMAL(18, 6);
