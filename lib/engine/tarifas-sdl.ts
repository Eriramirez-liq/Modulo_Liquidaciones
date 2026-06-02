/**
 * Calculo de Tarifas SDL a partir de los insumos (Cargos ADD + Uso de la red).
 *
 * Por cada OR y mes se arman los componentes:
 *   - NT1, NT2, NT3: cargo de uso de la red por nivel de tension.
 *       OR tipo ADD -> del archivo ADD (DT de su AREA de distribucion).
 *       OR tipo USO -> del archivo de uso de la red del OR (DT1/2/3).
 *   - CDI, CDN4, PR1, PR2, PR3: SIEMPRE del archivo de uso de la red del OR.
 *
 * Y se calculan 10 tarifas (5 activa + 5 reactiva) por combinacion
 * nivel+propiedad. Formulas verificadas contra la hoja TARIFA del negocio.
 */

export type TipoInsumo = "ADD" | "USO"
export type AreaDistribucion = "CENTRO" | "OCCIDENTE" | "ORIENTE" | "SUR"

// Mapeo OR -> tipo de insumo (de donde sale el NT). 21 ORs.
export const OR_TIPO: Record<string, TipoInsumo> = {
  AIRE: "USO", AFINIA: "USO", EEP_PEREIRA: "USO", EEP_CARTAGO: "USO",
  EMCALI: "USO", ENEL: "USO", EPM: "USO",
  CEDENAR: "ADD", CELSIA_VALLE: "ADD", CELSIA_TOLIMA: "ADD", CENS: "ADD",
  CEO: "ADD", CETSA: "ADD", CHEC: "ADD", EBSA: "ADD", EDEQ: "ADD",
  ELECTROHUILA: "ADD", EMSA: "ADD", ENERCA: "ADD", ESSA: "ADD", RUITOQUE: "ADD",
}

// Area de distribucion de los OR tipo ADD (para tomar el DT del ADD de su area).
export const OR_AREA_ADD: Record<string, AreaDistribucion> = {
  CENS: "CENTRO", CHEC: "CENTRO", EDEQ: "CENTRO", ESSA: "CENTRO", RUITOQUE: "CENTRO",
  CEDENAR: "OCCIDENTE", CELSIA_VALLE: "OCCIDENTE", CEO: "OCCIDENTE", CETSA: "OCCIDENTE",
  CELSIA_TOLIMA: "ORIENTE", EBSA: "ORIENTE", ELECTROHUILA: "ORIENTE",
  EMSA: "SUR", ENERCA: "SUR",
}

export interface ComponentesTarifa {
  nt1: number; nt2: number; nt3: number
  cdi: number; cdn4: number
  pr1: number; pr2: number; pr3: number   // fracciones (0.1255 = 12.55%)
}

export interface TarifasOR {
  activa: {
    nt1_or: number; nt1_compartido: number; nt1_usuario: number
    nt2_usuario: number; nt3_usuario: number
  }
  reactiva: {
    nt1_or: number; nt1_compartido: number; nt1_usuario: number
    nt2_usuario: number; nt3_usuario: number
  }
}

/**
 * Aplica las formulas de tarifa. Verificadas al decimal contra la hoja TARIFA.
 *
 * ACTIVA:
 *   NT1 OR         = NT1 - CDN4/(1-PR1)
 *   NT1 Compartido = (NT1 - CDN4/(1-PR1)) - CDI*0.5
 *   NT1 Usuario    = (NT1 - CDN4/(1-PR1)) - CDI
 *   NT2 Usuario    = NT2 - CDN4/(1-PR2)
 *   NT3 Usuario    = NT3 - CDN4/(1-PR3)
 * REACTIVA:
 *   NT1 OR         = NT1
 *   NT1 Compartido = NT1 - CDI*0.5
 *   NT1 Usuario    = NT1 - CDI
 *   NT2 Usuario    = NT2
 *   NT3 Usuario    = NT3
 */
export function calcularTarifas(c: ComponentesTarifa): TarifasOR {
  const activaNT1OR = c.nt1 - c.cdn4 / (1 - c.pr1)
  return {
    activa: {
      nt1_or:         activaNT1OR,
      nt1_compartido: activaNT1OR - c.cdi * 0.5,
      nt1_usuario:    activaNT1OR - c.cdi,
      nt2_usuario:    c.nt2 - c.cdn4 / (1 - c.pr2),
      nt3_usuario:    c.nt3 - c.cdn4 / (1 - c.pr3),
    },
    reactiva: {
      nt1_or:         c.nt1,
      nt1_compartido: c.nt1 - c.cdi * 0.5,
      nt1_usuario:    c.nt1 - c.cdi,
      nt2_usuario:    c.nt2,
      nt3_usuario:    c.nt3,
    },
  }
}
