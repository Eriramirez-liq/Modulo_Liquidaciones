-- ================================================================
-- Migration: ENERCA — mapeo SDL completo
--
-- Antes mapeo_sdl_json era NULL (ENERCA estaba pendiente). Esta
-- migracion configura el mapeo definitivo para que el wizard pueda
-- procesar el archivo SDL de ENERCA.
--
-- Archivo unico .xlsx, sheet 'Consumos Fronteras', headers en fila 4,
-- datos desde fila 5.
--
-- Mapeo de columnas:
--   - CODIGO SIC                  -> codigo_frontera
--   - NOMBRE FRONTERA             -> nombre_frontera
--   - TOTAL ACTIVA AENC           -> energia_kwh
--   - CONSUMO ACTIVA LIQUIDADO    -> valor_cop
--   - TARIFA SDL                  -> tarifa_sdl
--   - NT                          -> nivel_tension
--   - EXCESO REACTIVA             -> energia_reactiva_ind_pen
--   - EXCESO CAPACITIVA           -> energia_reactiva_cap_pen
--   - TARIFA Dm                   -> tarifa_reactiva
--   - FACTOR M                    -> factor_m
--
-- Logica especial en preprocessor preEnerca (lib/parsers/sdl.ts):
--   - propiedad_activos: NT=2 o 3 -> Usuario. NT=1: 'SI' -> Usuario,
--     'NO' -> OR.
--   - valor_reactiva_cop = REACTIVA EN EXCESO LIQUIDADO +
--     CAPACTIVA EN EXCESO LIQUIDADO.
--
-- Idempotente: si mapeo_sdl_json ya tiene otro valor, lo sobreescribe.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = '{
  "tipo_archivo": "xlsx",
  "hoja": 0,
  "fila_inicio": 5,
  "separador_csv": ",",
  "columnas": {
    "codigo_frontera": "CODIGO SIC",
    "nombre_frontera": "NOMBRE FRONTERA",
    "energia_kwh": "TOTAL ACTIVA AENC",
    "valor_cop": "CONSUMO ACTIVA LIQUIDADO",
    "tarifa_sdl": "TARIFA SDL",
    "periodo": null,
    "nivel_tension": "NT",
    "propiedad_activos": null,
    "energia_reactiva_ind_pen": "EXCESO REACTIVA",
    "energia_reactiva_cap_pen": "EXCESO CAPACITIVA",
    "valor_reactiva_cop": null,
    "tarifa_reactiva": "TARIFA Dm",
    "factor_m": "FACTOR M"
  }
}'::jsonb,
"updatedAt" = now()
WHERE codigo = 'ENERCA';
