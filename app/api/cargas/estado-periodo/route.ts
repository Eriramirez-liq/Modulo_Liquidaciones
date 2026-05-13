import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const anio = Number(searchParams.get("anio"))
  const mes  = Number(searchParams.get("mes"))

  if (!anio || !mes) {
    return NextResponse.json({ error: "Parámetros anio y mes requeridos" }, { status: 400 })
  }

  const periodo = await db.periodoConciliacion.findUnique({
    where: { anio_mes: { anio, mes } },
    select: { id: true },
  })

  const operadores = await db.configuracionOR.findMany({
    where: { activo: true },
    select: { id: true, codigo: true, nombre: true },
    orderBy: { codigo: "asc" },
  })

  type EstadoFuente = {
    estado: "pendiente" | "cargada" | "error"
    fecha?: string
    usuario?: string
    totalRegistros?: number
    cargaId?: string
  }

  async function estadoDe(tipoFuente: "FACTURACION" | "XM" | "SDL" | "BALANCE", orId?: string): Promise<EstadoFuente> {
    if (!periodo) return { estado: "pendiente" }

    const carga = await db.cargaFuente.findFirst({
      where: {
        periodo_id: periodo.id,
        tipo_fuente: tipoFuente,
        ...(orId ? { or_id: orId } : { or_id: null }),
      },
      include: { cargado_por: { select: { nombre: true } } },
      orderBy: { createdAt: "desc" },
    })

    if (!carga) return { estado: "pendiente" }
    return {
      estado: carga.estado === "COMPLETADA" ? "cargada" : carga.estado === "ERROR" ? "error" : "pendiente",
      fecha: carga.createdAt.toISOString(),
      usuario: carga.cargado_por.nombre,
      totalRegistros: carga.total_registros ?? undefined,
      cargaId: carga.id,
    }
  }

  const [facturacion, xm] = await Promise.all([
    estadoDe("FACTURACION"),
    estadoDe("XM"),
  ])

  const sdlResultados = await Promise.all(
    operadores.map(async (or: { id: string; codigo: string; nombre: string }) => ({
      orId: or.id,
      codigo: or.codigo,
      nombre: or.nombre,
      ...(await estadoDe("SDL", or.id)),
    }))
  )

  const balanceResultados = await Promise.all(
    operadores.map(async (or: { id: string; codigo: string; nombre: string }) => ({
      orId: or.id,
      codigo: or.codigo,
      nombre: or.nombre,
      ...(await estadoDe("BALANCE", or.id)),
    }))
  )

  return NextResponse.json({
    facturacion,
    xm,
    sdl: sdlResultados,
    balance: balanceResultados,
  })
}
