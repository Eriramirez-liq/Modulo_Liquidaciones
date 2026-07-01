-- Modulo Gestiones: accionables por frontera con diferencia de conciliacion.
-- Se aplica MANUALMENTE en Supabase (no via `prisma migrate`).
--
-- Crea 2 enums (ConceptoGestion, AccionGestion) y la tabla gestiones_frontera
-- con su unique (periodo_id, concepto, codigo_frontera) e indice por
-- (periodo_id, concepto). Sin foreign keys (campos planos), igual que
-- resultados_conciliacion_tc1.
--
-- Idempotente: CREATE TYPE no soporta IF NOT EXISTS, por eso se envuelve en
-- un bloque DO que ignora duplicate_object; el resto usa IF NOT EXISTS.
--
-- Rollback:
--   DROP TABLE IF EXISTS "gestiones_frontera";
--   DROP TYPE  IF EXISTS "AccionGestion";
--   DROP TYPE  IF EXISTS "ConceptoGestion";
-- (No hay dependencias externas hacia esta tabla, el rollback es seguro.)

-- 1) Enums (idempotentes via EXCEPTION duplicate_object)
DO $$ BEGIN
  CREATE TYPE "ConceptoGestion" AS ENUM ('SDL', 'TC1', 'COT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AccionGestion" AS ENUM (
    'CAMBIO_SOLICITADO_OR',
    'AJUSTE_NO_PROCEDE',
    'ERROR_BIA',
    'AJUSTE_APLICADO'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2) Tabla
CREATE TABLE IF NOT EXISTS "gestiones_frontera" (
  "id"                TEXT NOT NULL,
  "periodo_id"        TEXT NOT NULL,
  "concepto"          "ConceptoGestion" NOT NULL,
  "codigo_frontera"   TEXT NOT NULL,
  "or_id"             TEXT,
  "accion"            "AccionGestion" NOT NULL,
  "datos_ajustados"   TEXT[] NOT NULL DEFAULT '{}',
  "observacion"       TEXT,
  "gestionado_por_id" TEXT,
  "gestionado_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gestiones_frontera_pkey" PRIMARY KEY ("id")
);

-- 3) Unique (periodo_id, concepto, codigo_frontera): un accionable por frontera/concepto
CREATE UNIQUE INDEX IF NOT EXISTS "uq_gestion_periodo_concepto_frontera"
  ON "gestiones_frontera" ("periodo_id", "concepto", "codigo_frontera");

-- 4) Indice de lectura por periodo + concepto (query del GET)
CREATE INDEX IF NOT EXISTS "gestiones_frontera_periodo_id_concepto_idx"
  ON "gestiones_frontera" ("periodo_id", "concepto");
