/**
 * GET /api/cargos-str/netsuite/lote/activo — Endpoint 7 (D5): lote activo.
 *
 * Handler DELGADO (plan §B.2): auth → delegar en `obtenerLoteActivo` →
 * mapear LoteDto al MISMO shape que GET /lote/:loteId (BE-3) para consistencia
 * del FE (panel + polling).
 *
 * RUTA ESTÁTICA vs DINÁMICA: este `lote/activo` convive con `lote/[loteId]`.
 * En App Router las rutas estáticas tienen prioridad sobre las dinámicas, así
 * que `/lote/activo` resuelve SIEMPRE a este handler y nunca cae en `[loteId]`.
 *
 * Si no hay lote EN_PROGRESO → 204 sin body (señal al FE de "no hay lote activo").
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.2 (endpoint 7, D5).
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { obtenerLoteActivo } from "@/lib/integrations/netsuite/service"
import { isNetsuiteServiceError } from "@/lib/integrations/netsuite/errors"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(_request: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "No autorizado" },
      { status: 401 },
    )
  }

  try {
    const lote = await obtenerLoteActivo()

    // Sin lote EN_PROGRESO → 204 sin body. El FE lo interpreta como "no hay activo".
    if (lote === null) {
      return new NextResponse(null, { status: 204 })
    }

    // Mismo shape que GET /lote/:loteId (BE-3): `loteId`/`totalEnvios` sueltos.
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
    console.error("[netsuite/lote/activo GET] error inesperado:", e)
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Error interno" },
      { status: 500 },
    )
  }
}
