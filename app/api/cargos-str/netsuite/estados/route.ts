/**
 * GET /api/cargos-str/netsuite/estados — Endpoint 4: estados por cargo.
 *
 * Handler DELGADO (plan §B.2): auth → extraer/validar query CSV con Zod →
 * delegar en `obtenerEstadosPorCargo` → devolver el Record tal cual.
 *
 * El FE consume el `Record<\`${periodoId}|${orCodigo}\`, EstadoEnvioPorCargoDto>`
 * para pintar los badges de estado de cada cargo. No se reenvuelve.
 *
 * Query params (CSV): ?periodoIds=a,b&orCodigos=AFINIA,AIRE
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.2 (endpoint 4).
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { obtenerEstadosPorCargo } from "@/lib/integrations/netsuite/service"
import { isNetsuiteServiceError } from "@/lib/integrations/netsuite/errors"
import { estadosQuerySchema, extractEstadosQuery } from "@/lib/validation/netsuite"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "No autorizado" },
      { status: 401 },
    )
  }

  // 1. Extraer los CSV crudos del searchParams y validar con Zod ANTES de tocar la DB.
  //    `extractEstadosQuery` parte por comas, hace trim y filtra vacíos; el schema
  //    exige al menos un periodoId y un orCodigo no vacíos.
  const parsed = estadosQuerySchema.safeParse(
    extractEstadosQuery(request.nextUrl.searchParams),
  )
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "VALIDATION_ERROR",
        message: "Los parámetros de consulta no son válidos. Se requieren 'periodoIds' y 'orCodigos'.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  // 2. Delegar en el servicio y devolver el Record tal cual lo consume el FE.
  try {
    const estados = await obtenerEstadosPorCargo(
      parsed.data.periodoIds,
      parsed.data.orCodigos,
    )
    return NextResponse.json(estados, { status: 200 })
  } catch (e) {
    if (isNetsuiteServiceError(e)) {
      return NextResponse.json(e.toResponse(), { status: e.httpStatus })
    }
    console.error("[netsuite/estados GET] error inesperado:", e)
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Error interno" },
      { status: 500 },
    )
  }
}
