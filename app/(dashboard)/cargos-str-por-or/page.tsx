"use client"
import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"

type Periodo = { id: string; anio: number; mes: number; estado: string }

type OperadorSTR = { orCodigo: string; orNombre: string; valorCop: number }
type STRPorORResponse = { operadores: OperadorSTR[]; total: number }

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function labelPeriodo(p: Periodo): string {
  return `${p.anio}-${String(p.mes).padStart(2, "0")} — ${p.estado}`
}
function cop(v: number): string {
  return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}

function CargosSTRPorORContent() {
  const searchParams = useSearchParams()
  const periodoIdQuery = searchParams.get("periodoId") ?? ""

  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [periodoId, setPeriodoId] = useState<string>("")
  const [data, setData] = useState<STRPorORResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [periodosCargados, setPeriodosCargados] = useState(false)

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

  useEffect(() => {
    if (!periodoId) return
    setLoading(true)
    setData(null)
    fetch(`/api/str-por-or?periodoId=${periodoId}`)
      .then(r => r.json())
      .then((d: STRPorORResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [periodoId])

  const thStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.75rem", fontWeight: 600, color: "#6b7280",
    textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left",
    borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap", background: "#f9fafb",
  }
  const thRight: React.CSSProperties = { ...thStyle, textAlign: "right" }
  const tdStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.875rem", color: "#374151", borderBottom: "1px solid #f3f4f6",
  }
  const tdRight: React.CSSProperties = { ...tdStyle, textAlign: "right", fontFamily: "monospace" }

  const periodoSel = periodos.find(p => p.id === periodoId)
  const subtitulo = periodoSel
    ? `Período ${periodoSel.anio}-${String(periodoSel.mes).padStart(2, "0")} (${MESES[periodoSel.mes]} ${periodoSel.anio}) — ${periodoSel.estado}`
    : "Seleccione un período para ver los cargos STR."

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
            Cargos STR por operador
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>{subtitulo}</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
            <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Período</span>
            <select
              value={periodoId}
              onChange={e => setPeriodoId(e.target.value)}
              disabled={!periodosCargados}
              style={{
                border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 12px",
                fontSize: "0.875rem", background: "#fff", cursor: "pointer", minWidth: 200,
              }}
            >
              {!periodosCargados && <option value="">Cargando períodos…</option>}
              {periodos.length === 0 && periodosCargados && <option value="">Sin períodos</option>}
              {periodos.map(p => <option key={p.id} value={p.id}>{labelPeriodo(p)}</option>)}
            </select>
          </div>
          <Link href="/cargos-str" style={{
            border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 12px", background: "#fff",
            fontSize: "0.8rem", color: "#374151", textDecoration: "none", whiteSpace: "nowrap",
          }}>
            Ir al módulo STR
          </Link>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>Cargando…</div>
        ) : !data || data.operadores.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Sin cargos STR para este período.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Operador</th>
                  <th style={thRight}>Valor a pagar</th>
                </tr>
              </thead>
              <tbody>
                {data.operadores.map(op => (
                  <tr key={op.orCodigo}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 500 }}>{op.orNombre}</span>{" "}
                      <span style={{
                        fontFamily: "monospace", fontSize: "0.78rem", color: "#6b7280",
                        background: "#f3f4f6", padding: "1px 6px", borderRadius: 4,
                      }}>{op.orCodigo}</span>
                    </td>
                    <td style={{ ...tdRight, fontWeight: 600 }}>{cop(op.valorCop)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ padding: "10px 14px", fontSize: "0.875rem", fontWeight: 700, color: "#065f46", borderTop: "2px solid #d1fae5", background: "#f0fdf4" }}>TOTAL</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, borderTop: "2px solid #d1fae5", background: "#07c5a8", color: "#fff" }}>
                    {cop(data.total)}
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

export default function CargosSTRPorORPage() {
  return (
    <Suspense fallback={<div style={{ padding: "40px", textAlign: "center", color: "#9ca3af" }}>Cargando...</div>}>
      <CargosSTRPorORContent />
    </Suspense>
  )
}
