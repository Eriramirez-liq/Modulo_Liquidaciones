"use client"

import { useEffect, useState } from "react"

// ─── Tipos del contrato del endpoint GET /api/proyeccion-cargos-or ───────────

interface PorNT<T> { nt1: T; nt2: T; nt3: T }

interface SalidaMes {
  sdlActivaNT: PorNT<number> | null
  sdlReactivaNT: PorNT<number> | null
  str: number | null
  total: number | null
}

interface FilaMes {
  periodoConsumo: string
  periodoFacturacion: string
  esProyectado: boolean
  demandaPendiente: boolean
  sdlEnergy: number | null
  activaNT: PorNT<number> | null
  reactivaTotal: number | null
  reactivaNT: PorNT<number> | null
  strEnergy: number | null
  precioActivaNT: PorNT<number | null>
  precioReactivaNT: PorNT<number | null>
  precioStr: number | null
  strTotalCop: number | null
  salida: SalidaMes | null
}

interface Porcentajes {
  activaNT: PorNT<number>
  reactivaPct: number
  reactivaNT: PorNT<number>
  strPct: number
}

interface Respuesta {
  porcentajes: Porcentajes
  meses: FilaMes[]
}

// ─── Paleta ───────────────────────────────────────────────────────────────

const AZUL_PROY = "#eff6ff"     // fondo columnas proyectadas (normal)
const AZUL_PROY_SOMBRA = "#dbeafe" // fondo columnas proyectadas en filas sombreadas
const AZUL_BORDE = "#bfdbfe"
const GRIS_REAL = "#f9fafb"     // fondo encabezado de meses reales
const GRIS_SOMBRA = "#f3f4f6"   // fondo de filas sombreadas (subtotales)
const TEAL_TOTAL = "#0f766e"    // fondo de la fila Total Cargos OR

// ─── Formateadores ───────────────────────────────────────────────────────────

const fmtKwh = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 })
const fmtCop = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 })
const fmtPrecio = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function kwh(v: number | null): string {
  return v === null || v === undefined ? "—" : fmtKwh.format(v)
}
function cop(v: number | null): string {
  return v === null || v === undefined ? "—" : "$" + fmtCop.format(v)
}
function precio(v: number | null): string {
  return v === null || v === undefined ? "—" : "$" + fmtPrecio.format(v)
}
function pct(v: number): string {
  return (v * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 }) + "%"
}

// Etiqueta legible del mes "AAAA-MM" → "Ene 2026"
const NOMBRE_MES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
function etiquetaMes(periodo: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo)
  if (!m) return periodo
  const anio = m[1]
  const mes = Number(m[2])
  return `${NOMBRE_MES[mes] ?? mes} ${anio}`
}

// Suma los tres niveles de un PorNT; null si el bloque es null.
function sumaNT(p: PorNT<number> | null | undefined): number | null {
  if (!p) return null
  return p.nt1 + p.nt2 + p.nt3
}
// Total SDL (activa + reactiva en COP); null si ambos bloques son null.
function totalSdl(m: FilaMes): number | null {
  const a = sumaNT(m.salida?.sdlActivaNT)
  const r = sumaNT(m.salida?.sdlReactivaNT)
  if (a === null && r === null) return null
  return (a ?? 0) + (r ?? 0)
}

// ─── Definición de filas (rubros) de la matriz ────────────────────────────────

type Tipo = "kwh" | "cop" | "precio"

interface FilaDef {
  label: string
  tipo: Tipo
  pctValor?: number   // valor para la columna "%" (solo demanda)
  sangria?: boolean   // sub-fila indentada (NT)
  negrilla?: boolean  // label + valores en negrilla
  sombra?: boolean    // fondo sombreado (subtotales SDL / STR)
  total?: boolean     // fila Total Cargos OR (resaltada)
  valor: (m: FilaMes) => number | null
}

interface Seccion {
  titulo: string
  filas: FilaDef[]
}

function construirSecciones(p: Porcentajes): Seccion[] {
  return [
    {
      titulo: "Demanda (kWh)",
      filas: [
        { label: "SDL Energy (kWh)", tipo: "kwh", negrilla: true, pctValor: 1, valor: (m) => m.sdlEnergy },
        { label: "Active NT1", tipo: "kwh", sangria: true, pctValor: p.activaNT.nt1, valor: (m) => m.activaNT?.nt1 ?? null },
        { label: "Active NT2", tipo: "kwh", sangria: true, pctValor: p.activaNT.nt2, valor: (m) => m.activaNT?.nt2 ?? null },
        { label: "Active NT3", tipo: "kwh", sangria: true, pctValor: p.activaNT.nt3, valor: (m) => m.activaNT?.nt3 ?? null },
        { label: "Reactive Energy (kWh)", tipo: "kwh", negrilla: true, pctValor: p.reactivaPct, valor: (m) => m.reactivaTotal },
        { label: "NT1", tipo: "kwh", sangria: true, pctValor: p.reactivaNT.nt1, valor: (m) => m.reactivaNT?.nt1 ?? null },
        { label: "NT2", tipo: "kwh", sangria: true, pctValor: p.reactivaNT.nt2, valor: (m) => m.reactivaNT?.nt2 ?? null },
        { label: "NT3", tipo: "kwh", sangria: true, pctValor: p.reactivaNT.nt3, valor: (m) => m.reactivaNT?.nt3 ?? null },
        { label: "STR Energy (kWh)", tipo: "kwh", negrilla: true, pctValor: p.strPct, valor: (m) => m.strEnergy },
      ],
    },
    {
      titulo: "Precio (COP/kWh)",
      filas: [
        { label: "Precio activa NT1", tipo: "precio", valor: (m) => m.precioActivaNT.nt1 },
        { label: "Precio activa NT2", tipo: "precio", valor: (m) => m.precioActivaNT.nt2 },
        { label: "Precio activa NT3", tipo: "precio", valor: (m) => m.precioActivaNT.nt3 },
        { label: "Precio reactiva NT1", tipo: "precio", valor: (m) => m.precioReactivaNT.nt1 },
        { label: "Precio reactiva NT2", tipo: "precio", valor: (m) => m.precioReactivaNT.nt2 },
        { label: "Precio reactiva NT3", tipo: "precio", valor: (m) => m.precioReactivaNT.nt3 },
        { label: "Precio STR", tipo: "precio", valor: (m) => m.precioStr },
      ],
    },
    {
      titulo: "Salida flujo Cargos OR (COP)",
      filas: [
        { label: "SDL", tipo: "cop", negrilla: true, sombra: true, valor: totalSdl },
        { label: "Active Energy", tipo: "cop", negrilla: true, valor: (m) => sumaNT(m.salida?.sdlActivaNT) },
        { label: "NT1", tipo: "cop", sangria: true, valor: (m) => m.salida?.sdlActivaNT?.nt1 ?? null },
        { label: "NT2", tipo: "cop", sangria: true, valor: (m) => m.salida?.sdlActivaNT?.nt2 ?? null },
        { label: "NT3", tipo: "cop", sangria: true, valor: (m) => m.salida?.sdlActivaNT?.nt3 ?? null },
        { label: "Reactive Energy", tipo: "cop", negrilla: true, valor: (m) => sumaNT(m.salida?.sdlReactivaNT) },
        { label: "NT1", tipo: "cop", sangria: true, valor: (m) => m.salida?.sdlReactivaNT?.nt1 ?? null },
        { label: "NT2", tipo: "cop", sangria: true, valor: (m) => m.salida?.sdlReactivaNT?.nt2 ?? null },
        { label: "NT3", tipo: "cop", sangria: true, valor: (m) => m.salida?.sdlReactivaNT?.nt3 ?? null },
        { label: "STR", tipo: "cop", negrilla: true, sombra: true, valor: (m) => m.salida?.str ?? null },
        { label: "Total Cargos OR (COP)", tipo: "cop", total: true, valor: (m) => m.salida?.total ?? null },
      ],
    },
  ]
}

function formatear(v: number | null, tipo: Tipo): string {
  if (tipo === "kwh") return kwh(v)
  if (tipo === "precio") return precio(v)
  return cop(v)
}

// Fondo de una celda de mes según fila/columna.
function fondoCelda(fila: FilaDef, m: FilaMes): string {
  if (fila.total) return TEAL_TOTAL
  if (m.esProyectado) return fila.sombra ? AZUL_PROY_SOMBRA : AZUL_PROY
  return fila.sombra ? GRIS_SOMBRA : "transparent"
}

// ─── Componente ────────────────────────────────────────────────────────────

export default function ProyeccionCargosORPage() {
  const [mesesProyeccion, setMesesProyeccion] = useState(3)
  const [data, setData] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setCargando(true)
    setError(null)
    fetch(`/api/proyeccion-cargos-or?mesesProyeccion=${mesesProyeccion}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? `Error ${r.status}`)
        }
        return r.json() as Promise<Respuesta>
      })
      .then((d) => { if (!cancelado) setData(d) })
      .catch((e: unknown) => { if (!cancelado) setError(e instanceof Error ? e.message : "Error desconocido") })
      .finally(() => { if (!cancelado) setCargando(false) })
    return () => { cancelado = true }
  }, [mesesProyeccion])

  const secciones = data ? construirSecciones(data.porcentajes) : []
  const meses = data?.meses ?? []
  const hayProyectados = meses.some((m) => m.demandaPendiente)

  const thRubro: React.CSSProperties = {
    position: "sticky", left: 0, zIndex: 2, background: "#fff",
    textAlign: "left", padding: "8px 12px", borderRight: "1px solid #e5e7eb",
    fontSize: "0.8rem", fontWeight: 500, color: "#374151", whiteSpace: "nowrap",
    minWidth: 200,
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Encabezado */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
            Proyección Cargos OR
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
            Cargos SDL y STR por mes de consumo / facturación. Los meses reales usan la
            facturación cargada; los proyectados promedian los últimos 6 meses reales.
          </p>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", color: "#374151" }}>
          Meses a proyectar
          <select
            value={mesesProyeccion}
            onChange={(e) => setMesesProyeccion(Number(e.target.value))}
            style={{
              padding: "6px 10px", borderRadius: 7, border: "1px solid #d1d5db",
              fontSize: "0.85rem", background: "#fff", color: "#111827",
            }}
          >
            {[0, 1, 2, 3, 6, 9, 12].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Leyenda */}
      <div style={{ display: "flex", gap: 16, fontSize: "0.78rem", color: "#6b7280", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: GRIS_REAL, border: "1px solid #e5e7eb" }} />
          Mes real (facturación cargada)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: AZUL_PROY, border: `1px solid ${AZUL_BORDE}` }} />
          Mes proyectado
        </span>
      </div>

      {hayProyectados && (
        <div style={{
          background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8,
          padding: "10px 14px", fontSize: "0.8rem", color: "#92400e",
        }}>
          Los meses proyectados muestran los <strong>precios</strong> (promedio de los últimos 6 meses reales),
          pero la <strong>demanda</strong> queda pendiente hasta conectar la query de Metabase. Por eso sus
          energías y cargos aparecen como «—».
        </div>
      )}

      {/* Estados */}
      {cargando && (
        <div style={cajaInfo}>Cargando proyección…</div>
      )}
      {error && !cargando && (
        <div style={{ ...cajaInfo, color: "#b91c1c", borderColor: "#fecaca", background: "#fef2f2" }}>
          {error}
        </div>
      )}
      {!cargando && !error && meses.length === 0 && (
        <div style={cajaInfo}>
          No hay datos de facturación cargados. Cargá al menos un mes para ver la proyección.
        </div>
      )}

      {/* Matriz */}
      {!cargando && !error && meses.length > 0 && (
        <div style={{
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
          overflowX: "auto",
        }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ ...thRubro, zIndex: 3, fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#9ca3af" }}>
                  Mes facturación
                </th>
                <th style={{
                  padding: "8px 10px", textAlign: "right", fontSize: "0.72rem",
                  fontWeight: 600, color: "#9ca3af", background: "#fff",
                  borderRight: "1px solid #e5e7eb", minWidth: 64,
                }}>
                  %
                </th>
                {meses.map((m) => (
                  <th key={m.periodoConsumo} style={{
                    padding: "8px 14px", textAlign: "right", whiteSpace: "nowrap",
                    background: m.esProyectado ? AZUL_PROY : GRIS_REAL,
                    borderLeft: m.esProyectado ? `1px solid ${AZUL_BORDE}` : "1px solid #f0f0f0",
                  }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 700, color: m.esProyectado ? "#1d4ed8" : "#111827" }}>
                      {etiquetaMes(m.periodoFacturacion)}
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "#9ca3af", fontWeight: 400 }}>
                      consumo {etiquetaMes(m.periodoConsumo)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {secciones.map((sec) => (
                <SeccionFilas key={sec.titulo} seccion={sec} meses={meses} thRubro={thRubro} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SeccionFilas({ seccion, meses, thRubro }: {
  seccion: Seccion
  meses: FilaMes[]
  thRubro: React.CSSProperties
}) {
  return (
    <>
      <tr>
        <td colSpan={meses.length + 2} style={{
          position: "sticky", left: 0,
          background: "#f3f4f6", padding: "6px 12px",
          fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "#6b7280", borderTop: "1px solid #e5e7eb",
        }}>
          {seccion.titulo}
        </td>
      </tr>
      {seccion.filas.map((fila, i) => {
        const labelBg = fila.total ? TEAL_TOTAL : fila.sombra ? GRIS_SOMBRA : "#fff"
        const labelColor = fila.total ? "#fff" : fila.negrilla ? "#111827" : "#374151"
        const pctBg = fila.total ? TEAL_TOTAL : fila.sombra ? GRIS_SOMBRA : "#fff"
        return (
          <tr key={`${fila.label}-${i}`} style={{ borderTop: "1px solid #f3f4f6" }}>
            <td style={{
              ...thRubro,
              background: labelBg,
              paddingLeft: fila.sangria ? 28 : 12,
              fontWeight: fila.negrilla || fila.total ? 700 : 400,
              color: labelColor,
            }}>
              {fila.label}
            </td>
            <td style={{
              padding: "7px 10px", textAlign: "right", whiteSpace: "nowrap",
              fontSize: "0.78rem", color: fila.total ? "#fff" : "#9ca3af",
              background: pctBg, borderRight: "1px solid #e5e7eb",
              fontWeight: fila.negrilla ? 600 : 400,
            }}>
              {fila.pctValor !== undefined ? pct(fila.pctValor) : ""}
            </td>
            {meses.map((m) => {
              const v = fila.valor(m)
              const esTotal = fila.total
              return (
                <td key={m.periodoConsumo} style={{
                  padding: "7px 14px", textAlign: "right", whiteSpace: "nowrap",
                  fontSize: "0.82rem",
                  fontWeight: fila.negrilla || esTotal ? 700 : 400,
                  color: esTotal ? "#fff" : v === null ? "#cbd5e1" : "#374151",
                  background: fondoCelda(fila, m),
                  borderLeft: m.esProyectado ? `1px solid ${AZUL_BORDE}` : "1px solid #f6f6f6",
                }}>
                  {formatear(v, fila.tipo)}
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}

const cajaInfo: React.CSSProperties = {
  background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
  padding: "24px", textAlign: "center", color: "#6b7280", fontSize: "0.9rem",
}
