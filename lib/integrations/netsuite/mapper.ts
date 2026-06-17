/**
 * Mappers entre la entidad de persistencia (EnvioNetsuiteCargoSTR) y los tipos
 * de borde: el payload que se envía a NetSuite y el DTO que consume el frontend.
 *
 * PRECISIÓN DECIMAL (R5, regla absoluta del módulo): los montos viajan SIEMPRE
 * como string producido con `Decimal.toFixed(2)` / `.toString()`. Está PROHIBIDO
 * aplicar `Number()` a un Decimal en todo `lib/integrations/netsuite/**`.
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.3 (Mapper con precisión decimal).
 */

import type { ConfiguracionOR, EnvioNetsuiteCargoSTR } from "@prisma/client"
import type { EnvioDto, NetsuitePayload } from "./types"

/** Envío con su operador de red ya incluido (relación `operador_red`). */
export type EnvioConOperador = EnvioNetsuiteCargoSTR & {
  operador_red: ConfiguracionOR
}

/**
 * Construye el payload para NetSuite a partir de un envío persistido.
 *
 * PRECISION: nunca convertir Decimal a Number aquí — usar .toFixed(2) o .toString().
 */
export function snapshotToPayload(envio: EnvioConOperador): NetsuitePayload {
  return {
    externalId: envio.idempotency_key,
    // internalId del vendor en NetSuite. Si está vacío, el cliente real lo
    // marca como error (VENDOR_SIN_ID) — el OR no tiene vendor configurado.
    vendorId: envio.operador_red.netsuite_vendor_id ?? "",
    vendor: envio.operador_red.codigo,
    // PRECISION: Decimal → "123456.78". NUNCA Number(envio.monto_snapshot_cop).
    amount: envio.monto_snapshot_cop.toFixed(2),
    currency: "COP",
    memo: `Cargo STR ${envio.operador_red.nombre} ${envio.mes_consumo}`,
    date: `${envio.mes_facturacion}-01`,
  }
}

/** Convierte un Date a ISO string, o null si no hay fecha. */
function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

/**
 * Convierte un envío persistido al DTO que consume el frontend.
 *
 * PRECISION: `montoSnapshotCop` se serializa con `.toFixed(2)` (string), nunca
 * como Number.
 */
export function envioToDto(envio: EnvioConOperador): EnvioDto {
  return {
    id: envio.id,
    periodoId: envio.periodo_id,
    orId: envio.or_id,
    orCodigo: envio.operador_red.codigo,
    orNombre: envio.operador_red.nombre,
    // PRECISION: Decimal → string. NUNCA Number().
    montoSnapshotCop: envio.monto_snapshot_cop.toFixed(2),
    mesConsumo: envio.mes_consumo,
    mesFacturacion: envio.mes_facturacion,
    estado: envio.estado,
    intentos: envio.intentos,
    numeroOc: envio.numero_oc,
    netsuiteInternalId: envio.netsuite_internal_id,
    errorMensaje: envio.error_mensaje,
    errorCodigo: envio.error_codigo,
    enviadoAt: toIso(envio.enviado_at),
    respondidoAt: toIso(envio.respondido_at),
  }
}
