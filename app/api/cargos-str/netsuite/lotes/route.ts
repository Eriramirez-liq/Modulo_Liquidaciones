/**
 * GET /api/cargos-str/netsuite/lotes — historial de lotes (plural).
 *
 * Distinto de `/lote/:loteId` (detalle con envíos). Aquí se devuelven solo
 * resúmenes ordenados por fecha desc. El detalle de cada lote (envíos, OC,
 * errores) lo sigue dando el endpoint singular, que el FE reusa.
 *
 * Handler DELGADO: auth → parseo de `?limite=` → servicio → serialización.
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listarLotes } from "@/lib/integrations/netsuite/service"
import { isNetsuiteServiceError } from "@/lib/integrations/netsuite/errors"

export const runtime = "nodejs"

const LIMITE_DEFAULT = 50
const LIMITE_MAX = 200

/** Parsea `?limite=` a un entero válido en [1, LIMITE_MAX], con fallback. */
function parseLimite(raw: string | null): number {
  if (raw === null) return LIMITE_DEFAULT
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return LIMITE_DEFAULT
  return Math.min(n, LIMITE_MAX)
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "No autorizado" },
      { status: 401 },
    )
  }

  const url = new URL(request.url)
  const limite = parseLimite(url.searchParams.get("limite"))

  try {
    const lotes = await listarLotes(limite)
    return NextResponse.json({ lotes }, { status: 200 })
  } catch (e) {
    if (isNetsuiteServiceError(e)) {
      return NextResponse.json(e.toResponse(), { status: e.httpStatus })
    }
    console.error("[netsuite/lotes GET] error inesperado:", e)
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Error interno" },
      { status: 500 },
    )
  }
}
