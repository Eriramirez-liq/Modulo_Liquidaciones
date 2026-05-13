import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { db } from "@/lib/db"

const ADMIN_EMAIL = "erika.ramirez@bia.app"
const ALLOWED_DOMAIN = "@bia.app"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email?.endsWith(ALLOWED_DOMAIN)) return false
      try {
        await db.user.upsert({
          where: { email: user.email },
          create: {
            email: user.email,
            nombre: user.name ?? user.email!.split("@")[0] ?? "Usuario",
            password: "",
            rol: user.email === ADMIN_EMAIL ? "ADMINISTRADOR" : "ANALISTA",
          },
          update: {
            nombre: user.name ?? user.email!.split("@")[0] ?? "Usuario",
          },
        })
      } catch {}
      return true
    },
    async jwt({ token, user }) {
      if (user?.email) {
        try {
          const dbUser = await db.user.findUnique({
            where: { email: user.email },
            select: { id: true, rol: true, nombre: true },
          })
          if (dbUser) {
            token.userId = dbUser.id
            token.rol = dbUser.rol
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
          id: (token.userId as string) ?? "",
          rol: (token.rol as string) ?? "ANALISTA",
          nombre: (token.nombre as string) ?? session.user?.name ?? "",
        },
      }
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: { strategy: "jwt" },
})
