/**
 * PATCH /api/operadores/:id — edita el `netsuite_vendor_id` de un OR.
 *
 * Handler DELGADO: valida con Zod, persiste y serializa. El `netsuite_vendor_id`
 * es el internalId del vendor en NetSuite (lo consume el módulo de Cargos STR).
 * Normalización: string vacío (tras trim) → null, para no guardar cadenas vacías.
 */

import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export const runtime = "nodejs"

// Acepta string (que se normaliza) o null explícito.
const patchBodySchema = z.object({
  netsuite_vendor_id: z.union([z.string(), z.null()]),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const { id } = await params

  // Parseo del body. Si el JSON es inválido, lo tratamos como VALIDATION_ERROR.
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "Body JSON inválido" },
      { status: 400 },
    )
  }

  const parsed = patchBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "VALIDATION_ERROR",
        message: "El cuerpo de la petición no es válido",
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  // Normalizar: trim y string vacío → null.
  const valor = parsed.data.netsuite_vendor_id
  const valorNormalizado: string | null =
    valor === null ? null : valor.trim() === "" ? null : valor.trim()

  try {
    const operador = await db.configuracionOR.update({
      where: { id },
      data: { netsuite_vendor_id: valorNormalizado },
      select: { id: true, codigo: true, nombre: true, netsuite_vendor_id: true },
    })
    return NextResponse.json(operador, { status: 200 })
  } catch (e) {
    // P2025: registro a actualizar no encontrado → 404.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json(
        { error: "OR_NO_ENCONTRADO", message: "Operador de red no encontrado" },
        { status: 404 },
      )
    }
    console.error(`[operadores/${id} PATCH] error inesperado:`, e)
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Error interno" },
      { status: 500 },
    )
  }
}
