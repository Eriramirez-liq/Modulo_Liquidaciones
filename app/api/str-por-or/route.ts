import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/str-por-or?periodoId=<CUID>
 *
 * Devuelve el valor STR a pagar agrupado por operador de red para el período.
 * A diferencia de facturación/SDL/TC1, registros_str usa el CUID del período
 * (periodo.id) como clave, así que NO se convierte a string "AAAA-MM".
 * Solo lectura (idempotente). Montos a number solo para display.
 */
export const runtime = "nodejs"

interface OperadorSTR {
  orCodigo: string
  orNombre: string
  valorCop: number
}

interface RespuestaSTRPorOR {
  operadores: OperadorSTR[]
  total: number
}

const VACIO: RespuestaSTRPorOR = { operadores: [], total: 0 }

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoId = searchParams.get("periodoId")
  if (!periodoId) return NextResponse.json({ error: "periodoId requerido" }, { status: 400 })

  const periodo = await db.periodoConciliacion.findUnique({
    where: { id: periodoId },
    select: { id: true },
  })
  if (!periodo) return NextResponse.json(VACIO)

  // registros_str.periodo_id = CUID del período.
  const grupos = await db.registroSTR.groupBy({
    by: ["or_id"],
    where: { periodo_id: periodoId },
    _sum: { valor_cop: true },
  })

  const orIds = grupos.map((g) => g.or_id)
  const configs = await db.configuracionOR.findMany({
    where: { id: { in: orIds } },
    select: { id: true, codigo: true, nombre: true },
  })
  const configPorId = new Map(configs.map((c) => [c.id, c]))

  const operadores: OperadorSTR[] = grupos
    .map((g) => {
      const cfg = configPorId.get(g.or_id)
      return {
        orCodigo: cfg?.codigo ?? g.or_id,
        orNombre: cfg?.nombre ?? g.or_id,
        valorCop: Number(g._sum.valor_cop ?? 0),
      }
    })
    .sort((a, b) => a.orNombre.localeCompare(b.orNombre))

  const total = operadores.reduce((acc, o) => acc + o.valorCop, 0)

  return NextResponse.json({ operadores, total })
}
