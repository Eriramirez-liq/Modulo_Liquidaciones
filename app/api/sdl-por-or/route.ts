import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/sdl-por-or?periodoId=<CUID>
 *
 * Devuelve el total de SDL (activa + reactiva) agrupado por operador de red para
 * el periodo. Los montos se convierten a number SOLO para display (los Decimal
 * de Prisma quedan en escala 18,2; el cálculo financiero real vive en otros
 * flujos). Idempotente: solo lectura.
 */
export const runtime = "nodejs"

interface OperadorSDL {
  orCodigo: string
  orNombre: string
  activaCop: number
  reactivaCop: number
  totalCop: number
}

interface RespuestaSDLPorOR {
  operadores: OperadorSDL[]
  totales: { activaCop: number; reactivaCop: number; totalCop: number }
}

const VACIO: RespuestaSDLPorOR = {
  operadores: [],
  totales: { activaCop: 0, reactivaCop: 0, totalCop: 0 },
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoId = searchParams.get("periodoId")
  if (!periodoId) return NextResponse.json({ error: "periodoId requerido" }, { status: 400 })

  // El periodoId entrante es el CUID; los registros usan la clave string "AAAA-MM".
  const periodo = await db.periodoConciliacion.findUnique({
    where: { id: periodoId },
    select: { anio: true, mes: true },
  })
  if (!periodo) return NextResponse.json(VACIO)
  const periodoStr = `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`

  // Agregación por operador de red, excluyendo duplicados.
  const grupos = await db.registroSDL.groupBy({
    by: ["or_id"],
    where: { periodo_id: periodoStr, es_duplicado: false },
    _sum: { valor_sdl_cop: true, valor_reactiva_cop: true },
  })

  // Resolver or_id (CUID) → { codigo, nombre }.
  const orIds = grupos.map((g) => g.or_id)
  const configs = await db.configuracionOR.findMany({
    where: { id: { in: orIds } },
    select: { id: true, codigo: true, nombre: true },
  })
  const configPorId = new Map(configs.map((c) => [c.id, c]))

  const operadores: OperadorSDL[] = grupos.map((g) => {
    const cfg = configPorId.get(g.or_id)
    const activaCop = Number(g._sum.valor_sdl_cop ?? 0)
    const reactivaCop = Number(g._sum.valor_reactiva_cop ?? 0)
    return {
      orCodigo: cfg?.codigo ?? g.or_id,
      orNombre: cfg?.nombre ?? g.or_id,
      activaCop,
      reactivaCop,
      totalCop: activaCop + reactivaCop,
    }
  })

  operadores.sort((a, b) => a.orNombre.localeCompare(b.orNombre))

  const totales = operadores.reduce(
    (acc, o) => ({
      activaCop: acc.activaCop + o.activaCop,
      reactivaCop: acc.reactivaCop + o.reactivaCop,
      totalCop: acc.totalCop + o.totalCop,
    }),
    { activaCop: 0, reactivaCop: 0, totalCop: 0 },
  )

  return NextResponse.json({ operadores, totales })
}
