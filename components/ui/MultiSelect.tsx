"use client"
import { useState } from "react"

/**
 * Dropdown de seleccion multiple con "Seleccionar todos" / "Limpiar".
 * Reutilizado en Cargos STR y Tarifas SDL.
 */
export function MultiSelect({
  label, summary, options, selected, onToggle, onSelectAll, onClear,
}: {
  label: string
  summary: string
  options: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string) => void
  onSelectAll: () => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative", minWidth: 220 }}>
      <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>{label}</label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          border: "1px solid #d1d5db", borderRadius: 8, padding: "7px 12px",
          fontSize: "0.875rem", background: "#fff", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8, textAlign: "left",
        }}
      >
        <span style={{ color: selected.length === 0 ? "#6b7280" : "#111827" }}>{summary}</span>
        <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>▼</span>
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}
          />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 20,
            minWidth: 260, maxHeight: 320, overflowY: "auto",
          }}>
            <div style={{
              padding: "6px 10px", borderBottom: "1px solid #f3f4f6",
              display: "flex", gap: 12, fontSize: "0.78rem",
            }}>
              <button type="button" onClick={onSelectAll}
                style={{ background: "none", border: "none", color: "#07c5a8", cursor: "pointer", padding: 0 }}>
                Seleccionar todos
              </button>
              <button type="button" onClick={onClear}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: 0 }}>
                Limpiar
              </button>
            </div>
            {options.length === 0 ? (
              <div style={{ padding: "10px 14px", fontSize: "0.8rem", color: "#9ca3af" }}>
                Sin opciones disponibles
              </div>
            ) : options.map(opt => (
              <label key={opt.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 12px", cursor: "pointer", fontSize: "0.875rem",
              }}>
                <input
                  type="checkbox"
                  checked={selected.includes(opt.id)}
                  onChange={() => onToggle(opt.id)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
