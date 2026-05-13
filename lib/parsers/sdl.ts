import { FilaSDL, MapeoColumnas, ResultadoParser } from "@/lib/parsers/types"

export async function parsearSDL(
  _buffer: Buffer,
  _mapeo: MapeoColumnas | null,
  _orId: string,
  _periodoId: string | null,
  _anio: number,
  _mes: number
): Promise<ResultadoParser<FilaSDL>> {
  void _buffer
  void _mapeo
  void _orId
  void _periodoId
  void _anio
  void _mes
  return {
    filas: [],
    alertas: ["Parser SDL en modo mock."],
    erroresCriticos: [],
  }
}
