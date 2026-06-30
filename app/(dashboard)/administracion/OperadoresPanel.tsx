"use client"
import { useState, useEffect } from "react"

type Operador = {
  id: string; codigo: string; nombre: string; nit: string | null; activo: boolean
  mapeo_sdl_json: Record<string, unknown> | null
  netsuite_vendor_id: string | null
}

// Estado de edición inline por operador
type EditState = {
  editing: boolean
  value: string
  saving: boolean
  error: string | null
}

export default function OperadoresPanel() {
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [loading, setLoading]       = useState(true)
  // Map de id → estado de edición de vendor id
  const [editStates, setEditStates] = useState<Record<string, EditState>>({})

  useEffect(() => {
    fetch("/api/operadores?includeMapeo=true")
      .then(r => r.json())
      .then((data: Operador[]) => { setOperadores(data); setLoading(false) })
  }, [])

  function startEdit(id: string, currentValue: string | null) {
    setEditStates(prev => ({
      ...prev,
      [id]: { editing: true, value: currentValue ?? "", saving: false, error: null },
    }))
  }

  function cancelEdit(id: string) {
    setEditStates(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  async function saveVendorId(id: string) {
    const state = editStates[id]
    if (!state) return
    const newValue = state.value.trim()

    setEditStates(prev => ({ ...prev, [id]: { ...prev[id]!, saving: true, error: null } }))

    try {
      const res = await fetch(`/api/operadores/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ netsuite_vendor_id: newValue === "" ? null : newValue }),
      })
      if (!res.ok) {
        let msg = `Error ${res.status}`
        try { const body = await res.json(); msg = (body as { message?: string }).message ?? msg } catch { /* noop */ }
        setEditStates(prev => ({ ...prev, [id]: { ...prev[id]!, saving: false, error: msg } }))
        return
      }
      const updated = await res.json() as { id: string; codigo: string; nombre: string; netsuite_vendor_id: string | null }
      // Actualizar la fila en el estado local con el valor devuelto por el backend
      setOperadores(prev => prev.map(o => o.id === updated.id ? { ...o, netsuite_vendor_id: updated.netsuite_vendor_id } : o))
      // Cerrar el editor
      setEditStates(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch {
      setEditStates(prev => ({ ...prev, [id]: { ...prev[id]!, saving: false, error: "Error de red. Reintentá." } }))
    }
  }

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
      <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
        Configuración SDL y parámetros de mapeo por operador.
      </p>

      {/* Summary */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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
                <th style={thStyle}>Vendor NetSuite</th>
                <th style={thStyle}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>Cargando operadores...</td></tr>
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
                    <td style={{ ...tdStyle, minWidth: 180 }}>
                      <VendorCell
                        vendorId={o.netsuite_vendor_id}
                        editState={editStates[o.id] ?? null}
                        onStartEdit={() => startEdit(o.id, o.netsuite_vendor_id)}
                        onCancelEdit={() => cancelEdit(o.id)}
                        onSave={() => saveVendorId(o.id)}
                        onChangeValue={(v: string) =>
                          setEditStates(prev => ({ ...prev, [o.id]: { ...prev[o.id]!, value: v } }))
                        }
                      />
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

// ---------------------------------------------------------------------------
// VendorCell — celda editable inline para netsuite_vendor_id
// ---------------------------------------------------------------------------

interface VendorCellProps {
  vendorId: string | null
  editState: EditState | null
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  onChangeValue: (v: string) => void
}

function VendorCell({
  vendorId,
  editState,
  onStartEdit,
  onCancelEdit,
  onSave,
  onChangeValue,
}: VendorCellProps) {
  if (!editState) {
    // Modo lectura
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.82rem", color: vendorId ? "#374151" : "#9ca3af" }}>
          {vendorId ?? "—"}
        </span>
        <button
          type="button"
          onClick={onStartEdit}
          title="Editar Vendor NetSuite"
          style={{
            background: "none", border: "1px solid #e5e7eb", borderRadius: 4,
            padding: "1px 6px", fontSize: "0.7rem", color: "#6b7280",
            cursor: "pointer", lineHeight: 1.4,
          }}
        >
          Editar
        </button>
      </div>
    )
  }

  // Modo edición
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="text"
          value={editState.value}
          onChange={e => onChangeValue(e.target.value)}
          disabled={editState.saving}
          placeholder="ej. 12345"
          style={{
            border: "1px solid #07c5a8", borderRadius: 4, padding: "3px 7px",
            fontSize: "0.82rem", fontFamily: "monospace", width: 110,
            outline: "none", color: "#111827",
          }}
          onKeyDown={e => {
            if (e.key === "Enter") onSave()
            if (e.key === "Escape") onCancelEdit()
          }}
          autoFocus
        />
        <button
          type="button"
          onClick={onSave}
          disabled={editState.saving}
          style={{
            background: "#07c5a8", color: "#fff", border: "none", borderRadius: 4,
            padding: "3px 8px", fontSize: "0.75rem", fontWeight: 600,
            cursor: editState.saving ? "not-allowed" : "pointer",
            opacity: editState.saving ? 0.7 : 1,
          }}
        >
          {editState.saving ? "Guardando…" : "Guardar"}
        </button>
        {!editState.saving && (
          <button
            type="button"
            onClick={onCancelEdit}
            style={{
              background: "none", border: "1px solid #e5e7eb", borderRadius: 4,
              padding: "3px 7px", fontSize: "0.75rem", color: "#6b7280",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        )}
      </div>
      {editState.error && (
        <span style={{ fontSize: "0.72rem", color: "#b91c1c" }}>{editState.error}</span>
      )}
    </div>
  )
}
