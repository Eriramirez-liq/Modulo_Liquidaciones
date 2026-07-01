/**
 * POST /api/gestiones/accionable
 *
 * Registra (upsert) el accionable de una frontera con diferencia, por concepto.
 * Idempotente por la unique (periodo_id, concepto, codigo_frontera): reintentos
 * sobreescriben el mismo registro sin duplicar.
 *
 * Handler DELGADO: auth → parsear → validar Zod → upsert → responder.
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { AccionGestion } from "@prisma/client"
import { accionableSchema } from "@/lib/validation/gestiones"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  // 1. Parsear body JSON.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "El cuerpo de la solicitud no es JSON valido." },
      { status: 400 },
    )
  }

  // 2. Validar con Zod ANTES de tocar la DB.
  const parsed = accionableSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos invalidos", issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { periodoId, concepto, codigoFrontera, orId, accion, datosAjustados, observacion } =
    parsed.data

  // Solo AJUSTE_APLICADO persiste datos_ajustados; el resto guarda [].
  const datos =
    accion === AccionGestion.AJUSTE_APLICADO ? (datosAjustados ?? []) : []

  // 3. Upsert idempotente por la unique.
  try {
    const g = await db.gestionFrontera.upsert({
      where: {
        uq_gestion_periodo_concepto_frontera: {
          periodo_id: periodoId,
          concepto,
          codigo_frontera: codigoFrontera,
        },
      },
      create: {
        periodo_id: periodoId,
        concepto,
        codigo_frontera: codigoFrontera,
        or_id: orId ?? null,
        accion,
        datos_ajustados: datos,
        observacion: observacion ?? null,
        gestionado_por_id: session.user.id,
      },
      update: {
        or_id: orId ?? null,
        accion,
        datos_ajustados: datos,
        observacion: observacion ?? null,
        gestionado_por_id: session.user.id,
        gestionado_at: new Date(),
      },
      select: {
        accion: true,
        datos_ajustados: true,
        observacion: true,
        gestionado_at: true,
      },
    })

    return NextResponse.json({
      accion: g.accion,
      datosAjustados: g.datos_ajustados,
      observacion: g.observacion,
      gestionadoAt: g.gestionado_at.toISOString(),
    })
  } catch (e) {
    console.error("[gestiones/accionable POST] error inesperado:", e)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
