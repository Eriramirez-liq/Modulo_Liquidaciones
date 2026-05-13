"use client"
import { useState, useEffect } from "react"
import { Play } from "lucide-react"

type Periodo = { id: string; anio: number; mes: number; estado: string }
type Operador = { id: string; codigo: string; nombre: string }

export default function ConciliacionesPage() {
  const [periodos, setPeriodos]     = useState<Periodo[]>([])
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [periodoId, setPeriodoId]   = useState("")
  const [orId, setOrId]             = useState("")
  const [tipo, setTipo]             = useState("Todos")
  const [loading, setLoading]       = useState(false)
  const [mensaje, setMensaje]       = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/periodos").then(r => r.json()),
      fetch("/api/operadores").then(r => r.json()),
    ]).then(([ps, ors]) => {
      setPeriodos(ps)
      setOperadores(ors)
    })
  }, [])

  async function ejecutar() {
    if (!periodoId) { setMensaje("Selecciona un período para continuar."); return }
    setLoading(true)
    setMensaje(null)
    // Motor de conciliación no implementado aún — placeholder
    await new Promise(r => setTimeout(r, 800))
    setMensaje("El motor de conciliación se ejecutará aquí cuando esté implementado.")
    setLoading(false)
  }

  const selectStyle: React.CSSProperties = {
    border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px",
    fontSize: "0.875rem", background: "#fff", cursor: "pointer", minWidth: 200,
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
          Motor de Conciliación
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
          Ejecuta las reglas de negocio sobre el período seleccionado para obtener Provisiones, Contingencias y Disputas.
        </p>
      </div>

      <div style={{
        background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "24px",
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "#374151" }}>
              Período de conciliación
            </label>
            <select value={periodoId} onChange={e => setPeriodoId(e.target.value)} style={selectStyle}>
              <option value="">Selecciona un período...</option>
              {periodos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.anio}-{String(p.mes).padStart(2, "0")} — {p.estado}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "#374151" }}>
              Operador de Red
            </label>
            <select value={orId} onChange={e => setOrId(e.target.value)} style={selectStyle}>
              <option value="">Todos los ORs</option>
              {operadores.map(o => (
                <option key={o.id} value={o.id}>{o.nombre}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "#374151" }}>
              Tipo de liquidación
            </label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={selectStyle}>
              {["Todos", "SDL", "TC1", "COT", "BALANCE"].map(t => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          <button
            onClick={ejecutar}
            disabled={loading}
            style={{
              background: "#07c5a8", color: "#fff", border: "none", borderRadius: 8,
              padding: "9px 20px", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8, opacity: loading ? 0.7 : 1,
              alignSelf: "flex-end",
            }}
          >
            <Play size={14} />
            Ejecutar Conciliación
          </button>
        </div>

        {mensaje && (
          <div style={{
            marginTop: 16, padding: "10px 14px", background: "#eff6ff",
            border: "1px solid #bfdbfe", borderRadius: 8,
            fontSize: "0.875rem", color: "#1d4ed8",
          }}>
            {mensaje}
          </div>
        )}
      </div>
    </div>
  )
}
