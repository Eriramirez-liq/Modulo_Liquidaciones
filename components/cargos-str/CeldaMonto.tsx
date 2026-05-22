"use client"

import type { EstadoEnvioUI } from "./types"

interface CeldaMontoProps {
  periodoId: string
  orCodigo: string
  monto: number
  // null = sin envío previo para este (período, operador)
  estadoEnvio: EstadoEnvioUI | null
  // Solo se dispara si estadoEnvio !== null
  onClick?: () => void
}

// Configuración visual por estado
// - PENDIENTE: amarillo con punto (único estado "envío pendiente")
// - PROCESANDO/PROCESADO: azul sin badge (enviado a NetSuite, OC pendiente o emitida)
// - ERROR: rojo con ✗
type EstadoConfig = {
  bg: string
  textColor: string
  badgeColor: string | null
  badgeSymbol: string | null
}

function getEstadoConfig(estado: EstadoEnvioUI["estado"]): EstadoConfig {
  switch (estado) {
    case "PENDIENTE":
      return { bg: "#fef3c7", textColor: "#374151", badgeColor: "#b45309", badgeSymbol: "●" }
    case "PROCESANDO":
    case "PROCESADO":
      return { bg: "#dbeafe", textColor: "#1e3a8a", badgeColor: null, badgeSymbol: null }
    case "ERROR":
      return { bg: "#fee2e2", textColor: "#374151", badgeColor: "#b91c1c", badgeSymbol: "✗" }
  }
}

function buildTooltip(estadoEnvio: EstadoEnvioUI): string {
  switch (estadoEnvio.estado) {
    case "PENDIENTE":
      return "Envío pendiente..."
    case "PROCESANDO":
      return "Enviando a NetSuite..."
    case "PROCESADO":
      return estadoEnvio.numeroOc ? `OC: ${estadoEnvio.numeroOc}` : "Procesado"
    case "ERROR": {
      const msg = estadoEnvio.errorMensaje ?? "Error desconocido"
      return `Error: ${msg.slice(0, 80)}${msg.length > 80 ? "…" : ""}`
    }
  }
}

function formatCurrency(v: number): string {
  return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}

export function CeldaMonto({ monto, estadoEnvio, onClick }: CeldaMontoProps) {
  const esVacio = monto === 0 || monto == null

  const config = estadoEnvio ? getEstadoConfig(estadoEnvio.estado) : null
  const bg = config?.bg ?? "#ffffff"
  const textColor = config?.textColor ?? "#374151"
  const cursor = onClick ? "pointer" : "default"
  const tooltipTitle = estadoEnvio ? buildTooltip(estadoEnvio) : undefined

  return (
    <td
      title={tooltipTitle}
      onClick={estadoEnvio && onClick ? onClick : undefined}
      style={{
        padding: "8px 12px",
        fontSize: 14,
        background: bg,
        border: "1px solid #e5e7eb",
        textAlign: "right",
        fontFamily: "monospace",
        whiteSpace: "nowrap",
        cursor: cursor,
        verticalAlign: "middle",
      }}
    >
      {esVacio ? (
        <span style={{ color: "#d1d5db" }}>-</span>
      ) : (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
          <span style={{ color: textColor }}>{formatCurrency(monto)}</span>
          {config?.badgeSymbol && (
            <span
              style={{
                color: config.badgeColor ?? "inherit",
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
              }}
              aria-hidden="true"
            >
              {config.badgeSymbol}
            </span>
          )}
        </span>
      )}
    </td>
  )
}

export default CeldaMonto
