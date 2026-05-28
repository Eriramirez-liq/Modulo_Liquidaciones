-- ================================================================
-- Migration: ENEL — activar multi-archivo + mapear columnas
--
-- ENEL envia 2 archivos por periodo que se combinan por CODIGO SIC:
--   1. Preliquidacion consumos:
--      - CODIGO SIC               -> codigo_frontera
--      - NOMBRE CUENTA CONTRATO   -> nombre_frontera
--      - CONSUMO ACTIVA           -> energia_kwh
--      - VALOR SDL ACT            -> valor_cop
--      - VALOR SDL REAC           -> valor_reactiva_cop
--      - NIVEL TENSION            -> nivel_tension
--   2. Informe energia reactiva:
--      - CODIGO SIC               -> codigo_frontera (JOIN)
--      - FACTOR M                 -> factor_m
--      - EXCESO_REACTIVA_INDUCTIVA  -> energia_reactiva_ind_pen
--      - EXCESO_REACTIVA_CAPACITIVA -> energia_reactiva_cap_pen
--
-- El parser usa procesarEnelMulti (analogo a EMSA) que detecta el tipo de
-- cada archivo por sus headers.
--
-- Cambios al jsonb:
-- - Agregar multi_archivos = true (activa la UI multi-file en wizard).
-- - Actualizar columnas.energia_reactiva_ind_pen -> 'EXCESO_REACTIVA_INDUCTIVA'
--   (antes era 'CONSUMO REACTIVA' del archivo de Preliquidacion).
-- - Agregar columnas.energia_reactiva_cap_pen -> 'EXCESO_REACTIVA_CAPACITIVA'.
-- - Agregar columnas.factor_m -> 'FACTOR M'.
-- - Agregar columnas.nombre_frontera -> 'NOMBRE CUENTA CONTRATO'.
--
-- Idempotente.
-- ================================================================

UPDATE configuracion_or
SET mapeo_sdl_json = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                mapeo_sdl_json,
                '{multi_archivos}',
                'true'::jsonb,
                true
              ),
              '{columnas,nombre_frontera}',
              '"NOMBRE CUENTA CONTRATO"'::jsonb,
              true
            ),
            '{columnas,energia_reactiva_ind_pen}',
            '"EXCESO_REACTIVA_INDUCTIVA"'::jsonb,
            true
          ),
          '{columnas,energia_reactiva_cap_pen}',
          '"EXCESO_REACTIVA_CAPACITIVA"'::jsonb,
          true
        ),
        '{columnas,factor_m}',
        '"FACTOR M"'::jsonb,
        true
      ),
      '{columnas,nombre_frontera}',
      '"NOMBRE CUENTA CONTRATO"'::jsonb,
      true
    ),
    "updatedAt" = now()
WHERE codigo = 'ENEL';
