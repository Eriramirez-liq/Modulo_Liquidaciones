"use client"
import { useState, useEffect } from "react"
import Link from "next/link"

type Carga = {
  id: string
  tipo_fuente: string
  nombre_archivo: string
  estado: string
  total_registros: number | null
  createdAt: string
  periodo: { anio: number; mes: number }
  operador_red: { codigo: string; nombre: string } | null
  cargado_por: { nombre: string }
}

const FUENTE_COLORS: Record<string, [string, string]> = {
  SDL:        ["#eff6ff", "#1d4ed8"],
  XM:         ["#f0fdf4", "#15803d"],
  FACTURACION:["#fef3c7", "#b45309"],
  BALANCE:    ["#fdf4ff", "#7c3aed"],
  TC1:        ["#fff7ed", "#c2410c"],
  COT:        ["#f0f9ff", "#0369a1"],
}

const ESTADO_COLORS: Record<string, [string, string]> = {
  COMPLETADA: ["#f0fdf4", "#15803d"],
  ERROR:      ["#fef2f2", "#b91c1c"],
  PROCESANDO: ["#fff7ed", "#b45309"],
  PENDIENTE:  ["#f9fafb", "#6b7280"],
}

export function TablaHistorial() {
  const [cargas, setCargas]   = useState<Carga[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/cargas")
      .then(r => r.json())
      .then(d => { setCargas(d.cargas ?? []); setLoading(false) })
  }, [])

  const thStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.75rem", fontWeight: 600,
    color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em",
    textAlign: "left", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap",
  }
  const tdStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.875rem", color: "#374151",
    borderBottom: "1px solid #f3f4f6",
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
      <div style={{
        padding: "16px 20px", display: "flex", justifyContent: "space-between",
        alignItems: "center", borderBottom: "1px solid #f3f4f6",
      }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#111827", margin: "0 0 2px" }}>
            Historial de cargas
          </h2>
          <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: 0 }}>
            Archivos cargados al sistema por período y tipo de fuente
          </p>
        </div>
        <Link
          href="/cargas/nueva"
          style={{
            background: "#07c5a8", color: "#fff", borderRadius: 8,
            padding: "8px 16px", fontSize: "0.875rem", fontWeight: 600,
            textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          + Nueva carga
        </Link>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f9fafb" }}>
            <tr>
              <th style={thStyle}>Período</th>
              <th style={thStyle}>Tipo</th>
              <th style={thStyle}>Operador</th>
              <th style={thStyle}>Archivo</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Registros</th>
              <th style={thStyle}>Estado</th>
              <th style={thStyle}>Cargado por</th>
              <th style={thStyle}>Fecha</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>
                  Cargando...
                </td>
              </tr>
            ) : cargas.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "40px" }}>
                  No hay cargas registradas. Haz clic en &quot;+ Nueva carga&quot; para comenzar.
                </td>
              </tr>
            ) : cargas.map(c => {
              const [fbg, fcol] = FUENTE_COLORS[c.tipo_fuente] ?? ["#f3f4f6", "#6b7280"]
              const [ebg, ecol] = ESTADO_COLORS[c.estado]      ?? ["#f3f4f6", "#6b7280"]
              const fecha = new Date(c.createdAt).toLocaleString("es-CO", {
                day: "2-digit", month: "2-digit", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })
              return (
                <tr key={c.id} style={{ transition: "background 0.1s" }}>
                  <td style={tdStyle}>
                    {c.periodo.anio}-{String(c.periodo.mes).padStart(2, "0")}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      background: fbg, color: fcol, padding: "2px 8px",
                      borderRadius: 999, fontSize: "0.75rem", fontWeight: 600,
                    }}>
                      {c.tipo_fuente}
                    </span>
                  </td>
                  <td style={tdStyle}>{c.operador_red?.nombre ?? "—"}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.8rem" }}>
                    {c.nombre_archivo}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {c.total_registros?.toLocaleString("es-CO") ?? "—"}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      background: ebg, color: ecol, padding: "2px 8px",
                      borderRadius: 999, fontSize: "0.75rem", fontWeight: 600,
                    }}>
                      {c.estado === "COMPLETADA" ? "Completada"
                       : c.estado === "ERROR"     ? "Error"
                       : c.estado === "PROCESANDO"? "Procesando"
                       : "Pendiente"}
                    </span>
                  </td>
                  <td style={tdStyle}>{c.cargado_por.nombre}</td>
                  <td style={{ ...tdStyle, color: "#9ca3af", fontSize: "0.8rem" }}>{fecha}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {c.tipo_fuente === "SDL" && c.estado === "COMPLETADA" && (
                      <a
                        href={`/api/cargas/exportar-sdl?cargaId=${c.id}`}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          border: "1px solid #86efac", color: "#15803d", background: "#fff",
                          borderRadius: 7, padding: "4px 10px", fontSize: "0.78rem",
                          fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap",
                        }}
                      >
                        ↓ Excel
                      </a>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
