"use client"
import { useState, useEffect, useMemo } from "react"

const MES_NOMBRE = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

type Periodo  = { id: string; anio: number; mes: number; estado: string }
type Operador = { id: string; codigo: string; nombre: string }

type Resultado = {
  periodos:        { id: string; facturacion: string; consumo: string }[]
  operadores:      { codigo: string; nombre: string; totales: Record<string, number>; total: number }[]
  totalPorPeriodo: Record<string, number>
  totalGeneral:    number
}

function cop(v: number) {
  return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}

function mesLabel(periodoStr: string): string {
  // "2026-02" → "Febrero 2026"
  const [a, m] = periodoStr.split("-")
  const n = parseInt(m ?? "", 10)
  if (!a || isNaN(n) || n < 1 || n > 12) return periodoStr
  return `${MES_NOMBRE[n]} ${a}`
}

// El período guardado en la base es el de CONSUMO (lo que selecciona el
// usuario en el wizard al cargar Insumos STR). La facturación es +1 mes.
function facturacionDe(anio: number, mes: number): { anio: number; mes: number } {
  if (mes === 12) return { anio: anio + 1, mes: 1 }
  return { anio, mes: mes + 1 }
}

export default function CargosSTRPage() {
  const [periodos, setPeriodos]     = useState<Periodo[]>([])
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [periodoSel, setPeriodoSel] = useState<string[]>([])  // periodo_id (facturación)
  const [orSel, setOrSel]           = useState<string[]>([])
  const [data, setData]             = useState<Resultado | null>(null)
  const [loading, setLoading]       = useState(false)
  const [filtrado, setFiltrado]     = useState(false)

  useEffect(() => {
    fetch("/api/periodos")
      .then(r => r.ok ? r.json() : [])
      .then((ps) => setPeriodos(Array.isArray(ps) ? ps : []))
      .catch(() => setPeriodos([]))

    fetch("/api/operadores?tipo=str")
      .then(r => r.ok ? r.json() : [])
      .then((ors) => setOperadores(Array.isArray(ors) ? ors : []))
      .catch(() => setOperadores([]))
  }, [])

  // Cada periodo en la base representa el mes de CONSUMO. Calculamos la
  // facturación derivada (+1 mes) para mostrarla en el dropdown gemelo —
  // ambos selectores comparten el mismo periodo_id pero con etiquetas
  // distintas (consumo vs facturación).
  const periodosConConsumo = useMemo(() => {
    return periodos.map(p => {
      const f = facturacionDe(p.anio, p.mes)
      return {
        id:               p.id,
        anio:             p.anio,
        mes:              p.mes,
        consumoLabel:     `${MES_NOMBRE[p.mes]} ${p.anio}`,
        facturacionLabel: `${MES_NOMBRE[f.mes]} ${f.anio}`,
      }
    })
  }, [periodos])

  async function filtrar() {
    setLoading(true)
    setFiltrado(true)
    const params = new URLSearchParams()
    if (periodoSel.length > 0) params.set("periodoIds", periodoSel.join(","))
    if (orSel.length      > 0) params.set("orIds",      orSel.join(","))
    const res = await fetch(`/api/cargos-str?${params}`)
    setData(await res.json())
    setLoading(false)
  }

  function togglePeriodo(id: string) {
    setPeriodoSel(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function toggleOR(id: string) {
    setOrSel(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function selectAllPeriodos() { setPeriodoSel(periodos.map(p => p.id)) }
  function clearPeriodos()     { setPeriodoSel([]) }
  function selectAllORs()      { setOrSel(operadores.map(o => o.id)) }
  function clearORs()          { setOrSel([]) }

  const facturacionSummary = periodoSel.length === 0
    ? "Todos los períodos"
    : periodoSel.length === 1
      ? (periodosConConsumo.find(p => p.id === periodoSel[0])?.facturacionLabel ?? "1 período")
      : `${periodoSel.length} períodos`

  const consumoSummary = periodoSel.length === 0
    ? "Todos los meses"
    : periodoSel.length === 1
      ? (periodosConConsumo.find(p => p.id === periodoSel[0])?.consumoLabel ?? "1 mes")
      : `${periodoSel.length} meses`

  const orSummary = orSel.length === 0
    ? "Todos"
    : orSel.length === 1
      ? (operadores.find(o => o.id === orSel[0])?.nombre ?? "1 OR")
      : `${orSel.length} ORs`

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
          Cargos STR
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
          Cargos calculados a partir de los Insumos STR, totalizados por operador.
        </p>
      </div>

      {/* Filters */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
          <MultiSelect
            label="Período facturación"
            summary={facturacionSummary}
            options={periodosConConsumo.map(p => ({ id: p.id, label: p.facturacionLabel }))}
            selected={periodoSel}
            onToggle={togglePeriodo}
            onSelectAll={selectAllPeriodos}
            onClear={clearPeriodos}
          />
          <MultiSelect
            label="Período consumo"
            summary={consumoSummary}
            options={periodosConConsumo.map(p => ({ id: p.id, label: p.consumoLabel }))}
            selected={periodoSel}
            onToggle={togglePeriodo}
            onSelectAll={selectAllPeriodos}
            onClear={clearPeriodos}
          />
          <MultiSelect
            label="Operador de Red"
            summary={orSummary}
            options={operadores.map(o => ({ id: o.id, label: o.nombre }))}
            selected={orSel}
            onToggle={toggleOR}
            onSelectAll={selectAllORs}
            onClear={clearORs}
          />
          <button
            onClick={filtrar}
            disabled={loading}
            style={{
              background: "#07c5a8", color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 24px", fontSize: "0.875rem", fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
            }}
          >
            Filtrar
          </button>
        </div>
      </div>

      {/* Results */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {!filtrado ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Selecciona los filtros y pulsa <strong>Filtrar</strong> para ver los cargos.
          </div>
        ) : loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Cargando…
          </div>
        ) : !data || data.operadores.length === 0 || data.periodos.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            No hay cargos STR para los filtros seleccionados.
          </div>
        ) : (
          <ResultsTable data={data} />
        )}
      </div>
    </div>
  )
}

function ResultsTable({ data }: { data: Resultado }) {
  const multiplePeriodos = data.periodos.length > 1
  const thTopStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.78rem", fontWeight: 700,
    color: "#1e3a8a", textAlign: "left",
    background: "#dbeafe", whiteSpace: "nowrap",
    borderBottom: "1px solid #bfdbfe",
  }
  const thSubStyle: React.CSSProperties = {
    padding: "8px 14px", fontSize: "0.78rem", fontWeight: 600,
    color: "#1e3a8a", textAlign: "left",
    background: "#eff6ff", whiteSpace: "nowrap",
    borderBottom: "2px solid #bfdbfe",
  }
  const tdStyle: React.CSSProperties = {
    padding: "8px 14px", fontSize: "0.875rem", color: "#374151",
    borderBottom: "1px solid #f3f4f6",
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          {/* Fila 1: Mes facturación */}
          <tr>
            <th style={thTopStyle}>Mes facturación</th>
            {data.periodos.map(p => (
              <th key={`f-${p.id}`} style={{ ...thTopStyle, textAlign: "center" }}>
                {mesLabel(p.facturacion)}
              </th>
            ))}
            {multiplePeriodos && <th style={{ ...thTopStyle, textAlign: "right" }} rowSpan={2}>Total</th>}
          </tr>
          {/* Fila 2: Mes consumo */}
          <tr>
            <th style={thSubStyle}>Mes Consumo</th>
            {data.periodos.map(p => (
              <th key={`c-${p.id}`} style={{ ...thSubStyle, textAlign: "center" }}>
                {mesLabel(p.consumo)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.operadores.map(o => (
            <tr key={o.codigo}>
              <td style={{ ...tdStyle, fontWeight: 600, textAlign: "center" }}>{o.nombre}</td>
              {data.periodos.map(p => (
                <td key={p.id} style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>
                  {cop(o.totales[p.id] ?? 0)}
                </td>
              ))}
              {multiplePeriodos && (
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
                  {cop(o.total)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{
              ...tdStyle, fontWeight: 700, background: "#f0fdf4",
              color: "#065f46", borderTop: "2px solid #d1fae5", textAlign: "center",
            }}>
              TOTAL
            </td>
            {data.periodos.map(p => (
              <td key={p.id} style={{
                ...tdStyle, textAlign: "right", fontFamily: "monospace",
                fontWeight: 700, background: "#f0fdf4", color: "#065f46",
                borderTop: "2px solid #d1fae5",
              }}>
                {cop(data.totalPorPeriodo[p.id] ?? 0)}
              </td>
            ))}
            {multiplePeriodos && (
              <td style={{
                ...tdStyle, textAlign: "right", fontFamily: "monospace",
                fontWeight: 700, background: "#07c5a8", color: "#fff",
                borderTop: "2px solid #d1fae5",
              }}>
                {cop(data.totalGeneral)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function MultiSelect({
  label, summary, options, selected, onToggle, onSelectAll, onClear,
}: {
  label: string
  summary: string
  options: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string) => void
  onSelectAll: () => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative", minWidth: 220 }}>
      <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>{label}</label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          border: "1px solid #d1d5db", borderRadius: 8, padding: "7px 12px",
          fontSize: "0.875rem", background: "#fff", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8, textAlign: "left",
        }}
      >
        <span style={{ color: selected.length === 0 ? "#6b7280" : "#111827" }}>{summary}</span>
        <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>▼</span>
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 10,
            }}
          />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 20,
            minWidth: 260, maxHeight: 320, overflowY: "auto",
          }}>
            <div style={{
              padding: "6px 10px", borderBottom: "1px solid #f3f4f6",
              display: "flex", gap: 12, fontSize: "0.78rem",
            }}>
              <button type="button" onClick={onSelectAll}
                style={{ background: "none", border: "none", color: "#07c5a8", cursor: "pointer", padding: 0 }}>
                Seleccionar todos
              </button>
              <button type="button" onClick={onClear}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: 0 }}>
                Limpiar
              </button>
            </div>
            {options.length === 0 ? (
              <div style={{ padding: "10px 14px", fontSize: "0.8rem", color: "#9ca3af" }}>
                Sin opciones disponibles
              </div>
            ) : options.map(opt => (
              <label key={opt.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 12px", cursor: "pointer", fontSize: "0.875rem",
              }}>
                <input
                  type="checkbox"
                  checked={selected.includes(opt.id)}
                  onChange={() => onToggle(opt.id)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
