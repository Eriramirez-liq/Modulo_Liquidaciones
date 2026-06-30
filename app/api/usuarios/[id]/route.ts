/**
 * PATCH /api/usuarios/:id — actualiza rol / activo / password de un usuario.
 * SOLO ADMINISTRADOR.
 *
 * Salvaguarda: un admin NO puede quitarse a si mismo el rol admin ni
 * desactivarse (compara params.id contra session.user.id).
 *
 * El handler es delgado: valida con Zod, aplica salvaguarda, persiste y
 * serializa. NUNCA devuelve password.
 */

import { NextRequest, NextResponse } from "next/server"
import { Prisma, Rol } from "@prisma/client"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export const runtime = "nodejs"

type UsuarioPublico = {
  id: string
  nombre: string
  email: string
  rol: "ADMINISTRADOR" | "ANALISTA" | "CONSULTA"
  activo: boolean
  createdAt: string
}

const SELECT_PUBLICO = {
  id: true,
  nombre: true,
  email: true,
  rol: true,
  activo: true,
  createdAt: true,
} as const

type UsuarioRow = {
  id: string
  nombre: string
  email: string
  rol: Rol
  activo: boolean
  createdAt: Date
}

function serializar(u: UsuarioRow): UsuarioPublico {
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    activo: u.activo,
    createdAt: u.createdAt.toISOString(),
  }
}

// Body parcial: cualquier subconjunto de { rol, activo, password }.
const patchBodySchema = z.object({
  rol: z.nativeEnum(Rol).optional(),
  activo: z.boolean().optional(),
  password: z.string().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  if (session.user.rol !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 })
  }

  const { id } = await params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }

  const parsed = patchBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const { rol, activo, password } = parsed.data

  // Salvaguarda: un admin no puede quitarse el rol admin ni desactivarse.
  if (id === session.user.id) {
    const quitaAdmin = rol !== undefined && rol !== Rol.ADMINISTRADOR
    const seDesactiva = activo === false
    if (quitaAdmin || seDesactiva) {
      return NextResponse.json(
        { error: "No podés modificar tu propio rol/estado de administrador" },
        { status: 400 },
      )
    }
  }

  if (password !== undefined && password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres" },
      { status: 400 },
    )
  }

  // Construye el patch solo con los campos presentes.
  const data: Prisma.UserUpdateInput = {}
  if (rol !== undefined) data.rol = rol
  if (activo !== undefined) data.activo = activo
  if (password !== undefined) data.password = await bcrypt.hash(password, 10)

  try {
    const usuario = await db.user.update({
      where: { id },
      data,
      select: SELECT_PUBLICO,
    })
    return NextResponse.json(serializar(usuario), { status: 200 })
  } catch (e) {
    // P2025: registro a actualizar no encontrado → 404.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }
    console.error(`[usuarios/${id} PATCH] error inesperado:`, e)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
