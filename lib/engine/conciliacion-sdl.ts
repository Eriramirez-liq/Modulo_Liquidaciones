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
  g_bia:      number | null
  t_bia:      number | null
  d_bia:      number | null
  pr_bia:     number | null
  r_bia:      number | null
  c_bia:      number | null    // c NO se usa en las formulas de provision
  tarifa_sdl: number | null
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

  // ── B1: fac < xm = sdl  (OR debe pagar) ──────────────────────────────────
  if (delta_l1 < -umbral && xmEqSdl) {
    return {
      caso: "B1",
      resultado_l1: "CONTINGENCIA_L1",
      resultado_l2: "SIN_DIFERENCIA",
      delta_l1, delta_l2,
      impacto_financiero_l1: null, // se valoriza al recibir cobro del OR
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

  // ── D1: fac < sdl < xm  (contingencia + disputa) ─────────────────────────
  if (e_fac + umbral < e_sdl && e_sdl + umbral < e_xm) {
    const valor_l2 = calcularDisputa({ delta: e_xm - e_sdl, tarifa, observaciones })
    return {
      caso: "D1",
      resultado_l1: "CONTINGENCIA_L1",
      resultado_l2: "DISPUTA_L2",
      delta_l1, delta_l2,
      impacto_financiero_l1: null, // valorización al recibir cobro
      impacto_financiero_l2: valor_l2,
      requiere_alerta_manual: true,
      observaciones,
    }
  }

  // ── D2: sdl < xm < fac  (provision combinada, absorbe disputa) ───────────
  if (e_sdl + umbral < e_xm && e_xm + umbral < e_fac) {
    const valor = calcularProvisionCombinada({ e_fac, e_sdl, tarifa, observaciones })
    return {
      caso: "D2",
      resultado_l1: "PROVISION_COMBINADA",
      resultado_l2: "SIN_DIFERENCIA",  // disputa absorbida
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

  // ── D4: tres valores distintos sin patron — alerta manual ────────────────
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

interface CtxProvision { e_fac: number; e_xm?: number; e_sdl?: number; tarifa: TarifaBIA; observaciones: string[] }

/** Provision L1 (B2): |e_fac - e_xm| × (g + t + d + pr + r).  C excluido. */
function calcularProvisionL1(ctx: { e_fac: number; e_xm: number; tarifa: TarifaBIA; observaciones: string[] }): number | null {
  const { g_bia, t_bia, d_bia, pr_bia, r_bia } = ctx.tarifa
  if (g_bia == null || t_bia == null || d_bia == null || pr_bia == null || r_bia == null) {
    ctx.observaciones.push("Provision L1 sin valorizar: faltan tarifas BIA (g/t/d/pr/r).")
    return null
  }
  const delta = Math.abs(ctx.e_fac - ctx.e_xm)
  const tarifaTotal = g_bia + t_bia + d_bia + pr_bia + r_bia
  return delta * tarifaTotal
}

/** Provision combinada (D2): |e_fac - e_sdl| × (g + t + d + pr + r).  C excluido. */
function calcularProvisionCombinada(ctx: { e_fac: number; e_sdl: number; tarifa: TarifaBIA; observaciones: string[] }): number | null {
  const { g_bia, t_bia, d_bia, pr_bia, r_bia } = ctx.tarifa
  if (g_bia == null || t_bia == null || d_bia == null || pr_bia == null || r_bia == null) {
    ctx.observaciones.push("Provision combinada sin valorizar: faltan tarifas BIA (g/t/d/pr/r).")
    return null
  }
  const delta = Math.abs(ctx.e_fac - ctx.e_sdl)
  const tarifaTotal = g_bia + t_bia + d_bia + pr_bia + r_bia
  return delta * tarifaTotal
}

/**
 * Provision D3: |e_fac - e_xm| × (g + t + (d - tarifa_sdl) + pr + r).
 * Valida `tarifa_sdl <= d_bia` — si la tarifa SDL supera el componente D
 * de BIA, no se puede calcular (escala a alerta).
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
  const tarifaAjustada = g_bia + t_bia + (d_bia - tarifa_sdl) + pr_bia + r_bia
  return delta * tarifaAjustada
}

/** Disputa L2 (C1, C2, D1): |delta| × tarifa_sdl. */
function calcularDisputa(ctx: { delta: number; tarifa: TarifaBIA; observaciones: string[] }): number | null {
  if (ctx.tarifa.tarifa_sdl == null) {
    ctx.observaciones.push("Disputa L2 sin valorizar: falta tarifa_sdl.")
    return null
  }
  return Math.abs(ctx.delta) * ctx.tarifa.tarifa_sdl
}
