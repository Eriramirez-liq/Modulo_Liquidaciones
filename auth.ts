import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"

const ALLOWED_DOMAIN = "@bia.app"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email:    { label: "Email",      type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const email    = (credentials?.email    as string | undefined)?.toLowerCase().trim()
        const password =  credentials?.password as string | undefined

        if (!email || !password) return null
        if (!email.endsWith(ALLOWED_DOMAIN))  return null

        try {
          const user = await db.user.findUnique({
            where: { email },
            select: { id: true, email: true, nombre: true, rol: true, password: true, activo: true },
          })

          if (!user || !user.activo) return null

          const ok = await bcrypt.compare(password, user.password)
          if (!ok) return null

          return { id: user.id, email: user.email, name: user.nombre }
        } catch {
          return null
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) {
        try {
          const dbUser = await db.user.findUnique({
            where: { email: user.email },
            select: { id: true, rol: true, nombre: true },
          })
          if (dbUser) {
            token.userId = dbUser.id
            token.rol    = dbUser.rol
            token.nombre = dbUser.nombre
          }
        } catch {}
      }
      return token
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id:     (token.userId as string) ?? "",
          rol:    (token.rol    as string) ?? "ANALISTA",
          nombre: (token.nombre as string) ?? session.user?.name ?? "",
        },
      }
    },
  },
  pages: {
    signIn: "/login",
    error:  "/login",
  },
  session: { strategy: "jwt" },
})
