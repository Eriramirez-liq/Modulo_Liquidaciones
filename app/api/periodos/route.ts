import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const periodos = await db.periodoConciliacion.findMany({
    select: { id: true, anio: true, mes: true, estado: true },
    orderBy: [{ anio: "desc" }, { mes: "desc" }],
  })

  return NextResponse.json(periodos)
}
