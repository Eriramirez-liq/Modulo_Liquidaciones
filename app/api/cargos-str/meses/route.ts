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

  const [registrosMeses, periodos] = await Promise.all([
    db.registroSTR.findMany({
      select: { mes_consumo: true },
      distinct: ["mes_consumo"],
    }),
    db.periodoConciliacion.findMany({
      select: { anio: true, mes: true },
      orderBy: [{ anio: "desc" }, { mes: "desc" }],
    }),
  ])

  const set = new Set<string>()
  for (const r of registrosMeses) set.add(r.mes_consumo)
  for (const p of periodos) set.add(`${p.anio}-${String(p.mes).padStart(2, "0")}`)

  const meses = Array.from(set).sort().reverse()
  return NextResponse.json(meses)
}
