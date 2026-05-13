import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma, TipoFuente } from "@prisma/client"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const anio     = searchParams.get("anio")    ? Number(searchParams.get("anio"))    : undefined
  const mes      = searchParams.get("mes")     ? Number(searchParams.get("mes"))     : undefined
  const fuente   = searchParams.get("fuente")  ?? undefined
  const orId     = searchParams.get("orId")    ?? undefined
  const page     = Number(searchParams.get("page") ?? "1")
  const pageSize = 50

  const where: Prisma.CargaFuenteWhereInput = {
    ...(anio !== undefined || mes !== undefined
      ? {
          periodo: {
            is: {
              ...(anio !== undefined ? { anio } : {}),
              ...(mes !== undefined ? { mes } : {}),
            },
          },
        }
      : {}),
    ...(fuente ? { tipo_fuente: fuente as TipoFuente } : {}),
    ...(orId ? { or_id: orId } : {}),
  }

  const cargas = await db.cargaFuente.findMany({
    where,
    include: {
      periodo: { select: { anio: true, mes: true } },
      operador_red: { select: { codigo: true, nombre: true } },
      cargado_por: { select: { nombre: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  const total = await db.cargaFuente.count({ where })

  return NextResponse.json({ cargas, total, page, pageSize })
}
