import { PrismaClient } from "@prisma/client"

/**
 * Construye la URL de conexión reforzando parámetros seguros para entornos
 * serverless (Vercel) contra el pooler de Supabase:
 *
 *  - connection_limit=1 → cada instancia/lambda usa 1 sola conexión, evitando
 *    agotar el pool del pooler (el error "max clients reached in session mode").
 *  - pgbouncer=true → desactiva prepared statements (obligatorio en transaction
 *    pooler; inocuo en session/direct).
 *
 * Solo se agregan si NO vienen ya en la DATABASE_URL, para respetar overrides.
 */
function buildDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL
  if (!raw) return undefined
  try {
    const u = new URL(raw)
    if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "1")
    if (!u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true")
    return u.toString()
  } catch {
    // Si la URL no es parseable, usarla tal cual.
    return raw
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error"],
    datasources: { db: { url: buildDatabaseUrl() } },
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}

export const db = prisma
