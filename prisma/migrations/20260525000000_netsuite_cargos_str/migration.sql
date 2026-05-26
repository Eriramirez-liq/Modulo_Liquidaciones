-- CreateEnum
CREATE TYPE "EstadoLoteNetsuite" AS ENUM ('EN_PROGRESO', 'COMPLETADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "EstadoEnvioNetsuite" AS ENUM ('PENDIENTE', 'PROCESANDO', 'PROCESADO', 'ERROR');

-- AlterEnum
ALTER TYPE "AccionAuditoria" ADD VALUE 'ENVIAR_LOTE_NETSUITE';

-- CreateTable
CREATE TABLE "lotes_netsuite" (
    "id" TEXT NOT NULL,
    "estado" "EstadoLoteNetsuite" NOT NULL DEFAULT 'EN_PROGRESO',
    "total_envios" INTEGER NOT NULL,
    "total_ok" INTEGER NOT NULL DEFAULT 0,
    "total_error" INTEGER NOT NULL DEFAULT 0,
    "iniciado_por_id" TEXT NOT NULL,
    "iniciado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizado_at" TIMESTAMP(3),

    CONSTRAINT "lotes_netsuite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envios_netsuite_cargo_str" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "or_id" TEXT NOT NULL,
    "monto_snapshot_cop" DECIMAL(18,2) NOT NULL,
    "mes_consumo" TEXT NOT NULL,
    "mes_facturacion" TEXT NOT NULL,
    "estado" "EstadoEnvioNetsuite" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "numero_oc" TEXT,
    "netsuite_internal_id" TEXT,
    "respuesta_ok_json" JSONB,
    "error_mensaje" TEXT,
    "error_codigo" TEXT,
    "error_payload_json" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "enviado_at" TIMESTAMP(3),
    "respondido_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "envios_netsuite_cargo_str_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lotes_netsuite_estado_idx" ON "lotes_netsuite"("estado");

-- CreateIndex
CREATE INDEX "lotes_netsuite_iniciado_at_idx" ON "lotes_netsuite"("iniciado_at");

-- CreateIndex
CREATE UNIQUE INDEX "envios_netsuite_cargo_str_idempotency_key_key" ON "envios_netsuite_cargo_str"("idempotency_key");

-- CreateIndex
CREATE INDEX "envios_netsuite_cargo_str_periodo_id_or_id_createdAt_idx" ON "envios_netsuite_cargo_str"("periodo_id", "or_id", "createdAt");

-- CreateIndex
CREATE INDEX "envios_netsuite_cargo_str_estado_idx" ON "envios_netsuite_cargo_str"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "envios_netsuite_cargo_str_lote_id_periodo_id_or_id_key" ON "envios_netsuite_cargo_str"("lote_id", "periodo_id", "or_id");

-- CreateIndex
CREATE INDEX "registros_str_periodo_id_idx" ON "registros_str"("periodo_id");

-- CreateIndex
CREATE INDEX "registros_str_or_id_idx" ON "registros_str"("or_id");

-- CreateIndex
CREATE INDEX "registros_str_mes_consumo_idx" ON "registros_str"("mes_consumo");

-- AddForeignKey
ALTER TABLE "lotes_netsuite" ADD CONSTRAINT "lotes_netsuite_iniciado_por_id_fkey" FOREIGN KEY ("iniciado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_netsuite_cargo_str" ADD CONSTRAINT "envios_netsuite_cargo_str_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes_netsuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_netsuite_cargo_str" ADD CONSTRAINT "envios_netsuite_cargo_str_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodos_conciliacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_netsuite_cargo_str" ADD CONSTRAINT "envios_netsuite_cargo_str_or_id_fkey" FOREIGN KEY ("or_id") REFERENCES "configuracion_or"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
