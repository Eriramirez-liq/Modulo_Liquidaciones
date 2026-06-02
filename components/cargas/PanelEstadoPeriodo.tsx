"use client"
import { useState, useEffect } from "react"
import { periodoMaximo, mesesValidos, aniosValidos } from "@/lib/utils/periodos"

type Estado = "pendiente" | "cargada" | "error"
type FuenteEstado = {
  estado: Estado
  fecha?: string
  usuario?: string
  totalRegistros?: number
  cargaId?: string
}
type SDLEstado = FuenteEstado & { orId: string; codigo: string; nombre: string }

type PeriodoEstado = {
  facturacion: FuenteEstado
  xm: FuenteEstado
  sdl: SDLEstado[]
  tc1: SDLEstado[]
  balance: SDLEstado[]
}

const PERIODO_MAX = periodoMaximo()

export function PanelEstadoPeriodo() {
  const [anio, setAnio] = useState(PERIODO_MAX.anio)
  const [mes, setMes]   = useState(PERIODO_MAX.mes)
  const [data, setData] = useState<PeriodoEstado | null>(null)
  // KPI de pendientes seleccionado (muestra la lista de OR pendientes).
  const [verPendientes, setVerPendientes] = useState<"sdl" | "tc1" | null>(null)

  useEffect(() => {
    setVerPendientes(null)
    fetch(`/api/cargas/estado-periodo?anio=${anio}&mes=${mes}`)
      .then(r => r.json())
      .then(setData)
  }, [anio, mes])

  function Badge({ estado }: { estado: Estado }) {
    const [bg, col, label] =
      estado === "cargada"  ? ["#f0fdf4", "#15803d", "Cargada"]
    : estado === "error"    ? ["#fef2f2", "#b91c1c", "Error"]
    : ["#f9fafb", "#9ca3af", "Pendiente"]
    return (
      <span style={{
        background: bg, color: col, padding: "1px 7px",
        borderRadius: 999, fontSize: "0.7rem", fontWeight: 600,
      }}>
        {label}
      </span>
    )
  }

  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]
  const years = aniosValidos()
  const mesesDelAnio = mesesValidos(anio)

  // Si el mes seleccionado dejo de ser valido para el año elegido, ajustar.
  useEffect(() => {
    if (mesesDelAnio.length > 0 && !mesesDelAnio.includes(mes)) {
      setMes(mesesDelAnio[mesesDelAnio.length - 1]!)
    }
  }, [anio]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
      <div style={{
        padding: "14px 20px", borderBottom: "1px solid #f3f4f6",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
      }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 600, color: "#111827", margin: 0 }}>
          Estado del período
        </h2>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={mes}
            onChange={e => setMes(Number(e.target.value))}
            style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 8px", fontSize: "0.8rem", background: "#fff" }}
          >
            {mesesDelAnio.map((m) => <option key={m} value={m}>{meses[m - 1]}</option>)}
          </select>
          <select
            value={anio}
            onChange={e => setAnio(Number(e.target.value))}
            style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 8px", fontSize: "0.8rem", background: "#fff" }}
          >
            {years.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {data && (() => {
        const sdlPend = data.sdl.filter(s => s.estado === "pendiente")
        const tc1Pend = (data.tc1 ?? []).filter(s => s.estado === "pendiente")
        const lista = verPendientes === "sdl" ? sdlPend : verPendientes === "tc1" ? tc1Pend : []
        return (
          <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Estado de fuentes generales */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              <FRow label="Facturación" estado={data.facturacion} />
              <FRow label="XM" estado={data.xm} />
            </div>

            {/* KPIs de pendientes SDL / TC1 (clickeables) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <KpiPendientes
                label="SDL — pendientes"
                cant={sdlPend.length}
                total={data.sdl.length}
                activo={verPendientes === "sdl"}
                onClick={() => setVerPendientes(verPendientes === "sdl" ? null : "sdl")}
              />
              <KpiPendientes
                label="TC1 — pendientes"
                cant={tc1Pend.length}
                total={(data.tc1 ?? []).length}
                activo={verPendientes === "tc1"}
                onClick={() => setVerPendientes(verPendientes === "tc1" ? null : "tc1")}
              />
            </div>

            {/* Lista de OR pendientes del KPI seleccionado */}
            {verPendientes && (
              <div style={{
                background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8,
                padding: "12px 14px",
              }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#92400e", marginBottom: 8 }}>
                  {verPendientes.toUpperCase()} — {lista.length} operadores pendientes de cargar
                </div>
                {lista.length === 0 ? (
                  <div style={{ fontSize: "0.8rem", color: "#15803d" }}>
                    ✓ Todos los operadores tienen su archivo {verPendientes.toUpperCase()} cargado.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {lista.map(o => (
                      <span key={o.orId} style={{
                        background: "#fff", border: "1px solid #fcd34d", color: "#92400e",
                        padding: "3px 10px", borderRadius: 999, fontSize: "0.78rem", fontWeight: 500,
                      }}>
                        {o.nombre}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

function KpiPendientes({ label, cant, total, activo, onClick }: {
  label: string; cant: number; total: number; activo: boolean; onClick: () => void
}) {
  const color = cant === 0 ? "#15803d" : "#d97706"
  return (
    <button onClick={onClick} style={{
      background: activo ? "#fffbeb" : "#fff",
      border: activo ? `2px solid ${color}` : "1px solid #e5e7eb",
      borderRadius: 10, padding: "12px 16px", cursor: "pointer", textAlign: "left",
      display: "flex", flexDirection: "column", gap: 2,
    }}>
      <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: "1.5rem", fontWeight: 700, color, lineHeight: 1.15 }}>
        {cant}<span style={{ fontSize: "0.85rem", color: "#9ca3af", fontWeight: 500 }}> / {total}</span>
      </span>
    </button>
  )
}

function FRow({ label, estado }: { label: string; estado: { estado: "pendiente" | "cargada" | "error"; totalRegistros?: number } }) {
  const [bg, col] =
    estado.estado === "cargada"  ? ["#f0fdf4", "#15803d"]
  : estado.estado === "error"    ? ["#fef2f2", "#b91c1c"]
  : ["#f9fafb", "#9ca3af"]
  const text = estado.estado === "cargada"
    ? `${label}: ${estado.totalRegistros?.toLocaleString("es-CO") ?? "?"} reg.`
    : estado.estado === "error" ? `${label}: Error`
    : `${label}: Pendiente`
  return (
    <span style={{
      background: bg, color: col, padding: "3px 10px",
      borderRadius: 999, fontSize: "0.78rem", fontWeight: 500,
      border: `1px solid ${col}22`,
    }}>
      {text}
    </span>
  )
}
