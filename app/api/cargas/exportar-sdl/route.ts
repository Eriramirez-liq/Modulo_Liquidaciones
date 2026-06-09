import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import * as XLSX from "xlsx"

/**
 * GET /api/cargas/exportar-sdl?cargaId=X
 *
 * Genera un .xlsx con todos los registros SDL de una carga (preliquidacion
 * del operador). Una fila por frontera con todos los campos guardados.
 */
export const runtime = "nodejs"

const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const cargaId = searchParams.get("cargaId")
  if (!cargaId) return NextResponse.json({ error: "cargaId requerido" }, { status: 400 })

  const carga = await db.cargaFuente.findUnique({
    where: { id: cargaId },
    select: {
      id: true, tipo_fuente: true, nombre_archivo: true,
      periodo: { select: { anio: true, mes: true } },
      operador_red: { select: { codigo: true, nombre: true } },
    },
  })
  if (!carga) return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 })
  if (carga.tipo_fuente !== "SDL") {
    return NextResponse.json({ error: "La exportación solo aplica a cargas SDL." }, { status: 400 })
  }

  const registros = await db.registroSDL.findMany({
    where: { carga_id: cargaId },
    orderBy: { codigo_frontera: "asc" },
  })

  const filas = registros.map(r => ({
    "Código Frontera":            r.codigo_frontera,
    "Nombre Frontera":            r.nombre_frontera ?? "",
    "Periodo":                    r.periodo_sdl,
    "Energía Activa (kWh)":       num(r.energia_sdl_kwh),
    "Valor SDL (COP)":            num(r.valor_sdl_cop),
    "Tarifa SDL ($/kWh)":         num(r.tarifa_sdl),
    "Nivel de Tensión":           r.nivel_tension ?? "",
    "Propiedad de Activos":       r.propiedad_activos ?? "",
    "Reactiva Inductiva Pen. (kVArh)":  num(r.energia_reactiva_ind_pen),
    "Reactiva Capacitiva Pen. (kVArh)": num(r.energia_reactiva_cap_pen),
    "Valor Reactiva (COP)":       num(r.valor_reactiva_cop),
    "Tarifa Reactiva ($/kVArh)":  num(r.tarifa_reactiva),
    "Factor M":                   num(r.factor_m),
  }))

  const wb = XLSX.utils.book_new()
  const ws = filas.length > 0
    ? XLSX.utils.json_to_sheet(filas)
    : XLSX.utils.aoa_to_sheet([["La carga no tiene registros SDL."]])
  XLSX.utils.book_append_sheet(wb, ws, "SDL")

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  const orCod = carga.operador_red?.codigo ?? "OR"
  const periodoStr = carga.periodo ? `${carga.periodo.anio}-${String(carga.periodo.mes).padStart(2, "0")}` : "periodo"
  const fname = `sdl_${orCod}_${periodoStr}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  })
}
