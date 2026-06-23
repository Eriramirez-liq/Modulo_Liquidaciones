"use client"
import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"

type Periodo = { id: string; anio: number; mes: number; estado: string }

type OperadorSDL = {
  orCodigo: string
  orNombre: string
  activaCop: number
  reactivaCop: number
  totalCop: number
}

type SDLPorORResponse = {
  operadores: OperadorSDL[]
  totales: { activaCop: number; reactivaCop: number; totalCop: number }
}

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function labelPeriodo(p: Periodo): string {
  const mm = String(p.mes).padStart(2, "0")
  return `${p.anio}-${mm} — ${p.estado}`
}

function cop(v: number): string {
  return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}

// ---------------------------------------------------------------------------
// Contenido principal — usa useSearchParams, requiere Suspense
// ---------------------------------------------------------------------------

function PreliquidacionesSDLContent() {
  const searchParams = useSearchParams()
  const periodoIdQuery = searchParams.get("periodoId") ?? ""

  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [periodoId, setPeriodoId] = useState<string>("")
  const [data, setData] = useState<SDLPorORResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [periodosCargados, setPeriodosCargados] = useState(false)

  // Carga períodos y selecciona el correcto
  useEffect(() => {
    fetch("/api/periodos")
      .then(r => r.json())
      .then((ps: Periodo[]) => {
        setPeriodos(ps)
        if (ps.length > 0) {
          const match = ps.find(p => p.id === periodoIdQuery)
          setPeriodoId(match ? match.id : (ps[0]?.id ?? ""))
        }
        setPeriodosCargados(true)
      })
      .catch(() => setPeriodosCargados(true))
  }, [periodoIdQuery])

  // Fetch datos SDL cuando cambia el período seleccionado
  useEffect(() => {
    if (!periodoId) return
    setLoading(true)
    setData(null)
    fetch(`/api/sdl-por-or?periodoId=${periodoId}`)
      .then(r => r.json())
      .then((d: SDLPorORResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [periodoId])

  const thStyle: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    textAlign: "left",
    borderBottom: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
    background: "#f9fafb",
  }
  const thRight: React.CSSProperties = { ...thStyle, textAlign: "right" }
  const tdStyle: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: "0.875rem",
    color: "#374151",
    borderBottom: "1px solid #f3f4f6",
  }
  const tdRight: React.CSSProperties = {
    ...tdStyle,
    textAlign: "right",
    fontFamily: "monospace",
  }
  const tdTotales: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: "0.875rem",
    fontWeight: 700,
    color: "#065f46",
    borderTop: "2px solid #d1fae5",
    background: "#f0fdf4",
  }
  const tdTotalesRight: React.CSSProperties = {
    ...tdTotales,
    textAlign: "right",
    fontFamily: "monospace",
  }

  // Subtítulo con el período seleccionado
  const periodoSel = periodos.find(p => p.id === periodoId)
  const subtitulo = periodoSel
    ? `Período ${periodoSel.anio}-${String(periodoSel.mes).padStart(2, "0")} (${MESES[periodoSel.mes]} ${periodoSel.anio}) — ${periodoSel.estado}`
    : "Seleccione un período para ver la preliquidación."

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
            Preliquidación SDL por operador
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
            {subtitulo}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Período</span>
          <select
            value={periodoId}
            onChange={e => setPeriodoId(e.target.value)}
            disabled={!periodosCargados}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: "0.875rem",
              background: "#fff",
              cursor: "pointer",
              minWidth: 200,
            }}
          >
            {!periodosCargados && <option value="">Cargando períodos…</option>}
            {periodos.length === 0 && periodosCargados && <option value="">Sin períodos</option>}
            {periodos.map(p => (
              <option key={p.id} value={p.id}>
                {labelPeriodo(p)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Cargando…
          </div>
        ) : !data || data.operadores.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Sin preliquidación SDL para este período.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Operador</th>
                  <th style={thRight}>Activa</th>
                  <th style={thRight}>Reactiva</th>
                  <th style={thRight}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.operadores.map(op => (
                  <tr key={op.orCodigo}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 500 }}>{op.orNombre}</span>
                      {" "}
                      <span style={{
                        fontFamily: "monospace",
                        fontSize: "0.78rem",
                        color: "#6b7280",
                        background: "#f3f4f6",
                        padding: "1px 6px",
                        borderRadius: 4,
                      }}>
                        {op.orCodigo}
                      </span>
                    </td>
                    <td style={tdRight}>{cop(op.activaCop)}</td>
                    <td style={tdRight}>{cop(op.reactivaCop)}</td>
                    <td style={{ ...tdRight, fontWeight: 600 }}>{cop(op.totalCop)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...tdTotales, fontWeight: 700 }}>TOTAL</td>
                  <td style={tdTotalesRight}>{cop(data.totales.activaCop)}</td>
                  <td style={tdTotalesRight}>{cop(data.totales.reactivaCop)}</td>
                  <td style={{ ...tdTotalesRight, background: "#07c5a8", color: "#fff" }}>
                    {cop(data.totales.totalCop)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export default — envuelve en Suspense (requerido por Next 15 + useSearchParams)
// ---------------------------------------------------------------------------

export default function PreliquidacionesSDLPage() {
  return (
    <Suspense fallback={<div style={{ padding: "40px", textAlign: "center", color: "#9ca3af" }}>Cargando...</div>}>
      <PreliquidacionesSDLContent />
    </Suspense>
  )
}
