import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const operadores = await db.configuracionOR.findMany({
    where: { activo: true },
    select: { id: true, codigo: true, nombre: true, nit: true },
    orderBy: { codigo: "asc" },
  })

  return NextResponse.json(operadores)
}
