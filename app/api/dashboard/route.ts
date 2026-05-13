import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoId = searchParams.get("periodoId") ?? undefined

  const empty = {
    totalFronteras: 0, sinDiferencia: 0,
    provisiones: 0, valorProvisiones: 0,
    contingenciasAbiertas: 0,
    disputas: 0, valorDisputas: 0,
    alertasManuales: 0, incompletas: 0, errores: 0,
    impactoEstimado: 0,
  }

  if (!periodoId) return NextResponse.json(empty)

  const [resultados, provisiones, contingencias, disputas] = await Promise.all([
    db.resultadoConciliacion.findMany({
      where: { periodo_id: periodoId },
      select: { caso: true, resultado_l1: true, impacto_financiero_l1: true, impacto_financiero_l2: true },
    }),
    db.provision.count({ where: { periodo_id: periodoId } }),
    db.contingencia.count({ where: { periodo_id: periodoId, estado: "PENDIENTE" } }),
    db.disputa.count({   where: { periodo_id: periodoId } }),
  ])

  const totalFronteras   = resultados.length
  const sinDiferencia    = resultados.filter(r => r.caso === "A1").length
  const alertasManuales  = resultados.filter(r => r.resultado_l1 === "ALERTA_MANUAL").length
  const incompletas      = resultados.filter(r => r.caso === "INCOMPLETA").length
  const errores          = resultados.filter(r => r.caso === "ERROR").length
  const valorProvisiones = resultados.reduce((s, r) => s + Number(r.impacto_financiero_l1 ?? 0), 0)
  const valorDisputas    = resultados.reduce((s, r) => s + Number(r.impacto_financiero_l2 ?? 0), 0)

  return NextResponse.json({
    totalFronteras, sinDiferencia,
    provisiones, valorProvisiones,
    contingenciasAbiertas: contingencias,
    disputas, valorDisputas,
    alertasManuales, incompletas, errores,
    impactoEstimado: valorProvisiones + valorDisputas,
  })
}
