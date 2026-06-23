/**
 * Motor de conciliacion SDL — funcion pura.
 *
 * Compara la energia de una frontera entre 3 fuentes:
 *   - E_fac: energia activa reportada en Facturacion BIA (desde Metabase)
 *   - E_xm:  energia reportada por XM (Reporte CGM)
 *   - E_sdl: energia reportada por el Operador de Red (SDL preliquidacion)
 *
 * Clasifica el caso (A1, B1, B2, C1, C2, D1, D2, D3, D4, INCOMPLETA),
 * computa los deltas y, cuando aplica, el valor financiero de provision
 * o disputa.
 *
 * Especificacion: _referencia/PRD_SDL.md (M2 Motor de Conciliacion).
 * Umbral: ±100 kWh absoluto por defecto (configurable).
 * Regla del techo: E_xm es el limite superior para E_sdl.
 *
 * Esta funcion NO toca la DB. Es pura: misma entrada => misma salida.
 */

export type CasoConciliacion =
  | "A1" | "B1" | "B2" | "C1" | "C2"
  | "D1" | "D2" | "D3" | "D4"
  | "INCOMPLETA"
  | "ERROR"

export type ResultadoLinea =
  | "SIN_DIFERENCIA"
  | "CONTINGENCIA_L1"
  | "PROVISION_L1"
  | "PROVISION_L2"
  | "DISPUTA_L2"
  | "PROVISION_COMBINADA"
  | "ALERTA_MANUAL"
  | "INCOMPLETA"

export interface TarifaBIA {
  g_bia:       number | null
  g_bolsa_bia: number | null   // se usa en formulas de Perdida (B1, B1-ext)
  t_bia:       number | null
  d_bia:       number | null
  pr_bia:      number | null
  r_bia:       number | null
  c_bia:       number | null   // c NO se usa en las formulas de provision/perdida
  tarifa_sdl:  number | null
}

export interface InputClasificacion {
  e_fac: number
  e_xm:  number | null
  e_sdl: number | null
  tarifa: TarifaBIA
  umbral?: number   // default 100 kWh
}

export interface ResultadoClasificacion {
  caso:                  CasoConciliacion
  resultado_l1:          ResultadoLinea | null
  resultado_l2:          ResultadoLinea | null
  delta_l1:              number              // e_fac - e_xm
  delta_l2:              number              // e_xm - e_sdl
  impacto_financiero_l1: number | null       // valor provision L1 / contingencia
  impacto_financiero_l2: number | null       // valor disputa L2
  requiere_alerta_manual: boolean
  observaciones:         string[]
}

// ────────────────────────────────────────────────────────────────────────────
// Funcion principal
// ────────────────────────────────────────────────────────────────────────────

export function clasificarFrontera(input: InputClasificacion): ResultadoClasificacion {
  const { e_fac, e_xm, e_sdl, tarifa } = input
  const umbral = input.umbral ?? 100
  const observaciones: string[] = []

  // ── Caso 0: datos faltantes ──────────────────────────────────────────────
  if (e_xm == null || e_sdl == null) {
    if (e_xm  == null) observaciones.push("Falta dato en XM")
    if (e_sdl == null) observaciones.push("Falta dato en SDL")
    return {
      caso: "INCOMPLETA",
      resultado_l1: "INCOMPLETA",
      resultado_l2: "INCOMPLETA",
      delta_l1: e_xm  != null ? e_fac - e_xm  : 0,
      delta_l2: 0,
      impacto_financiero_l1: null,
      impacto_financiero_l2: null,
      requiere_alerta_manual: false,
      observaciones,
    }
  }

  const delta_l1 = e_fac - e_xm
  const delta_l2 = e_xm - e_sdl

  const facEqXm  = Math.abs(delta_l1) <= umbral
  const xmEqSdl  = Math.abs(delta_l2) <= umbral
  const facEqSdl = Math.abs(e_fac - e_sdl) <= umbral

  // ── A1: las tres iguales ─────────────────────────────────────────────────
  if (facEqXm && xmEqSdl) {
    return {
      caso: "A1",
      resultado_l1: "SIN_DIFERENCIA",
      resultado_l2: "SIN_DIFERENCIA",
      delta_l1, delta_l2,
      impacto_financiero_l1: 0,
      impacto_financiero_l2: 0,
      requiere_alerta_manual: false,
      observaciones,
    }
  }

  // ── B1: fac < xm = sdl  (Perdida, OR alineado con XM) ───────────────────
  // Formula: (xm-fac) × (g_bolsa + t + d + pr + r)
  if (delta_l1 < -umbral && xmEqSdl) {
    const valor = calcularPerdidaNormal({ e_fac, e_xm, tarifa, observaciones })
    return {
      caso: "B1",
      resultado_l1: "CONTINGENCIA_L1",
      resultado_l2: "SIN_DIFERENCIA",
      delta_l1, delta_l2,
      impacto_financiero_l1: valor,
      impacto_financiero_l2: 0,
      requiere_alerta_manual: false,
      observaciones,
    }
  }

  // ── B2: fac > xm = sdl  (BIA provisiona) ─────────────────────────────────
  if (delta_l1 > umbral && xmEqSdl) {
    const valor = calcularProvisionL1({ e_fac, e_xm, tarifa, observaciones })
    return {
      caso: "B2",
      resultado_l1: "PROVISION_L1",
      resultado_l2: "SIN_DIFERENCIA",
      delta_l1, delta_l2,
      impacto_financiero_l1: valor,
      impacto_financiero_l2: 0,
      requiere_alerta_manual: false,
      observaciones,
    }
  }

  // ── C1: fac = xm > sdl  (OR cobro de menos, pedir SDL corregido) ─────────
  if (facEqXm && delta_l2 > umbral) {
    const valor = calcularDisputa({ delta: e_xm - e_sdl, tarifa, observaciones })
    return {
      caso: "C1",
      resultado_l1: "SIN_DIFERENCIA",
      resultado_l2: "DISPUTA_L2",
      delta_l1, delta_l2,
      impacto_financiero_l1: 0,
      impacto_financiero_l2: valor,
      requiere_alerta_manual: false,
      observaciones,
    }
  }

  // ── C2: fac = xm < sdl  (OR cobro de mas, supera el techo XM) ────────────
  if (facEqXm && delta_l2 < -umbral) {
    const valor = calcularDisputa({ delta: e_sdl - e_xm, tarifa, observaciones })
    return {
      caso: "C2",
      resultado_l1: "SIN_DIFERENCIA",
      resultado_l2: "DISPUTA_L2",
      delta_l1, delta_l2,
      impacto_financiero_l1: 0,
      impacto_financiero_l2: valor,
      requiere_alerta_manual: false,
      observaciones,
    }
  }

  // ── D1: fac < sdl < xm  (Alerta manual + Perdida: BIA<OR<XM) ─────────────
  // Formula: (xm-fac) × (g_bolsa + t + d + pr + r)  — g_bolsa como toda perdida
  if (e_fac + umbral < e_sdl && e_sdl + umbral < e_xm) {
    observaciones.push("D1 (BIA<OR<XM): genera Perdida y aparece en Alertas Manuales.")
    const valor = calcularPerdidaNormal({ e_fac, e_xm, tarifa, observaciones })
    return {
      caso: "D1",
      resultado_l1: "CONTINGENCIA_L1",
      resultado_l2: "SIN_DIFERENCIA",
      delta_l1, delta_l2,
      impacto_financiero_l1: valor,
      impacto_financiero_l2: 0,
      requiere_alerta_manual: true,
      observaciones,
    }
  }

  // ── D2: fac > sdl > xm  (Alerta manual: BIA>OR>XM → Provision) ───────────
  // Formula: (fac-xm) × (g + t + d + pr + r)
  if (e_fac > e_sdl + umbral && e_sdl > e_xm + umbral) {
    const valor = calcularProvisionAlertaManual({ e_fac, e_xm, tarifa, observaciones })
    return {
      caso: "D2",
      resultado_l1: "PROVISION_L1",
      resultado_l2: "SIN_DIFERENCIA",
      delta_l1, delta_l2,
      impacto_financiero_l1: valor,
      impacto_financiero_l2: 0,
      requiere_alerta_manual: true,
      observaciones,
    }
  }

  // ── D3: xm < fac = sdl  (provision D3 con tarifa especial) ───────────────
  if (delta_l1 > umbral && facEqSdl) {
    const valor = calcularProvisionD3({ e_fac, e_xm, tarifa, observaciones })
    return {
      caso: "D3",
      resultado_l1: "PROVISION_L1",
      resultado_l2: "SIN_DIFERENCIA",
      delta_l1, delta_l2,
      impacto_financiero_l1: valor,
      impacto_financiero_l2: 0,
      requiere_alerta_manual: false,
      observaciones,
    }
  }

  // ── B1-ext: fac ≈ sdl < xm  (Perdida, OR alineado con BIA) ───────────────
  // Formula: (xm-fac) × (g_bolsa + t + (d-sdl) + pr + r)
  // BIA y OR concuerdan, XM reporta MAS energia. Tarifa especial (d-sdl).
  if (facEqSdl && delta_l2 > umbral) {
    observaciones.push(
      "B1-ext: fac ≈ sdl < xm. BIA y OR concuerdan, XM reporta mayor consumo.",
    )
    const valor = calcularPerdidaBIAext({ e_fac, e_xm, tarifa, observaciones })
    return {
      caso: "B1",
      resultado_l1: "CONTINGENCIA_L1",
      resultado_l2: "SIN_DIFERENCIA",
      delta_l1, delta_l2,
      impacto_financiero_l1: valor,
      impacto_financiero_l2: 0,
      requiere_alerta_manual: false,
      observaciones,
    }
  }

  // ── D4: tres valores distintos sin patron — alerta manual ────────────────
  // Si además hay PÉRDIDA por mayor reporte a XM (fac < xm), genera Contingencia
  // (pérdida) por la diferencia fac vs xm — debe sumar en el KPI de pérdidas
  // aunque los 3 valores difieran (se mantiene como alerta manual / revisar).
  if (delta_l1 < -umbral) {
    observaciones.push(
      "D4 con pérdida por mayor reporte a XM (fac < xm): genera pérdida y requiere revisión (los 3 valores difieren).",
    )
    const valor = calcularPerdidaNormal({ e_fac, e_xm, tarifa, observaciones })
    return {
      caso: "D4",
      resultado_l1: "CONTINGENCIA_L1",
      resultado_l2: "ALERTA_MANUAL",
      delta_l1, delta_l2,
      impacto_financiero_l1: valor,
      impacto_financiero_l2: null,
      requiere_alerta_manual: true,
      observaciones,
    }
  }
  // Si hay PROVISIÓN por menor reporte a XM (fac > xm), genera Provisión L1 por
  // la diferencia fac vs xm — debe sumar en el KPI de provisiones, manteniéndose
  // como alerta manual / revisar (los 3 valores difieren).
  if (delta_l1 > umbral) {
    observaciones.push(
      "D4 con provisión por menor reporte a XM (fac > xm): genera provisión y requiere revisión (los 3 valores difieren).",
    )
    const valor = calcularProvisionL1({ e_fac, e_xm, tarifa, observaciones })
    return {
      caso: "D4",
      resultado_l1: "PROVISION_L1",
      resultado_l2: "ALERTA_MANUAL",
      delta_l1, delta_l2,
      impacto_financiero_l1: valor,
      impacto_financiero_l2: null,
      requiere_alerta_manual: true,
      observaciones,
    }
  }
  observaciones.push(
    "Combinacion de valores no encaja en patrones A1-D3. Requiere revision manual.",
  )
  return {
    caso: "D4",
    resultado_l1: "ALERTA_MANUAL",
    resultado_l2: "ALERTA_MANUAL",
    delta_l1, delta_l2,
    impacto_financiero_l1: null,
    impacto_financiero_l2: null,
    requiere_alerta_manual: true,
    observaciones,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers de valorizacion
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// PROVISIONES (BIA reporto de menos a XM, fac > xm)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Provision L1 (B2 — OR alineado con XM):
 *   (fac - xm) × (g + t + d + pr + r)
 * C excluido. Tarifa normal sin ajustar.
 */
function calcularProvisionL1(ctx: { e_fac: number; e_xm: number; tarifa: TarifaBIA; observaciones: string[] }): number | null {
  const { g_bia, t_bia, d_bia, pr_bia, r_bia } = ctx.tarifa
  if (g_bia == null || t_bia == null || d_bia == null || pr_bia == null || r_bia == null) {
    ctx.observaciones.push("Provision L1 (B2) sin valorizar: faltan tarifas BIA (g/t/d/pr/r).")
    return null
  }
  const delta = Math.abs(ctx.e_fac - ctx.e_xm)
  return delta * (g_bia + t_bia + d_bia + pr_bia + r_bia)
}

/**
 * Provision D3 (OR alineado con BIA):
 *   (fac - xm) × (g + t + (d - tarifa_sdl) + pr + r)
 * Valida tarifa_sdl <= d_bia.
 */
function calcularProvisionD3(ctx: { e_fac: number; e_xm: number; tarifa: TarifaBIA; observaciones: string[] }): number | null {
  const { g_bia, t_bia, d_bia, pr_bia, r_bia, tarifa_sdl } = ctx.tarifa
  if (g_bia == null || t_bia == null || d_bia == null || pr_bia == null || r_bia == null) {
    ctx.observaciones.push("Provision D3 sin valorizar: faltan tarifas BIA.")
    return null
  }
  if (tarifa_sdl == null) {
    ctx.observaciones.push("Provision D3 sin valorizar: falta tarifa_sdl.")
    return null
  }
  if (tarifa_sdl > d_bia) {
    ctx.observaciones.push(
      `Provision D3 invalida: tarifa_sdl (${tarifa_sdl}) > d_bia (${d_bia}). Revisar tarifas.`,
    )
    return null
  }
  const delta = Math.abs(ctx.e_fac - ctx.e_xm)
  return delta * (g_bia + t_bia + (d_bia - tarifa_sdl) + pr_bia + r_bia)
}

/**
 * Provision Alerta Manual (D2 — BIA>OR>XM):
 *   (fac - xm) × (g + t + d + pr + r)
 * Misma estructura que B2.
 */
function calcularProvisionAlertaManual(ctx: { e_fac: number; e_xm: number; tarifa: TarifaBIA; observaciones: string[] }): number | null {
  const { g_bia, t_bia, d_bia, pr_bia, r_bia } = ctx.tarifa
  if (g_bia == null || t_bia == null || d_bia == null || pr_bia == null || r_bia == null) {
    ctx.observaciones.push("Provision D2 sin valorizar: faltan tarifas BIA (g/t/d/pr/r).")
    return null
  }
  const delta = Math.abs(ctx.e_fac - ctx.e_xm)
  return delta * (g_bia + t_bia + d_bia + pr_bia + r_bia)
}

// ────────────────────────────────────────────────────────────────────────────
// PERDIDAS (BIA reporto de mas a XM, fac < xm)
// Las formulas de Perdida usan g_bolsa_bia en lugar de g_bia.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Perdida normal (B1 — OR alineado con XM):
 *   (xm - fac) × (g_bolsa + t + d + pr + r)
 */
function calcularPerdidaNormal(ctx: { e_fac: number; e_xm: number; tarifa: TarifaBIA; observaciones: string[] }): number | null {
  const { g_bolsa_bia, t_bia, d_bia, pr_bia, r_bia } = ctx.tarifa
  if (g_bolsa_bia == null) {
    ctx.observaciones.push("Perdida B1 sin valorizar: falta g_bolsa_bia.")
    return null
  }
  if (t_bia == null || d_bia == null || pr_bia == null || r_bia == null) {
    ctx.observaciones.push("Perdida B1 sin valorizar: faltan tarifas BIA (t/d/pr/r).")
    return null
  }
  const delta = Math.abs(ctx.e_xm - ctx.e_fac)
  return delta * (g_bolsa_bia + t_bia + d_bia + pr_bia + r_bia)
}

/**
 * Perdida B1-ext (OR alineado con BIA):
 *   (xm - fac) × (g_bolsa + t + (d - tarifa_sdl) + pr + r)
 */
function calcularPerdidaBIAext(ctx: { e_fac: number; e_xm: number; tarifa: TarifaBIA; observaciones: string[] }): number | null {
  const { g_bolsa_bia, t_bia, d_bia, pr_bia, r_bia, tarifa_sdl } = ctx.tarifa
  if (g_bolsa_bia == null) {
    ctx.observaciones.push("Perdida B1-ext sin valorizar: falta g_bolsa_bia.")
    return null
  }
  if (t_bia == null || d_bia == null || pr_bia == null || r_bia == null) {
    ctx.observaciones.push("Perdida B1-ext sin valorizar: faltan tarifas BIA (t/d/pr/r).")
    return null
  }
  if (tarifa_sdl == null) {
    ctx.observaciones.push("Perdida B1-ext sin valorizar: falta tarifa_sdl.")
    return null
  }
  if (tarifa_sdl > d_bia) {
    ctx.observaciones.push(
      `Perdida B1-ext invalida: tarifa_sdl (${tarifa_sdl}) > d_bia (${d_bia}). Revisar tarifas.`,
    )
    return null
  }
  const delta = Math.abs(ctx.e_xm - ctx.e_fac)
  return delta * (g_bolsa_bia + t_bia + (d_bia - tarifa_sdl) + pr_bia + r_bia)
}

// Nota: D1 (Perdida alerta manual, BIA<OR<XM) usa la misma formula que B1
// (calcularPerdidaNormal). La diferencia es solo la condicion + el flag
// requiere_alerta_manual. Toda Perdida usa g_bolsa_bia.

// ────────────────────────────────────────────────────────────────────────────
// DISPUTAS (C1, C2)
// ────────────────────────────────────────────────────────────────────────────

/** Disputa L2 (C1, C2): |delta| × tarifa_sdl. Estimacion mientras OR responde. */
function calcularDisputa(ctx: { delta: number; tarifa: TarifaBIA; observaciones: string[] }): number | null {
  if (ctx.tarifa.tarifa_sdl == null) {
    ctx.observaciones.push("Disputa L2 sin valorizar: falta tarifa_sdl.")
    return null
  }
  return Math.abs(ctx.delta) * ctx.tarifa.tarifa_sdl
}

// ────────────────────────────────────────────────────────────────────────────
// INDICADORES EXTENDIDOS (fac vs sdl, ademas de ACTIVA)
//
// Comparaciones independientes a la conciliacion de ACTIVA. Una frontera puede
// estar OK en activa pero tener diff en inductiva, factor M, etc.
// Si algun campo es null en cualquiera de los dos lados, no se evalua diff
// (no podemos comparar). Mismo criterio si no hay SDL: todos diff_* = false
// y la frontera queda solo como Incompleta.
// ────────────────────────────────────────────────────────────────────────────

export interface InputIndicadores {
  // Energia reactiva inductiva penalizada
  ind_pen_fac: number | null
  ind_pen_sdl: number | null
  // Energia reactiva capacitiva penalizada
  cap_pen_fac: number | null
  cap_pen_sdl: number | null
  // Factor M (entero 1-12 esperado)
  factor_m_fac: number | null
  factor_m_sdl: number | null
  // Nivel tension (string)
  nivel_tension_fac: string | null
  nivel_tension_sdl: string | null
  // Propiedad de activos (string)
  propiedad_activos_fac: string | null
  propiedad_activos_sdl: string | null
  // Umbral kWh para reactivas (default 100, mismo que activa)
  umbral_kwh?: number
}

export interface ResultadoIndicadores {
  ind_pen_delta:      number | null
  diff_inductiva:     boolean
  cap_pen_delta:      number | null
  diff_capacitiva:    boolean
  diff_factor_m:      boolean
  diff_nivel_tension: boolean
  diff_propiedad:     boolean
}

export function clasificarIndicadores(input: InputIndicadores): ResultadoIndicadores {
  const umbral = input.umbral_kwh ?? 100

  // Inductiva penalizada: |fac - sdl| > umbral
  const indDelta = (input.ind_pen_fac != null && input.ind_pen_sdl != null)
    ? input.ind_pen_fac - input.ind_pen_sdl
    : null
  const diffInd = indDelta != null && Math.abs(indDelta) > umbral

  // Capacitiva penalizada: |fac - sdl| > umbral
  const capDelta = (input.cap_pen_fac != null && input.cap_pen_sdl != null)
    ? input.cap_pen_fac - input.cap_pen_sdl
    : null
  const diffCap = capDelta != null && Math.abs(capDelta) > umbral

  // Factor M: comparacion exacta de enteros (redondear porque puede venir
  // como decimal pero conceptualmente es 1..12).
  const diffFm = (input.factor_m_fac != null && input.factor_m_sdl != null)
    && Math.round(input.factor_m_fac) !== Math.round(input.factor_m_sdl)

  // Nivel tension y propiedad: string normalizado (trim + lowercase).
  const normStr = (s: string | null): string => (s ?? "").trim().toLowerCase()
  const diffNT = (input.nivel_tension_fac != null && input.nivel_tension_sdl != null)
    && normStr(input.nivel_tension_fac) !== normStr(input.nivel_tension_sdl)
  const diffProp = (input.propiedad_activos_fac != null && input.propiedad_activos_sdl != null)
    && normStr(input.propiedad_activos_fac) !== normStr(input.propiedad_activos_sdl)

  return {
    ind_pen_delta:      indDelta,
    diff_inductiva:     diffInd,
    cap_pen_delta:      capDelta,
    diff_capacitiva:    diffCap,
    diff_factor_m:      diffFm,
    diff_nivel_tension: diffNT,
    diff_propiedad:     diffProp,
  }
}
