import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const includeMapeo = new URL(request.url).searchParams.get("includeMapeo") === "true"

  const operadores = await db.configuracionOR.findMany({
    where: { activo: true },
    select: {
      id: true, codigo: true, nombre: true, nit: true, activo: true,
      ...(includeMapeo ? { mapeo_sdl_json: true } : {}),
    },
    orderBy: { codigo: "asc" },
  })

  return NextResponse.json(operadores)
}
