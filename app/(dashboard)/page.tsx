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
  // Panel principal
  cargoStrCop: number
  cargoSdlCop: number; cargoSdlActivaCop: number; cargoSdlReactivaCop: number
  compensacionesCop: number | null
  congruenciaPct: number; congruentes: number; fronterasFacturadas: number; fronterasFacturadasKwh: number
  topFronteras: { codigoFrontera: string; provisionCop: number; perdidaCop: number; totalCop: number }[]
}

// El período guardado (PeriodoConciliacion.{anio,mes}) es el de CONSUMO.
// En el dashboard se muestra como MES EN CURSO / facturación = consumo + 1.
const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
function mesEnCurso(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 }
}
function labelMesEnCurso(p: Periodo): string {
  const f = mesEnCurso(p.anio, p.mes)
  return `${MESES[f.mes]} ${f.anio}`
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

  const d = data

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
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Mes en curso (facturación)</span>
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
                  {labelMesEnCurso(p)} — {p.estado}
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
          {/* KPIs del mes en curso */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <KPI label="CARGO STR" main={cop(d?.cargoStrCop ?? 0)} color="#0369a1"
              sub="Total a pagar del mes"
              href={periodoId ? `/cargos-str-por-or?periodoId=${periodoId}` : undefined} />
            <KPI label="CARGO SDL" main={cop(d?.cargoSdlCop ?? 0)} color="#1d4ed8"
              sub="Preliquidación activa + reactiva"
              href={periodoId ? `/preliquidaciones-sdl?periodoId=${periodoId}` : undefined} />
            <KPI label="PÉRDIDAS" main={cop(d?.valorContingencias ?? 0)} color="#f59e0b"
              sub={`${d?.contingenciasAbiertas ?? 0} contingencia(s)`}
              href={periodoId ? `/gestiones?tab=contingencias&periodoId=${periodoId}` : undefined} />
            <KPI label="PROVISIONES" main={cop(d?.valorProvisiones ?? 0)} color="#3b82f6"
              sub={`${d?.provisiones ?? 0} provisión(es)`}
              href={periodoId ? `/gestiones?tab=provisiones&periodoId=${periodoId}` : undefined} />
            <KPI label="COMPENSACIONES EN EL MES"
              main={d?.compensacionesCop != null ? cop(d.compensacionesCop) : "—"} color="#7c3aed"
              sub="Lógica pendiente" />
            <KPI label="CONGRUENCIA" main={`${d?.congruenciaPct ?? 0}%`} color="#15803d"
              sub={`${d?.congruentes ?? 0}/${d?.fronterasFacturadas ?? 0} fronteras (NT + propiedad)`}
              href={periodoId ? `/congruencia?periodoId=${periodoId}` : undefined} />
            <KPI label="FRONTERAS FACTURADAS" main={d?.fronterasFacturadas ?? 0} color="#0369a1"
              sub={`${(d?.fronterasFacturadasKwh ?? 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })} kWh`} />
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
            <ChartCard title="TOP 10 FRONTERAS — IMPACTO (PÉRDIDA + PROVISIÓN)">
              <TopFronteras items={d?.topFronteras ?? []} cop={cop} />
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

function TopFronteras({ items, cop }: {
  items: { codigoFrontera: string; provisionCop: number; perdidaCop: number; totalCop: number }[]
  cop: (v: number) => string
}) {
  if (items.length === 0) {
    return (
      <p style={{ fontSize: "0.8rem", color: "#9ca3af", textAlign: "center" }}>
        Sin provisiones ni pérdidas para este período.
      </p>
    )
  }
  const max = Math.max(...items.map(i => i.totalCop), 1)
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Leyenda */}
      <div style={{ display: "flex", gap: 14, fontSize: "0.7rem", color: "#6b7280" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#f59e0b" }} /> Pérdida
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#3b82f6" }} /> Provisión
        </span>
      </div>
      {items.map(i => (
        <div key={i.codigoFrontera} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
            <span style={{ fontFamily: "monospace", color: "#374151", fontWeight: 600 }}>
              {i.codigoFrontera}
            </span>
            <span style={{ color: "#111827", fontWeight: 600 }}>{cop(i.totalCop)}</span>
          </div>
          <div style={{ display: "flex", height: 10, borderRadius: 4, overflow: "hidden", background: "#f3f4f6", width: `${Math.max((i.totalCop / max) * 100, 2)}%`, minWidth: 24 }}>
            {i.perdidaCop > 0 && (
              <div style={{ background: "#f59e0b", width: `${(i.perdidaCop / i.totalCop) * 100}%` }} title={`Pérdida: ${cop(i.perdidaCop)}`} />
            )}
            {i.provisionCop > 0 && (
              <div style={{ background: "#3b82f6", width: `${(i.provisionCop / i.totalCop) * 100}%` }} title={`Provisión: ${cop(i.provisionCop)}`} />
            )}
          </div>
        </div>
      ))}
    </div>
  )
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
