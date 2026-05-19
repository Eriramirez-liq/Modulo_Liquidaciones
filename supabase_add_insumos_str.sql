-- ================================================================
-- Migration: Add INSUMOS_STR enum value + registros_str table
-- Run this in Supabase SQL editor after schema changes.
-- ================================================================

-- 1. Add INSUMOS_STR to TipoFuente enum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'INSUMOS_STR'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'TipoFuente')
  ) THEN
    ALTER TYPE "TipoFuente" ADD VALUE 'INSUMOS_STR';
  END IF;
END $$;

-- 2. Create registros_str table
CREATE TABLE IF NOT EXISTS registros_str (
  id            TEXT PRIMARY KEY,
  carga_id      TEXT NOT NULL,
  periodo_id    TEXT NOT NULL,
  or_id         TEXT NOT NULL,
  mes_consumo   TEXT NOT NULL,
  valor_cop     DECIMAL(18, 2) NOT NULL,
  detalle_json  JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_str_periodo
    FOREIGN KEY (periodo_id) REFERENCES periodos_conciliacion(id),
  CONSTRAINT fk_str_or
    FOREIGN KEY (or_id) REFERENCES configuracion_or(id)
);

CREATE INDEX IF NOT EXISTS idx_str_periodo   ON registros_str(periodo_id);
CREATE INDEX IF NOT EXISTS idx_str_or        ON registros_str(or_id);
CREATE INDEX IF NOT EXISTS idx_str_mes       ON registros_str(mes_consumo);
CREATE INDEX IF NOT EXISTS idx_str_carga     ON registros_str(carga_id);
