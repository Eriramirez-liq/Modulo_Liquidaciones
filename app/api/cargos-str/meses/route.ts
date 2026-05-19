import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/cargos-str/meses
 *
 * Devuelve la lista de meses de consumo disponibles para el filtro de la
 * página Cargos STR. Combina los meses ya presentes en registros_str con
 * los períodos existentes en periodos_conciliacion (para que el usuario
 * pueda filtrar por meses futuros aunque aún no haya datos).
 *
 * Response: ["2026-01", "2026-02", ...] ordenado descendente (más reciente primero).
 */
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const set = new Set<string>()

  // Si la tabla registros_str aún no existe (migración pendiente),
  // simplemente seguimos con los meses de periodos_conciliacion.
  try {
    const registrosMeses = await db.registroSTR.findMany({
      select: { mes_consumo: true },
      distinct: ["mes_consumo"],
    })
    for (const r of registrosMeses) set.add(r.mes_consumo)
  } catch (e) {
    console.warn("[cargos-str/meses] registros_str no disponible:", e)
  }

  // Fallback: meses derivados de los períodos de conciliación existentes.
  try {
    const periodos = await db.periodoConciliacion.findMany({
      select: { anio: true, mes: true },
      orderBy: [{ anio: "desc" }, { mes: "desc" }],
    })
    for (const p of periodos) set.add(`${p.anio}-${String(p.mes).padStart(2, "0")}`)
  } catch (e) {
    console.warn("[cargos-str/meses] periodos_conciliacion no disponible:", e)
  }

  // Si no hay nada en DB, ofrecer los últimos 12 meses como opciones por defecto
  // (así el usuario puede al menos filtrar aunque aún no haya datos).
  if (set.size === 0) {
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
    }
  }

  const meses = Array.from(set).sort().reverse()
  return NextResponse.json(meses)
}
