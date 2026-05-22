"use client"
import { useState, useEffect } from "react"
import { Play } from "lucide-react"

type Periodo = { id: string; anio: number; mes: number; estado: string }
type Operador = { id: string; codigo: string; nombre: string }

interface ResumenConciliacion {
  periodoStr: string
  totalFronteras: number
  porCaso: Record<string, number>
  provisiones:   { cantidad: number; valor_total: number }
  contingencias: { cantidad: number; energia_total: number }
  disputas:      { cantidad: number; valor_total: number }
  alertasManual: number
  incompletas:   number
  fronterasNoEnFacturacion: { xm: number; sdl: number }
}

function cop(v: number) {
  return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
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
    setError(null)
    setMensaje(null)
    setResumen(null)
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
        `Revisá Gestiones para ver provisiones, contingencias y disputas.`,
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
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
              Resumen — {resumen.periodoStr}
            </h2>
            <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}>
              {resumen.totalFronteras} fronteras conciliadas.
              {resumen.alertasManual > 0 && ` ${resumen.alertasManual} con alerta manual.`}
              {resumen.incompletas > 0 && ` ${resumen.incompletas} incompletas.`}
            </p>
          </div>

          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <KpiCard label="Provisiones"   main={resumen.provisiones.cantidad}
              sub={cop(resumen.provisiones.valor_total)} color="#3b82f6" />
            <KpiCard label="Contingencias" main={resumen.contingencias.cantidad}
              sub={`${resumen.contingencias.energia_total.toLocaleString("es-CO")} kWh`} color="#f59e0b" />
            <KpiCard label="Disputas"      main={resumen.disputas.cantidad}
              sub={cop(resumen.disputas.valor_total)} color="#dc2626" />
            <KpiCard label="Alertas manuales" main={resumen.alertasManual} color="#9333ea" />
          </div>

          {/* Distribución por caso */}
          <div>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>
              Distribución por caso
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
              {Object.entries(resumen.porCaso)
                .filter(([, n]) => n > 0)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([caso, n]) => (
                  <div key={caso} style={{
                    border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px",
                    background: "#fafafa",
                  }}>
                    <div style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {caso}
                    </div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#111827" }}>
                      {n.toLocaleString("es-CO")}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Fronteras huérfanas */}
          {(resumen.fronterasNoEnFacturacion.xm > 0 || resumen.fronterasNoEnFacturacion.sdl > 0) && (
            <div style={{
              padding: "10px 14px", background: "#fffbeb",
              border: "1px solid #fde68a", borderRadius: 8,
              fontSize: "0.85rem", color: "#92400e",
            }}>
              ⚠ Hay fronteras en otras fuentes que no están en Facturación:
              {resumen.fronterasNoEnFacturacion.xm  > 0 && ` ${resumen.fronterasNoEnFacturacion.xm} en XM,`}
              {resumen.fronterasNoEnFacturacion.sdl > 0 && ` ${resumen.fronterasNoEnFacturacion.sdl} en SDL.`}
              {" "}Estas fronteras NO se concilian (Facturación es el universo maestro).
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, main, sub, color }: { label: string; main: number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
      padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4,
    }}>
      <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#9ca3af",
        textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: "1.5rem", fontWeight: 700, color: color ?? "#111827", lineHeight: 1.15 }}>
        {main.toLocaleString("es-CO")}
      </span>
      {sub && <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>{sub}</span>}
    </div>
  )
}
