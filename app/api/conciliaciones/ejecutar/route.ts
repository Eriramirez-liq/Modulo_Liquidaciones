import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { ejecutarConciliacion } from "@/lib/engine/conciliacion-orchestrator"
import { ejecutarConciliacionTC1 } from "@/lib/engine/conciliacion-tc1"
import { esPeriodoPermitido } from "@/lib/utils/periodos"

/**
 * POST /api/conciliaciones/ejecutar
 *
 * Ejecuta el motor de conciliación para un período (y opcionalmente filtrado
 * por un OR). Idempotente: cada ejecución borra los resultados previos del
 * período y vuelve a generar todo.
 *
 * Body: { anio: number, mes: number, orId?: string, tipo?: "SDL" | "TC1" }
 *   tipo default "SDL". "TC1" concilia nivel de tensión y propiedad de
 *   activos contra Facturación.
 *
 * Response 200: { ok: true, tipo, resumen }
 * Response 4xx: { error: string }
 */

export const runtime     = "nodejs"
// Correr el período completo (sin OR) + la consulta de G de bolsa a Metabase
// puede tomar más que el default; damos margen.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  let body: { anio?: number; mes?: number; orId?: string | null; tipo?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const anio = Number(body.anio)
  const mes  = Number(body.mes)
  const orId = body.orId ?? undefined
  const tipo = (body.tipo ?? "SDL").toUpperCase()

  if (!anio || !mes) {
    return NextResponse.json({ error: "Parámetros anio y mes son obligatorios." }, { status: 400 })
  }

  // Solo conciliar hasta el mes anterior (periodo de consumo cerrado).
  if (!esPeriodoPermitido(anio, mes)) {
    return NextResponse.json(
      { error: "Solo se puede conciliar hasta el mes anterior (mes de consumo)." },
      { status: 400 }
    )
  }

  if (tipo !== "SDL" && tipo !== "TC1") {
    return NextResponse.json(
      { error: `Tipo de conciliación no soportado: ${tipo}. Use SDL o TC1.` },
      { status: 400 }
    )
  }

  try {
    if (tipo === "TC1") {
      const resumen = await ejecutarConciliacionTC1({ anio, mes, orId, userId: session.user.id })
      return NextResponse.json({ ok: true, tipo: "TC1", resumen })
    }
    const resumen = await ejecutarConciliacion({
      anio, mes, orId,
      userId: session.user.id,
    })
    return NextResponse.json({ ok: true, tipo: "SDL", resumen })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[conciliaciones/ejecutar] error:", e)
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    )
  }
}
