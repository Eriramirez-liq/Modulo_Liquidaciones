/**
 * /api/usuarios — gestion de usuarios. SOLO ADMINISTRADOR.
 *
 *   GET  → lista de usuarios (sin password), ordenada por nombre asc.
 *   POST → crea un usuario (valida dominio @bia.app, password >= 8, rol valido).
 *
 * Guard comun: exige sesion (401 si no hay) y rol ADMINISTRADOR (403 si no lo es).
 * El handler es delgado: valida con Zod, persiste y serializa. NUNCA devuelve password.
 */

import { NextRequest, NextResponse } from "next/server"
import { Prisma, Rol } from "@prisma/client"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export const runtime = "nodejs"

const ALLOWED_DOMAIN = "@bia.app"

// Shape publico de un usuario (sin password). createdAt serializado a ISO string.
type UsuarioPublico = {
  id: string
  nombre: string
  email: string
  rol: "ADMINISTRADOR" | "ANALISTA" | "CONSULTA"
  activo: boolean
  createdAt: string
}

// Columnas que se exponen al cliente. NUNCA incluir password.
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

const createBodySchema = z.object({
  nombre: z.string(),
  email: z.string(),
  password: z.string(),
  rol: z.nativeEnum(Rol),
})

export async function GET(): Promise<NextResponse> {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  if (session.user.rol !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 })
  }

  const usuarios = await db.user.findMany({
    select: SELECT_PUBLICO,
    orderBy: { nombre: "asc" },
  })

  return NextResponse.json(usuarios.map(serializar), { status: 200 })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  if (session.user.rol !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }

  const parsed = createBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const nombre = parsed.data.nombre.trim()
  if (nombre === "") {
    return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 })
  }

  const email = parsed.data.email.toLowerCase().trim()
  if (!email.endsWith(ALLOWED_DOMAIN)) {
    return NextResponse.json(
      { error: "El email debe terminar en @bia.app" },
      { status: 400 },
    )
  }

  if (parsed.data.password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres" },
      { status: 400 },
    )
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10)

  try {
    const usuario = await db.user.create({
      data: {
        nombre,
        email,
        password: passwordHash,
        rol: parsed.data.rol,
      },
      select: SELECT_PUBLICO,
    })
    return NextResponse.json(serializar(usuario), { status: 201 })
  } catch (e) {
    // P2002: violacion de constraint unico (email duplicado) → 409.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Ya existe un usuario con ese email" },
        { status: 409 },
      )
    }
    console.error("[usuarios POST] error inesperado:", e)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
