import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/**
 * Configuración de Vitest para los tests unitarios DETERMINISTAS del módulo
 * NetSuite (Fase 3 / deuda D9).
 *
 * - environment "node": estos tests son lógica pura de servidor, sin DOM.
 * - globals: true → `describe/it/expect` disponibles sin import explícito.
 * - alias "@/*": replica el path mapping de tsconfig.json para que los imports
 *   tipo "@/lib/..." resuelvan también bajo Vitest.
 *
 * NINGÚN test toca DB, NextAuth ni hace fetch real (R-tests): solo funciones
 * puras (firma OAuth, mappers, mock determinista, errores de dominio, helpers
 * de parseo del cliente real). No se importa `lib/db` ni nada que abra conexión.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
})
