"use client"
import { useState, useEffect } from "react"

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
  balance: SDLEstado[]
}

const now = new Date()

export function PanelEstadoPeriodo() {
  const [anio, setAnio] = useState(now.getFullYear())
  const [mes, setMes]   = useState(now.getMonth() + 1)
  const [data, setData] = useState<PeriodoEstado | null>(null)

  useEffect(() => {
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
  const years = [now.getFullYear() - 1, now.getFullYear()]

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
            {meses.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
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

      {data && (
        <div style={{ padding: "14px 20px", display: "flex", flexWrap: "wrap", gap: 16 }}>
          <FRow label="Facturación" estado={data.facturacion} />
          <FRow label="XM" estado={data.xm} />
          {data.sdl.filter(s => s.estado !== "pendiente").map(s => (
            <FRow key={s.orId} label={`SDL — ${s.codigo}`} estado={s} />
          ))}
          {data.sdl.filter(s => s.estado === "pendiente").length > 0 && (
            <span style={{ fontSize: "0.78rem", color: "#9ca3af", alignSelf: "center" }}>
              {data.sdl.filter(s => s.estado === "pendiente").length} SDL pendientes
            </span>
          )}
        </div>
      )}
    </div>
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
