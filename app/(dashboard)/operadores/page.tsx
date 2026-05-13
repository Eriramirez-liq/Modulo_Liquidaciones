"use client"
import { useState, useEffect } from "react"

type Operador = {
  id: string; codigo: string; nombre: string; nit: string | null; activo: boolean
  mapeo_sdl_json: Record<string, unknown> | null
}

export default function OperadoresPage() {
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    fetch("/api/operadores?includeMapeo=true")
      .then(r => r.json())
      .then((data: Operador[]) => { setOperadores(data); setLoading(false) })
  }, [])

  const thStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.75rem", fontWeight: 600, color: "#6b7280",
    textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left",
    borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap",
  }
  const tdStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.875rem", color: "#374151",
    borderBottom: "1px solid #f3f4f6",
  }

  function MapeoBadge({ mapeo }: { mapeo: Record<string, unknown> | null }) {
    if (!mapeo) {
      return <span style={{ background: "#fef9c3", color: "#a16207", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600 }}>Pendiente mapeo</span>
    }
    const tipo = (mapeo.tipo_archivo as string | undefined) ?? "xlsx"
    const cols = Object.values((mapeo.columnas as Record<string,string|null> | undefined) ?? {}).filter(Boolean).length
    return (
      <span style={{ background: "#f0fdf4", color: "#15803d", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600 }}>
        {tipo.toUpperCase()} · {cols} cols
      </span>
    )
  }

  const total        = operadores.length
  const configurados = operadores.filter(o => o.mapeo_sdl_json !== null).length

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
          Operadores de Red
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
          Configuración SDL y parámetros de mapeo por operador.
        </p>
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 18px", display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em" }}>Total ORs</span>
          <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827" }}>{total}</span>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 18px", display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em" }}>Mapeo SDL configurado</span>
          <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#07c5a8" }}>{configurados}</span>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 18px", display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pendiente mapeo</span>
          <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#f59e0b" }}>{total - configurados}</span>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: "#f9fafb" }}>
              <tr>
                <th style={thStyle}>Código</th>
                <th style={thStyle}>Nombre</th>
                <th style={thStyle}>NIT</th>
                <th style={thStyle}>Mapeo SDL</th>
                <th style={thStyle}>Tipo archivo</th>
                <th style={thStyle}>Fila inicio</th>
                <th style={thStyle}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>Cargando operadores...</td></tr>
              ) : operadores.map(o => {
                const mapeo = o.mapeo_sdl_json
                const tipoArchivo = (mapeo?.tipo_archivo as string | undefined) ?? "—"
                const filaInicio  = (mapeo?.fila_inicio  as number | undefined) ?? "—"
                return (
                  <tr key={o.id}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontWeight: 600, fontSize: "0.8rem" }}>
                      {o.codigo}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{o.nombre}</td>
                    <td style={{ ...tdStyle, color: "#9ca3af" }}>{o.nit ?? "—"}</td>
                    <td style={tdStyle}><MapeoBadge mapeo={mapeo} /></td>
                    <td style={{ ...tdStyle, color: mapeo ? "#374151" : "#9ca3af" }}>
                      {mapeo ? tipoArchivo.toUpperCase() : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center", color: mapeo ? "#374151" : "#9ca3af" }}>
                      {mapeo ? filaInicio : "—"}
                    </td>
                    <td style={tdStyle}>
                      {o.activo
                        ? <span style={{ background: "#f0fdf4", color: "#15803d", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600 }}>Activo</span>
                        : <span style={{ background: "#fef2f2", color: "#b91c1c", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600 }}>Inactivo</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
