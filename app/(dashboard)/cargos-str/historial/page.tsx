"use client"
import { useState, useEffect } from "react"
import Link from "next/link"
import { listarLotesReal, getLoteReal } from "@/lib/api/netsuite-cargos"
import type { LoteResumenDto } from "@/lib/integrations/netsuite/types"
import type { LoteResponse, EnvioDto } from "@/lib/api/netsuite-cargos"

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function formatMonto(copStr: string): string {
  const n = parseFloat(copStr)
  if (isNaN(n)) return copStr
  return `$ ${n.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}

// ---------------------------------------------------------------------------
// Badge de estado de lote
// ---------------------------------------------------------------------------

function EstadoLoteBadge({ estado }: { estado: LoteResumenDto["estado"] }) {
  const styles: Record<LoteResumenDto["estado"], React.CSSProperties> = {
    EN_PROGRESO: { background: "#fef9c3", color: "#a16207" },
    COMPLETADO:  { background: "#f0fdf4", color: "#15803d" },
    CANCELADO:   { background: "#f3f4f6", color: "#6b7280" },
  }
  const labels: Record<LoteResumenDto["estado"], string> = {
    EN_PROGRESO: "En progreso",
    COMPLETADO:  "Completado",
    CANCELADO:   "Cancelado",
  }
  return (
    <span style={{
      ...styles[estado],
      padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600,
    }}>
      {labels[estado]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Badge de estado de envío individual
// ---------------------------------------------------------------------------

type EstadoEnvio = EnvioDto["estado"]

function EstadoEnvioBadge({ estado }: { estado: EstadoEnvio }) {
  const styles: Record<EstadoEnvio, React.CSSProperties> = {
    PROCESADO:  { background: "#f0fdf4", color: "#15803d" },
    ERROR:      { background: "#fef2f2", color: "#b91c1c" },
    PENDIENTE:  { background: "#f3f4f6", color: "#6b7280" },
    PROCESANDO: { background: "#fef9c3", color: "#a16207" },
  }
  const labels: Record<EstadoEnvio, string> = {
    PROCESADO:  "OK",
    ERROR:      "Error",
    PENDIENTE:  "Pendiente",
    PROCESANDO: "Procesando",
  }
  return (
    <span style={{
      ...styles[estado],
      padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600,
    }}>
      {labels[estado]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Fila de envío individual dentro del detalle de un lote
// ---------------------------------------------------------------------------

function FilaEnvio({ envio }: { envio: EnvioDto }) {
  const esError = envio.estado === "ERROR"
  return (
    <>
      <tr>
        <td style={tdDetalle}>
          <span style={{ fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>
            {envio.orCodigo}
          </span>
          <span style={{ fontSize: "0.78rem", color: "#6b7280", marginLeft: 6 }}>
            {envio.orNombre}
          </span>
        </td>
        <td style={{ ...tdDetalle, fontFamily: "monospace", textAlign: "right" }}>
          {formatMonto(envio.montoSnapshotCop)}
        </td>
        <td style={{ ...tdDetalle, textAlign: "center" }}>
          <EstadoEnvioBadge estado={envio.estado} />
        </td>
        <td style={{ ...tdDetalle, fontFamily: "monospace", color: envio.numeroOc ? "#374151" : "#9ca3af" }}>
          {envio.numeroOc ?? "—"}
        </td>
      </tr>
      {esError && (envio.errorMensaje || envio.errorCodigo) && (
        <tr>
          <td colSpan={4} style={{ padding: "0 14px 10px 14px", borderBottom: "1px solid #f3f4f6" }}>
            <div style={{
              background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6,
              padding: "8px 12px",
            }}>
              {envio.errorCodigo && (
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#b91c1c", marginBottom: 2, fontFamily: "monospace" }}>
                  [{envio.errorCodigo}]
                </div>
              )}
              <div style={{ fontSize: "0.82rem", color: "#b91c1c", lineHeight: 1.5 }}>
                {envio.errorMensaje}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

const tdDetalle: React.CSSProperties = {
  padding: "8px 14px", fontSize: "0.875rem", color: "#374151",
  borderBottom: "1px solid #f3f4f6",
}

// ---------------------------------------------------------------------------
// Panel de detalle de un lote (se expande inline)
// ---------------------------------------------------------------------------

interface DetallePanelProps {
  loteId: string
}

function DetallePanel({ loteId }: DetallePanelProps) {
  const [detalle, setDetalle] = useState<LoteResponse | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCargando(true)
    setError(null)
    getLoteReal(loteId)
      .then(data => { setDetalle(data); setCargando(false) })
      .catch(() => { setError("No se pudo cargar el detalle."); setCargando(false) })
  }, [loteId])

  if (cargando) {
    return (
      <div style={{ padding: "20px 24px", color: "#9ca3af", fontSize: "0.875rem" }}>
        Cargando detalle…
      </div>
    )
  }
  if (error || !detalle) {
    return (
      <div style={{ padding: "20px 24px", color: "#b91c1c", fontSize: "0.875rem" }}>
        {error ?? "Sin datos."}
      </div>
    )
  }

  return (
    <div style={{ background: "#f9fafb", borderTop: "1px solid #e5e7eb", padding: "16px 24px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ background: "#f3f4f6" }}>
          <tr>
            <th style={thDetalle}>OR</th>
            <th style={{ ...thDetalle, textAlign: "right" }}>Monto</th>
            <th style={{ ...thDetalle, textAlign: "center" }}>Estado</th>
            <th style={thDetalle}>N° OC</th>
          </tr>
        </thead>
        <tbody>
          {detalle.envios.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ ...tdDetalle, textAlign: "center", color: "#9ca3af", padding: "20px" }}>
                Sin envíos en este lote.
              </td>
            </tr>
          ) : detalle.envios.map(envio => (
            <FilaEnvio key={envio.id} envio={envio} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

const thDetalle: React.CSSProperties = {
  padding: "8px 14px", fontSize: "0.73rem", fontWeight: 600, color: "#6b7280",
  textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left",
  borderBottom: "1px solid #e5e7eb",
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function HistorialEnviosPage() {
  const [lotes, setLotes] = useState<LoteResumenDto[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [loteExpandido, setLoteExpandido] = useState<string | null>(null)

  useEffect(() => {
    listarLotesReal(50)
      .then(data => { setLotes(data); setCargando(false) })
      .catch(() => { setErrorCarga("No se pudo cargar el historial."); setCargando(false) })
  }, [])

  const thStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.75rem", fontWeight: 600, color: "#6b7280",
    textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left",
    borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap",
    background: "#f9fafb",
  }
  const tdStyle: React.CSSProperties = {
    padding: "11px 14px", fontSize: "0.875rem", color: "#374151",
    borderBottom: "1px solid #f3f4f6",
  }

  function toggleDetalle(id: string) {
    setLoteExpandido(prev => prev === id ? null : id)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
            Historial de envíos NetSuite
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
            Lotes enviados a NetSuite para creación de órdenes de compra.
          </p>
        </div>
        <Link
          href="/cargos-str"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: "0.875rem", color: "#07c5a8", fontWeight: 500,
            textDecoration: "none", padding: "6px 14px",
            border: "1px solid #07c5a8", borderRadius: 8,
          }}
        >
          ← Volver a Cargos STR
        </Link>
      </div>

      {/* Tabla de lotes */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {cargando ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Cargando…
          </div>
        ) : errorCarga ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#b91c1c", fontSize: "0.9rem" }}>
            {errorCarga}
          </div>
        ) : lotes.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            No hay lotes enviados todavía.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Fecha inicio</th>
                <th style={thStyle}>Estado</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Envíos</th>
                <th style={{ ...thStyle, textAlign: "center" }}>OK</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Errores</th>
                <th style={thStyle}>Iniciado por</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {lotes.map(lote => (
                <>
                  <tr
                    key={lote.id}
                    style={{ cursor: "pointer", background: loteExpandido === lote.id ? "#f0fdf4" : undefined }}
                    onClick={() => toggleDetalle(lote.id)}
                  >
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.82rem" }}>
                      {formatFecha(lote.iniciadoAt)}
                    </td>
                    <td style={tdStyle}>
                      <EstadoLoteBadge estado={lote.estado} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center", fontWeight: 600 }}>
                      {lote.totalEnvios}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center", fontWeight: 600, color: "#15803d" }}>
                      {lote.totalOk}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center", fontWeight: 600, color: lote.totalError > 0 ? "#b91c1c" : "#9ca3af" }}>
                      {lote.totalError}
                    </td>
                    <td style={{ ...tdStyle, color: "#6b7280" }}>
                      {lote.iniciadoPor.nombre}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <span style={{
                        fontSize: "0.72rem", color: "#07c5a8", fontWeight: 600,
                        textDecoration: "underline", cursor: "pointer",
                      }}>
                        {loteExpandido === lote.id ? "Ocultar" : "Ver"}
                      </span>
                    </td>
                  </tr>
                  {loteExpandido === lote.id && (
                    <tr key={`${lote.id}-detalle`}>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <DetallePanel loteId={lote.id} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
