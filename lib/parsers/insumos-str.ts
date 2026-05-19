import { ResultadoParser } from "@/lib/parsers/types"

export type FilaSTR = {
  or_codigo:    string  // Código del operador (AFINIA, AIRE, …)
  mes_consumo:  string  // "AAAA-MM"
  valor_cop:    number
  archivo:      string  // Nombre del archivo de origen (para trazabilidad)
  detalle?:     Record<string, unknown>
}

/**
 * Parser de Insumos STR.
 *
 * Recibe uno o varios archivos (xlsx/csv) y, según la lógica de análisis
 * (a definir por el usuario), produce un cargo por (operador, mes_consumo).
 *
 * Por ahora retorna lista vacía con una alerta — la lógica de análisis
 * se completará cuando el usuario defina las reglas de transformación.
 */
export async function parsearInsumosSTR(
  buffers: { buffer: Buffer; nombre: string }[],
  anio: number,
  mes: number,
): Promise<ResultadoParser<FilaSTR>> {
  void anio; void mes
  const alertas: string[]         = []
  const erroresCriticos: string[] = []
  const filas: FilaSTR[]          = []

  if (buffers.length === 0) {
    erroresCriticos.push("No se recibió ningún archivo.")
    return { filas, alertas, erroresCriticos }
  }

  alertas.push(
    `Recibidos ${buffers.length} archivo(s): ${buffers.map(b => b.nombre).join(", ")}. ` +
    "La lógica de análisis de Insumos STR aún no está implementada — los cargos se calcularán " +
    "cuando se defina la transformación.",
  )

  return { filas, alertas, erroresCriticos }
}
