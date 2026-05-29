"use client"
import { useState, useEffect } from "react"
import { Play, Download } from "lucide-react"

type Periodo = { id: string; anio: number; mes: number; estado: string }
type Operador = { id: string; codigo: string; nombre: string }

type Indicador =
  | "sin_diferencia"
  | "activa"
  | "inductiva"
  | "capacitiva"
  | "factor_m"
  | "nivel_tension"
  | "propiedad"
  | "incompletas"

interface ResumenConciliacion {
  periodoId: string
  periodoStr: string
  totalFronteras: number
  sinDiferencia: number
  indicadores: {
    activa:        number
    inductiva:     number
    capacitiva:    number
    factor_m:      number
    nivel_tension: number
    propiedad:     number
  }
  provisiones:   { cantidad: number; energia_total: number; valor_total: number }
  contingencias: { cantidad: number; energia_total: number; valor_estimado_total: number }
  disputas:      { cantidad: number; valor_total: number }
  alertasManual: number
  incompletas:   number
}

interface FilaDetalle {
  id: string
  codigo_frontera: string
  nombre_usuario: string | null
  operador_red: string | null
  or_obj: { codigo: string; nombre: string } | null
  e_fac: string | null
  e_xm:  string | null
  e_sdl: string | null
  delta_l1: string | null
  delta_l2: string | null
  caso: string
  resultado_l1: string | null
  resultado_l2: string | null
  impacto_financiero_l1: string | null
  impacto_financiero_l2: string | null
  requiere_alerta_manual: boolean
  observaciones: string | null
  ind_pen_fac: string | null
  ind_pen_sdl: string | null
  ind_pen_delta: string | null
  cap_pen_fac: string | null
  cap_pen_sdl: string | null
  cap_pen_delta: string | null
  factor_m_fac: string | null
  factor_m_sdl: string | null
  nivel_tension_fac: string | null
  nivel_tension_sdl: string | null
  propiedad_activos_fac: string | null
  propiedad_activos_sdl: string | null
}

function cop(v: number) {
  return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}
function num(v: string | null | number, frac = 0): string {
  if (v == null) return "—"
  const n = typeof v === "number" ? v : parseFloat(v)
  if (isNaN(n)) return "—"
  return n.toLocaleString("es-CO", { maximumFractionDigits: frac })
}
function txt(v: string | null): string {
  return v?.trim() || "—"
}

export default function ConciliacionesPage() {
  const [periodos, setPeriodos]     = useState<Periodo[]>([])
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [periodoId, setPeriodoId]   = useState("")
  const [orId, setOrId]             = useState("")
  const [tipo, setTipo]             = useState("SDL")
  const [loading, setLoading]       = useState(false)
  const [mensaje, setMensaje]       = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [resumen, setResumen]       = useState<ResumenConciliacion | null>(null)
  const [indicadorSel, setIndicadorSel] = useState<Indicador | null>(null)
  const [descargando, setDescargando] = useState(false)

  async function descargarExcel() {
    if (!resumen) return
    setDescargando(true)
    try {
      const qs = new URLSearchParams({ periodoId: resumen.periodoId })
      if (orId) qs.set("orId", orId)
      const res = await fetch(`/api/conciliaciones/exportar?${qs}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "No se pudo generar el Excel.")
        return
      }
      const blob = await res.blob()
      const disp = res.headers.get("Content-Disposition") ?? ""
      const m = disp.match(/filename="(.+?)"/)
      const fname = m?.[1] ?? `conciliacion_${resumen.periodoStr}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fname
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(`Error al descargar el Excel: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDescargando(false)
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/periodos").then(r => r.json()),
      fetch("/api/operadores?tipo=sdl").then(r => r.json()),
    ]).then(([ps, ors]) => {
      setPeriodos(ps)
      setOperadores(ors)
    })
  }, [])

  async function ejecutar() {
    setError(null)
    setMensaje(null)
    setResumen(null)
    setIndicadorSel(null)
    if (!periodoId) { setError("Selecciona un período para continuar."); return }
    if (tipo !== "SDL") {
      setError(`El motor para "${tipo}" aún no está implementado. Solo SDL está disponible.`)
      return
    }
    const periodo = periodos.find(p => p.id === periodoId)
    if (!periodo) { setError("Período no encontrado."); return }

    setLoading(true)
    try {
      const res = await fetch("/api/conciliaciones/ejecutar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anio: periodo.anio,
          mes:  periodo.mes,
          orId: orId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Error al ejecutar la conciliación.")
        return
      }
      setResumen(data.resumen)
      setMensaje(
        `Conciliación completada: ${data.resumen.totalFronteras} fronteras procesadas. ` +
        `Hacé click en una KPI para ver el detalle.`,
      )
    } catch (e) {
      setError(`Error de red: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
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
          Compara Facturación vs OR vs XM en 6 indicadores: activa, inductiva, capacitiva, factor M, nivel de tensión, propiedad de activos.
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

        {error && (
          <div style={{
            marginTop: 16, padding: "10px 14px", background: "#fef2f2",
            border: "1px solid #fca5a5", borderRadius: 8,
            fontSize: "0.875rem", color: "#b91c1c",
          }}>
            {error}
          </div>
        )}
        {mensaje && (
          <div style={{
            marginTop: 16, padding: "10px 14px", background: "#f0fdf4",
            border: "1px solid #86efac", borderRadius: 8,
            fontSize: "0.875rem", color: "#15803d",
          }}>
            {mensaje}
          </div>
        )}
      </div>

      {resumen && (
        <div style={{
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "24px",
          display: "flex", flexDirection: "column", gap: 20,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
                Resumen — {resumen.periodoStr}
              </h2>
              <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}>
                {resumen.totalFronteras} fronteras procesadas. Hacé click en una KPI para ver el detalle.
              </p>
            </div>
            <button
              onClick={descargarExcel}
              disabled={descargando}
              style={{
                background: "#fff", color: "#15803d", border: "1px solid #86efac",
                borderRadius: 8, padding: "8px 16px", fontSize: "0.85rem", fontWeight: 600,
                cursor: descargando ? "default" : "pointer", display: "flex", alignItems: "center",
                gap: 8, opacity: descargando ? 0.7 : 1, whiteSpace: "nowrap",
              }}
            >
              <Download size={15} />
              {descargando ? "Generando…" : "Descargar Excel"}
            </button>
          </div>

          {/* KPIs clickeables */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <KpiCard label="Sin diferencia"   indicador="sin_diferencia"  selected={indicadorSel} onSelect={setIndicadorSel}
              main={resumen.sinDiferencia} color="#10b981" />
            <KpiCard label="Activa"           indicador="activa"          selected={indicadorSel} onSelect={setIndicadorSel}
              main={resumen.indicadores.activa} color="#3b82f6" />
            <KpiCard label="Inductiva"        indicador="inductiva"       selected={indicadorSel} onSelect={setIndicadorSel}
              main={resumen.indicadores.inductiva} color="#06b6d4" />
            <KpiCard label="Capacitiva"       indicador="capacitiva"      selected={indicadorSel} onSelect={setIndicadorSel}
              main={resumen.indicadores.capacitiva} color="#0891b2" />
            <KpiCard label="Factor M"         indicador="factor_m"        selected={indicadorSel} onSelect={setIndicadorSel}
              main={resumen.indicadores.factor_m} color="#a855f7" />
            <KpiCard label="Nivel de tensión" indicador="nivel_tension"   selected={indicadorSel} onSelect={setIndicadorSel}
              main={resumen.indicadores.nivel_tension} color="#f59e0b" />
            <KpiCard label="Propiedad activos" indicador="propiedad"      selected={indicadorSel} onSelect={setIndicadorSel}
              main={resumen.indicadores.propiedad} color="#d97706" />
            <KpiCard label="Incompletas / Error" indicador="incompletas"  selected={indicadorSel} onSelect={setIndicadorSel}
              main={resumen.incompletas} color="#6b7280" />
          </div>

          {indicadorSel && (
            <PanelDetalle
              indicador={indicadorSel}
              periodoId={resumen.periodoId}
              orId={orId || undefined}
              totales={
                indicadorSel === "activa"
                  ? { provisiones: resumen.provisiones, contingencias: resumen.contingencias, disputas: resumen.disputas }
                  : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel de detalle: fetch + renderiza tabla segun el indicador seleccionado
// ─────────────────────────────────────────────────────────────────────────────

function PanelDetalle({
  indicador, periodoId, orId, totales,
}: {
  indicador: Indicador
  periodoId: string
  orId?: string
  totales?: {
    provisiones:   { cantidad: number; energia_total: number; valor_total: number }
    contingencias: { cantidad: number; energia_total: number; valor_estimado_total: number }
    disputas:      { cantidad: number; valor_total: number }
  }
}) {
  const [rows, setRows]     = useState<FilaDetalle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ periodoId, indicador })
    if (orId) qs.set("orId", orId)
    fetch(`/api/conciliaciones/detalle?${qs}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error)
        else setRows(data.rows ?? [])
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [indicador, periodoId, orId])

  return (
    <div style={{
      background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10,
      padding: "16px", display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#111827", margin: 0 }}>
          {tituloIndicador(indicador)}
        </h3>
        <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>
          {loading ? "Cargando…" : `${rows.length} ${rows.length === 1 ? "frontera" : "fronteras"}`}
        </span>
      </div>

      {/* Cabecera especial para ACTIVA con sub-totales */}
      {indicador === "activa" && totales && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <SubTotal label="Provisiones" cantidad={totales.provisiones.cantidad}
            sub={`${num(totales.provisiones.energia_total)} kWh · ${cop(totales.provisiones.valor_total)}`}
            color="#3b82f6" />
          <SubTotal label="Pérdidas" cantidad={totales.contingencias.cantidad}
            sub={`${num(totales.contingencias.energia_total)} kWh · ${cop(totales.contingencias.valor_estimado_total)}`}
            color="#f59e0b" />
          <SubTotal label="Disputas" cantidad={totales.disputas.cantidad}
            sub={cop(totales.disputas.valor_total)} color="#dc2626" />
        </div>
      )}

      {error && (
        <div style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div style={{ fontSize: "0.85rem", color: "#6b7280", padding: "16px", textAlign: "center" }}>
          No hay fronteras para este indicador.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <TablaDetalle indicador={indicador} rows={rows} />
        </div>
      )}
    </div>
  )
}

function tituloIndicador(i: Indicador): string {
  switch (i) {
    case "sin_diferencia":    return "Sin diferencia"
    case "activa":            return "ACTIVA — detalle"
    case "inductiva":         return "INDUCTIVA — detalle"
    case "capacitiva":        return "CAPACITIVA — detalle"
    case "factor_m":          return "FACTOR M — detalle"
    case "nivel_tension":     return "NIVEL DE TENSIÓN — detalle"
    case "propiedad":         return "PROPIEDAD DE ACTIVOS — detalle"
    case "incompletas":       return "Incompletas / Error"
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tablas por indicador
// ─────────────────────────────────────────────────────────────────────────────

const th: React.CSSProperties = {
  textAlign: "left", padding: "8px 10px", fontSize: "0.72rem",
  color: "#6b7280", fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.04em", borderBottom: "1px solid #e5e7eb",
  background: "#fff", whiteSpace: "nowrap",
}
const td: React.CSSProperties = {
  padding: "8px 10px", fontSize: "0.82rem", color: "#111827",
  borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap",
}
const tdSic: React.CSSProperties = { ...td, fontFamily: "monospace", fontWeight: 600 }
const tdRight: React.CSSProperties = { ...td, textAlign: "right" }

function TablaDetalle({ indicador, rows }: { indicador: Indicador; rows: FilaDetalle[] }) {
  if (indicador === "activa") return <TablaActiva rows={rows} />
  if (indicador === "inductiva" || indicador === "capacitiva") return <TablaReactiva rows={rows} tipo={indicador} />
  if (indicador === "factor_m") return <TablaFactorM rows={rows} />
  if (indicador === "nivel_tension") return <TablaTexto rows={rows} campo="nivel_tension" />
  if (indicador === "propiedad")     return <TablaTexto rows={rows} campo="propiedad" />
  if (indicador === "incompletas")   return <TablaIncompletas rows={rows} />
  return <TablaSimple rows={rows} />
}

function TablaActiva({ rows }: { rows: FilaDetalle[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 6 }}>
      <thead>
        <tr>
          <th style={th}>SIC</th>
          <th style={th}>Operador</th>
          <th style={{ ...th, textAlign: "right" }}>Activa fac</th>
          <th style={{ ...th, textAlign: "right" }}>Activa OR</th>
          <th style={{ ...th, textAlign: "right" }}>Activa XM</th>
          <th style={{ ...th, textAlign: "right" }}>Δ fac−XM</th>
          <th style={{ ...th, textAlign: "right" }}>Δ fac−OR</th>
          <th style={th}>Tipo</th>
          <th style={{ ...th, textAlign: "right" }}>Valor</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const { tipo, valor, color } = tipoActiva(r)
          const deltaFacOr = (r.e_fac != null && r.e_sdl != null)
            ? parseFloat(r.e_fac) - parseFloat(r.e_sdl)
            : null
          return (
            <tr key={r.id}>
              <td style={tdSic}>{r.codigo_frontera}</td>
              <td style={td}>{r.or_obj?.nombre ?? r.operador_red ?? "—"}</td>
              <td style={tdRight}>{num(r.e_fac)}</td>
              <td style={tdRight}>{num(r.e_sdl)}</td>
              <td style={tdRight}>{num(r.e_xm)}</td>
              <td style={tdRight}>{num(r.delta_l1)}</td>
              <td style={tdRight}>{deltaFacOr != null ? num(deltaFacOr) : "—"}</td>
              <td style={{ ...td, color, fontWeight: 600 }}>
                {tipo} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({r.caso})</span>
              </td>
              <td style={tdRight}>{valor != null ? cop(valor) : "—"}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function tipoActiva(r: FilaDetalle): { tipo: string; valor: number | null; color: string } {
  if (r.resultado_l1 === "PROVISION_L1")  return { tipo: "Provisión", valor: r.impacto_financiero_l1 != null ? parseFloat(r.impacto_financiero_l1) : null, color: "#3b82f6" }
  if (r.resultado_l1 === "CONTINGENCIA_L1") return { tipo: "Pérdida", valor: r.impacto_financiero_l1 != null ? parseFloat(r.impacto_financiero_l1) : null, color: "#f59e0b" }
  if (r.resultado_l2 === "DISPUTA_L2")    return { tipo: "Disputa",   valor: r.impacto_financiero_l2 != null ? parseFloat(r.impacto_financiero_l2) : null, color: "#dc2626" }
  if (r.caso === "D4")                    return { tipo: "Alerta",    valor: null, color: "#9333ea" }
  return { tipo: r.caso, valor: null, color: "#6b7280" }
}

function TablaReactiva({ rows, tipo }: { rows: FilaDetalle[]; tipo: "inductiva" | "capacitiva" }) {
  const fac = tipo === "inductiva" ? "ind_pen_fac" : "cap_pen_fac"
  const sdl = tipo === "inductiva" ? "ind_pen_sdl" : "cap_pen_sdl"
  const delta = tipo === "inductiva" ? "ind_pen_delta" : "cap_pen_delta"
  const label = tipo === "inductiva" ? "Inductiva pen." : "Capacitiva pen."
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 6 }}>
      <thead>
        <tr>
          <th style={th}>SIC</th>
          <th style={th}>Operador</th>
          <th style={{ ...th, textAlign: "right" }}>{label} fac (kWh)</th>
          <th style={{ ...th, textAlign: "right" }}>{label} OR (kWh)</th>
          <th style={{ ...th, textAlign: "right" }}>Δ fac−OR (kWh)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td style={tdSic}>{r.codigo_frontera}</td>
            <td style={td}>{r.or_obj?.nombre ?? r.operador_red ?? "—"}</td>
            <td style={tdRight}>{num(r[fac])}</td>
            <td style={tdRight}>{num(r[sdl])}</td>
            <td style={tdRight}>{num(r[delta])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TablaFactorM({ rows }: { rows: FilaDetalle[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 6 }}>
      <thead>
        <tr>
          <th style={th}>SIC</th>
          <th style={th}>Operador</th>
          <th style={{ ...th, textAlign: "right" }}>Factor M fac</th>
          <th style={{ ...th, textAlign: "right" }}>Factor M OR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td style={tdSic}>{r.codigo_frontera}</td>
            <td style={td}>{r.or_obj?.nombre ?? r.operador_red ?? "—"}</td>
            <td style={tdRight}>{num(r.factor_m_fac)}</td>
            <td style={tdRight}>{num(r.factor_m_sdl)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TablaTexto({ rows, campo }: { rows: FilaDetalle[]; campo: "nivel_tension" | "propiedad" }) {
  const fac = campo === "nivel_tension" ? "nivel_tension_fac" : "propiedad_activos_fac"
  const sdl = campo === "nivel_tension" ? "nivel_tension_sdl" : "propiedad_activos_sdl"
  const label = campo === "nivel_tension" ? "Nivel tensión" : "Propiedad"
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 6 }}>
      <thead>
        <tr>
          <th style={th}>SIC</th>
          <th style={th}>Operador</th>
          <th style={th}>{label} fac</th>
          <th style={th}>{label} OR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td style={tdSic}>{r.codigo_frontera}</td>
            <td style={td}>{r.or_obj?.nombre ?? r.operador_red ?? "—"}</td>
            <td style={td}>{txt(r[fac])}</td>
            <td style={td}>{txt(r[sdl])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TablaIncompletas({ rows }: { rows: FilaDetalle[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 6 }}>
      <thead>
        <tr>
          <th style={th}>SIC</th>
          <th style={th}>Operador</th>
          <th style={th}>Motivo</th>
          <th style={{ ...th, textAlign: "right" }}>Activa fac</th>
          <th style={{ ...th, textAlign: "right" }}>Activa OR</th>
          <th style={{ ...th, textAlign: "right" }}>Activa XM</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td style={tdSic}>{r.codigo_frontera}</td>
            <td style={td}>{r.or_obj?.nombre ?? r.operador_red ?? "—"}</td>
            <td style={td}>{r.observaciones ?? "—"}</td>
            <td style={tdRight}>{num(r.e_fac)}</td>
            <td style={tdRight}>{num(r.e_sdl)}</td>
            <td style={tdRight}>{num(r.e_xm)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TablaSimple({ rows }: { rows: FilaDetalle[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 6 }}>
      <thead>
        <tr>
          <th style={th}>SIC</th>
          <th style={th}>Operador</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td style={tdSic}>{r.codigo_frontera}</td>
            <td style={td}>{r.or_obj?.nombre ?? r.operador_red ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Componentes auxiliares
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label, main, color, indicador, selected, onSelect,
}: {
  label: string
  main: number
  color: string
  indicador: Indicador
  selected: Indicador | null
  onSelect: (i: Indicador) => void
}) {
  const isSelected = selected === indicador
  return (
    <button
      onClick={() => onSelect(indicador)}
      style={{
        background: isSelected ? "#f0f9ff" : "#fff",
        border: isSelected ? `2px solid ${color}` : "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 4,
        cursor: "pointer", textAlign: "left",
        transition: "all 0.15s",
      }}
    >
      <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#9ca3af",
        textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: "1.5rem", fontWeight: 700, color, lineHeight: 1.15 }}>
        {main.toLocaleString("es-CO")}
      </span>
    </button>
  )
}

function SubTotal({ label, cantidad, sub, color }: { label: string; cantidad: number; sub: string; color: string }) {
  return (
    <div style={{
      background: "#fff", border: `1px solid ${color}33`, borderLeft: `4px solid ${color}`,
      borderRadius: 8, padding: "10px 14px",
      display: "flex", flexDirection: "column", gap: 2,
    }}>
      <span style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#111827" }}>
        {cantidad.toLocaleString("es-CO")} <span style={{ fontSize: "0.85rem", color: "#6b7280", fontWeight: 500 }}>{sub}</span>
      </span>
    </div>
  )
}
