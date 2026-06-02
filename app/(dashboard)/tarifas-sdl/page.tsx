"use client"
import { useState, useEffect } from "react"

interface FilaTarifa {
  id: string
  periodo: string
  or_codigo: string
  nivel_tension: string
  propiedad_activos: string
  tarifa_activa: string
  tarifa_reactiva: string
}

function num(v: string | number | null): string {
  if (v == null) return "—"
  const n = typeof v === "number" ? v : parseFloat(v)
  if (isNaN(n)) return "—"
  return n.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const selectStyle: React.CSSProperties = {
  border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px",
  fontSize: "0.875rem", background: "#fff", cursor: "pointer", minWidth: 160,
}

export default function TarifasSDLPage() {
  const [periodo, setPeriodo]   = useState("")
  const [orCodigo, setOrCodigo] = useState("")
  const [nivel, setNivel]       = useState("")
  const [energia, setEnergia]   = useState<"todas" | "activa" | "reactiva">("todas")

  const [rows, setRows]           = useState<FilaTarifa[]>([])
  const [periodos, setPeriodos]   = useState<string[]>([])
  const [operadores, setOperadores] = useState<string[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    const qs = new URLSearchParams()
    if (periodo)  qs.set("periodo", periodo)
    if (orCodigo) qs.set("orCodigo", orCodigo)
    if (nivel)    qs.set("nivel", nivel)
    fetch(`/api/tarifas-sdl?${qs}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return }
        setRows(data.rows ?? [])
        setPeriodos(data.periodos ?? [])
        setOperadores(data.operadores ?? [])
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [periodo, orCodigo, nivel])

  const verActiva   = energia === "todas" || energia === "activa"
  const verReactiva = energia === "todas" || energia === "reactiva"

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
          Tarifas SDL
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
          Tarifas activa y reactiva por operador de red, nivel de tensión y propiedad de activos,
          calculadas a partir de los insumos (Cargos ADD + Uso de la red).
        </p>
      </div>

      {/* Filtros */}
      <div style={{
        background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px",
        display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end",
      }}>
        <Filtro label="Mes de consumo">
          <select value={periodo} onChange={e => setPeriodo(e.target.value)} style={selectStyle}>
            <option value="">Todos</option>
            {periodos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Filtro>
        <Filtro label="Operador de red">
          <select value={orCodigo} onChange={e => setOrCodigo(e.target.value)} style={selectStyle}>
            <option value="">Todos</option>
            {operadores.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Filtro>
        <Filtro label="Nivel de tensión">
          <select value={nivel} onChange={e => setNivel(e.target.value)} style={selectStyle}>
            <option value="">Todos</option>
            <option value="1">Nivel 1</option>
            <option value="2">Nivel 2</option>
            <option value="3">Nivel 3</option>
          </select>
        </Filtro>
        <Filtro label="Energía">
          <select value={energia} onChange={e => setEnergia(e.target.value as "todas" | "activa" | "reactiva")} style={selectStyle}>
            <option value="todas">Activa y reactiva</option>
            <option value="activa">Activa</option>
            <option value="reactiva">Reactiva</option>
          </select>
        </Filtro>
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px" }}>
        <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: 12 }}>
          {loading ? "Cargando…" : `${rows.length} ${rows.length === 1 ? "registro" : "registros"}`}
        </div>
        {error && <div style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#6b7280", fontSize: "0.9rem" }}>
            No hay tarifas para los filtros seleccionados. Cargá los insumos en el módulo de Cargas
            (fuente &quot;Insumos Tarifas SDL&quot;).
          </div>
        )}
        {!loading && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <Th>Mes</Th>
                  <Th>Operador</Th>
                  <Th>Nivel</Th>
                  <Th>Propiedad</Th>
                  {verActiva   && <Th right>Tarifa Activa ($/kWh)</Th>}
                  {verReactiva && <Th right>Tarifa Reactiva ($/kVArh)</Th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <Td>{r.periodo}</Td>
                    <Td mono>{r.or_codigo}</Td>
                    <Td>{r.nivel_tension}</Td>
                    <Td>{r.propiedad_activos}</Td>
                    {verActiva   && <Td right>{num(r.tarifa_activa)}</Td>}
                    {verReactiva && <Td right>{num(r.tarifa_reactiva)}</Td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Filtro({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "#374151" }}>{label}</label>
      {children}
    </div>
  )
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{
      padding: "8px 12px", textAlign: right ? "right" : "left", fontWeight: 600,
      color: "#6b7280", fontSize: "0.72rem", textTransform: "uppercase",
      letterSpacing: "0.04em", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap",
    }}>{children}</th>
  )
}
function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td style={{
      padding: "8px 12px", textAlign: right ? "right" : "left", color: "#111827",
      fontFamily: mono ? "monospace" : undefined, fontWeight: mono ? 600 : 400, whiteSpace: "nowrap",
    }}>{children}</td>
  )
}
