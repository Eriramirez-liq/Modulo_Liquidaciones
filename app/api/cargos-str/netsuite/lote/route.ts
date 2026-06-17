/**
 * POST /api/cargos-str/netsuite/lote — Endpoint 1: crear lote.
 *
 * Handler DELGADO (plan §B.2): auth → parsear body → validar con Zod →
 * delegar en `crearLote` → mapear LoteDto al shape que consume el FE → 201.
 *
 * Toda la lógica de dominio (advisory lock, idempotencia, snapshots de monto,
 * validaciones de negocio) vive en la capa de servicio. Aquí solo orquestamos.
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.2 (endpoint 1).
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { crearLote } from "@/lib/integrations/netsuite/service"
import { isNetsuiteServiceError } from "@/lib/integrations/netsuite/errors"
import { crearLoteSchema } from "@/lib/validation/netsuite"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "No autorizado" },
      { status: 401 },
    )
  }

  // 1. Parsear el body JSON. Body inválido → 400.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 },
    )
  }

  // 2. Validar con Zod ANTES de tocar la DB.
  const parsed = crearLoteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  // 3. Delegar en el servicio y mapear el resultado.
  try {
    const lote = await crearLote(session.user.id, parsed.data.cargos)
    // El FE espera `loteId`/`totalEnvios` sueltos (ver _dev/mocks/netsuite.ts).
    // El service devuelve el LoteDto canónico con `id`/`totales`.
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
      { status: 201 },
    )
  } catch (e) {
    if (isNetsuiteServiceError(e)) {
      return NextResponse.json(e.toResponse(), { status: e.httpStatus })
    }
    console.error("[netsuite/lote POST] error inesperado:", e)
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Error interno" },
      { status: 500 },
    )
  }
}
