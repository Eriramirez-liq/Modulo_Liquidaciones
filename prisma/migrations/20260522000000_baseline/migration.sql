-- Baseline migration generated on 2026-05-22
-- Reflects the schema currently deployed in production Supabase, which was
-- built historically via `prisma db push`. This migration must NOT be
-- executed against production; instead, run:
--   npx prisma migrate resolve --applied 20260522000000_baseline
-- to mark it as already applied. See docs/runbooks/prisma-migrate.md.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ANALISTA', 'ADMINISTRADOR');

-- CreateEnum
CREATE TYPE "TipoFuente" AS ENUM ('FACTURACION', 'XM', 'SDL', 'BALANCE', 'TC1', 'COT', 'INSUMOS_STR');

-- CreateEnum
CREATE TYPE "EstadoCarga" AS ENUM ('PENDIENTE', 'PROCESANDO', 'COMPLETADA', 'ERROR');

-- CreateEnum
CREATE TYPE "EstadoPeriodo" AS ENUM ('ABIERTO', 'EN_PROCESO', 'CERRADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "CasoConciliacion" AS ENUM ('A1', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'D3', 'D4', 'INCOMPLETA', 'ERROR');

-- CreateEnum
CREATE TYPE "ResultadoLinea" AS ENUM ('SIN_DIFERENCIA', 'CONTINGENCIA_L1', 'PROVISION_L1', 'PROVISION_L2', 'DISPUTA_L2', 'PROVISION_COMBINADA', 'ALERTA_MANUAL', 'INCOMPLETA');

-- CreateEnum
CREATE TYPE "TipoProvision" AS ENUM ('L1', 'D3', 'COMBINADA');

-- CreateEnum
CREATE TYPE "EstadoProvision" AS ENUM ('PENDIENTE', 'CRUZADO_PARCIAL', 'CRUZADO_TOTAL');

-- CreateEnum
CREATE TYPE "EstadoContingencia" AS ENUM ('PENDIENTE', 'COBRADO', 'CERRADO');

-- CreateEnum
CREATE TYPE "ResultadoContingencia" AS ENUM ('PENDIENTE', 'PERDIDA_REPORTE', 'GANANCIA_REAL', 'PERDIDA_REAL');

-- CreateEnum
CREATE TYPE "TipoResultadoCruce" AS ENUM ('INGRESO', 'COSTO', 'EXACTO');

-- CreateEnum
CREATE TYPE "EstadoDisputa" AS ENUM ('ABIERTA', 'EN_GESTION', 'RESUELTA', 'CERRADA_SIN_AJUSTE');

-- CreateEnum
CREATE TYPE "AccionAuditoria" AS ENUM ('LOGIN', 'LOGOUT', 'CARGAR_FUENTE', 'REEMPLAZAR_FUENTE', 'EJECUTAR_CONCILIACION', 'CREAR_PROVISION', 'ACTUALIZAR_PROVISION', 'CREAR_CONTINGENCIA', 'ACTUALIZAR_CONTINGENCIA', 'REGISTRAR_CRUCE', 'CREAR_DISPUTA', 'ACTUALIZAR_DISPUTA', 'EXPORTAR_REPORTE', 'CAMBIAR_CONFIGURACION', 'CREAR_USUARIO', 'ACTUALIZAR_USUARIO');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'ANALISTA',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periodos_conciliacion" (
    "id" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "estado" "EstadoPeriodo" NOT NULL DEFAULT 'ABIERTO',
    "fecha_cierre" TIMESTAMP(3),
    "cerrado_por_id" TEXT,
    "creado_por_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "periodos_conciliacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_or" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "nit" TEXT,
    "email_contacto" TEXT,
    "telefono_contacto" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "mapeo_sdl_json" JSONB,
    "mapeo_balance_json" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_or_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargas_fuente" (
    "id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "tipo_fuente" "TipoFuente" NOT NULL,
    "or_id" TEXT,
    "nombre_archivo" TEXT NOT NULL,
    "estado" "EstadoCarga" NOT NULL DEFAULT 'PENDIENTE',
    "total_registros" INTEGER,
    "registros_procesados" INTEGER,
    "registros_error" INTEGER,
    "mensaje_error" TEXT,
    "justificacion_reemplazo" TEXT,
    "reemplaza_id" TEXT,
    "cargado_por_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cargas_fuente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_facturacion" (
    "id" TEXT NOT NULL,
    "carga_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "codigo_frontera" TEXT NOT NULL,
    "nombre_usuario" TEXT,
    "operador_red" TEXT,
    "energia_kwh" DECIMAL(18,6) NOT NULL,
    "nt_raw" VARCHAR(10),
    "nivel_tension" VARCHAR(5),
    "propiedad_activos" VARCHAR(20),
    "energia_reactiva_ind_tot" DECIMAL(18,6),
    "energia_reactiva_cap_tot" DECIMAL(18,6),
    "energia_reactiva_ind_pen" DECIMAL(18,6),
    "energia_reactiva_cap_pen" DECIMAL(18,6),
    "factor_m" DECIMAL(10,4),
    "g_bia" DECIMAL(18,6),
    "t_bia" DECIMAL(18,6),
    "d_bia" DECIMAL(18,6),
    "pr_bia" DECIMAL(18,6),
    "r_bia" DECIMAL(18,6),
    "c_bia" DECIMAL(18,6),
    "tarifa_total_bia" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_facturacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_xm" (
    "id" TEXT NOT NULL,
    "carga_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "codigo_frontera" TEXT NOT NULL,
    "nombre_frontera" TEXT,
    "energia_xm_kwh" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_xm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_sdl" (
    "id" TEXT NOT NULL,
    "carga_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "or_id" TEXT NOT NULL,
    "codigo_frontera" TEXT NOT NULL,
    "nombre_frontera" TEXT,
    "periodo_sdl" TEXT NOT NULL,
    "energia_sdl_kwh" DECIMAL(18,6) NOT NULL,
    "valor_sdl_cop" DECIMAL(18,2) NOT NULL,
    "tarifa_sdl" DECIMAL(18,6) NOT NULL,
    "nivel_tension" TEXT,
    "propiedad_activos" TEXT,
    "energia_reactiva_ind_pen" DECIMAL(18,6),
    "energia_reactiva_cap_pen" DECIMAL(18,6),
    "valor_reactiva_cop" DECIMAL(18,2),
    "factor_m" DECIMAL(10,4),
    "es_duplicado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_sdl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_tc1" (
    "id" TEXT NOT NULL,
    "carga_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "codigo_frontera" TEXT NOT NULL,
    "niu" TEXT,
    "nivel_tension" TEXT,
    "nivel_tension_primario" TEXT,
    "pct_propiedad_activo" TEXT,
    "tipo_conexion" TEXT,
    "conexion_red" TEXT,
    "id_comercializador" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_tc1_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_balance" (
    "id" TEXT NOT NULL,
    "carga_id" TEXT NOT NULL,
    "or_id" TEXT NOT NULL,
    "codigo_frontera" TEXT NOT NULL,
    "periodo_ajuste" TEXT NOT NULL,
    "energia_balance_kwh" DECIMAL(18,6) NOT NULL,
    "valor_balance_cop" DECIMAL(18,2) NOT NULL,
    "tarifa_balance" DECIMAL(18,6) NOT NULL,
    "periodo_tarifa" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_cot" (
    "id" TEXT NOT NULL,
    "carga_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "or_id" TEXT,
    "codigo_frontera" TEXT NOT NULL,
    "nombre_frontera" TEXT,
    "periodo_cot" TEXT,
    "valor_cot_cop" DECIMAL(18,2),
    "tarifa_cot" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_cot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_str" (
    "id" TEXT NOT NULL,
    "carga_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "or_id" TEXT NOT NULL,
    "mes_consumo" TEXT NOT NULL,
    "valor_cop" DECIMAL(18,2) NOT NULL,
    "detalle_json" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_str_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultados_conciliacion" (
    "id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "codigo_frontera" TEXT NOT NULL,
    "nombre_usuario" TEXT,
    "operador_red" TEXT,
    "or_id" TEXT,
    "e_fac" DECIMAL(18,6),
    "e_xm" DECIMAL(18,6),
    "e_sdl" DECIMAL(18,6),
    "delta_l1" DECIMAL(18,6),
    "delta_l2" DECIMAL(18,6),
    "caso" "CasoConciliacion" NOT NULL,
    "resultado_l1" "ResultadoLinea",
    "resultado_l2" "ResultadoLinea",
    "impacto_financiero_l1" DECIMAL(18,2),
    "impacto_financiero_l2" DECIMAL(18,2),
    "requiere_alerta_manual" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "conciliado_por_id" TEXT,
    "conciliado_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resultados_conciliacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provisiones" (
    "id" TEXT NOT NULL,
    "resultado_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "codigo_frontera" TEXT NOT NULL,
    "or_id" TEXT,
    "tipo" "TipoProvision" NOT NULL,
    "energia_kwh" DECIMAL(18,6) NOT NULL,
    "valor_provisionado_cop" DECIMAL(18,2) NOT NULL,
    "componentes_json" JSONB,
    "estado" "EstadoProvision" NOT NULL DEFAULT 'PENDIENTE',
    "fecha_cierre" TIMESTAMP(3),
    "creado_por_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provisiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contingencias" (
    "id" TEXT NOT NULL,
    "resultado_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "codigo_frontera" TEXT NOT NULL,
    "or_id" TEXT,
    "energia_kwh" DECIMAL(18,6) NOT NULL,
    "costo_calculado_cop" DECIMAL(18,2),
    "refacturacion_cliente_cop" DECIMAL(18,2),
    "costo_neto_cop" DECIMAL(18,2),
    "estado" "EstadoContingencia" NOT NULL DEFAULT 'PENDIENTE',
    "resultado_tipo" "ResultadoContingencia" NOT NULL DEFAULT 'PENDIENTE',
    "descripcion" TEXT,
    "fecha_cobro" TIMESTAMP(3),
    "fecha_cierre" TIMESTAMP(3),
    "creado_por_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contingencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cruces_balance" (
    "id" TEXT NOT NULL,
    "registro_balance_id" TEXT NOT NULL,
    "codigo_frontera" TEXT NOT NULL,
    "provision_id" TEXT,
    "contingencia_id" TEXT,
    "energia_cruzada_kwh" DECIMAL(18,6) NOT NULL,
    "valor_cruzado_cop" DECIMAL(18,2) NOT NULL,
    "resultado_neto_cop" DECIMAL(18,2) NOT NULL,
    "tipo_resultado" "TipoResultadoCruce" NOT NULL,
    "fecha_cruce" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registrado_por_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cruces_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputas" (
    "id" TEXT NOT NULL,
    "resultado_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "codigo_frontera" TEXT NOT NULL,
    "or_id" TEXT NOT NULL,
    "energia_exceso_kwh" DECIMAL(18,6) NOT NULL,
    "valor_disputa_cop" DECIMAL(18,2) NOT NULL,
    "estado" "EstadoDisputa" NOT NULL DEFAULT 'ABIERTA',
    "descripcion" TEXT,
    "resolucion" TEXT,
    "abierta_por_id" TEXT NOT NULL,
    "cerrada_por_id" TEXT,
    "cerrada_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_auditoria" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "accion" "AccionAuditoria" NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "detalle" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "periodos_conciliacion_anio_mes_key" ON "periodos_conciliacion"("anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "configuracion_or_codigo_key" ON "configuracion_or"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "resultados_conciliacion_periodo_id_codigo_frontera_key" ON "resultados_conciliacion"("periodo_id", "codigo_frontera");

-- AddForeignKey
ALTER TABLE "periodos_conciliacion" ADD CONSTRAINT "periodos_conciliacion_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periodos_conciliacion" ADD CONSTRAINT "periodos_conciliacion_cerrado_por_id_fkey" FOREIGN KEY ("cerrado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_fuente" ADD CONSTRAINT "cargas_fuente_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodos_conciliacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_fuente" ADD CONSTRAINT "cargas_fuente_or_id_fkey" FOREIGN KEY ("or_id") REFERENCES "configuracion_or"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_fuente" ADD CONSTRAINT "cargas_fuente_cargado_por_id_fkey" FOREIGN KEY ("cargado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_sdl" ADD CONSTRAINT "registros_sdl_or_id_fkey" FOREIGN KEY ("or_id") REFERENCES "configuracion_or"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_balance" ADD CONSTRAINT "registros_balance_or_id_fkey" FOREIGN KEY ("or_id") REFERENCES "configuracion_or"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_str" ADD CONSTRAINT "registros_str_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodos_conciliacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_str" ADD CONSTRAINT "registros_str_or_id_fkey" FOREIGN KEY ("or_id") REFERENCES "configuracion_or"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_conciliacion" ADD CONSTRAINT "resultados_conciliacion_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodos_conciliacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_conciliacion" ADD CONSTRAINT "resultados_conciliacion_or_id_fkey" FOREIGN KEY ("or_id") REFERENCES "configuracion_or"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_conciliacion" ADD CONSTRAINT "resultados_conciliacion_conciliado_por_id_fkey" FOREIGN KEY ("conciliado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisiones" ADD CONSTRAINT "provisiones_resultado_id_fkey" FOREIGN KEY ("resultado_id") REFERENCES "resultados_conciliacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisiones" ADD CONSTRAINT "provisiones_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodos_conciliacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisiones" ADD CONSTRAINT "provisiones_or_id_fkey" FOREIGN KEY ("or_id") REFERENCES "configuracion_or"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisiones" ADD CONSTRAINT "provisiones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contingencias" ADD CONSTRAINT "contingencias_resultado_id_fkey" FOREIGN KEY ("resultado_id") REFERENCES "resultados_conciliacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contingencias" ADD CONSTRAINT "contingencias_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodos_conciliacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contingencias" ADD CONSTRAINT "contingencias_or_id_fkey" FOREIGN KEY ("or_id") REFERENCES "configuracion_or"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contingencias" ADD CONSTRAINT "contingencias_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruces_balance" ADD CONSTRAINT "cruces_balance_registro_balance_id_fkey" FOREIGN KEY ("registro_balance_id") REFERENCES "registros_balance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruces_balance" ADD CONSTRAINT "cruces_balance_provision_id_fkey" FOREIGN KEY ("provision_id") REFERENCES "provisiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruces_balance" ADD CONSTRAINT "cruces_balance_contingencia_id_fkey" FOREIGN KEY ("contingencia_id") REFERENCES "contingencias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruces_balance" ADD CONSTRAINT "cruces_balance_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputas" ADD CONSTRAINT "disputas_resultado_id_fkey" FOREIGN KEY ("resultado_id") REFERENCES "resultados_conciliacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputas" ADD CONSTRAINT "disputas_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodos_conciliacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputas" ADD CONSTRAINT "disputas_or_id_fkey" FOREIGN KEY ("or_id") REFERENCES "configuracion_or"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputas" ADD CONSTRAINT "disputas_abierta_por_id_fkey" FOREIGN KEY ("abierta_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputas" ADD CONSTRAINT "disputas_cerrada_por_id_fkey" FOREIGN KEY ("cerrada_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_auditoria" ADD CONSTRAINT "log_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

