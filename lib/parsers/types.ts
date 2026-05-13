export type MapeoColumnas = Record<string, string>

export type FilaFacturacion = {
  codigo_frontera: string
  nombre_usuario: string
  operador_red: string
  energia_kwh: number
  g_bia: number
  t_bia: number
  d_bia: number
  pr_bia: number
  r_bia: number
  c_bia: number
  tarifa_total_bia: number
}

export type FilaXM = {
  codigo_frontera: string
  nombre_frontera?: string
  energia_xm_kwh: number
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
