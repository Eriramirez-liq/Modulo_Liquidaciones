/**
 * POST /api/cargos-str/netsuite/envio/:envioId/reenviar — Endpoint 5: reenviar.
 *
 * Handler DELGADO (plan §B.2). A diferencia de `procesar` (endpoint 2, que es
 * largo y se agenda con `after()`), el reenvío de un único envío es SÍNCRONO: el
 * service llama al cliente NetSuite, espera la respuesta (timeout interno de 30s)
 * y devuelve el EnvioDto ya actualizado. Por eso `maxDuration = 60`.
 *
 * El FE espera el EnvioDto completo (superset de `{ envioId, estado, numeroOc }`).
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.2 (endpoint 5).
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { reenviar } from "@/lib/integrations/netsuite/service"
import { isNetsuiteServiceError } from "@/lib/integrations/netsuite/errors"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ envioId: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "No autorizado" },
      { status: 401 },
    )
  }

  const { envioId } = await params

  try {
    // `reenviar` lanza:
    //  - EnvioNoEncontradoError (404, ENVIO_NO_ENCONTRADO) si no existe.
    //  - EnvioNoReenviableError (409, ENVIO_NO_REENVIABLE) si no está en ERROR
    //    o su lote no está EN_PROGRESO.
    // Es síncrono: espera la respuesta de NetSuite y devuelve el EnvioDto final.
    const envio = await reenviar(envioId)
    return NextResponse.json(envio, { status: 200 })
  } catch (e) {
    if (isNetsuiteServiceError(e)) {
      return NextResponse.json(e.toResponse(), { status: e.httpStatus })
    }
    console.error(`[netsuite/envio/${envioId}/reenviar POST] error inesperado:`, e)
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Error interno" },
      { status: 500 },
    )
  }
}
