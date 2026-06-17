import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { STR_OPERADORES, SDL_OPERADORES } from "@/lib/constants/operadores"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const url = new URL(request.url)
  const includeMapeo = url.searchParams.get("includeMapeo") === "true"
  const tipo         = url.searchParams.get("tipo")

  const whitelist =
    tipo === "str" ? STR_OPERADORES :
    tipo === "sdl" ? SDL_OPERADORES :
    null

  const operadores = await db.configuracionOR.findMany({
    where: {
      activo: true,
      ...(whitelist ? { codigo: { in: whitelist } } : {}),
    },
    select: {
      id: true, codigo: true, nombre: true, nit: true, activo: true,
      netsuite_vendor_id: true,
      ...(includeMapeo ? { mapeo_sdl_json: true } : {}),
    },
    orderBy: { codigo: "asc" },
  })

  return NextResponse.json(operadores)
}
