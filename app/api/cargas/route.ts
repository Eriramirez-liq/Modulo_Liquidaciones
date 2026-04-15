import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

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

  const cargas = await db.cargaFuente.findMany({
    where: {
      ...(anio !== undefined && mes !== undefined
        ? { periodo: { anio, mes } }
        : anio !== undefined
        ? { periodo: { anio } }
        : {}),
      ...(fuente ? { tipo_fuente: fuente as "FACTURACION" | "XM" | "SDL" | "BALANCE" } : {}),
      ...(orId ? { or_id: orId } : {}),
    },
    include: {
      periodo: { select: { anio: true, mes: true } },
      operador_red: { select: { codigo: true, nombre: true } },
      cargado_por: { select: { nombre: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  const total = await db.cargaFuente.count({
    where: {
      ...(anio !== undefined && mes !== undefined ? { periodo: { anio, mes } } : {}),
      ...(fuente ? { tipo_fuente: fuente as "FACTURACION" | "XM" | "SDL" | "BALANCE" } : {}),
      ...(orId ? { or_id: orId } : {}),
    },
  })

  return NextResponse.json({ cargas, total, page, pageSize })
}
