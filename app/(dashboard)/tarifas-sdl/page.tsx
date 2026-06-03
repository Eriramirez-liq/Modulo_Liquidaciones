"use client"
import { useState, useEffect, useMemo } from "react"
import { MultiSelect } from "@/components/ui/MultiSelect"

interface FilaTarifa {
  id: string
  periodo: string
  or_codigo: string
  nivel_tension: string
  propiedad_activos: string
  tarifa_activa: string
  tarifa_reactiva: string
}
type Periodo = { id: string; anio: number; mes: number }
type Operador = { id: string; codigo: string; nombre: string }

const MES_NOMBRE = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

function periodoStr(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}`
}
function num(v: string | number | null): string {
  if (v == null) return "—"
  const n = typeof v === "number" ? v : parseFloat(v)
  if (isNaN(n)) return "—"
  return n.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function TarifasSDLPage() {
  const [periodos, setPeriodos]     = useState<Periodo[]>([])
  const [operadores, setOperadores] = useState<Operador[]>([])
  // Selecciones (multi). Periodos como "AAAA-MM"; ORs como codigo.
  const [periodoSel, setPeriodoSel] = useState<string[]>([])
  const [orSel, setOrSel]           = useState<string[]>([])
  const [nivel, setNivel]           = useState("")
  const [propiedad, setPropiedad]   = useState("")
  const [energia, setEnergia]       = useState<"todos" | "activa" | "reactiva">("todos")

  const [rows, setRows]       = useState<FilaTarifa[]>([])
  const [loading, setLoading] = useState(false)
  const [filtrado, setFiltrado] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Opciones: mismos periodos que Cargos STR (de /api/periodos) y los 21 OR SDL.
  useEffect(() => {
    Promise.all([
      fetch("/api/periodos").then(r => r.json()),
      fetch("/api/operadores?tipo=sdl").then(r => r.json()),
    ]).then(([ps, ors]) => {
      setPeriodos(Array.isArray(ps) ? ps : [])
      setOperadores(Array.isArray(ors) ? ors : [])
    }).catch(() => {})
  }, [])

  // El filtrado se aplica solo al presionar "Filtrar" (como en Cargos STR).
  async function filtrar() {
    setLoading(true); setError(null); setFiltrado(true)
    const qs = new URLSearchParams()
    if (periodoSel.length > 0) qs.set("periodos", periodoSel.join(","))
    if (orSel.length      > 0) qs.set("orCodigos", orSel.join(","))
    if (nivel)     qs.set("nivel", nivel)
    if (propiedad) qs.set("propiedad", propiedad)
    try {
      const res = await fetch(`/api/tarifas-sdl?${qs}`)
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setRows(data.rows ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const periodoOpts = useMemo(
    () => periodos.map(p => ({ id: periodoStr(p.anio, p.mes), label: `${MES_NOMBRE[p.mes]} ${p.anio}` })),
    [periodos],
  )
  const orOpts = useMemo(
    () => operadores.map(o => ({ id: o.codigo, label: o.nombre })),
    [operadores],
  )

  const periodoSummary = periodoSel.length === 0 ? "Todos"
    : periodoSel.length === 1 ? (periodoOpts.find(p => p.id === periodoSel[0])?.label ?? "1 mes")
    : `${periodoSel.length} meses`
  const orSummary = orSel.length === 0 ? "Todos"
    : orSel.length === 1 ? (orOpts.find(o => o.id === orSel[0])?.label ?? "1 OR")
    : `${orSel.length} ORs`

  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
    set(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const verActiva   = energia === "todos" || energia === "activa"
  const verReactiva = energia === "todos" || energia === "reactiva"

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
        background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px",
        display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end",
      }}>
        <MultiSelect
          label="Mes de consumo"
          summary={periodoSummary}
          options={periodoOpts}
          selected={periodoSel}
          onToggle={toggle(setPeriodoSel)}
          onSelectAll={() => setPeriodoSel(periodoOpts.map(p => p.id))}
          onClear={() => setPeriodoSel([])}
        />
        <MultiSelect
          label="Operador de red"
          summary={orSummary}
          options={orOpts}
          selected={orSel}
          onToggle={toggle(setOrSel)}
          onSelectAll={() => setOrSel(orOpts.map(o => o.id))}
          onClear={() => setOrSel([])}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>Nivel de tensión</label>
          <select value={nivel} onChange={e => setNivel(e.target.value)}
            style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: "0.875rem", background: "#fff", minWidth: 140 }}>
            <option value="">Todos</option>
            <option value="1">Nivel 1</option>
            <option value="2">Nivel 2</option>
            <option value="3">Nivel 3</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>Propiedad de activos</label>
          <select value={propiedad} onChange={e => setPropiedad(e.target.value)}
            style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: "0.875rem", background: "#fff", minWidth: 140 }}>
            <option value="">Todas</option>
            <option value="OR">OR</option>
            <option value="COMPARTIDO">Compartido</option>
            <option value="USUARIO">Usuario</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>Energía</label>
          <select value={energia} onChange={e => setEnergia(e.target.value as "todos" | "activa" | "reactiva")}
            style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: "0.875rem", background: "#fff", minWidth: 140 }}>
            <option value="activa">Activa</option>
            <option value="reactiva">Reactiva</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <button
          onClick={filtrar}
          disabled={loading}
          style={{
            background: "#07c5a8", color: "#fff", border: "none", borderRadius: 8,
            padding: "9px 24px", fontSize: "0.875rem", fontWeight: 600,
            cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1, alignSelf: "flex-end",
          }}
        >
          {loading ? "Filtrando…" : "Filtrar"}
        </button>
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px" }}>
        <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: 12 }}>
          {loading ? "Cargando…" : filtrado ? `${rows.length} ${rows.length === 1 ? "registro" : "registros"}` : "Aplicá los filtros y presioná Filtrar."}
        </div>
        {error && <div style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{error}</div>}
        {!loading && !error && filtrado && rows.length === 0 && (
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
