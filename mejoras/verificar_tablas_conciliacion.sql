-- ================================================================
-- Verificacion: tablas de conciliacion presentes en Supabase
--
-- Corre este script en el SQL editor de Supabase. Va a:
--   1) Listar las tablas relacionadas con conciliacion que existen
--   2) Si alguna falta, mostrarte cual
--
-- No hace ningun cambio destructivo.
-- ================================================================

WITH esperadas AS (
  SELECT unnest(ARRAY[
    'periodos_conciliacion',
    'resultados_conciliacion',
    'provisiones',
    'contingencias',
    'disputas',
    'cruces_balance',
    'registros_facturacion',
    'registros_xm',
    'registros_sdl',
    'registros_balance',
    'registros_tc1',
    'registros_cot',
    'registros_str',
    'configuracion_or',
    'log_auditoria',
    'users'
  ]) AS tabla
),
existentes AS (
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
)
SELECT
  e.tabla,
  CASE WHEN x.table_name IS NOT NULL THEN '✓ existe' ELSE '✗ FALTA' END AS estado
FROM esperadas e
LEFT JOIN existentes x ON x.table_name = e.tabla
ORDER BY estado DESC, e.tabla;
