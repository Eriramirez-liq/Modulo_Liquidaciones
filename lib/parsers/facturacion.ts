import { FilaFacturacion, ResultadoParser } from "@/lib/parsers/types"

export async function parsearFacturacion(
  _buffer: Buffer,
  _periodo: string
): Promise<ResultadoParser<FilaFacturacion>> {
  void _buffer
  void _periodo
  return {
    filas: [],
    alertas: ["Parser de facturacion en modo mock."],
    erroresCriticos: [],
  }
}
