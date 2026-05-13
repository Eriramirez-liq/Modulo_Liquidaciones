-- ================================================================
-- Trigger: validar dominio @bia.app en tabla users
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- ================================================================

-- 1. Función que valida el dominio del email
CREATE OR REPLACE FUNCTION validar_dominio_bia()
RETURNS trigger AS $$
BEGIN
  IF NEW.email NOT LIKE '%@bia.app' THEN
    RAISE EXCEPTION
      'Acceso denegado: el correo % no pertenece al dominio @bia.app',
      NEW.email
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Trigger que ejecuta la función antes de cada INSERT
DROP TRIGGER IF EXISTS trigger_validar_dominio_bia ON users;

CREATE TRIGGER trigger_validar_dominio_bia
  BEFORE INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION validar_dominio_bia();
