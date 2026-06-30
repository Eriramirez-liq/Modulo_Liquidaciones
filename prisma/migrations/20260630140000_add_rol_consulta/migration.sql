-- Agrega el rol CONSULTA al enum "Rol" (solo lectura).
-- Idempotente: ADD VALUE IF NOT EXISTS permite reaplicar sin error.
-- Se aplica manualmente en Supabase (no via `prisma migrate`).
--
-- Rollback: PostgreSQL no soporta eliminar un valor de un enum directamente.
-- Para revertir habria que: 1) reasignar/eliminar usuarios con rol 'CONSULTA',
-- 2) recrear el tipo "Rol" sin ese valor y migrar la columna users.rol.
-- Mientras ningun usuario use 'CONSULTA', el valor extra es inocuo.
ALTER TYPE "Rol" ADD VALUE IF NOT EXISTS 'CONSULTA';
