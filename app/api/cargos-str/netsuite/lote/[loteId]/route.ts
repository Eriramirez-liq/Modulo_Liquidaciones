/**
 * GET /api/cargos-str/netsuite/lote/:loteId — Endpoint 3: obtener lote.
 *
 * Handler DELGADO (plan §B.2). Lo consume el polling del FE para ver el progreso
 * del procesamiento. Devuelve el LoteDto mapeado al shape que el FE espera
 * (`loteId`/`totalEnvios` sueltos, ver _dev/mocks/netsuite.ts `LoteResponse`).
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.2 (endpoint 3).
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { obtenerLote } from "@/lib/integrations/netsuite/service"
import { isNetsuiteServiceError } from "@/lib/integrations/netsuite/errors"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(
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
    // `obtenerLote` lanza LoteNoEncontradoError (404) si no existe.
    const lote = await obtenerLote(loteId)
    return NextResponse.json(
      {
        loteId: lote.id,
        estado: lote.estado,
        totalEnvios: lote.totales.total,
        iniciadoAt: lote.iniciadoAt,
        finalizadoAt: lote.finalizadoAt,
        iniciadoPor: lote.iniciadoPor,
        totales: lote.totales,
        envios: lote.envios,
      },
      { status: 200 },
    )
  } catch (e) {
    if (isNetsuiteServiceError(e)) {
      return NextResponse.json(e.toResponse(), { status: e.httpStatus })
    }
    console.error(`[netsuite/lote/${loteId} GET] error inesperado:`, e)
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Error interno" },
      { status: 500 },
    )
  }
}
