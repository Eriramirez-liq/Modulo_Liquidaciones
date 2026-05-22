/**
 * Tabla de casos de prueba del motor de conciliacion SDL.
 *
 * Cada entrada documenta un escenario que valida una rama del motor.
 * Estos casos siguen la especificacion _referencia/PRD_SDL.md
 * (umbral ±100 kWh por defecto).
 *
 * Uso: si despues queremos agregar Vitest/Jest, este archivo se convierte
 * en el suite de tests parametrizado de forma trivial.
 *
 * Tarifas de referencia usadas en los ejemplos:
 *   g_bia = 50, t_bia = 100, d_bia = 200, pr_bia = 30, r_bia = 20, c_bia = 10
 *   tarifa_sdl = 150
 *   Tarifa BIA total (sin C): 400
 *   Tarifa BIA D3 (con tarifa_sdl=150): 50+100+(200-150)+30+20 = 250
 */

import type { CasoConciliacion, InputClasificacion, ResultadoLinea } from "./conciliacion-sdl"

export const TARIFA_REF = {
  g_bia: 50,
  t_bia: 100,
  d_bia: 200,
  pr_bia: 30,
  r_bia:  20,
  c_bia:  10,
  tarifa_sdl: 150,
}

export interface CasoEsperado {
  nombre:                string
  input:                 InputClasificacion
  caso:                  CasoConciliacion
  resultado_l1:          ResultadoLinea | null
  resultado_l2:          ResultadoLinea | null
  impacto_financiero_l1: number | null
  impacto_financiero_l2: number | null
  requiere_alerta_manual: boolean
}

export const CASOS_PRUEBA: CasoEsperado[] = [
  // ───────────────────────────── A1: las tres iguales ─────────────────────────────
  {
    nombre: "A1: e_fac = e_xm = e_sdl exactos",
    input: { e_fac: 10000, e_xm: 10000, e_sdl: 10000, tarifa: TARIFA_REF },
    caso: "A1",
    resultado_l1: "SIN_DIFERENCIA",
    resultado_l2: "SIN_DIFERENCIA",
    impacto_financiero_l1: 0,
    impacto_financiero_l2: 0,
    requiere_alerta_manual: false,
  },
  {
    nombre: "A1: las tres dentro de ±100 kWh",
    input: { e_fac: 10050, e_xm: 9970, e_sdl: 10020, tarifa: TARIFA_REF },
    caso: "A1",
    resultado_l1: "SIN_DIFERENCIA",
    resultado_l2: "SIN_DIFERENCIA",
    impacto_financiero_l1: 0,
    impacto_financiero_l2: 0,
    requiere_alerta_manual: false,
  },

  // ───────────────────────── B1: fac < xm = sdl (contingencia) ────────────────────
  {
    nombre: "B1: fac (9000) < xm = sdl (10000)",
    input: { e_fac: 9000, e_xm: 10000, e_sdl: 10000, tarifa: TARIFA_REF },
    caso: "B1",
    resultado_l1: "CONTINGENCIA_L1",
    resultado_l2: "SIN_DIFERENCIA",
    impacto_financiero_l1: null,  // se valoriza al recibir cobro del OR
    impacto_financiero_l2: 0,
    requiere_alerta_manual: false,
  },

  // ───────────────────────── B2: fac > xm = sdl (provision L1) ────────────────────
  {
    nombre: "B2: fac (11000) > xm = sdl (10000) — provision = 1000 × 400 = 400.000",
    input: { e_fac: 11000, e_xm: 10000, e_sdl: 10000, tarifa: TARIFA_REF },
    caso: "B2",
    resultado_l1: "PROVISION_L1",
    resultado_l2: "SIN_DIFERENCIA",
    impacto_financiero_l1: 400_000,  // 1000 × (50+100+200+30+20)
    impacto_financiero_l2: 0,
    requiere_alerta_manual: false,
  },

  // ─────────────────── C1: fac = xm > sdl (disputa L2, OR cobro de menos) ─────────
  {
    nombre: "C1: fac=xm=10000, sdl=8000 — disputa = 2000 × 150 = 300.000",
    input: { e_fac: 10000, e_xm: 10000, e_sdl: 8000, tarifa: TARIFA_REF },
    caso: "C1",
    resultado_l1: "SIN_DIFERENCIA",
    resultado_l2: "DISPUTA_L2",
    impacto_financiero_l1: 0,
    impacto_financiero_l2: 300_000,  // (10000-8000) × 150
    requiere_alerta_manual: false,
  },

  // ─────────── C2: fac = xm < sdl (disputa L2, OR cobro de mas, supera techo) ─────
  {
    nombre: "C2: fac=xm=10000, sdl=11500 — disputa = 1500 × 150 = 225.000",
    input: { e_fac: 10000, e_xm: 10000, e_sdl: 11500, tarifa: TARIFA_REF },
    caso: "C2",
    resultado_l1: "SIN_DIFERENCIA",
    resultado_l2: "DISPUTA_L2",
    impacto_financiero_l1: 0,
    impacto_financiero_l2: 225_000,
    requiere_alerta_manual: false,
  },

  // ─────────── D1: fac < sdl < xm (contingencia + disputa, alerta manual) ─────────
  {
    nombre: "D1: fac=8000, sdl=9000, xm=10000",
    input: { e_fac: 8000, e_xm: 10000, e_sdl: 9000, tarifa: TARIFA_REF },
    caso: "D1",
    resultado_l1: "CONTINGENCIA_L1",
    resultado_l2: "DISPUTA_L2",
    impacto_financiero_l1: null,   // valorizacion al recibir cobro
    impacto_financiero_l2: 150_000, // (10000-9000) × 150
    requiere_alerta_manual: true,
  },

  // ───────────────── D2: sdl < xm < fac (provision combinada) ─────────────────────
  {
    nombre: "D2: sdl=8000, xm=10000, fac=12000 — provision = 4000 × 400 = 1.600.000",
    input: { e_fac: 12000, e_xm: 10000, e_sdl: 8000, tarifa: TARIFA_REF },
    caso: "D2",
    resultado_l1: "PROVISION_COMBINADA",
    resultado_l2: "SIN_DIFERENCIA",
    impacto_financiero_l1: 1_600_000, // (12000-8000) × 400
    impacto_financiero_l2: 0,
    requiere_alerta_manual: true,
  },

  // ─────────────────── D3: xm < fac = sdl (tarifa especial) ───────────────────────
  {
    nombre: "D3: xm=9000, fac=sdl=10000 — provision = 1000 × 250 = 250.000",
    input: { e_fac: 10000, e_xm: 9000, e_sdl: 10000, tarifa: TARIFA_REF },
    caso: "D3",
    resultado_l1: "PROVISION_L1",
    resultado_l2: "SIN_DIFERENCIA",
    impacto_financiero_l1: 250_000,  // 1000 × (50+100+(200-150)+30+20)
    impacto_financiero_l2: 0,
    requiere_alerta_manual: false,
  },

  // ─────────────────────────── D4: tres distintos sin patron ───────────────────────
  {
    nombre: "D4: fac=10000, xm=12000, sdl=8000 (fac entre sdl y xm, sin igualdad ni B/C/D1)",
    input: { e_fac: 10000, e_xm: 12000, e_sdl: 8000, tarifa: TARIFA_REF },
    // sdl=8000 < xm=12000 (sdl_lt_xm), fac=10000 < xm=12000 (fac_lt_xm),
    // fac=10000 > sdl=8000 (fac_gt_sdl), no encaja en D1 (fac>sdl) ni D2 (fac<xm)
    caso: "D4",
    resultado_l1: "ALERTA_MANUAL",
    resultado_l2: "ALERTA_MANUAL",
    impacto_financiero_l1: null,
    impacto_financiero_l2: null,
    requiere_alerta_manual: true,
  },

  // ─────────────────────── INCOMPLETA: falta dato en XM ────────────────────────────
  {
    nombre: "INCOMPLETA: e_xm = null",
    input: { e_fac: 10000, e_xm: null, e_sdl: 10000, tarifa: TARIFA_REF },
    caso: "INCOMPLETA",
    resultado_l1: "INCOMPLETA",
    resultado_l2: "INCOMPLETA",
    impacto_financiero_l1: null,
    impacto_financiero_l2: null,
    requiere_alerta_manual: false,
  },
  {
    nombre: "INCOMPLETA: e_sdl = null",
    input: { e_fac: 10000, e_xm: 10000, e_sdl: null, tarifa: TARIFA_REF },
    caso: "INCOMPLETA",
    resultado_l1: "INCOMPLETA",
    resultado_l2: "INCOMPLETA",
    impacto_financiero_l1: null,
    impacto_financiero_l2: null,
    requiere_alerta_manual: false,
  },
]
