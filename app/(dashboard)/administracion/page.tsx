"use client"
import { useState } from "react"
import OperadoresPanel from "./OperadoresPanel"
import UsuariosPanel from "./UsuariosPanel"

type Tab = "operadores" | "usuarios"

const TABS: { id: Tab; label: string }[] = [
  { id: "operadores", label: "Operadores" },
  { id: "usuarios", label: "Usuarios" },
]

export default function AdministracionPage() {
  const [tab, setTab] = useState<Tab>("operadores")

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
          Administración
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
          Configuración de operadores de red y gestión de usuarios.
        </p>
      </div>

      {/* Pestañas */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e7eb" }}>
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "10px 16px", fontSize: "0.875rem",
                fontWeight: active ? 700 : 500,
                color: active ? "#07c5a8" : "#6b7280",
                borderBottom: active ? "2px solid #07c5a8" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === "operadores" ? <OperadoresPanel /> : <UsuariosPanel />}
    </div>
  )
}
