"use client"
import { useState, useEffect } from "react"

type Periodo  = { id: string; anio: number; mes: number; estado: string }
type Operador = { id: string; codigo: string; nombre: string }

type Provision = {
  id: string; codigo_frontera: string; tipo: string
  energia_kwh: string; valor_provisionado_cop: string; estado: string
  createdAt: string
  periodo: { anio: number; mes: number }
  operador_red: { codigo: string; nombre: string } | null
}
type Contingencia = {
  id: string; codigo_frontera: string
  energia_kwh: string; costo_calculado_cop: string | null; estado: string
  createdAt: string
  periodo: { anio: number; mes: number }
  operador_red: { codigo: string; nombre: string } | null
}
type Disputa = {
  id: string; codigo_frontera: string
  energia_exceso_kwh: string; valor_disputa_cop: string; estado: string
  createdAt: string
  periodo: { anio: number; mes: number }
  operador_red: { codigo: string; nombre: string }
}

type Tab = "provisiones" | "contingencias" | "disputas"

const ESTADO_PROV: Record<string, [string, string]> = {
  PENDIENTE:       ["#fff7ed", "#b45309"],
  CRUZADO_PARCIAL: ["#eff6ff", "#1d4ed8"],
  CRUZADO_TOTAL:   ["#f0fdf4", "#15803d"],
}
const ESTADO_CONT: Record<string, [string, string]> = {
  PENDIENTE: ["#fff7ed", "#b45309"],
  COBRADO:   ["#eff6ff", "#1d4ed8"],
  CERRADO:   ["#f0fdf4", "#15803d"],
}
const ESTADO_DISP: Record<string, [string, string]> = {
  ABIERTA:           ["#fef2f2", "#b91c1c"],
  EN_GESTION:        ["#fff7ed", "#b45309"],
  RESUELTA:          ["#f0fdf4", "#15803d"],
  CERRADA_SIN_AJUSTE:["#f9fafb", "#6b7280"],
}

function cop(v: string | number | null) {
  if (v == null) return "—"
  return `$ ${Number(v).toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}
function kwh(v: string | number | null) {
  if (v == null) return "—"
  return `${Number(v).toLocaleString("es-CO", { maximumFractionDigits: 2 })}`
}
function dias(created: string) {
  const d = Math.floor((Date.now() - new Date(created).getTime()) / 86400000)
  return d === 0 ? "Hoy" : `${d}d`
}

export default function GestionesPage() {
  const [periodos, setPeriodos]     = useState<Periodo[]>([])
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [periodoId, setPeriodoId]   = useState("")
  const [orId, setOrId]             = useState("")
  const [tab, setTab]               = useState<Tab>("provisiones")
  const [estadoFiltro, setEstadoFiltro] = useState("")
  const [rows, setRows]             = useState<unknown[]>([])
  const [loading, setLoading]       = useState(false)
  const [filtrado, setFiltrado]     = useState(false)

  useEffect(() => {
    Promise.all([
      fetch("/api/periodos").then(r => r.json()),
      fetch("/api/operadores").then(r => r.json()),
    ]).then(([ps, ors]) => { setPeriodos(ps); setOperadores(ors) })
  }, [])

  async function filtrar() {
    setLoading(true)
    setFiltrado(true)
    const params = new URLSearchParams({ tipo: tab })
    if (periodoId) params.set("periodoId", periodoId)
    if (orId) params.set("orId", orId)
    const res = await fetch(`/api/gestiones?${params}`)
    setRows(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    if (filtrado) filtrar()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const selectStyle: React.CSSProperties = {
    border: "1px solid #d1d5db", borderRadius: 8, padding: "7px 12px",
    fontSize: "0.875rem", background: "#fff", cursor: "pointer",
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

  function StatusBadge({ estado, map }: { estado: string; map: Record<string, [string, string]> }) {
    const [bg, col] = map[estado] ?? ["#f3f4f6", "#6b7280"]
    return (
      <span style={{ background: bg, color: col, padding: "2px 8px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 600 }}>
        {estado.replace(/_/g, " ")}
      </span>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
          Gestión M3
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
          Provisiones, contingencias y disputas generadas por el motor de conciliación.
        </p>
      </div>

      {/* Filters */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>Período</label>
            <select value={periodoId} onChange={e => setPeriodoId(e.target.value)} style={selectStyle}>
              <option value="">Todos los períodos</option>
              {periodos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.anio}-{String(p.mes).padStart(2, "0")} — {p.estado}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>Operador de Red</label>
            <select value={orId} onChange={e => setOrId(e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {operadores.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
          <button
            onClick={filtrar}
            disabled={loading}
            style={{
              background: "#07c5a8", color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 18px", fontSize: "0.875rem", fontWeight: 600,
              cursor: "pointer", opacity: loading ? 0.7 : 1, alignSelf: "flex-end",
            }}
          >
            Filtrar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
        {([["provisiones","Provisiones"],["contingencias","Contingencias"],["disputas","Disputas"]] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              padding: "10px 16px", fontSize: "0.875rem",
              fontWeight: tab === k ? 600 : 400,
              color: tab === k ? "#07c5a8" : "#9ca3af",
              background: "none", border: "none",
              borderBottom: tab === k ? "2px solid #07c5a8" : "2px solid transparent",
              cursor: "pointer", marginBottom: -1,
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Sub-filter + Table */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
          <select
            value={estadoFiltro}
            onChange={e => setEstadoFiltro(e.target.value)}
            style={{ ...selectStyle, fontSize: "0.8rem", padding: "5px 10px" }}
          >
            <option value="">Todos los estados</option>
            {tab === "provisiones" && <>
              <option>PENDIENTE</option>
              <option>CRUZADO_PARCIAL</option>
              <option>CRUZADO_TOTAL</option>
            </>}
            {tab === "contingencias" && <>
              <option>PENDIENTE</option><option>COBRADO</option><option>CERRADO</option>
            </>}
            {tab === "disputas" && <>
              <option>ABIERTA</option><option>EN_GESTION</option>
              <option>RESUELTA</option><option>CERRADA_SIN_AJUSTE</option>
            </>}
          </select>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: "#f9fafb" }}>
              <tr>
                <th style={thStyle}>Frontera</th>
                <th style={thStyle}>Operador de Red</th>
                <th style={thStyle}>Período</th>
                <th style={thStyle}>Tipo</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Energía (kWh)</th>
                <th style={{ ...thStyle, textAlign: "right" }}>
                  {tab === "provisiones" ? "Provisionado (COP)" : tab === "disputas" ? "Valor (COP)" : "Costo (COP)"}
                </th>
                <th style={thStyle}>Estado</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Días</th>
                <th style={thStyle}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>Cargando...</td></tr>
              ) : !filtrado ? (
                <tr><td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>Selecciona un período y pulsa Filtrar.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>No hay registros para los filtros seleccionados.</td></tr>
              ) : tab === "provisiones" ? (
                (rows as Provision[])
                  .filter(r => !estadoFiltro || r.estado === estadoFiltro)
                  .map(r => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{r.codigo_frontera}</td>
                    <td style={tdStyle}>{r.operador_red?.nombre ?? "—"}</td>
                    <td style={tdStyle}>{r.periodo.anio}-{String(r.periodo.mes).padStart(2,"0")}</td>
                    <td style={tdStyle}>{r.tipo}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{kwh(r.energia_kwh)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{cop(r.valor_provisionado_cop)}</td>
                    <td style={tdStyle}><StatusBadge estado={r.estado} map={ESTADO_PROV} /></td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#9ca3af" }}>{dias(r.createdAt)}</td>
                    <td style={tdStyle}><span style={{ color: "#07c5a8", cursor: "pointer", fontSize: "0.8rem" }}>Ver</span></td>
                  </tr>
                ))
              ) : tab === "contingencias" ? (
                (rows as Contingencia[])
                  .filter(r => !estadoFiltro || r.estado === estadoFiltro)
                  .map(r => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{r.codigo_frontera}</td>
                    <td style={tdStyle}>{r.operador_red?.nombre ?? "—"}</td>
                    <td style={tdStyle}>{r.periodo.anio}-{String(r.periodo.mes).padStart(2,"0")}</td>
                    <td style={tdStyle}>Contingencia</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{kwh(r.energia_kwh)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{cop(r.costo_calculado_cop)}</td>
                    <td style={tdStyle}><StatusBadge estado={r.estado} map={ESTADO_CONT} /></td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#9ca3af" }}>{dias(r.createdAt)}</td>
                    <td style={tdStyle}><span style={{ color: "#07c5a8", cursor: "pointer", fontSize: "0.8rem" }}>Ver</span></td>
                  </tr>
                ))
              ) : (
                (rows as Disputa[])
                  .filter(r => !estadoFiltro || r.estado === estadoFiltro)
                  .map(r => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{r.codigo_frontera}</td>
                    <td style={tdStyle}>{r.operador_red?.nombre ?? "—"}</td>
                    <td style={tdStyle}>{r.periodo.anio}-{String(r.periodo.mes).padStart(2,"0")}</td>
                    <td style={tdStyle}>Disputa</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{kwh(r.energia_exceso_kwh)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{cop(r.valor_disputa_cop)}</td>
                    <td style={tdStyle}><StatusBadge estado={r.estado} map={ESTADO_DISP} /></td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#9ca3af" }}>{dias(r.createdAt)}</td>
                    <td style={tdStyle}><span style={{ color: "#07c5a8", cursor: "pointer", fontSize: "0.8rem" }}>Ver</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
