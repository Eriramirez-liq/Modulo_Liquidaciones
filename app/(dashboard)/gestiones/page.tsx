"use client"
import { useState, useEffect, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"

type Periodo  = { id: string; anio: number; mes: number; estado: string }
type Operador = { id: string; codigo: string; nombre: string }

type Concepto = "SDL" | "TC1" | "COT"

type Diff = { campo: string; fac: string | null; or: string | null }
type Gestion = { accion: string; datosAjustados: string[]; observacion: string | null; gestionadoAt: string }
type FilaGestion = {
  concepto: Concepto
  periodoId: string
  codigoFrontera: string
  operadorNombre: string | null
  orId: string | null
  caso: string
  eFac: string | null; eXm: string | null; eSdl: string | null
  diffs: Diff[]
  gestion: Gestion | null
}

// ─── Catálogos ───────────────────────────────────────────────────────────────

const CAMPO_LABEL: Record<string, string> = {
  activa: "Activa", inductiva: "Inductiva", capacitiva: "Capacitiva",
  factor_m: "Factor M", nivel_tension: "Nivel tensión", propiedad: "Propiedad",
  incompleta: "Incompleta",
}

// Datos ajustables al aplicar un ajuste (multi-selección)
const DATOS_AJUSTABLES: { key: string; label: string }[] = [
  { key: "activa", label: "Activa" },
  { key: "inductiva", label: "Inductiva" },
  { key: "capacitiva", label: "Capacitiva" },
  { key: "factor_m", label: "Factor M" },
  { key: "nivel_tension", label: "Nivel de tensión" },
  { key: "propiedad", label: "Propiedad de activos" },
]

const ACCIONES: { key: string; label: string; color: string }[] = [
  { key: "CAMBIO_SOLICITADO_OR", label: "Cambio solicitado al OR", color: "#1d4ed8" },
  { key: "AJUSTE_NO_PROCEDE",    label: "Ajuste no procede",       color: "#6b7280" },
  { key: "ERROR_BIA",            label: "Error BIA",               color: "#b45309" },
  { key: "AJUSTE_APLICADO",      label: "Ajuste aplicado",         color: "#15803d" },
]
function accionLabel(k: string) { return ACCIONES.find(a => a.key === k)?.label ?? k }
function accionColor(k: string) { return ACCIONES.find(a => a.key === k)?.color ?? "#6b7280" }

function num(v: string | null) {
  if (v == null) return "—"
  return Number(v).toLocaleString("es-CO", { maximumFractionDigits: 2 })
}

export default function GestionesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: "#9ca3af" }}>Cargando...</div>}>
      <GestionesContent />
    </Suspense>
  )
}

function GestionesContent() {
  const searchParams = useSearchParams()
  const periodoIdUrl = searchParams.get("periodoId") ?? ""
  const orIdUrl      = searchParams.get("orId")      ?? ""
  const conceptoUrl  = (searchParams.get("concepto") as Concepto | null) ?? "SDL"

  const [periodos, setPeriodos]     = useState<Periodo[]>([])
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [periodoId, setPeriodoId]   = useState(periodoIdUrl)
  const [orId, setOrId]             = useState(orIdUrl)
  const [concepto, setConcepto]     = useState<Concepto>(conceptoUrl)
  const [rows, setRows]             = useState<FilaGestion[]>([])
  const [loading, setLoading]       = useState(false)
  const [filtrado, setFiltrado]     = useState(false)
  const [modal, setModal]           = useState<FilaGestion | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/periodos").then(r => r.json()),
      fetch("/api/operadores").then(r => r.json()),
    ]).then(([ps, ors]) => { setPeriodos(ps); setOperadores(ors) })
  }, [])

  const filtrar = useCallback(async () => {
    if (concepto === "COT") { setRows([]); setFiltrado(true); return }
    setLoading(true)
    setFiltrado(true)
    const params = new URLSearchParams({ concepto })
    if (periodoId) params.set("periodoId", periodoId)
    if (orId) params.set("orId", orId)
    const res = await fetch(`/api/gestiones?${params}`)
    setRows(res.ok ? await res.json() : [])
    setLoading(false)
  }, [concepto, periodoId, orId])

  // Re-filtrar al cambiar de concepto (si ya se filtró alguna vez)
  useEffect(() => {
    if (filtrado) filtrar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concepto])

  // Auto-filtrar si viene período del URL
  useEffect(() => {
    if (periodoIdUrl) filtrar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoIdUrl])

  function onGuardado(fila: FilaGestion, gestion: Gestion) {
    setRows(prev => prev.map(r =>
      r.codigoFrontera === fila.codigoFrontera && r.concepto === fila.concepto
        ? { ...r, gestion }
        : r,
    ))
    setModal(null)
  }

  const selectStyle: React.CSSProperties = {
    border: "1px solid #d1d5db", borderRadius: 8, padding: "7px 12px",
    fontSize: "0.875rem", background: "#fff", cursor: "pointer",
  }
  const thStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.75rem", fontWeight: 600, color: "#6b7280",
    textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left",
    borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap",
  }
  const tdStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.875rem", color: "#374151",
    borderBottom: "1px solid #f3f4f6", verticalAlign: "top",
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
          Gestiones
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
          Fronteras con diferencias en conciliación. Filtrá por concepto y registrá el accionable.
        </p>
      </div>

      {/* Filtros */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>Período</label>
            <select value={periodoId} onChange={e => setPeriodoId(e.target.value)} style={selectStyle}>
              <option value="">Todos los períodos</option>
              {periodos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.anio}-{String(p.mes).padStart(2, "0")} — {p.estado}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>Operador de Red</label>
            <select value={orId} onChange={e => setOrId(e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {operadores.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
          <button
            onClick={filtrar}
            disabled={loading}
            style={{
              background: "#07c5a8", color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 18px", fontSize: "0.875rem", fontWeight: 600,
              cursor: "pointer", opacity: loading ? 0.7 : 1, alignSelf: "flex-end",
            }}
          >
            Filtrar
          </button>
        </div>
      </div>

      {/* Concepto (tabs) */}
      <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", flexWrap: "wrap" }}>
        {(["SDL", "TC1", "COT"] as Concepto[]).map(k => (
          <button
            key={k}
            onClick={() => setConcepto(k)}
            style={{
              padding: "10px 18px", fontSize: "0.875rem",
              fontWeight: concepto === k ? 700 : 400,
              color: concepto === k ? "#07c5a8" : "#9ca3af",
              background: "none", border: "none",
              borderBottom: concepto === k ? "2px solid #07c5a8" : "2px solid transparent",
              cursor: "pointer", marginBottom: -1,
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {concepto === "COT" ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Concepto COT — módulo en construcción. La lógica de diferencias se definirá más adelante.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ background: "#f9fafb" }}>
                <tr>
                  <th style={thStyle}>Frontera</th>
                  <th style={thStyle}>Operador</th>
                  <th style={thStyle}>Caso</th>
                  <th style={thStyle}>Diferencias (BIA → OR)</th>
                  <th style={thStyle}>Accionable</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>—</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>Cargando...</td></tr>
                ) : !filtrado ? (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>Pulsá Filtrar para ver las fronteras con diferencias.</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#9ca3af", padding: "32px" }}>No hay fronteras con diferencias {concepto} para los filtros seleccionados.</td></tr>
                ) : (
                  rows.map(r => (
                    <tr key={`${r.concepto}-${r.codigoFrontera}`}>
                      <td style={{ ...tdStyle, fontWeight: 600, fontFamily: "monospace" }}>{r.codigoFrontera}</td>
                      <td style={tdStyle}>{r.operadorNombre ?? "—"}</td>
                      <td style={tdStyle}>
                        <span style={{
                          background: r.caso === "INCOMPLETA" || r.caso === "ERROR" ? "#fffbeb" : "#eff6ff",
                          color: r.caso === "INCOMPLETA" || r.caso === "ERROR" ? "#92400e" : "#1d4ed8",
                          padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600,
                        }}>{r.caso}</span>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {r.diffs.length === 0 ? <span style={{ color: "#9ca3af" }}>—</span> : r.diffs.map((df, i) => (
                            <span key={i} style={{
                              background: "#fef2f2", color: "#b91c1c", padding: "2px 8px",
                              borderRadius: 6, fontSize: "0.72rem", fontWeight: 500, whiteSpace: "nowrap",
                            }}>
                              {CAMPO_LABEL[df.campo] ?? df.campo}
                              {df.campo !== "incompleta" && (
                                <span style={{ color: "#7f1d1d", fontWeight: 400 }}>
                                  {" "}{num(df.fac)} → {num(df.or)}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        {r.gestion ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{
                              color: "#fff", background: accionColor(r.gestion.accion),
                              padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600,
                              width: "fit-content",
                            }}>{accionLabel(r.gestion.accion)}</span>
                            {r.gestion.accion === "AJUSTE_APLICADO" && r.gestion.datosAjustados.length > 0 && (
                              <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                                Ajustado: {r.gestion.datosAjustados.map(d => CAMPO_LABEL[d] ?? d).join(", ")}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#9ca3af", fontSize: "0.8rem" }}>Sin gestionar</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <button
                          onClick={() => setModal(r)}
                          style={{
                            background: "none", border: "1px solid #07c5a8", borderRadius: 6,
                            padding: "4px 10px", fontSize: "0.78rem", color: "#07c5a8",
                            fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                          }}
                        >
                          {r.gestion ? "Editar" : "Gestionar"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <ModalAccionable
          fila={modal}
          onClose={() => setModal(null)}
          onGuardado={onGuardado}
        />
      )}
    </div>
  )
}

// ─── Modal de accionable ──────────────────────────────────────────────────────

function ModalAccionable({ fila, onClose, onGuardado }: {
  fila: FilaGestion
  onClose: () => void
  onGuardado: (fila: FilaGestion, gestion: Gestion) => void
}) {
  const [accion, setAccion]     = useState(fila.gestion?.accion ?? "")
  const [datos, setDatos]       = useState<string[]>(fila.gestion?.datosAjustados ?? [])
  const [obs, setObs]           = useState(fila.gestion?.observacion ?? "")
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const esAjuste = accion === "AJUSTE_APLICADO"

  function toggleDato(k: string) {
    setDatos(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])
  }

  async function guardar() {
    if (!accion) { setError("Seleccioná un accionable."); return }
    if (esAjuste && datos.length === 0) { setError("Confirmá al menos un dato ajustado."); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch("/api/gestiones/accionable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodoId: fila.periodoId,
          concepto: fila.concepto,
          codigoFrontera: fila.codigoFrontera,
          orId: fila.orId,
          accion,
          datosAjustados: esAjuste ? datos : [],
          observacion: obs.trim() || undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError((body as { error?: string }).error ?? `Error ${res.status}`); return }
      onGuardado(fila, body as Gestion)
    } catch {
      setError("Error de red. Reintentá.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 480,
          display: "flex", flexDirection: "column", gap: 16, maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#111827", margin: "0 0 2px" }}>
            Accionable — {fila.codigoFrontera}
          </h2>
          <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: 0 }}>
            {fila.concepto} · {fila.operadorNombre ?? "sin OR"}
          </p>
        </div>

        {/* Diferencias (contexto) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {fila.diffs.map((df, i) => (
            <span key={i} style={{
              background: "#fef2f2", color: "#b91c1c", padding: "2px 8px",
              borderRadius: 6, fontSize: "0.72rem", fontWeight: 500,
            }}>
              {CAMPO_LABEL[df.campo] ?? df.campo}
              {df.campo !== "incompleta" && ` ${num(df.fac)} → ${num(df.or)}`}
            </span>
          ))}
        </div>

        {/* Accionable */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#374151" }}>Accionable</label>
          {ACCIONES.map(a => (
            <label key={a.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", color: "#374151", cursor: "pointer" }}>
              <input type="radio" name="accion" checked={accion === a.key} onChange={() => setAccion(a.key)} />
              {a.label}
            </label>
          ))}
        </div>

        {/* Datos ajustados (solo ajuste aplicado) */}
        {esAjuste && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 12 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#15803d" }}>
              ¿Qué dato se ajustó? (uno o varios)
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {DATOS_AJUSTABLES.map(d => (
                <label key={d.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: "#374151", cursor: "pointer" }}>
                  <input type="checkbox" checked={datos.includes(d.key)} onChange={() => toggleDato(d.key)} />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Observación */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#374151" }}>Observación (opcional)</label>
          <textarea
            value={obs}
            onChange={e => setObs(e.target.value)}
            rows={2}
            style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "7px 10px", fontSize: "0.85rem", color: "#111827", resize: "vertical" }}
          />
        </div>

        {error && <span style={{ fontSize: "0.8rem", color: "#b91c1c" }}>{error}</span>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 16px", fontSize: "0.85rem", color: "#374151", cursor: "pointer" }}
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={saving}
            style={{ background: "#07c5a8", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: "0.85rem", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Guardando…" : "Guardar accionable"}
          </button>
        </div>
      </div>
    </div>
  )
}
