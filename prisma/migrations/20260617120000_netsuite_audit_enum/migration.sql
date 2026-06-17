-- Nuevas acciones de auditoría del módulo NetSuite (BE-6).
-- Idempotente: ADD VALUE IF NOT EXISTS permite reaplicar sin error.
-- Mientras esta migración no esté aplicada, auditNetsuite es no-throwing y
-- simplemente omite la entrada (el flujo de negocio continúa igual).
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'PROCESAR_ENVIO_NETSUITE';
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'REENVIAR_ENVIO_NETSUITE';
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'CANCELAR_LOTE_NETSUITE';
