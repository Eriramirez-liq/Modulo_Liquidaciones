"use client"
import { useState, useEffect, useCallback } from "react"
import { RefreshCw } from "lucide-react"
import Link from "next/link"

type Periodo = { id: string; anio: number; mes: number; estado: string }
type DashData = {
  totalFronteras: number; sinDiferencia: number
  provisiones: number; valorProvisiones: number
  contingenciasAbiertas: number; valorContingencias: number
  disputas: number; valorDisputas: number
  alertasManuales: number; incompletas: number; errores: number
  impactoEstimado: number
}

export default function InicioPage() {
  const [periodos, setPeriodos]   = useState<Periodo[]>([])
  const [periodoId, setPeriodoId] = useState("")
  const [tab, setTab]             = useState<"principal" | "historico" | "por_or">("principal")
  const [data, setData]           = useState<DashData | null>(null)
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    fetch("/api/periodos")
      .then(r => r.json())
      .then((p: Periodo[]) => {
        setPeriodos(p)
        if (p.length > 0 && p[0]) setPeriodoId(p[0].id)
      })
  }, [])

  const fetchData = useCallback(async () => {
    if (!periodoId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/dashboard?periodoId=${periodoId}`)
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [periodoId])

  useEffect(() => { fetchData() }, [fetchData])

  const sel = periodos.find(p => p.id === periodoId)
  const periodoLabel = sel
    ? `${sel.anio}-${String(sel.mes).padStart(2, "0")} — ${sel.estado}`
    : "—"

  const d = data
  const pct = d && d.totalFronteras > 0
    ? Math.round((d.sinDiferencia / d.totalFronteras) * 100)
    : 0

  function cop(v: number) {
    return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
            Dashboard de Seguimiento
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
            Monitoreo global del proceso de conciliación por período.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Período activo</span>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={periodoId}
              onChange={e => setPeriodoId(e.target.value)}
              style={{
                border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 12px",
                fontSize: "0.875rem", background: "#fff", cursor: "pointer",
              }}
            >
              {periodos.length === 0 && <option value="">Sin períodos</option>}
              {periodos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.anio}-{String(p.mes).padStart(2, "0")} — {p.estado}
                </option>
              ))}
            </select>
            <button
              onClick={fetchData}
              disabled={loading}
              style={{
                border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 12px",
                background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                fontSize: "0.875rem", color: "#374151", opacity: loading ? 0.6 : 1,
              }}
            >
              <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
              Refrescar
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
        {([["principal", "Panel Principal"], ["historico", "Histórico 12 M"], ["por_or", "Por Operador de Red"]] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              padding: "10px 16px", fontSize: "0.875rem",
              fontWeight: tab === k ? 600 : 400,
              color: tab === k ? "#07c5a8" : "#6b7280",
              background: "none", border: "none",
              borderBottom: tab === k ? "2px solid #07c5a8" : "2px solid transparent",
              cursor: "pointer", marginBottom: -1,
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "principal" && (
        <>
          {/* KPI row 1 — 7 cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
            <KPI label="TOTAL FRONTERAS" main={d?.totalFronteras ?? 0} sub={periodoLabel.split(" — ")[0] ?? ""} />
            <KPI label="SIN DIFERENCIA (A1)" main={d?.sinDiferencia ?? 0} color="#07c5a8" sub={`${pct}%`} />
            <KPI label="PROVISIONES" main={d?.provisiones ?? 0} color="#3b82f6"
              sub={cop(d?.valorProvisiones ?? 0)}
              href={periodoId ? `/gestiones?tab=provisiones&periodoId=${periodoId}` : undefined} />
            <KPI label="PÉRDIDAS L1" main={d?.contingenciasAbiertas ?? 0} color="#f59e0b"
              sub={cop(d?.valorContingencias ?? 0)}
              href={periodoId ? `/gestiones?tab=contingencias&periodoId=${periodoId}` : undefined} />
            <KPI label="DISPUTAS L2" main={d?.disputas ?? 0} color="#3b82f6"
              sub={cop(d?.valorDisputas ?? 0)}
              href={periodoId ? `/gestiones?tab=disputas&periodoId=${periodoId}` : undefined} />
            <KPI label="ALERTAS MANUALES" main={d?.alertasManuales ?? 0} color="#9333ea"
              href={periodoId ? `/gestiones?tab=alertas-manuales&periodoId=${periodoId}` : undefined} />
            <KPI label="INCOMPLETAS / ERRORES"
              main={`${d?.incompletas ?? 0} / ${d?.errores ?? 0}`} color="#ef4444"
              href={periodoId ? `/gestiones?tab=incompletas&periodoId=${periodoId}` : undefined} />
          </div>

          {/* KPI row 2 — impacto */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <KPI label="IMPACTO ESTIMADO (L1+L2)"
              main={cop(d?.impactoEstimado ?? 0)} color="#7c3aed"
              sub={`${(d?.totalFronteras ?? 0)} kWh`} />
          </div>

          {/* Charts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <ChartCard title="DISTRIBUCIÓN DE FRONTERAS">
              <div style={{ textAlign: "center", color: "#9ca3af" }}>
                <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "#d1d5db" }}>
                  {d?.totalFronteras ?? 0}
                </div>
                <div style={{ fontSize: "0.7rem", letterSpacing: "0.08em" }}>FRONTERAS</div>
              </div>
            </ChartCard>
            <ChartCard title="TOP 10 FRONTERAS — IMPACTO FINANCIERO L1">
              <p style={{ fontSize: "0.8rem", color: "#9ca3af", textAlign: "center" }}>
                Sin datos de conciliación para este período.
              </p>
            </ChartCard>
          </div>
        </>
      )}

      {tab === "historico" && (
        <div style={{
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
          padding: "32px", textAlign: "center", color: "#9ca3af", fontSize: "0.875rem",
        }}>
          Histórico de 12 meses disponible cuando existan períodos cerrados.
        </div>
      )}

      {tab === "por_or" && (
        <div style={{
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
          padding: "32px", textAlign: "center", color: "#9ca3af", fontSize: "0.875rem",
        }}>
          Desglose por operador de red disponible después de ejecutar la conciliación.
        </div>
      )}
    </div>
  )
}

function KPI({ label, main, color, sub, href }: {
  label: string; main: string | number; color?: string; sub?: string
  href?: string
}) {
  const content = (
    <>
      <span style={{
        fontSize: "0.65rem", fontWeight: 600, color: "#9ca3af",
        textTransform: "uppercase", letterSpacing: "0.06em",
      }}>
        {label}
      </span>
      <span style={{ fontSize: "1.5rem", fontWeight: 700, color: color ?? "#111827", lineHeight: 1.15 }}>
        {main}
      </span>
      {sub && <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{sub}</span>}
    </>
  )
  const baseStyle: React.CSSProperties = {
    background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
    padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4,
    textDecoration: "none",
  }
  if (href) {
    return (
      <Link href={href} style={{
        ...baseStyle, cursor: "pointer", transition: "border-color 0.15s, transform 0.1s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#9ca3af" }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e5e7eb" }}
      >
        {content}
      </Link>
    )
  }
  return <div style={baseStyle}>{content}</div>
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
      <div style={{
        fontSize: "0.65rem", fontWeight: 600, color: "#9ca3af",
        textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16,
      }}>
        {title}
      </div>
      <div style={{ minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  )
}
