import { FilaXM, ResultadoParser } from "@/lib/parsers/types"

export async function parsearXM(
  _buffer: Buffer,
  _periodoId: string | null,
  _anio: number,
  _mes: number
): Promise<ResultadoParser<FilaXM>> {
  void _buffer
  void _periodoId
  void _anio
  void _mes
  return {
    filas: [],
    alertas: ["Parser XM en modo mock."],
    erroresCriticos: [],
  }
}
