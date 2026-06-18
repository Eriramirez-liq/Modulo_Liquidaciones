-- Fase 3 — RLS (D7): endurecer las tablas NetSuite.
--
-- Prisma se conecta con el rol owner (postgres), que BYPASSA RLS, así que
-- habilitar RLS NO rompe el acceso del backend. El objetivo es bloquear a los
-- roles de la API de Supabase (anon/authenticated) — la app no los usa (todo va
-- por Prisma + NextAuth). No se usa FORCE ROW LEVEL SECURITY (eso sujetaría al
-- owner a las políticas y dejaría a Prisma sin acceso).
--
-- Idempotente: ENABLE RLS es repetible; los REVOKE se guardan por si el rol no
-- existe (entornos no-Supabase).

ALTER TABLE "lotes_netsuite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "envios_netsuite_cargo_str" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "lotes_netsuite", "envios_netsuite_cargo_str" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "lotes_netsuite", "envios_netsuite_cargo_str" FROM authenticated;
  END IF;
END $$;

-- Sin políticas permisivas: con RLS habilitado y sin policy, cualquier rol que
-- NO sea owner obtiene cero filas. Combinado con el REVOKE, es doble candado.
-- Si en el futuro la app usara service_role/PostgREST, agregar aquí una policy
-- explícita para ese rol.
