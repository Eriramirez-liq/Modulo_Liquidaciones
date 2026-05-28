-- ================================================================
-- Migration: Limpiar registros huerfanos de cargas reemplazadas
--
-- Antes del fix de hoy, cuando una carga reemplazaba a otra:
-- - Se creaba una nueva CargaFuente con reemplaza_id apuntando a la vieja.
-- - Pero los RegistroXxx (SDL/FACTURACION/XM/BALANCE) de la vieja NO se
--   borraban. Quedaban como huerfanos.
-- - La conciliacion tomaba TODOS los registros del periodo + OR (incluidos
--   los huerfanos) lo que causaba duplicados y resultados ambiguos.
--
-- Este script identifica esas cargas reemplazadas y borra sus registros
-- derivados. Es idempotente: si no hay huerfanos, no hace nada.
--
-- NOTA importante: NO borra los huerfanos de EEP_PEREIRA donde la opcion
-- usada fue 'agregar' (esas cargas NO tienen reemplaza_id apuntandolas,
-- coexisten correctamente).
--
-- Pasos (ejecutar de a uno, revisando el resultado de cada SELECT antes
-- del DELETE correspondiente):
-- ================================================================

-- ── 1) Diagnostico: cuantos registros se afectarian ─────────────────────────

-- Cargas reemplazadas (ids cuya version "nueva" las apunta con reemplaza_id)
WITH cargas_reemplazadas AS (
  SELECT DISTINCT reemplaza_id AS carga_id
  FROM cargas_fuente
  WHERE reemplaza_id IS NOT NULL
)
SELECT
  'SDL'         AS tabla, COUNT(*) AS huerfanos FROM registros_sdl         WHERE carga_id IN (SELECT carga_id FROM cargas_reemplazadas)
UNION ALL
SELECT
  'FACTURACION' AS tabla, COUNT(*) AS huerfanos FROM registros_facturacion WHERE carga_id IN (SELECT carga_id FROM cargas_reemplazadas)
UNION ALL
SELECT
  'XM'          AS tabla, COUNT(*) AS huerfanos FROM registros_xm          WHERE carga_id IN (SELECT carga_id FROM cargas_reemplazadas)
UNION ALL
SELECT
  'BALANCE'     AS tabla, COUNT(*) AS huerfanos FROM registros_balance     WHERE carga_id IN (SELECT carga_id FROM cargas_reemplazadas);

-- ── 2) Borrado (descomentar y ejecutar despues de revisar el diagnostico) ──

/*
WITH cargas_reemplazadas AS (
  SELECT DISTINCT reemplaza_id AS carga_id
  FROM cargas_fuente
  WHERE reemplaza_id IS NOT NULL
)
DELETE FROM registros_sdl
WHERE carga_id IN (SELECT carga_id FROM cargas_reemplazadas);

WITH cargas_reemplazadas AS (
  SELECT DISTINCT reemplaza_id AS carga_id
  FROM cargas_fuente
  WHERE reemplaza_id IS NOT NULL
)
DELETE FROM registros_facturacion
WHERE carga_id IN (SELECT carga_id FROM cargas_reemplazadas);

WITH cargas_reemplazadas AS (
  SELECT DISTINCT reemplaza_id AS carga_id
  FROM cargas_fuente
  WHERE reemplaza_id IS NOT NULL
)
DELETE FROM registros_xm
WHERE carga_id IN (SELECT carga_id FROM cargas_reemplazadas);

WITH cargas_reemplazadas AS (
  SELECT DISTINCT reemplaza_id AS carga_id
  FROM cargas_fuente
  WHERE reemplaza_id IS NOT NULL
)
DELETE FROM registros_balance
WHERE carga_id IN (SELECT carga_id FROM cargas_reemplazadas);
*/

-- ── 3) Verificacion post-DELETE (deberia devolver 0 en todas las tablas) ──

-- WITH cargas_reemplazadas AS (
--   SELECT DISTINCT reemplaza_id AS carga_id FROM cargas_fuente WHERE reemplaza_id IS NOT NULL
-- )
-- SELECT 'SDL' AS tabla, COUNT(*) FROM registros_sdl WHERE carga_id IN (SELECT carga_id FROM cargas_reemplazadas)
-- UNION ALL ...;
