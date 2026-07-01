import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { obtenerGBolsaNacional } from "@/lib/integrations/precio-bolsa"
import { MetabaseError } from "@/lib/integrations/metabase"

/**
 * GET /api/precio-bolsa?anio=AAAA&mes=M
 *
 * Devuelve la "G de bolsa" (precio de bolsa nacional promedio) del mes de
 * CONSUMO indicado, consultando la card 1237 de Metabase (date_type=month,
 * version=TxF, date=rango del mes). Útil para verificar la conexión y el valor.
 *
 * Respuesta: { valor, rango, periodoConsumo }
 */
export const runtime     = "nodejs"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const anio = Number(searchParams.get("anio"))
  const mes  = Number(searchParams.get("mes"))

  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return NextResponse.json(
      { error: "Parámetros anio y mes (1-12) son obligatorios. El mes es el de CONSUMO." },
      { status: 400 },
    )
  }

  try {
    const gb = await obtenerGBolsaNacional(anio, mes)
    return NextResponse.json(gb)
  } catch (e) {
    if (e instanceof MetabaseError) {
      return NextResponse.json(
        { error: e.message, detalle: e.body ?? undefined, status: e.status },
        { status: 502 },
      )
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Error al consultar Metabase: ${msg}` }, { status: 500 })
  }
}
