/**
 * POST /api/cargos-str/netsuite/lote/:loteId/cancelar — Endpoint 6: cancelar.
 *
 * Handler DELGADO (plan §B.2). Cancela un lote EN_PROGRESO que no tenga envíos
 * PROCESANDO. La operación es transaccional dentro del service.
 *
 * El FE (mock `mockPostCancelar`) hoy resuelve void y rechaza 409 si hay envíos
 * PROCESANDO. Devolvemos 200 con `{ loteId, estado }` (mismo mapeo que el GET de
 * lote: `loteId: lote.id`, `estado: lote.estado` = "CANCELADO").
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.2 (endpoint 6).
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cancelarLote } from "@/lib/integrations/netsuite/service"
import { isNetsuiteServiceError } from "@/lib/integrations/netsuite/errors"

export const runtime = "nodejs"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ loteId: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "No autorizado" },
      { status: 401 },
    )
  }

  const { loteId } = await params

  try {
    // `cancelarLote` lanza:
    //  - LoteNoEncontradoError (404, LOTE_NO_ENCONTRADO) si no existe.
    //  - LoteNoCancelableError (409, LOTE_NO_CANCELABLE) si no está EN_PROGRESO
    //    o tiene envíos PROCESANDO.
    const lote = await cancelarLote(loteId)
    return NextResponse.json(
      { loteId: lote.id, estado: lote.estado },
      { status: 200 },
    )
  } catch (e) {
    if (isNetsuiteServiceError(e)) {
      return NextResponse.json(e.toResponse(), { status: e.httpStatus })
    }
    console.error(`[netsuite/lote/${loteId}/cancelar POST] error inesperado:`, e)
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Error interno" },
      { status: 500 },
    )
  }
}
