// Whitelists de operadores de red por modulo. Centralizadas aca para reusar
// en /api/operadores, estado-periodo, etc.

// Operadores que aplican al modulo Cargos STR.
export const STR_OPERADORES = [
  "AFINIA", "AIRE", "BAJO_PUTUMAYO", "CEDENAR", "CELSIA_VALLE", "CENS", "CEO",
  "CHEC", "DISPAC", "EBSA", "EDEQ", "EEP_PEREIRA", "ELECTROCAQUETA",
  "ELECTROHUILA", "EMCALI", "EMSA", "ENEL", "ENELAR", "ENERCA",
  "ENERGUAVIARE", "EPM", "ESSA", "PUTUMAYO",
]

// Los 21 ORs que aplican al modulo SDL (requieren mapeo de estructura para la
// preliquidacion). Misma lista que se usa para TC1. Provista por el negocio.
export const SDL_OPERADORES = [
  "AFINIA", "AIRE", "CEDENAR", "CETSA", "CELSIA_VALLE", "CELSIA_TOLIMA",
  "CENS", "CEO", "CHEC", "EBSA", "EDEQ", "EEP_PEREIRA", "ELECTROHUILA",
  "EMCALI", "EMSA", "ENEL", "ENERCA", "EPM", "ESSA", "EEP_CARTAGO",
  "RUITOQUE",
]
