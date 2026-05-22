import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { ejecutarConciliacion } from "@/lib/engine/conciliacion-orchestrator"

/**
 * POST /api/conciliaciones/ejecutar
 *
 * Ejecuta el motor de conciliación SDL para un período (y opcionalmente
 * filtrado por un OR). Idempotente: cada ejecución borra los resultados
 * previos del período y vuelve a generar todo.
 *
 * Body: { anio: number, mes: number, orId?: string }
 *
 * Response 200: { ok: true, resumen: ResumenConciliacion }
 * Response 4xx: { error: string }
 */

export const runtime     = "nodejs"
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  let body: { anio?: number; mes?: number; orId?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const anio = Number(body.anio)
  const mes  = Number(body.mes)
  const orId = body.orId ?? undefined

  if (!anio || !mes) {
    return NextResponse.json({ error: "Parámetros anio y mes son obligatorios." }, { status: 400 })
  }

  // No permitir conciliar períodos futuros (espejo del check de cargas)
  const ahora = new Date()
  if (anio > ahora.getFullYear() || (anio === ahora.getFullYear() && mes > ahora.getMonth() + 1)) {
    return NextResponse.json(
      { error: "No se puede conciliar un período futuro." },
      { status: 400 }
    )
  }

  try {
    const resumen = await ejecutarConciliacion({
      anio, mes, orId,
      userId: session.user.id,
    })
    return NextResponse.json({ ok: true, resumen })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[conciliaciones/ejecutar] error:", e)
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    )
  }
}
