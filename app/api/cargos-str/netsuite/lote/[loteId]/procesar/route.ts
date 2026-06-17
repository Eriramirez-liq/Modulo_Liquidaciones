/**
 * POST /api/cargos-str/netsuite/lote/:loteId/procesar — Endpoint 2: procesar lote.
 *
 * Handler DELGADO (plan §B.2). El procesamiento es LARGO (secuencial, un envío a
 * la vez con timeout de 30s por envío). Estrategia para no exceder maxDuration:
 *   1. Validar que el lote exista y esté EN_PROGRESO (síncrono, barato).
 *   2. Disparar `procesarLote` SIN await (fire-and-forget con `.catch`).
 *   3. Responder 202 de inmediato. El FE consulta el progreso por polling (GET).
 *
 * Nota Vercel: el patrón promesa-no-awaitada es el mínimo del plan §B.2. La
 * función puede ser cortada por el runtime al responder; el guard de estado +
 * `updateMany` atómico del service hacen el reproceso idempotente (R11).
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.2 (endpoint 2), TD-2.
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { obtenerLote, procesarLote } from "@/lib/integrations/netsuite/service"
import {
  isNetsuiteServiceError,
  LoteNoProcesableError,
} from "@/lib/integrations/netsuite/errors"

export const runtime = "nodejs"
export const maxDuration = 60

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
    // 1. Validar estado ANTES de disparar. `obtenerLote` lanza
    //    LoteNoEncontradoError (404) si no existe.
    const lote = await obtenerLote(loteId)
    if (lote.estado !== "EN_PROGRESO") {
      throw new LoteNoProcesableError()
    }

    // 2. Fire-and-forget: NO await. El error se loguea para Vercel logs.
    void procesarLote(loteId).catch((err) => {
      console.error(`[netsuite/lote/${loteId}/procesar] fallo en background:`, err)
    })

    // 3. Responder de inmediato.
    return NextResponse.json(
      {
        loteId: lote.id,
        estado: "EN_PROGRESO" as const,
        totalEnvios: lote.totales.total,
      },
      { status: 202 },
    )
  } catch (e) {
    if (isNetsuiteServiceError(e)) {
      return NextResponse.json(e.toResponse(), { status: e.httpStatus })
    }
    console.error(`[netsuite/lote/${loteId}/procesar] error inesperado:`, e)
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Error interno" },
      { status: 500 },
    )
  }
}
