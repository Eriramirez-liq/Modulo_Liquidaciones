import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

// Whitelist de operadores que aplican al módulo Cargos STR.
// Listados por código en configuracion_or.
const STR_OPERADORES = [
  "AFINIA", "AIRE", "BAJO_PUTUMAYO", "CEDENAR", "CELSIA_VALLE", "CENS", "CEO",
  "CHEC", "DISPAC", "EBSA", "EDEQ", "EEP_PEREIRA", "ELECTROCAQUETA",
  "ELECTROHUILA", "EMCALI", "EMSA", "ENEL", "ENELAR", "ENERCA",
  "ENERGUAVIARE", "EPM", "ESSA", "PUTUMAYO",
]

// Whitelist de operadores que aplican al módulo SDL. Son los 21 ORs que
// requieren mapeo de estructura para cargar el archivo de preliquidación.
// Lista provista por el negocio (Erika, 2026-05-27).
const SDL_OPERADORES = [
  "AFINIA", "AIRE", "CEDENAR", "CETSA", "CELSIA_VALLE", "CELSIA_TOLIMA",
  "CENS", "CEO", "CHEC", "EBSA", "EDEQ", "EEP_PEREIRA", "ELECTROHUILA",
  "EMCALI", "EMSA", "ENEL", "ENERCA", "EPM", "ESSA", "EEP_CARTAGO",
  "RUITOQUE",
]

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
      ...(includeMapeo ? { mapeo_sdl_json: true } : {}),
    },
    orderBy: { codigo: "asc" },
  })

  return NextResponse.json(operadores)
}
