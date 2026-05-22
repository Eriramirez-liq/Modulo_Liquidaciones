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

export type ResultadoParser<T> = {
  filas: T[]
  alertas: string[]
  erroresCriticos: string[]
}
