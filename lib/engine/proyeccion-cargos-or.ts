/**
 * Motor de calculo del modulo "Proyeccion Cargos OR".
 *
 * Construye una matriz por mes (cada columna = un mes de CONSUMO) con las
 * energias (activa por NT, reactiva por NT, STR) y su valorizacion en COP a
 * partir de la demanda total (sdlEnergy) y los precios SDL/STR del periodo.
 *
 * Toda la logica de calculo por-mes vive aqui como funcion PURA. El endpoint
 * se encarga de las queries, de armar los meses reales y de proyectar precios.
 *
 * Nota sobre precision: los montos en BD son Decimal. Aqui trabajamos con
 * `number` porque el resultado es para display/proyeccion, no para asentar
 * movimientos contables. Cualquier asiento real debe re-calcularse con Decimal.
 */

/** Desglose de la energia activa por nivel de tension (fracciones que suman 1). */
export const ACTIVA_NT = {
  nt1: 0.3452,
  nt2: 0.5296,
  nt3: 0.1252,
} as const

/** Reactiva total = 2.29% de la SDL Energy. */
export const REACTIVA_PCT = 0.0229

/** Desglose de la energia reactiva por nivel de tension (fracciones del total reactivo). */
export const REACTIVA_NT = {
  nt1: 0.4736,
  nt2: 0.4857,
  nt3: 0.04,
} as const

/** Adicional STR: la STR Energy es la SDL activa total x (1 + STR_PCT). */
export const STR_PCT = 0.08

/** Triplete de valores por nivel de tension. */
export interface PorNT<T> {
  nt1: T
  nt2: T
  nt3: T
}

/** Precios (COP/kWh) de entrada para un mes. `null` = sin dato disponible. */
export interface PreciosMes {
  precioActivaNT: PorNT<number | null>
  precioReactivaNT: PorNT<number | null>
  precioStr: number | null
}

/** Salida valorizada en COP de un mes. */
export interface SalidaMes {
  sdlActivaNT: PorNT<number> | null
  sdlReactivaNT: PorNT<number> | null
  str: number | null
  total: number | null
}

/** Resultado del calculo de energias + salida para un mes con demanda conocida. */
export interface CalculoMes {
  activaNT: PorNT<number>
  reactivaTotal: number
  reactivaNT: PorNT<number>
  strEnergy: number
  salida: SalidaMes
}

/**
 * Multiplica energia x precio devolviendo `null` si el precio es `null`.
 * Mantiene el contrato de "sin dato" (precio ausente) en vez de asumir 0.
 */
function valorizar(energia: number, precio: number | null): number | null {
  return precio === null ? null : energia * precio
}

/**
 * Calcula las energias por NT, la STR Energy y la salida valorizada en COP a
 * partir de la demanda total del mes y los precios del periodo.
 *
 * Funcion PURA: no toca BD ni dependencias externas. Determinista.
 *
 * @param sdlEnergy Demanda total del mes en kWh (activa total deduplicada).
 * @param precios   Precios SDL/STR (COP/kWh) del periodo; cualquiera puede ser null.
 * @returns Energias derivadas y su valorizacion en COP.
 */
export function calcularMes(sdlEnergy: number, precios: PreciosMes): CalculoMes {
  // --- Energia activa por NT ---
  const activaNT: PorNT<number> = {
    nt1: sdlEnergy * ACTIVA_NT.nt1,
    nt2: sdlEnergy * ACTIVA_NT.nt2,
    nt3: sdlEnergy * ACTIVA_NT.nt3,
  }

  // --- Energia reactiva (total y por NT) ---
  const reactivaTotal = sdlEnergy * REACTIVA_PCT
  const reactivaNT: PorNT<number> = {
    nt1: reactivaTotal * REACTIVA_NT.nt1,
    nt2: reactivaTotal * REACTIVA_NT.nt2,
    nt3: reactivaTotal * REACTIVA_NT.nt3,
  }

  // --- STR Energy = activa total x (1 + STR_PCT) ---
  const strEnergy = sdlEnergy * (1 + STR_PCT)

  // --- Valorizacion en COP ---
  const sdlActivaNT: PorNT<number | null> = {
    nt1: valorizar(activaNT.nt1, precios.precioActivaNT.nt1),
    nt2: valorizar(activaNT.nt2, precios.precioActivaNT.nt2),
    nt3: valorizar(activaNT.nt3, precios.precioActivaNT.nt3),
  }
  const sdlReactivaNT: PorNT<number | null> = {
    nt1: valorizar(reactivaNT.nt1, precios.precioReactivaNT.nt1),
    nt2: valorizar(reactivaNT.nt2, precios.precioReactivaNT.nt2),
    nt3: valorizar(reactivaNT.nt3, precios.precioReactivaNT.nt3),
  }
  const str = valorizar(strEnergy, precios.precioStr)

  // El total suma solo los componentes con dato. Si TODOS son null, total = null.
  const componentes: Array<number | null> = [
    sdlActivaNT.nt1, sdlActivaNT.nt2, sdlActivaNT.nt3,
    sdlReactivaNT.nt1, sdlReactivaNT.nt2, sdlReactivaNT.nt3,
    str,
  ]
  const conDato = componentes.filter((c): c is number => c !== null)
  const total = conDato.length === 0 ? null : conDato.reduce((a, b) => a + b, 0)

  // sdlActivaNT/sdlReactivaNT se exponen como PorNT<number> | null: si los tres
  // niveles vienen sin precio, se devuelve null en bloque (no hay valorizacion).
  const activaCompleta =
    sdlActivaNT.nt1 !== null && sdlActivaNT.nt2 !== null && sdlActivaNT.nt3 !== null
  const reactivaCompleta =
    sdlReactivaNT.nt1 !== null && sdlReactivaNT.nt2 !== null && sdlReactivaNT.nt3 !== null

  return {
    activaNT,
    reactivaTotal,
    reactivaNT,
    strEnergy,
    salida: {
      sdlActivaNT: activaCompleta ? (sdlActivaNT as PorNT<number>) : null,
      sdlReactivaNT: reactivaCompleta ? (sdlReactivaNT as PorNT<number>) : null,
      str,
      total,
    },
  }
}

/**
 * Suma "AAAA-MM" + N meses (N puede ser 0). Devuelve el string normalizado.
 * Lanza si el formato de entrada no es "AAAA-MM".
 */
export function sumarMeses(periodo: string, n: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo)
  if (!m) throw new Error(`Periodo invalido (se espera "AAAA-MM"): ${periodo}`)
  const anio = Number(m[1])
  const mes = Number(m[2]) // 1..12
  // Indice de mes base-0 desde el anio 0 para sumar limpio.
  const total = anio * 12 + (mes - 1) + n
  const nuevoAnio = Math.floor(total / 12)
  const nuevoMes = (total % 12) + 1
  return `${String(nuevoAnio).padStart(4, "0")}-${String(nuevoMes).padStart(2, "0")}`
}

/** Mes de facturacion de un mes de consumo = consumo + 1 mes. */
export function mesFacturacionDe(periodoConsumo: string): string {
  return sumarMeses(periodoConsumo, 1)
}

/**
 * Lista los N meses de consumo siguientes al ultimo mes real (excluyendolo).
 * Si N <= 0 devuelve []. Si N > 0, devuelve [ultimo+1, ..., ultimo+N].
 */
export function mesesSiguientes(ultimoMesReal: string, n: number): string[] {
  if (n <= 0) return []
  const out: string[] = []
  for (let i = 1; i <= n; i++) out.push(sumarMeses(ultimoMesReal, i))
  return out
}

/**
 * Promedia los valores no-null de una serie. Devuelve null si no hay ninguno.
 * Usado para proyectar precios desde los ultimos meses reales.
 */
export function promedio(valores: Array<number | null>): number | null {
  const v = valores.filter((x): x is number => x !== null)
  if (v.length === 0) return null
  return v.reduce((a, b) => a + b, 0) / v.length
}
