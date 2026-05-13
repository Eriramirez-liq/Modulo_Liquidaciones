import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.NEXT_DATABASE_URL ||
          process.env.DATABASE_URL ||
          "file:./dev.db",
      },
    },
    log: process.env.NODE_ENV === "development" ? ["error"] : ["error"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}

export const db = prisma
