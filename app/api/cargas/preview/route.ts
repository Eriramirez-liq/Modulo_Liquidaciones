import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { parsearFacturacion } from "@/lib/parsers/facturacion"
import { parsearXM } from "@/lib/parsers/xm"
import { parsearSDL } from "@/lib/parsers/sdl"
import { parsearBalance } from "@/lib/parsers/balance"
import { parsearInsumosSTR } from "@/lib/parsers/insumos-str"

import { TipoFuente } from "@prisma/client"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const formData = await request.formData()
  const file       = formData.get("file") as File | null
  const filesMulti = formData.getAll("files") as File[]
  const anio       = Number(formData.get("anio"))
  const mes        = Number(formData.get("mes"))
  const tipoFuente = formData.get("tipoFuente") as string
  const orId       = formData.get("orId") as string | null

  const hasAnyFile = (file != null) || (filesMulti.length > 0)
  if (!hasAnyFile || !anio || !mes || !tipoFuente) {
    return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 })
  }

  // Buffer del archivo principal (single-file mode). Para INSUMOS_STR usamos filesMulti.
  const buffer = file ? Buffer.from(await file.arrayBuffer()) : Buffer.alloc(0)
  const periodo = `${anio}-${String(mes).padStart(2, "0")}`

  // Verificar si ya existe carga para este período+fuente+OR
  const periodoExistente = await db.periodoConciliacion.findUnique({
    where: { uq_periodo_anio_mes: { anio, mes } },
    select: { id: true },
  })

  let existeCargaPrevia = false
  let cargaPreviaId: string | undefined

  if (periodoExistente) {
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

  let result
  try {
    switch (tipoFuente) {
      case "FACTURACION": {
        result = await parsearFacturacion(buffer, periodo)
        break
      }
      case "XM": {
        result = await parsearXM(buffer, periodoExistente?.id ?? null, anio, mes)
        break
      }
      case "SDL": {
        if (!orId) return NextResponse.json({ error: "orId requerido para SDL" }, { status: 400 })
        const or = await db.configuracionOR.findUnique({
          where: { id: orId },
          select: { mapeo_sdl_json: true, codigo: true },
        })
        result = await parsearSDL(
          buffer,
          or?.mapeo_sdl_json as Record<string, unknown> | null,
          orId,
          periodoExistente?.id ?? null,
          anio,
          mes,
          or?.codigo ?? undefined,
        )
        break
      }
      case "BALANCE": {
        if (!orId) return NextResponse.json({ error: "orId requerido para Balance" }, { status: 400 })
        const or = await db.configuracionOR.findUnique({
          where: { id: orId },
          select: { mapeo_balance_json: true },
        })
        result = await parsearBalance(
          buffer,
          or?.mapeo_balance_json as Record<string, string> | null,
        )
        break
      }
      case "INSUMOS_STR": {
        if (filesMulti.length === 0) {
          return NextResponse.json(
            { error: "Insumos STR requiere al menos un archivo" },
            { status: 400 }
          )
        }
        const buffers = await Promise.all(
          filesMulti.map(async (f) => ({
            buffer: Buffer.from(await f.arrayBuffer()),
            nombre: f.name,
          }))
        )
        result = await parsearInsumosSTR(buffers, anio, mes)
        break
      }
      default:
        return NextResponse.json({ error: "Tipo de fuente inválido" }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json(
      { error: "Error al parsear el archivo", detalle: String(e) },
      { status: 422 }
    )
  }

  return NextResponse.json({
    preview: result.filas.slice(0, 20),
    filasCompletas: result.filas,
    total: result.filas.length,
    alertas: result.alertas,
    erroresCriticos: result.erroresCriticos,
    existeCargaPrevia,
    cargaPreviaId,
  })
}
