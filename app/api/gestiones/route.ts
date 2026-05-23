import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoId = searchParams.get("periodoId") ?? undefined
  const orId      = searchParams.get("orId")      ?? undefined
  const tipo      = searchParams.get("tipo")      ?? "provisiones"

  if (tipo === "provisiones") {
    const rows = await db.provision.findMany({
      where: {
        ...(periodoId ? { periodo_id: periodoId } : {}),
        ...(orId      ? { or_id: orId }           : {}),
      },
      include: {
        periodo:      { select: { anio: true, mes: true } },
        operador_red: { select: { codigo: true, nombre: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    return NextResponse.json(rows)
  }

  if (tipo === "contingencias") {
    const rows = await db.contingencia.findMany({
      where: {
        ...(periodoId ? { periodo_id: periodoId } : {}),
        ...(orId      ? { or_id: orId }           : {}),
      },
      include: {
        periodo:      { select: { anio: true, mes: true } },
        operador_red: { select: { codigo: true, nombre: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    return NextResponse.json(rows)
  }

  if (tipo === "disputas") {
    const rows = await db.disputa.findMany({
      where: {
        ...(periodoId ? { periodo_id: periodoId } : {}),
        ...(orId      ? { or_id: orId }           : {}),
      },
      include: {
        periodo:      { select: { anio: true, mes: true } },
        operador_red: { select: { codigo: true, nombre: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    return NextResponse.json(rows)
  }

  // Alertas manuales: ResultadoConciliacion con requiere_alerta_manual=true
  if (tipo === "alertas-manuales") {
    const rows = await db.resultadoConciliacion.findMany({
      where: {
        requiere_alerta_manual: true,
        ...(periodoId ? { periodo_id: periodoId } : {}),
        ...(orId      ? { or_id: orId }           : {}),
      },
      include: {
        periodo: { select: { anio: true, mes: true } },
        or_obj:  { select: { codigo: true, nombre: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    return NextResponse.json(rows)
  }

  // Incompletas/Errores: ResultadoConciliacion con caso INCOMPLETA o ERROR
  if (tipo === "incompletas") {
    const rows = await db.resultadoConciliacion.findMany({
      where: {
        caso: { in: ["INCOMPLETA", "ERROR"] },
        ...(periodoId ? { periodo_id: periodoId } : {}),
        ...(orId      ? { or_id: orId }           : {}),
      },
      include: {
        periodo: { select: { anio: true, mes: true } },
        or_obj:  { select: { codigo: true, nombre: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    return NextResponse.json(rows)
  }

  return NextResponse.json([])
}
