"use client"

import { useEffect, useRef } from "react"
import type { DetalleEnvio } from "./types"

interface DetalleEnvioModalProps {
  abierto: boolean
  envio: DetalleEnvio | null
  cargando: boolean
  onCerrar: () => void
  // Opcional: solo disponible cuando estado === "ERROR"
  onReenviar?: () => void
}

// ---------------------------------------------------------------------------
// Helpers locales
// ---------------------------------------------------------------------------

function formatMonto(montoStr: string): string {
  const num = parseInt(montoStr, 10)
  if (isNaN(num)) return montoStr
  return `$ ${num.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}

function formatFecha(isoStr: string | null): string {
  if (!isoStr) return "—"
  return new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Bogota",
  }).format(new Date(isoStr))
}

function formatMesPeriodo(yyyyMM: string): string {
  const [anio, mes] = yyyyMM.split("-")
  const nombres = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
  const n = parseInt(mes ?? "", 10)
  if (!anio || isNaN(n) || n < 1 || n > 12) return yyyyMM
  return `${nombres[n] ?? ""} ${anio}`
}

// Badge inline — reutilizado en el header del modal
function BadgeEstado({ estado }: { estado: DetalleEnvio["estado"] }) {
  const config =
    estado === "PROCESADO"
      ? { simbolo: "✓", bg: "#d1fae5", color: "#065f46", label: "Creado exitoso" }
      : estado === "ERROR"
        ? { simbolo: "✗", bg: "#fee2e2", color: "#b91c1c", label: "Error" }
        : { simbolo: "●", bg: "#dbeafe", color: "#1e3a8a", label: "En proceso" }

  return (
    <span
      aria-label={config.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: "50%",
        background: config.bg,
        color: config.color,
        fontSize: 13,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {config.simbolo}
    </span>
  )
}

// Bloque JSON colapsable con <details>/<summary>
function JsonColapsable({ titulo, datos }: { titulo: string; datos: unknown }) {
  return (
    <details style={{ marginTop: 8 }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: 12,
          color: "#6b7280",
          fontWeight: 600,
          userSelect: "none",
          padding: "4px 0",
        }}
      >
        {titulo}
      </summary>
      <pre
        style={{
          marginTop: 4,
          padding: "10px 12px",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          fontSize: 11,
          color: "#374151",
          overflowX: "auto",
          maxHeight: 200,
          overflowY: "auto",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {JSON.stringify(datos, null, 2)}
      </pre>
    </details>
  )
}

// Fila de detalle: label + valor
function FilaDetalle({ label, valor, mono = false }: { label: string; valor: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 0" }}>
      <span
        style={{
          fontSize: 12,
          color: "#6b7280",
          minWidth: 160,
          flexShrink: 0,
          paddingTop: 1,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: "#111827",
          fontFamily: mono ? "monospace" : undefined,
          wordBreak: "break-all",
        }}
      >
        {valor}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function DetalleEnvioModal({
  abierto,
  envio,
  cargando,
  onCerrar,
  onReenviar,
}: DetalleEnvioModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  // Guardar el elemento que tenía foco antes de abrir el modal
  const anteriorFocoRef = useRef<Element | null>(null)

  // Guardar foco anterior al abrir; restaurarlo al cerrar
  useEffect(() => {
    if (abierto) {
      anteriorFocoRef.current = document.activeElement
      // Dar foco al primer elemento focuseable dentro del modal
      const timer = setTimeout(() => {
        if (modalRef.current) {
          const primer = modalRef.current.querySelector<HTMLElement>(
            "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
          )
          primer?.focus()
        }
      }, 0)
      return () => clearTimeout(timer)
    } else {
      // Restaurar foco al cerrar
      if (anteriorFocoRef.current instanceof HTMLElement) {
        anteriorFocoRef.current.focus()
      }
    }
  }, [abierto])

  // Cerrar con Escape
  useEffect(() => {
    if (!abierto) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [abierto, onCerrar])

  if (!abierto) return null

  const titleId = "detalle-envio-modal-title"

  return (
    // Overlay
    <div
      role="presentation"
      onClick={onCerrar}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      {/* Caja del modal — stopPropagation para no cerrar al hacer click dentro */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
        style={{
          background: "#ffffff",
          borderRadius: 8,
          padding: "24px",
          width: "100%",
          maxWidth: 600,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* ------------------------------------------------------------------ */}
        {/* Estado: cargando                                                    */}
        {/* ------------------------------------------------------------------ */}
        {cargando && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "32px 0",
              color: "#6b7280",
              fontSize: 14,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 28,
                height: 28,
                border: "3px solid #e5e7eb",
                borderTopColor: "#07c5a8",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <span>Cargando detalle...</span>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Estado: envio disponible                                            */}
        {/* ------------------------------------------------------------------ */}
        {!cargando && envio && (
          <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <BadgeEstado estado={envio.estado} />
              <h2
                id={titleId}
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#111827",
                }}
              >
                {envio.estado === "PROCESADO"
                  ? "Orden de compra creada"
                  : envio.estado === "ERROR"
                    ? "Error al crear orden de compra"
                    : "Envío en proceso"}
              </h2>
            </div>

            <div
              style={{
                width: "100%",
                height: 1,
                background: "#f3f4f6",
              }}
            />

            {/* ---------------------------------------------------------------- */}
            {/* Layout PROCESADO                                                 */}
            {/* ---------------------------------------------------------------- */}
            {envio.estado === "PROCESADO" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {/* Número de OC — destacado */}
                <div
                  style={{
                    background: "#d1fae5",
                    borderRadius: 8,
                    padding: "12px 16px",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontSize: 11, color: "#065f46", fontWeight: 600, marginBottom: 2 }}>
                    Número de OC
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#065f46", fontFamily: "monospace" }}>
                    {envio.numeroOc ?? "—"}
                  </div>
                  {envio.netsuiteInternalId && (
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                      ID interno NetSuite: {envio.netsuiteInternalId}
                    </div>
                  )}
                </div>

                <FilaDetalle label="Monto enviado" valor={formatMonto(envio.montoSnapshotCop)} mono />
                <FilaDetalle label="Mes de consumo" valor={formatMesPeriodo(envio.mesConsumo)} />
                <FilaDetalle label="Mes de facturación" valor={formatMesPeriodo(envio.mesFacturacion)} />
                <FilaDetalle label="Enviado" valor={formatFecha(envio.enviadoAt)} />
                <FilaDetalle label="Respondido" valor={formatFecha(envio.respondidoAt)} />
                <FilaDetalle
                  label="Intentos"
                  valor={
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: "#e5e7eb",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#374151",
                      }}
                    >
                      {envio.intentos}
                    </span>
                  }
                />

                {/* Payloads colapsables */}
                {envio.requestPayloadJson != null && (
                  <JsonColapsable titulo="Payload enviado (JSON)" datos={envio.requestPayloadJson} />
                )}
                {envio.responsePayloadJson != null && (
                  <JsonColapsable titulo="Respuesta recibida (JSON)" datos={envio.responsePayloadJson} />
                )}
              </div>
            )}

            {/* ---------------------------------------------------------------- */}
            {/* Layout ERROR                                                     */}
            {/* ---------------------------------------------------------------- */}
            {envio.estado === "ERROR" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {/* Mensaje de error — destacado */}
                <div
                  style={{
                    background: "#fee2e2",
                    borderRadius: 8,
                    padding: "12px 16px",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontSize: 11, color: "#b91c1c", fontWeight: 600, marginBottom: 4 }}>
                    Mensaje de error
                  </div>
                  <div style={{ fontSize: 13, color: "#7f1d1d", lineHeight: 1.5 }}>
                    {envio.errorMensaje ?? "Error desconocido"}
                  </div>
                  {envio.errorCodigo && (
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 11,
                        color: "#6b7280",
                        fontFamily: "monospace",
                      }}
                    >
                      Código: {envio.errorCodigo}
                    </div>
                  )}
                </div>

                <FilaDetalle
                  label="Monto que se intentó enviar"
                  valor={formatMonto(envio.montoSnapshotCop)}
                  mono
                />
                <FilaDetalle label="Mes de consumo" valor={formatMesPeriodo(envio.mesConsumo)} />
                <FilaDetalle label="Mes de facturación" valor={formatMesPeriodo(envio.mesFacturacion)} />
                <FilaDetalle
                  label="Intentos"
                  valor={
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: "#fee2e2",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#b91c1c",
                      }}
                    >
                      {envio.intentos}
                    </span>
                  }
                />
                <FilaDetalle label="Último intento — enviado" valor={formatFecha(envio.enviadoAt)} />
                <FilaDetalle label="Último intento — respondido" valor={formatFecha(envio.respondidoAt)} />

                {/* Payloads colapsables */}
                {envio.requestPayloadJson != null && (
                  <JsonColapsable titulo="Payload enviado (JSON)" datos={envio.requestPayloadJson} />
                )}
                {envio.responsePayloadJson != null && (
                  <JsonColapsable titulo="Respuesta de NetSuite (JSON)" datos={envio.responsePayloadJson} />
                )}
              </div>
            )}

            {/* ---------------------------------------------------------------- */}
            {/* Footer                                                           */}
            {/* ---------------------------------------------------------------- */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                paddingTop: 8,
                borderTop: "1px solid #f3f4f6",
              }}
            >
              <button
                type="button"
                onClick={onCerrar}
                style={{
                  padding: "8px 20px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                Cerrar
              </button>
              {envio.estado === "ERROR" && onReenviar && (
                <button
                  type="button"
                  onClick={onReenviar}
                  style={{
                    padding: "8px 20px",
                    fontSize: 14,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: "none",
                    background: "#07c5a8",
                    color: "#ffffff",
                    cursor: "pointer",
                  }}
                >
                  Reenviar
                </button>
              )}
            </div>
          </>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Estado: no hay envío (edge case)                                   */}
        {/* ------------------------------------------------------------------ */}
        {!cargando && !envio && (
          <>
            <h2
              id={titleId}
              style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}
            >
              Detalle de envío
            </h2>
            <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>
              No se encontró información para este envío.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8 }}>
              <button
                type="button"
                onClick={onCerrar}
                style={{
                  padding: "8px 20px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export { DetalleEnvioModal }
