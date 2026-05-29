export type MapeoColumnas = Record<string, string>

// FilaFacturacion ahora refleja la data que viene de Metabase + los derivados
// del NT. Campos opcionales son los que no estan garantizados por la query.
export type FilaFacturacion = {
  codigo_frontera:          string
  periodo:                  string                  // "AAAA-MM" desde la columna Period
  nombre_usuario:           string | null
  operador_red:             string | null
  energia_kwh:              number
  nt_raw:                   string | null           // valor original de la columna NT
  nivel_tension:            string | null           // "1", "2" o "3"
  propiedad_activos:        string | null           // "OR" | "Usuario" | "Compartido"
  // Reactiva total (sin penalizar) — Metabase Reactive Inductive/Capacitive Total
  energia_reactiva_ind_tot: number | null
  energia_reactiva_cap_tot: number | null
  // Reactiva penalizada (Metabase Reactive Inductive/Capacitive Pen) — usadas para SDL
  energia_reactiva_ind_pen: number | null
  energia_reactiva_cap_pen: number | null
  factor_m:                 number | null
  // Tarifas BIA (para conciliacion de balance, no para SDL)
  g_bia:                    number | null
  // G de bolsa: tarifa especial usada en formulas de Perdida
  g_bolsa_bia:              number | null
  t_bia:                    number | null
  d_bia:                    number | null
  pr_bia:                   number | null
  r_bia:                    number | null
  c_bia:                    number | null
  tarifa_total_bia:         number | null
}

// Etiquetas en formato amigable porque las claves se usan directamente como
// headers de la tabla de preview (Object.keys del primer registro).
export type FilaXM = {
  SIC:           string
  Nombre:        string | null
  Periodo:       string         // "AAAA-MM" derivado de la columna FECHA del archivo
  "Activa XM":   number         // suma de Total por frontera
}

export type FilaSDL = {
  codigo_frontera:          string
  nombre_frontera:          string | null
  periodo_sdl:              string
  energia_sdl_kwh:          number
  valor_sdl_cop:            number
  tarifa_sdl:               number
  nivel_tension:            string | null
  propiedad_activos:        string | null
  energia_reactiva_ind_pen: number | null
  energia_reactiva_cap_pen: number | null
  valor_reactiva_cop:       number | null
  tarifa_reactiva:          number | null
  factor_m:                 number | null
  es_duplicado:             boolean
}

export type FilaBalance = {
  codigo_frontera: string
  periodo_ajuste: string
  energia_balance_kwh: number
  valor_balance_cop: number
  tarifa_balance: number
  periodo_tarifa: string
}

// Columnas conocidas del formato TC1 (configuracion tecnica del OR). Las
// columnas extra del archivo se omiten. Se concilian solo nivel_tension y
// propiedad_activos contra Facturacion, pero se guardan todas (detalle).
export const TC1_COLUMNAS = [
  "NIU", "CODIGO_DE_CONEXION", "TIPO_DE_CONEXION", "NIVEL_DE_TENSION",
  "NIVEL_DE_TENSION_PRIMARIO", "PORC_PROPIEDAD_DEL_ACTIVO", "CONEXION_RED",
  "ID_COMERCIALIZADOR", "ID_MERCADO", "GRUPO_DE_CALIDAD",
  "COD_FRONTERA_COMERCIAL", "CODIGO_CIRCUITO_O_LINEA", "CODIGO_TRANSFORMADOR",
  "CODIGO_DANE_NIU", "UBICACION", "DIRECCION", "CONDICION_ESPECIAL",
  "TIPO_AREA_ESPECIAL", "CODIGO_AREA_ESPECIAL", "ESTRATO_ID", "ALTITUD",
  "LONGITUD", "LATITUD", "AUTOGENERADOR", "EXPORTA_ENERGIA", "POTENCIA",
  "TIPO_GENERACION", "CODIGO_FRONTERA_AUTO_GEN", "INICIO_OPERACION",
  "CONTRATO_RESPALDO",
] as const

export type FilaTC1 = {
  codigo_frontera:        string         // COD_FRONTERA_COMERCIAL
  niu:                    string | null
  nivel_tension:          string | null  // NIVEL_DE_TENSION (se concilia)
  nivel_tension_primario: string | null
  pct_propiedad_activo:   string | null  // PORC_PROPIEDAD_DEL_ACTIVO crudo
  propiedad_activos:      string | null  // derivado: USUARIO/COMPARTIDO/OR (se concilia)
  tipo_conexion:          string | null
  conexion_red:           string | null
  id_comercializador:     string | null
  // Todas las columnas conocidas del archivo (las extra se omiten).
  detalle:                Record<string, string>
}

export type ResultadoParser<T> = {
  filas: T[]
  alertas: string[]
  erroresCriticos: string[]
}
