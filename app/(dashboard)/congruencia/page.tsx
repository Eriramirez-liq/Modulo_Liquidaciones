"use client"
import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"

type Periodo = { id: string; anio: number; mes: number; estado: string }

type CongruenciaRow = {
  sic: string
  or: string
  estado: string
  diferencia: string | number
  datoErrado: string
  datoCorrecto: string
}

type CongruenciaResponse = {
  rows: CongruenciaRow[]
  total: number
  operadores: string[]
  estados: string[]
}

function labelPeriodo(p: Periodo): string {
  const mm = String(p.mes).padStart(2, "0")
  return `${p.anio}-${mm} — ${p.estado}`
}

// Badge de estado con colores semánticos
function EstadoBadge({ estado }: { estado: string }) {
  let background = "#f3f4f6"
  let color = "#374151"

  const lower = estado.toLowerCase()
  if (lower.includes("cambio tc1") || lower.includes("cambio sdl") || lower.includes("cambio bills")) {
    background = "#fef3c7"
    color = "#92400e"
  } else if (lower.includes("no se relaciona")) {
    background = "#eff6ff"
    color = "#1e40af"
  } else if (lower.includes("revisar")) {
    background = "#fef2f2"
    color = "#b91c1c"
  }

  return (
    <span style={{
      background,
      color,
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: "0.72rem",
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      {estado}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Contenido principal — usa useSearchParams, requiere Suspense
// ---------------------------------------------------------------------------

function CongruenciaContent() {
  const searchParams = useSearchParams()
  const periodoIdQuery = searchParams.get("periodoId") ?? ""

  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [periodoId, setPeriodoId] = useState<string>("")
  const [periodosCargados, setPeriodosCargados] = useState(false)

  // Filtros
  const [orFiltro, setOrFiltro] = useState<string>("")
  const [estadoFiltro, setEstadoFiltro] = useState<string>("")

  // Datos
  const [data, setData] = useState<CongruenciaResponse | null>(null)
  const [loading, setLoading] = useState(false)

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

  // Fetch datos de congruencia cuando cambian período o filtros
  useEffect(() => {
    if (!periodoId) return
    setLoading(true)
    setData(null)

    const params = new URLSearchParams({ periodoId })
    if (orFiltro)     params.set("orCodigo", orFiltro)
    if (estadoFiltro) params.set("estado", estadoFiltro)

    fetch(`/api/congruencia?${params.toString()}`)
      .then(r => r.json())
      .then((d: CongruenciaResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [periodoId, orFiltro, estadoFiltro])

  // Construir URL para exportar Excel con los filtros actuales
  function buildExportUrl(): string {
    const params = new URLSearchParams({ periodoId })
    if (orFiltro)     params.set("orCodigo", orFiltro)
    if (estadoFiltro) params.set("estado", estadoFiltro)
    return `/api/congruencia/exportar?${params.toString()}`
  }

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
  const tdStyle: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: "0.875rem",
    color: "#374151",
    borderBottom: "1px solid #f3f4f6",
    verticalAlign: "top",
  }

  const totalLabel = data
    ? `${data.total} frontera${data.total !== 1 ? "s" : ""} con diferencias`
    : ""

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
          Congruencia — fronteras con diferencias
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
          Cruza Facturación, SDL y TC1 (nivel de tensión y propiedad de activos)
        </p>
      </div>

      {/* Filtros */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
          {/* Selector de período */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>Período</label>
            <select
              value={periodoId}
              onChange={e => { setPeriodoId(e.target.value); setOrFiltro(""); setEstadoFiltro("") }}
              disabled={!periodosCargados}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 8,
                padding: "7px 12px",
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

          {/* Filtro Operador de Red */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>Operador de Red</label>
            <select
              value={orFiltro}
              onChange={e => setOrFiltro(e.target.value)}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 8,
                padding: "7px 12px",
                fontSize: "0.875rem",
                background: "#fff",
                cursor: "pointer",
                minWidth: 180,
              }}
            >
              <option value="">Todos</option>
              {(data?.operadores ?? []).map(op => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>

          {/* Filtro Estado */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>Estado</label>
            <select
              value={estadoFiltro}
              onChange={e => setEstadoFiltro(e.target.value)}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 8,
                padding: "7px 12px",
                fontSize: "0.875rem",
                background: "#fff",
                cursor: "pointer",
                minWidth: 160,
              }}
            >
              <option value="">Todos</option>
              {(data?.estados ?? []).map(est => (
                <option key={est} value={est}>{est}</option>
              ))}
            </select>
          </div>

          {/* Botón Descargar Excel */}
          {periodoId && (
            <a
              href={buildExportUrl()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: "0.875rem",
                color: "#374151",
                fontWeight: 500,
                textDecoration: "none",
                padding: "7px 16px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                background: "#fff",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Descargar Excel
            </a>
          )}
        </div>
      </div>

      {/* Encabezado de resultados */}
      {!loading && data && (
        <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>
          {totalLabel}
        </div>
      )}

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Cargando…
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Sin diferencias de congruencia para este período/filtros.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>SIC</th>
                  <th style={thStyle}>OR</th>
                  <th style={thStyle}>Estado</th>
                  <th style={thStyle}>Diferencia</th>
                  <th style={thStyle}>Dato errado</th>
                  <th style={thStyle}>Dato correcto</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.82rem", fontWeight: 600 }}>
                      {row.sic}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.82rem" }}>
                      {row.or}
                    </td>
                    <td style={tdStyle}>
                      <EstadoBadge estado={row.estado} />
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.82rem" }}>
                      {String(row.diferencia)}
                    </td>
                    <td style={{ ...tdStyle, color: "#c0392b" }}>
                      {row.datoErrado}
                    </td>
                    <td style={{ ...tdStyle, color: "#27ae60" }}>
                      {row.datoCorrecto}
                    </td>
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

// ---------------------------------------------------------------------------
// Export default — envuelve en Suspense (requerido por Next 15 + useSearchParams)
// ---------------------------------------------------------------------------

export default function CongruenciaPage() {
  return (
    <Suspense fallback={<div style={{ padding: "40px", textAlign: "center", color: "#9ca3af" }}>Cargando...</div>}>
      <CongruenciaContent />
    </Suspense>
  )
}
