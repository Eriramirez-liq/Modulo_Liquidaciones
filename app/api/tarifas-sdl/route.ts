import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"

/**
 * GET /api/tarifas-sdl?periodo=&orCodigo=&nivel=
 *
 * Devuelve las tarifas SDL calculadas, filtradas. "todos" = sin filtro.
 * Tambien devuelve las opciones de filtro disponibles (periodos y ORs).
 */
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  // Listas separadas por coma (multi-seleccion). Vacio = todos.
  const periodos  = (searchParams.get("periodos")  ?? "").split(",").filter(Boolean)
  const orCodigos = (searchParams.get("orCodigos") ?? "").split(",").filter(Boolean)
  const nivel     = searchParams.get("nivel") ?? undefined

  const where: Prisma.TarifaSDLWhereInput = {
    ...(periodos.length  > 0 ? { periodo: { in: periodos } } : {}),
    ...(orCodigos.length > 0 ? { or_codigo: { in: orCodigos } } : {}),
    ...(nivel ? { nivel_tension: nivel } : {}),
  }

  const [rows, periodosRaw, orsRaw] = await Promise.all([
    db.tarifaSDL.findMany({
      where,
      orderBy: [{ periodo: "desc" }, { or_codigo: "asc" }, { nivel_tension: "asc" }],
      take: 2000,
    }),
    db.tarifaSDL.findMany({ select: { periodo: true }, distinct: ["periodo"], orderBy: { periodo: "desc" } }),
    db.tarifaSDL.findMany({ select: { or_codigo: true }, distinct: ["or_codigo"], orderBy: { or_codigo: "asc" } }),
  ])

  return NextResponse.json({
    rows,
    periodos: periodosRaw.map(p => p.periodo),
    operadores: orsRaw.map(o => o.or_codigo),
  })
}
