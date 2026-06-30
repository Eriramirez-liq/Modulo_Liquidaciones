-- Valor total facturado (columna "Total" de la query de facturación BIA).
ALTER TABLE "registros_facturacion" ADD COLUMN IF NOT EXISTS "valor_total_cop" DECIMAL(18,2);
