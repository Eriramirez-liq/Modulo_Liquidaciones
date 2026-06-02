/**
 * Utilidades de periodo de consumo.
 *
 * Regla de negocio: el periodo de conciliacion es el MES DE CONSUMO, que
 * siempre es un mes ya cerrado. Por eso el periodo maximo seleccionable es el
 * MES ANTERIOR al actual (ej. en junio, el maximo es mayo). No se permite
 * cargar/conciliar el mes en curso ni futuros.
 */

/** Periodo maximo permitido = mes anterior al actual (1-12). */
export function periodoMaximo(now: Date = new Date()): { anio: number; mes: number } {
  const m0 = now.getMonth() // 0-11 (= mes anterior expresado en 1-12)
  if (m0 === 0) return { anio: now.getFullYear() - 1, mes: 12 }
  return { anio: now.getFullYear(), mes: m0 }
}

/** true si (anio, mes) es <= al periodo maximo permitido. */
export function esPeriodoPermitido(anio: number, mes: number, now: Date = new Date()): boolean {
  const max = periodoMaximo(now)
  return anio < max.anio || (anio === max.anio && mes <= max.mes)
}

/** Meses (1-12) seleccionables para un año dado, segun el periodo maximo. */
export function mesesValidos(anio: number, now: Date = new Date()): number[] {
  const max = periodoMaximo(now)
  if (anio > max.anio) return []
  const hasta = anio < max.anio ? 12 : max.mes
  return Array.from({ length: hasta }, (_, i) => i + 1)
}

/** Años seleccionables (el del periodo maximo y el anterior). */
export function aniosValidos(now: Date = new Date()): number[] {
  const max = periodoMaximo(now)
  return [max.anio - 1, max.anio]
}
