"use client"

import { useEffect, useRef, useCallback } from "react"
import type { CargoSeleccionado } from "./types"

interface ModalConfirmarLoteProps {
  abierto: boolean
  cargos: CargoSeleccionado[]
  /** ORs entre los cargos seleccionados que no tienen netsuite_vendor_id configurado */
  cargosSinVendor: { orCodigo: string; orNombre: string }[]
  enviando: boolean
  error: string | null
  onConfirmar: () => void
  onCancelar: () => void
}

function cop(v: number) {
  return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}

function mesLabel(periodoStr: string): string {
  const MES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
  const [a, m] = periodoStr.split("-")
  const n = parseInt(m ?? "", 10)
  if (!a || isNaN(n) || n < 1 || n > 12) return periodoStr
  return `${MES[n]} ${a}`
}

export default function ModalConfirmarLote({
  abierto,
  cargos,
  cargosSinVendor,
  enviando,
  error,
  onConfirmar,
  onCancelar,
}: ModalConfirmarLoteProps) {
  const cancelarBtnRef = useRef<HTMLButtonElement>(null)
  const confirmarBtnRef = useRef<HTMLButtonElement>(null)
  // Ref para restaurar el foco al cerrar el modal
  const anteriorFocusRef = useRef<Element | null>(null)

  // Guardar el elemento enfocado antes de abrir y restaurarlo al cerrar
  useEffect(() => {
    if (abierto) {
      anteriorFocusRef.current = document.activeElement
      // AutoFocus: primer botón (Cancelar)
      cancelarBtnRef.current?.focus()
    } else {
      if (anteriorFocusRef.current instanceof HTMLElement) {
        anteriorFocusRef.current.focus()
      }
    }
  }, [abierto])

  // Cerrar con Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enviando) {
        onCancelar()
      }
    },
    [enviando, onCancelar]
  )

  useEffect(() => {
    if (!abierto) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [abierto, handleKeyDown])

  if (!abierto) return null

  const totalMonto = cargos.reduce((acc, c) => acc + c.montoCop, 0)
  const cargosConErrorPrevio = cargos.filter(c => {
    // CargoSeleccionado no tiene tieneErrorPrevio directamente,
    // pero se pasa enriquecido desde page.tsx — verificar en tiempo de ejecución
    return (c as CargoSeleccionado & { tieneErrorPrevio?: boolean }).tieneErrorPrevio === true
  })

  // Set de códigos de OR sin vendor id — para marcar filas de la tabla
  const sinVendorSet = new Set(cargosSinVendor.map(v => v.orCodigo))
  const nombresORsSinVendor = cargosSinVendor.map(v => v.orNombre || v.orCodigo).join(", ")

  const titleId = "modal-confirmar-lote-titulo"

  return (
    <>
      {/* Overlay */}
      <div
        onClick={enviando ? undefined : onCancelar}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.45)",
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
        }}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 51,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.18)",
            width: "100%",
            maxWidth: 700,
            maxHeight: "80vh",
            display: "flex",
            flexDirection: "column",
            pointerEvents: "auto",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "20px 24px 16px",
              borderBottom: "1px solid #e5e7eb",
              flexShrink: 0,
            }}
          >
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontSize: "1.125rem",
                fontWeight: 700,
                color: "#111827",
              }}
            >
              Confirmar generación de OC
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "0.875rem",
                color: "#6b7280",
              }}
            >
              {cargos.length} cargo{cargos.length !== 1 ? "s" : ""} seleccionado
              {cargos.length !== 1 ? "s" : ""} — suma total:{" "}
              <strong style={{ color: "#111827" }}>{cop(totalMonto)}</strong>
            </p>
          </div>

          {/* Cuerpo */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* Advertencia OR sin Vendor de NetSuite — VENDOR_SIN_ID */}
            {cargosSinVendor.length > 0 && (
              <div
                role="alert"
                style={{
                  background: "#fef3c7",
                  border: "1px solid #fcd34d",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: "0.8rem",
                  color: "#b45309",
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <span style={{ fontSize: "1rem", flexShrink: 0 }}>⚠</span>
                <span>
                  <strong>
                    {cargosSinVendor.length} operador{cargosSinVendor.length !== 1 ? "es" : ""} sin
                    Vendor de NetSuite configurado:
                  </strong>{" "}
                  {nombresORsSinVendor}.{" "}
                  Esos envíos fallarán (VENDOR_SIN_ID). Cargá el id interno en{" "}
                  <strong>Operadores → Vendor NetSuite</strong>.
                </span>
              </div>
            )}

            {/* Warning cargos con error previo */}
            {cargosConErrorPrevio.length > 0 && (
              <div
                role="alert"
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fcd34d",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: "0.8rem",
                  color: "#92400e",
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <span style={{ fontSize: "1rem", flexShrink: 0 }}>⚠</span>
                <span>
                  <strong>{cargosConErrorPrevio.length}</strong> cargo
                  {cargosConErrorPrevio.length !== 1 ? "s" : ""} ya fallaron antes.
                  Al confirmar se reenvían en un nuevo lote.
                </span>
              </div>
            )}

            {/* Tabla de cargos */}
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                overflow: "hidden",
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.8rem",
                }}
              >
                <thead>
                  <tr>
                    {[
                      { label: "Operador", align: "left" as const },
                      { label: "Mes consumo", align: "center" as const },
                      { label: "Mes facturación", align: "center" as const },
                      { label: "Monto", align: "right" as const },
                    ].map(col => (
                      <th
                        key={col.label}
                        style={{
                          padding: "8px 12px",
                          background: "#f9fafb",
                          borderBottom: "1px solid #e5e7eb",
                          fontWeight: 600,
                          color: "#374151",
                          textAlign: col.align,
                          whiteSpace: "nowrap",
                          position: "sticky",
                          top: 0,
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cargos.map((c, i) => {
                    const esSinVendor = sinVendorSet.has(c.orCodigo)
                    return (
                    <tr
                      key={`${c.periodoId}|${c.orCodigo}`}
                      style={{
                        background: esSinVendor
                          ? "#fffbeb"
                          : i % 2 === 0 ? "#fff" : "#fafafa",
                      }}
                    >
                      <td
                        style={{
                          padding: "7px 12px",
                          borderBottom: "1px solid #f3f4f6",
                          color: "#111827",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: "0.75rem",
                              color: "#6b7280",
                            }}
                          >
                            {c.orCodigo}
                          </span>
                          <span>{c.orNombre}</span>
                          {esSinVendor && (
                            <span
                              style={{
                                fontSize: "0.68rem",
                                fontWeight: 600,
                                color: "#b45309",
                                background: "#fef3c7",
                                border: "1px solid #fcd34d",
                                borderRadius: 4,
                                padding: "1px 5px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              sin vendor
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          borderBottom: "1px solid #f3f4f6",
                          textAlign: "center",
                          color: "#374151",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {mesLabel(c.mesConsumo)}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          borderBottom: "1px solid #f3f4f6",
                          textAlign: "center",
                          color: "#374151",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {mesLabel(c.mesFacturacion)}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          borderBottom: "1px solid #f3f4f6",
                          textAlign: "right",
                          fontFamily: "monospace",
                          color: "#111827",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {cop(c.montoCop)}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Total al pie de la tabla */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 12,
                padding: "8px 0 0",
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <span
                style={{
                  fontSize: "0.8rem",
                  color: "#6b7280",
                  fontWeight: 600,
                }}
              >
                Total {cargos.length} cargo{cargos.length !== 1 ? "s" : ""}:
              </span>
              <span
                style={{
                  fontSize: "1rem",
                  fontWeight: 700,
                  fontFamily: "monospace",
                  color: "#065f46",
                }}
              >
                {cop(totalMonto)}
              </span>
            </div>

            {/* Error del fetch */}
            {error && (
              <div
                role="alert"
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: "0.8rem",
                  color: "#b91c1c",
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "16px 24px",
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <button
              ref={cancelarBtnRef}
              type="button"
              onClick={onCancelar}
              disabled={enviando}
              style={{
                padding: "8px 20px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "#fff",
                color: "#374151",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: enviando ? "not-allowed" : "pointer",
                opacity: enviando ? 0.6 : 1,
              }}
            >
              Cancelar
            </button>
            <button
              ref={confirmarBtnRef}
              type="button"
              onClick={onConfirmar}
              disabled={enviando}
              style={{
                padding: "8px 20px",
                borderRadius: 8,
                border: "none",
                background: enviando ? "#a7f3d0" : "#07c5a8",
                color: "#fff",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: enviando ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "background 0.15s",
              }}
            >
              {enviando ? (
                <>
                  <SpinnerIcon />
                  Enviando...
                </>
              ) : (
                "Confirmar envío"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      style={{
        animation: "spin 0.8s linear infinite",
      }}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="2"
      />
      <path
        d="M7 1.5A5.5 5.5 0 0 1 12.5 7"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
