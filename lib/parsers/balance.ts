import { FilaBalance, MapeoColumnas, ResultadoParser } from "@/lib/parsers/types"

export async function parsearBalance(
  _buffer: Buffer,
  _mapeo: MapeoColumnas | null
): Promise<ResultadoParser<FilaBalance>> {
  void _buffer
  void _mapeo
  return {
    filas: [],
    alertas: ["Parser Balance en modo mock."],
    erroresCriticos: [],
  }
}
