/**
 * GET /api/gestiones?concepto=SDL|TC1|COT&periodoId=&orId=
 *
 * Lista fronteras CON DIFERENCIA de conciliacion por concepto, mergeadas con su
 * accionable guardado (gestiones_frontera). Handler DELGADO: auth → validar
 * query → delegar en listarGestiones → responder. La logica vive en
 * lib/engine/gestiones.ts.
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listarGestiones, type ConceptoGestionStr } from "@/lib/engine/gestiones"

export const runtime = "nodejs"

const CONCEPTOS: readonly ConceptoGestionStr[] = ["SDL", "TC1", "COT"]

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const conceptoRaw = (searchParams.get("concepto") ?? "SDL").toUpperCase()
  const periodoId = searchParams.get("periodoId") ?? undefined
  const orId = searchParams.get("orId") ?? undefined

  const concepto = CONCEPTOS.find((c) => c === conceptoRaw)
  if (!concepto) {
    return NextResponse.json(
      { error: "concepto invalido; use SDL, TC1 o COT" },
      { status: 400 },
    )
  }

  try {
    const filas = await listarGestiones(concepto, periodoId, orId)
    return NextResponse.json(filas)
  } catch (e) {
    console.error("[gestiones GET] error inesperado:", e)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
