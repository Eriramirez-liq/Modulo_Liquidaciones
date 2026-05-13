import { auth as nextAuth, handlers, signIn, signOut } from "@/auth"

export { handlers, signIn, signOut }

type AppUser = {
  id: string
  nombre: string
  rol: string
}

type AppSession = {
  user: AppUser
}

export async function auth(): Promise<AppSession | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await nextAuth() as any
  if (!session?.user?.id) return null
  return {
    user: {
      id: session.user.id,
      nombre: session.user.nombre ?? session.user.name ?? "Usuario",
      rol: session.user.rol ?? "ANALISTA",
    },
  }
}
