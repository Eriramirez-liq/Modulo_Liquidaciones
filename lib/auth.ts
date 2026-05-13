import { NextResponse } from "next/server"
import { db } from "@/lib/db"

type AppUser = {
  id: string
  nombre: string
  rol: string
}

type AppSession = {
  user: AppUser
}

export async function auth(): Promise<AppSession | null> {
  const user = await db.user.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, nombre: true, rol: true },
  })

  if (user) {
    return { user }
  }

  return {
    user: {
      id: "dev-user",
      nombre: "Usuario Desarrollo",
      rol: "ADMIN",
    },
  }
}

export const handlers = {
  async GET() {
    return NextResponse.json(
      { message: "Auth local activa." },
      { status: 200 }
    )
  },
  async POST() {
    return NextResponse.json(
      { message: "Auth local activa." },
      { status: 200 }
    )
  },
}
