-- Columna para el internalId del vendor en NetSuite (mapeo OR → vendor, R9).
-- La carga Erika por cada operador de red. Nullable: los OR sin OC no la necesitan.
ALTER TABLE "configuracion_or" ADD COLUMN "netsuite_vendor_id" TEXT;
