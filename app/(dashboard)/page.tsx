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
  facturacionTotalCop: number; provisionesKwh: number; perdidasKwh: number
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
  const [tab, setTab]             = useState<"principal" | "historico">("principal")
  const [data, setData]           = useState<DashData | null>(null)
  const [loading, setLoading]     = useState(false)
  // G de bolsa (precio bolsa nacional) del mes de consumo del período seleccionado.
  const [gBolsa, setGBolsa]       = useState<{ valor: number | null } | null>(null)
  const [gBolsaLoading, setGBolsaLoading] = useState(false)
  // Recalcular pérdidas (re-ejecuta la conciliación SDL del período).
  const [recalc, setRecalc]       = useState(false)
  const [recalcMsg, setRecalcMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null)

  useEffect(() => {
    fetch("/api/periodos")
      .then(r => r.json())
      .then((p: Periodo[]) => {
        setPeriodos(p)
        if (p.length > 0 && p[0]) setPeriodoId(p[0].id)
      })
  }, [])

  // Traer la G de bolsa del mes de consumo (anio/mes del PeriodoConciliacion).
  useEffect(() => {
    const p = periodos.find(x => x.id === periodoId)
    if (!p) { setGBolsa(null); return }
    let cancel = false
    setGBolsaLoading(true)
    fetch(`/api/precio-bolsa?anio=${p.anio}&mes=${p.mes}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((res: { valor: number | null }) => { if (!cancel) setGBolsa({ valor: res.valor ?? null }) })
      .catch(() => { if (!cancel) setGBolsa(null) })
      .finally(() => { if (!cancel) setGBolsaLoading(false) })
    return () => { cancel = true }
  }, [periodoId, periodos])

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

  // Re-ejecuta la conciliación SDL del período seleccionado (recalcula pérdidas,
  // provisiones y disputas con la G de bolsa actual) y refresca el dashboard.
  async function recalcularPerdidas() {
    const p = periodos.find(x => x.id === periodoId)
    if (!p) return
    const ok = window.confirm(
      "Esto vuelve a ejecutar la conciliación SDL del período (recalcula pérdidas, " +
      "provisiones y disputas con la G de bolsa actual). Puede tardar. ¿Continuar?",
    )
    if (!ok) return
    setRecalc(true)
    setRecalcMsg(null)
    try {
      const res = await fetch("/api/conciliaciones/ejecutar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anio: p.anio, mes: p.mes, tipo: "SDL" }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRecalcMsg({ tipo: "error", texto: (body as { error?: string }).error ?? `Error ${res.status}` })
        return
      }
      const r = (body as { resumen?: { contingencias?: { valor_estimado_total?: number }; gBolsaNacional?: number | null } }).resumen
      const valor = r?.contingencias?.valor_estimado_total ?? 0
      const gb = r?.gBolsaNacional
      const gbTxt = gb != null
        ? ` · G de bolsa $ ${gb.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kWh`
        : ""
      setRecalcMsg({ tipo: "ok", texto: `Pérdidas recalculadas: ${cop(valor)}${gbTxt}` })
      await fetchData()
    } catch {
      setRecalcMsg({ tipo: "error", texto: "Error de red. Reintentá." })
    } finally {
      setRecalc(false)
    }
  }

  const d = data

  function cop(v: number) {
    return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
  }
  function kwh(v: number) {
    return `${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })} kWh`
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
          <div style={{
            marginTop: 8, display: "inline-flex", alignItems: "center", gap: 8,
            background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 999,
            padding: "4px 12px", fontSize: "0.78rem", color: "#0369a1",
          }}>
            <span style={{ fontWeight: 700 }}>G de bolsa</span>
            <span style={{ fontWeight: 600 }}>
              {gBolsaLoading
                ? "consultando…"
                : gBolsa?.valor != null
                  ? `$ ${gBolsa.valor.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / kWh`
                  : "no disponible"}
            </span>
            <span style={{ color: "#7dd3fc" }}>· precio bolsa nacional (consumo)</span>
          </div>
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
            <button
              onClick={recalcularPerdidas}
              disabled={recalc || !periodoId}
              title="Re-ejecuta la conciliación SDL del período y valoriza las pérdidas con la G de bolsa actual"
              style={{
                border: "1px solid #07c5a8", borderRadius: 8, padding: "6px 12px",
                background: recalc ? "#e6faf6" : "#07c5a8",
                cursor: recalc ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 6,
                fontSize: "0.875rem", fontWeight: 600,
                color: recalc ? "#0f766e" : "#fff", opacity: (recalc || !periodoId) ? 0.7 : 1,
              }}
            >
              <RefreshCw size={14} style={{ animation: recalc ? "spin 1s linear infinite" : "none" }} />
              {recalc ? "Recalculando…" : "Recalcular pérdidas"}
            </button>
          </div>
          {recalcMsg && (
            <span style={{
              fontSize: "0.75rem", marginTop: 2, textAlign: "right",
              color: recalcMsg.tipo === "ok" ? "#15803d" : "#b91c1c",
            }}>
              {recalcMsg.texto}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
        {([["principal", "Panel Principal"], ["historico", "Histórico 12 M"]] as const).map(([k, l]) => (
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
            <KPI label="FACTURACIÓN BIA" main={cop(d?.facturacionTotalCop ?? 0)} color="#0369a1"
              sub={`${kwh(d?.fronterasFacturadasKwh ?? 0)} · ${d?.fronterasFacturadas ?? 0} fronteras`} />
            <KPI label="CARGO STR" main={cop(d?.cargoStrCop ?? 0)} color="#0369a1"
              sub="Total a pagar del mes"
              href={periodoId ? `/cargos-str-por-or?periodoId=${periodoId}` : undefined} />
            <KPI label="CARGO SDL" main={cop(d?.cargoSdlCop ?? 0)} color="#1d4ed8"
              sub="Preliquidación activa + reactiva"
              href={periodoId ? `/preliquidaciones-sdl?periodoId=${periodoId}` : undefined} />
            <KPI label="PÉRDIDAS" main={cop(d?.valorContingencias ?? 0)} color="#f59e0b"
              sub={`${kwh(d?.perdidasKwh ?? 0)} · ${d?.contingenciasAbiertas ?? 0} frontera(s)`}
              href={periodoId ? `/gestiones?tab=contingencias&periodoId=${periodoId}` : undefined} />
            <KPI label="PROVISIONES" main={cop(d?.valorProvisiones ?? 0)} color="#3b82f6"
              sub={`${kwh(d?.provisionesKwh ?? 0)} · ${d?.provisiones ?? 0} frontera(s)`}
              href={periodoId ? `/gestiones?tab=provisiones&periodoId=${periodoId}` : undefined} />
          </div>

          {/* Indicadores de gestión + charts */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <IndicadoresGestion d={d} periodoId={periodoId} />
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

// ─── Indicadores de gestión ──────────────────────────────────────────────────

// Formato compacto para captions (mil M / M / k).
function compacto(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return (v / 1e9).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " mil M"
  if (abs >= 1e6) return (v / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " M"
  if (abs >= 1e3) return (v / 1e3).toLocaleString("es-CO", { maximumFractionDigits: 0 }) + " k"
  return v.toLocaleString("es-CO", { maximumFractionDigits: 0 })
}

type IndicadorProps = {
  label: string; valor: number | null; metaPct: number
  tipo: "menor" | "mayor"; calculo: string; href?: string
}

function IndicadoresGestion({ d, periodoId }: { d: DashData | null; periodoId: string }) {
  const facturadoCop  = d?.facturacionTotalCop    ?? 0
  const perdidaCop    = d?.valorContingencias     ?? 0
  const kwhFac        = d?.fronterasFacturadasKwh  ?? 0
  const kwhPerdida    = d?.perdidasKwh             ?? 0
  const kwhProvision  = d?.provisionesKwh          ?? 0
  const fronterasFac  = d?.fronterasFacturadas     ?? 0

  // valor = fracción (0..1); metaPct = umbral en %. tipo "menor" = umbral máximo
  // (verde si valor <= meta); tipo "mayor" = piso mínimo (verde si valor >= meta).
  const indicadores: IndicadorProps[] = [
    {
      label: "% Congruencia",
      valor: fronterasFac > 0 ? (d?.congruenciaPct ?? 0) / 100 : null,
      metaPct: 95,
      tipo: "mayor",
      calculo: `${d?.congruentes ?? 0}/${fronterasFac} fronteras (NT + propiedad)`,
      href: periodoId ? `/congruencia?periodoId=${periodoId}` : undefined,
    },
    {
      label: "% Pérdida",
      valor: facturadoCop > 0 ? perdidaCop / facturadoCop : null,
      metaPct: 0.1,
      tipo: "menor",
      calculo: `$${compacto(perdidaCop)} pérdida / $${compacto(facturadoCop)} facturado`,
    },
    {
      label: "% Dif. kWh absoluto",
      valor: kwhFac > 0 ? (kwhPerdida + kwhProvision) / kwhFac : null,
      metaPct: 0.35,
      tipo: "menor",
      calculo: `${compacto(kwhPerdida + kwhProvision)} / ${compacto(kwhFac)} kWh`,
    },
    {
      label: "% Reportado de más a XM",
      valor: kwhFac > 0 ? kwhPerdida / kwhFac : null,
      metaPct: 0.15,
      tipo: "menor",
      calculo: `${compacto(kwhPerdida)} pérdida / ${compacto(kwhFac)} kWh`,
    },
    {
      label: "% Reportado de menos a XM",
      valor: kwhFac > 0 ? kwhProvision / kwhFac : null,
      metaPct: 0.2,
      tipo: "menor",
      calculo: `${compacto(kwhProvision)} provisión / ${compacto(kwhFac)} kWh`,
    },
  ]

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
      <div style={{
        fontSize: "0.65rem", fontWeight: 600, color: "#9ca3af",
        textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16,
      }}>
        INDICADORES DE GESTIÓN
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        {indicadores.map(i => (
          <Indicador key={i.label} {...i} />
        ))}
      </div>
    </div>
  )
}

function Indicador({ label, valor, metaPct, tipo, calculo, href }: IndicadorProps) {
  const pct = valor === null ? null : valor * 100
  const cumple = pct === null ? null : (tipo === "menor" ? pct <= metaPct : pct >= metaPct)

  const VERDE = "#15803d", ROJO = "#b91c1c", GRIS = "#9ca3af"
  const color = cumple === null ? GRIS : cumple ? VERDE : ROJO
  const fondo = cumple === null ? "#f9fafb" : cumple ? "#f0fdf4" : "#fef2f2"

  // Posición de la marca de meta y llenado de la barra:
  // - "menor": la meta se ubica al 65% del track (deja aire para mostrar exceso);
  //   el llenado escala respecto a la meta.
  // - "mayor": escala 0-100% directa; la marca va en el valor de la meta (ej. 95%).
  const marca = tipo === "menor" ? 65 : metaPct
  const fill =
    pct === null ? 0
    : tipo === "menor" ? Math.min((pct / metaPct) * 65, 100)
    : Math.min(pct, 100)

  const fmtPct = (v: number) => v.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"
  const metaTxt = `meta ${tipo === "menor" ? "<" : ">"} ${metaPct.toLocaleString("es-CO", { maximumFractionDigits: 2 })}%`

  const cardStyle: React.CSSProperties = {
    border: `1px solid ${cumple === null ? "#e5e7eb" : color + "33"}`,
    borderRadius: 10, padding: "14px 16px", background: fondo,
    display: "flex", flexDirection: "column", gap: 8,
    textDecoration: "none",
  }

  const contenido = (
    <>
      {/* Título + estado */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#374151" }}>{label}</span>
        {cumple !== null && (
          <span style={{
            fontSize: "0.62rem", fontWeight: 700, color: "#fff", background: color,
            padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap",
          }}>
            {cumple ? "EN META" : "FUERA DE META"}
          </span>
        )}
      </div>

      {/* Valor */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "1.75rem", fontWeight: 800, color, lineHeight: 1 }}>
          {pct === null ? "—" : fmtPct(pct)}
        </span>
        <span style={{ fontSize: "0.72rem", color: "#9ca3af", fontWeight: 500 }}>{metaTxt}</span>
      </div>

      {/* Barra con marca de meta */}
      <div style={{ position: "relative", height: 8, background: "#e5e7eb", borderRadius: 999, marginTop: 2 }}>
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: `${fill}%`,
          background: color, borderRadius: 999, transition: "width 0.3s",
        }} />
        <div style={{
          position: "absolute", left: `${marca}%`, top: -2, bottom: -2, width: 2,
          background: "#6b7280",
        }} title={`Meta: ${metaPct}%`} />
      </div>

      {/* Cálculo */}
      <span style={{ fontSize: "0.68rem", color: "#9ca3af" }}>{calculo}</span>
    </>
  )

  if (href) {
    return (
      <Link href={href} style={{ ...cardStyle, cursor: "pointer" }}>
        {contenido}
      </Link>
    )
  }
  return <div style={cardStyle}>{contenido}</div>
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
