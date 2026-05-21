import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { TipoFuente } from "@prisma/client"

/**
 * POST /api/cargas/check-previa
 *
 * Verifica si ya existe una carga COMPLETADA para el (período, tipoFuente, orId)
 * indicado. Se usa cuando el archivo se parsea en el navegador (para evitar el
 * límite de 4.5 MB de Vercel en uploads) y necesitamos saber si hay que pedir
 * justificación de reemplazo.
 *
 * Body: { anio, mes, tipoFuente, orId? }
 * Response: { existeCargaPrevia, cargaPreviaId, periodoFuturo? }
 */
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const body = (await request.json()) as {
    anio?: number; mes?: number; tipoFuente?: string; orId?: string | null
  }
  const anio       = Number(body.anio)
  const mes        = Number(body.mes)
  const tipoFuente = body.tipoFuente
  const orId       = body.orId ?? null

  if (!anio || !mes || !tipoFuente) {
    return NextResponse.json({ error: "Parametros incompletos" }, { status: 400 })
  }

  // Rechazar periodos futuros
  const ahora = new Date()
  if (anio > ahora.getFullYear() || (anio === ahora.getFullYear() && mes > ahora.getMonth() + 1)) {
    return NextResponse.json(
      { error: "No se pueden cargar archivos para periodos futuros." },
      { status: 400 }
    )
  }

  const periodoExistente = await db.periodoConciliacion.findUnique({
    where: { uq_periodo_anio_mes: { anio, mes } },
    select: { id: true },
  })

  let existeCargaPrevia = false
  let cargaPreviaId: string | undefined

  if (periodoExistente && tipoFuente !== "INSUMOS_STR") {
    const cargaPrevia = await db.cargaFuente.findFirst({
      where: {
        periodo_id: periodoExistente.id,
        tipo_fuente: tipoFuente as TipoFuente,
        ...(orId ? { or_id: orId } : { or_id: null }),
        estado: "COMPLETADA",
      },
      orderBy: { createdAt: "desc" },
    })
    if (cargaPrevia) {
      existeCargaPrevia = true
      cargaPreviaId = cargaPrevia.id
    }
  }

  return NextResponse.json({ existeCargaPrevia, cargaPreviaId })
}
