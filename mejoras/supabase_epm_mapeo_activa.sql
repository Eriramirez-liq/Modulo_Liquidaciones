-- ================================================================
-- Migration: EPM — mapeo SDL del archivo de ACTIVA
--
-- EPM envia 2 archivos por periodo en momentos distintos (activa y
-- reactiva). Se cargan por separado con la accion "agregar" (igual que
-- EEP Pereira). El preprocessor preEpm (lib/parsers/sdl.ts) detecta el
-- tipo de archivo por sus headers.
--
-- Archivo de ACTIVA: headers en fila 13, datos desde fila 14
-- (fila_inicio: 14). Mapeo:
--   - Código SIC                 -> codigo_frontera
--   - Instalación                -> nombre_frontera
--   - ENERGÍA Activa SDL (KW)    -> energia_kwh
--   - INGRESO Activa SDL($)      -> valor_cop
--   - Cargo por Uso($/KWh)       -> tarifa_sdl
--   - Nivel de Tensión           -> nivel_tension (celda combinada;
--       preEpm hace forward-fill y extrae el numero: "nivel 2" -> "2")
--
-- Las filas de subtotal ("Total por nivel de tensión (nivel 1): ...")
-- no tienen Código SIC y el parser principal las salta solo.
--
-- Archivo de REACTIVA: pendiente de mapear.
--
-- Idempotente: sobreescribe el mapeo si ya existe.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = '{
  "tipo_archivo": "xlsx",
  "hoja": 0,
  "fila_inicio": 14,
  "separador_csv": ",",
  "columnas": {
    "codigo_frontera": "Código SIC",
    "nombre_frontera": "Instalación",
    "energia_kwh": "ENERGÍA Activa SDL (KW)",
    "valor_cop": "INGRESO Activa SDL($)",
    "tarifa_sdl": "Cargo por Uso($/KWh)",
    "periodo": null,
    "nivel_tension": "Nivel de Tensión",
    "propiedad_activos": null,
    "energia_reactiva_ind_pen": null,
    "energia_reactiva_cap_pen": null,
    "valor_reactiva_cop": null,
    "tarifa_reactiva": null,
    "factor_m": null
  }
}'::jsonb,
"updatedAt" = now()
WHERE codigo = 'EPM';
