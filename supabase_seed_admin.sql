-- ================================================================
-- Seed: usuario administrador inicial
-- Contraseña por defecto: BiaEnergy2026
-- IMPORTANTE: cambiala después del primer ingreso
-- ================================================================

INSERT INTO users (id, nombre, email, password, rol, activo, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'Erika Ramirez',
  'erika.ramirez@bia.app',
  '$2b$10$GztvlJnlJN6e1EiP.NdM3e1aLMiWFwqi6947wJcTklLoGWrHPNANS',
  'ADMINISTRADOR',
  true,
  now(),
  now()
)
ON CONFLICT (email) DO NOTHING;
