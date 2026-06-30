"use client"
import { useState, useEffect } from "react"

type Rol = "ADMINISTRADOR" | "ANALISTA" | "CONSULTA"

type Usuario = {
  id: string
  nombre: string
  email: string
  rol: Rol
  activo: boolean
  createdAt: string
}

const ROLES: { value: Rol; label: string; desc: string }[] = [
  { value: "ADMINISTRADOR", label: "Administrador", desc: "Acceso total y configuración" },
  { value: "ANALISTA", label: "Analista", desc: "Carga y concilia" },
  { value: "CONSULTA", label: "Consulta", desc: "Solo lectura" },
]

function rolLabel(rol: Rol): string {
  return ROLES.find(r => r.value === rol)?.label ?? rol
}

const COLOR_ROL: Record<Rol, { bg: string; fg: string }> = {
  ADMINISTRADOR: { bg: "#eef2ff", fg: "#4338ca" },
  ANALISTA:      { bg: "#f0fdf4", fg: "#15803d" },
  CONSULTA:      { bg: "#f3f4f6", fg: "#6b7280" },
}

export default function UsuariosPanel() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  // Acción en curso por id (para deshabilitar controles)
  const [savingId, setSavingId] = useState<string | null>(null)

  // Form de alta
  const [showForm, setShowForm] = useState(false)
  const [fNombre, setFNombre]   = useState("")
  const [fEmail, setFEmail]     = useState("")
  const [fPass, setFPass]       = useState("")
  const [fRol, setFRol]         = useState<Rol>("ANALISTA")
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function cargar() {
    setLoading(true)
    fetch("/api/usuarios")
      .then(async r => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}))
          throw new Error(b.error ?? `Error ${r.status}`)
        }
        return r.json() as Promise<Usuario[]>
      })
      .then(d => { setUsuarios(d); setError(null) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false))
  }

  useEffect(() => { cargar() }, [])

  async function patch(id: string, body: Record<string, unknown>) {
    setSavingId(id)
    try {
      const res = await fetch(`/api/usuarios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert((data as { error?: string }).error ?? `Error ${res.status}`)
        return
      }
      const u = data as Usuario
      setUsuarios(prev => prev.map(x => x.id === u.id ? u : x))
    } catch {
      alert("Error de red. Reintentá.")
    } finally {
      setSavingId(null)
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setFormError(null)
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: fNombre.trim(), email: fEmail.trim(), password: fPass, rol: fRol }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError((data as { error?: string }).error ?? `Error ${res.status}`)
        return
      }
      setUsuarios(prev => [...prev, data as Usuario].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setShowForm(false)
      setFNombre(""); setFEmail(""); setFPass(""); setFRol("ANALISTA")
    } catch {
      setFormError("Error de red. Reintentá.")
    } finally {
      setCreating(false)
    }
  }

  const thStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.75rem", fontWeight: 600, color: "#6b7280",
    textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left",
    borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap",
  }
  const tdStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.875rem", color: "#374151",
    borderBottom: "1px solid #f3f4f6", verticalAlign: "middle",
  }
  const inputStyle: React.CSSProperties = {
    border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px",
    fontSize: "0.85rem", color: "#111827", outline: "none", width: "100%",
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
          Usuarios del sistema y su rol de acceso. Solo administradores pueden gestionar.
        </p>
        <button
          type="button"
          onClick={() => { setShowForm(s => !s); setFormError(null) }}
          style={{
            background: showForm ? "#fff" : "#07c5a8", color: showForm ? "#374151" : "#fff",
            border: showForm ? "1px solid #d1d5db" : "none", borderRadius: 7,
            padding: "8px 14px", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
          }}
        >
          {showForm ? "Cancelar" : "+ Nuevo usuario"}
        </button>
      </div>

      {/* Form de alta */}
      {showForm && (
        <form onSubmit={crear} style={{
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 18,
          display: "flex", flexDirection: "column", gap: 14,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "0.78rem", color: "#6b7280", fontWeight: 600 }}>
              Nombre
              <input style={inputStyle} value={fNombre} onChange={e => setFNombre(e.target.value)} required placeholder="Nombre completo" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "0.78rem", color: "#6b7280", fontWeight: 600 }}>
              Email
              <input style={inputStyle} type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} required placeholder="usuario@bia.app" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "0.78rem", color: "#6b7280", fontWeight: 600 }}>
              Contraseña
              <input style={inputStyle} type="password" value={fPass} onChange={e => setFPass(e.target.value)} required minLength={8} placeholder="Mínimo 8 caracteres" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "0.78rem", color: "#6b7280", fontWeight: 600 }}>
              Rol
              <select style={inputStyle} value={fRol} onChange={e => setFRol(e.target.value as Rol)}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
              </select>
            </label>
          </div>
          {formError && <span style={{ fontSize: "0.8rem", color: "#b91c1c" }}>{formError}</span>}
          <div>
            <button type="submit" disabled={creating} style={{
              background: "#07c5a8", color: "#fff", border: "none", borderRadius: 7,
              padding: "8px 16px", fontSize: "0.85rem", fontWeight: 600,
              cursor: creating ? "not-allowed" : "pointer", opacity: creating ? 0.7 : 1,
            }}>
              {creating ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: "#f9fafb" }}>
              <tr>
                <th style={thStyle}>Nombre</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Rol</th>
                <th style={thStyle}>Estado</th>
                <th style={thStyle}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>Cargando usuarios…</td></tr>
              ) : usuarios.length === 0 ? (
                <tr><td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>No hay usuarios.</td></tr>
              ) : usuarios.map(u => {
                const busy = savingId === u.id
                const c = COLOR_ROL[u.rol]
                return (
                  <tr key={u.id} style={{ opacity: busy ? 0.6 : 1 }}>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{u.nombre}</td>
                    <td style={{ ...tdStyle, color: "#6b7280", fontFamily: "monospace", fontSize: "0.8rem" }}>{u.email}</td>
                    <td style={tdStyle}>
                      <select
                        value={u.rol}
                        disabled={busy}
                        onChange={e => patch(u.id, { rol: e.target.value })}
                        style={{
                          border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px",
                          fontSize: "0.8rem", fontWeight: 600, background: c.bg, color: c.fg,
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      {u.activo
                        ? <span style={{ background: "#f0fdf4", color: "#15803d", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600 }}>Activo</span>
                        : <span style={{ background: "#fef2f2", color: "#b91c1c", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600 }}>Inactivo</span>
                      }
                    </td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => patch(u.id, { activo: !u.activo })}
                        title={u.activo ? "Desactivar acceso" : "Activar acceso"}
                        style={{
                          background: "none", border: "1px solid #e5e7eb", borderRadius: 6,
                          padding: "4px 10px", fontSize: "0.78rem", color: "#374151",
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        {u.activo ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: "0.75rem", color: "#9ca3af", margin: 0 }}>
        {usuarios.length} usuario(s) · Roles: {ROLES.map(r => rolLabel(r.value)).join(" · ")}
      </p>
    </div>
  )
}
