-- ================================================================
-- Seed: Operadores de Red con configuración SDL
-- Total: 21 operadores
-- Excluidos: CARTAGO (consolidado en EEP_CARTAGO), EEP (consolidado)
-- Estado:
--   validado: AFINIA, AIRE(*), CEDENAR, CELSIA_TOLIMA, CELSIA_VALLE, CENS,
--             CEO, CETSA, CHEC, EBSA, EDEQ, EEP_CARTAGO, EEP_PEREIRA,
--             EMSA, ESSA, RUITOQUE
--   (*) AIRE: mapeo_sdl_json=NULL es correcto — usa MAPEO_SDL_DEFAULT +
--       preprocessor propio (reactiva calculada, NT normalizado, propiedad)
--   configurado (pendiente prueba): ENEL
--   pendiente mapeo SDL: ELECTROHUILA, EMCALI, ENERCA, EPM
-- ================================================================

INSERT INTO configuracion_or (id, codigo, nombre, activo, mapeo_sdl_json, mapeo_balance_json, "createdAt", "updatedAt")
VALUES
-- AFINIA: validado con archivo
(gen_random_uuid()::text, 'AFINIA', 'Afinia', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 2, "separador_csv": ",", "columnas": {"codigo_frontera": "SIC", "energia_kwh": "CONSUMO", "valor_cop": "PEAJES REGIONALES REGULADOS OTROS", "periodo": null, "nivel_tension": "NIVEL TENSION", "propiedad_activos": "PROPIEDAD", "energia_reactiva_ind_pen": "ENERGIA REACTIVA PEAJES", "energia_reactiva_cap_pen": null, "valor_reactiva_cop": "PEN. ENERGIA REACTIVA PEAJES", "factor_m": "M"}}'::jsonb, NULL, now(), now()),
-- AIRE: validado con archivo (mapeo=NULL intencional; usa default+preprocessor)
(gen_random_uuid()::text, 'AIRE', 'Aire', true, NULL, NULL, now(), now()),
-- CEDENAR: validado con archivo
(gen_random_uuid()::text, 'CEDENAR', 'Cedenar', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 2, "separador_csv": ",", "columnas": {"codigo_frontera": "CODIGO SIC", "energia_kwh": "Activa", "valor_cop": "VALOR TARIFA", "periodo": null, "nivel_tension": "NIVEL DE TENSION", "propiedad_activos": null, "energia_reactiva_ind_pen": "Penalizada", "energia_reactiva_cap_pen": null, "valor_reactiva_cop": null, "factor_m": null}}'::jsonb, NULL, now(), now()),
-- CELSIA_TOLIMA: validado con archivo
(gen_random_uuid()::text, 'CELSIA_TOLIMA', 'Celsia Tolima', true, '{"tipo_archivo": "csv", "hoja": 0, "fila_inicio": 2, "separador_csv": ";", "columnas": {"codigo_frontera": "C?igo SIC", "energia_kwh": "Activa KWh", "valor_cop": "$Peaje Activa", "periodo": null, "nivel_tension": "Nivel Tensi?", "propiedad_activos": "Propiedad Activo", "energia_reactiva_ind_pen": "Reactiva Inductiva Penalizada kVAr", "energia_reactiva_cap_pen": "Reactiva Capacitiva Penal kVAr", "valor_reactiva_cop": "$Peaje Reactiva", "factor_m": "Factor M"}}'::jsonb, NULL, now(), now()),
-- CELSIA_VALLE: validado con archivo
(gen_random_uuid()::text, 'CELSIA_VALLE', 'Celsia Valle', true, '{"tipo_archivo": "csv", "hoja": 0, "fila_inicio": 2, "separador_csv": ";", "columnas": {"codigo_frontera": "C?igo SIC", "energia_kwh": "Activa KWh", "valor_cop": "$Peaje Activa", "periodo": null, "nivel_tension": "Nivel Tensi?", "propiedad_activos": "Propiedad Activo", "energia_reactiva_ind_pen": "Reactiva Inductiva Penalizada kVAr", "energia_reactiva_cap_pen": "Reactiva Capacitiva Penal kVAr", "valor_reactiva_cop": " $Peaje Reactiva ", "factor_m": "Factor M"}}'::jsonb, NULL, now(), now()),
-- CENS: validado con archivo
(gen_random_uuid()::text, 'CENS', 'Cens', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 2, "separador_csv": ",", "columnas": {"codigo_frontera": "Código SIC", "energia_kwh": "Activa", "valor_cop": "Valor Activa", "periodo": null, "nivel_tension": "NT_PRO", "propiedad_activos": null, "energia_reactiva_ind_pen": "R_Inductiva", "energia_reactiva_cap_pen": "R_Capacitiva", "valor_reactiva_cop": "Valor R_Inductiva", "factor_m": "Factor M"}}'::jsonb, NULL, now(), now()),
-- CEO: validado con archivo
(gen_random_uuid()::text, 'CEO', 'CEO', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 2, "separador_csv": ",", "columnas": {"codigo_frontera": "Código SIC", "energia_kwh": "Activa KWh", "valor_cop": "$ Peaje Activa", "periodo": "Periodo", "nivel_tension": "Nivel Tensión", "propiedad_activos": "Propiedad Activo", "energia_reactiva_ind_pen": "Reactiva Inductiva Penal kVAr", "energia_reactiva_cap_pen": null, "valor_reactiva_cop": "$ Peaje Reactiva", "tarifa_reactiva": "Tarifa Reactiva $/kVAr", "factor_m": "Factor_m"}}'::jsonb, NULL, now(), now()),
-- CETSA: validado con archivo
(gen_random_uuid()::text, 'CETSA', 'Cetsa', true, '{"tipo_archivo": "csv", "hoja": 0, "fila_inicio": 2, "separador_csv": ";", "columnas": {"codigo_frontera": "C?igo SIC", "energia_kwh": "Activa KWh", "valor_cop": "$Peaje Activa", "periodo": null, "nivel_tension": "Nivel Tensi?", "propiedad_activos": "Propiedad Activo", "energia_reactiva_ind_pen": "Reactiva Inductiva Penalizada kVAr", "energia_reactiva_cap_pen": "Reactiva Capacitiva Penal kVAr", "valor_reactiva_cop": "$Peaje Reactiva", "factor_m": "Factor M"}}'::jsonb, NULL, now(), now()),
-- CHEC: validado con archivo
(gen_random_uuid()::text, 'CHEC', 'Chec', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 2, "separador_csv": ",", "columnas": {"codigo_frontera": "FRONTERA", "energia_kwh": "ENERGIA ACTIVA", "valor_cop": "LIQUIDACION ACTIVA", "periodo": null, "nivel_tension": "NIVEL TENSION", "propiedad_activos": null, "energia_reactiva_ind_pen": "TOTAL ENERGIA REACTIVA", "energia_reactiva_cap_pen": null, "valor_reactiva_cop": "LIQUIDACION REACTIVA", "tarifa_reactiva": "CARGO REACTIVO", "factor_m": "FACTOR M"}, "codigo_frontera_split": "-"}'::jsonb, NULL, now(), now()),
-- EBSA: validado con archivo
(gen_random_uuid()::text, 'EBSA', 'EBSA', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 2, "separador_csv": ",", "columnas": {"codigo_frontera": "CODIGO SIC", "energia_kwh": "KW-H", "valor_cop": "VALOR", "periodo": "PERIODO", "nivel_tension": "NT", "propiedad_activos": null, "energia_reactiva_ind_pen": "REACTIVA", "energia_reactiva_cap_pen": null, "valor_reactiva_cop": null, "factor_m": "VALOR M"}}'::jsonb, NULL, now(), now()),
-- EDEQ: validado con archivo
(gen_random_uuid()::text, 'EDEQ', 'Edeq', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 2, "separador_csv": ",", "columnas": {"codigo_frontera": "CODIGO SIC", "energia_kwh": "Energía Activa", "valor_cop": "Valor Activa", "periodo": null, "nivel_tension": "Nivel de Tensión  de la Frontera", "propiedad_activos": "Propiedad", "energia_reactiva_ind_pen": "Energía Reactiva Inductiva Penalizada", "energia_reactiva_cap_pen": "Energía Reactiva Capacitiva Penalizada", "valor_reactiva_cop": "Valor Reactiva Inductiva Penalizada", "factor_m": "Factor M (Energia Reactiva )"}}'::jsonb, NULL, now(), now()),
-- EEP_CARTAGO: validado con archivo
(gen_random_uuid()::text, 'EEP_CARTAGO', 'EEP Cartago', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 3, "separador_csv": ",", "columnas": {"codigo_frontera": "SIC", "energia_kwh": "Energía Activa ", "valor_cop": "Valor $ Activa", "periodo": null, "nivel_tension": "Nivel Tension", "propiedad_activos": null, "energia_reactiva_ind_pen": "Energía Reactiva Inductiva", "energia_reactiva_cap_pen": "Energía Reactiva Capacitiva", "valor_reactiva_cop": "Valor $ Reactiva Inductiva", "factor_m": "Factor M"}}'::jsonb, NULL, now(), now()),
-- EEP_PEREIRA: validado con archivo
(gen_random_uuid()::text, 'EEP_PEREIRA', 'EEP Pereira', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 3, "separador_csv": ",", "columnas": {"codigo_frontera": "SIC", "energia_kwh": "Energía Activa ", "valor_cop": "Valor $ Activa", "periodo": null, "nivel_tension": "Nivel Tension", "propiedad_activos": null, "energia_reactiva_ind_pen": "Energía Reactiva Inductiva", "energia_reactiva_cap_pen": "Energía Reactiva Capacitiva", "valor_reactiva_cop": "Valor $ Reactiva Inductiva", "factor_m": "Factor M"}}'::jsonb, NULL, now(), now()),
-- ELECTROHUILA: pendiente mapeo SDL
(gen_random_uuid()::text, 'ELECTROHUILA', 'Electrohuila', true, NULL, NULL, now(), now()),
-- EMCALI: pendiente mapeo SDL
(gen_random_uuid()::text, 'EMCALI', 'Emcali', true, NULL, NULL, now(), now()),
-- EMSA: validado con archivo
(gen_random_uuid()::text, 'EMSA', 'Emsa', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 2, "separador_csv": ",", "columnas": {"codigo_frontera": "CODIGO", "energia_kwh": "kWhR", "valor_cop": null, "periodo": null, "nivel_tension": null, "propiedad_activos": null, "energia_reactiva_ind_pen": null, "energia_reactiva_cap_pen": null, "valor_reactiva_cop": null, "tarifa_reactiva": null, "tarifa_sdl": null, "factor_m": null, "codigo_frontera_split": null}, "multi_archivos": true}'::jsonb, NULL, now(), now()),
-- ENEL: configurado — pendiente cargar archivo de prueba
(gen_random_uuid()::text, 'ENEL', 'Enel', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 2, "separador_csv": ",", "columnas": {"codigo_frontera": "CODIGO SIC", "energia_kwh": "CONSUMO ACTIVA", "valor_cop": "VALOR SDL ACT", "periodo": null, "nivel_tension": "NIVEL TENSION", "propiedad_activos": null, "energia_reactiva_ind_pen": "CONSUMO REACTIVA", "energia_reactiva_cap_pen": null, "valor_reactiva_cop": "VALOR SDL REAC", "factor_m": null}}'::jsonb, NULL, now(), now()),
-- ENERCA: pendiente mapeo SDL
(gen_random_uuid()::text, 'ENERCA', 'Enerca', true, NULL, NULL, now(), now()),
-- EPM: pendiente mapeo SDL
(gen_random_uuid()::text, 'EPM', 'EPM', true, NULL, NULL, now(), now()),
-- ESSA: validado con archivo
(gen_random_uuid()::text, 'ESSA', 'ESSA', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 5, "separador_csv": ",", "columnas": {"codigo_frontera": "CODIGO SIC", "energia_kwh": "DEFINITIVO", "valor_cop": "PEAJE ACTIVA", "periodo": null, "nivel_tension": "NIVEL TENSION", "propiedad_activos": "PROPIEDAD", "energia_reactiva_ind_pen": "REACTIVA PENALIZADA", "energia_reactiva_cap_pen": "CAPACITIVA PENALIZADA", "valor_reactiva_cop": "PEAJE INDUCTIVA", "factor_m": "M DIC"}}'::jsonb, NULL, now(), now()),
-- RUITOQUE: validado con archivo
(gen_random_uuid()::text, 'RUITOQUE', 'Ruitoque', true, '{"tipo_archivo": "xlsx", "hoja": 0, "fila_inicio": 7, "separador_csv": ",", "columnas": {"codigo_frontera": "Código SIC", "energia_kwh": "Activa", "valor_cop": "Valor Activa", "periodo": null, "nivel_tension": "NT", "propiedad_activos": null, "energia_reactiva_ind_pen": "R_Inductiva Penalizada", "energia_reactiva_cap_pen": "R_Capacitiva Penalizada", "valor_reactiva_cop": "Valor R_Inductiva", "factor_m": "Factor M"}}'::jsonb, NULL, now(), now())
ON CONFLICT (codigo) DO UPDATE SET
  nombre             = EXCLUDED.nombre,
  activo             = EXCLUDED.activo,
  mapeo_sdl_json     = EXCLUDED.mapeo_sdl_json,
  mapeo_balance_json = EXCLUDED.mapeo_balance_json,
  "updatedAt"        = now();
