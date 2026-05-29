"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

const ACCENT = "#07c5a8"

const MESES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
]

type TipoFuente = "FACTURACION" | "XM" | "SDL" | "BALANCE" | "TC1" | "COT" | "INSUMOS_STR"

interface FuenteCard {
  tipo: TipoFuente
  label: string
  desc: string
  requiresOR: boolean
  multiFile?: boolean
  icon: string
}

const FUENTES: FuenteCard[] = [
  {
    tipo: "FACTURACION", label: "Facturación BIA", requiresOR: false,
    desc: "Se consulta directo desde Metabase (sin carga de archivo).",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    tipo: "XM", label: "Reporte CGM/XM", requiresOR: false,
    desc: "Energía reportada por XM por frontera.",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    tipo: "SDL", label: "SDL por Operador", requiresOR: true,
    desc: "Archivo SDL del operador de red. Formato configurable por OR.",
    icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
  },
  {
    tipo: "BALANCE", label: "Balance de Energía", requiresOR: true,
    desc: "Ajuste retroactivo de un operador a períodos anteriores.",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  },
  {
    tipo: "TC1", label: "TC1 — Conf. Técnica", requiresOR: true,
    desc: "Archivo de configuración técnica de fronteras por OR (XM/SUI).",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
  },
  {
    tipo: "COT", label: "COT por Operador", requiresOR: true,
    desc: "Cargo por Otros Trámites enviado por el OR.",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    tipo: "INSUMOS_STR", label: "Insumos STR", requiresOR: false, multiFile: true,
    desc: "Múltiples archivos de insumos para el cálculo de cargos STR.",
    icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
  },
]

interface Operador {
  id: string
  codigo: string
  nombre: string
  // Solo presente cuando se solicita con ?includeMapeo=true. Si el mapeo tiene
  // multi_archivos:true, el wizard debe permitir subir varios archivos a la vez
  // (ej. EMSA SDL: 3 archivos por periodo).
  mapeo_sdl_json?: { multi_archivos?: boolean } | null
}

const now = new Date()
const CURRENT_YEAR  = now.getFullYear()
const CURRENT_MONTH = now.getMonth() + 1

export function WizardCarga() {
  const router = useRouter()

  const [step, setStep]                 = useState(0)
  const [anio, setAnio]                 = useState(CURRENT_YEAR)
  const [mes, setMes]                   = useState(CURRENT_MONTH)
  const [tipoFuente, setTipoFuente]     = useState<TipoFuente | null>(null)
  const [orId, setOrId]                 = useState("")
  const [operadores, setOperadores]     = useState<Operador[]>([])
  const [file, setFile]                 = useState<File | null>(null)
  const [files, setFiles]               = useState<File[]>([])
  const [dragOver, setDragOver]         = useState(false)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [preview, setPreview]           = useState<Record<string, unknown>[]>([])
  const [filasCompletas, setFilasCompletas] = useState<unknown[]>([])
  const [total, setTotal]               = useState(0)
  const [alertas, setAlertas]           = useState<string[]>([])
  const [erroresCriticos, setErroresCriticos] = useState<string[]>([])
  const [existeCargaPrevia, setExisteCargaPrevia] = useState(false)
  const [cargaPreviaId, setCargaPreviaId] = useState<string | undefined>()
  const [justificacion, setJustificacion] = useState("")
  // Accion frente a una carga previa: 'reemplazar' (default) o 'agregar'
  // (solo disponible para EEP_PEREIRA SDL — fronteras complementarias por NT).
  const [accionCargaPrevia, setAccionCargaPrevia] =
    useState<"reemplazar" | "agregar">("reemplazar")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Lista de operadores: SDL y TC1 usan la misma whitelist de 21 ORs. Para
  // SDL incluimos el mapeo para detectar multi-archivo (ej. EMSA). Para
  // BALANCE/COT y demas fuentes que requieren OR seguimos con todos los activos.
  useEffect(() => {
    const url =
      tipoFuente === "SDL" ? "/api/operadores?tipo=sdl&includeMapeo=true" :
      tipoFuente === "TC1" ? "/api/operadores?tipo=sdl" :
      "/api/operadores"
    fetch(url)
      .then((r) => r.json())
      .then((data) => setOperadores(Array.isArray(data) ? data : data.operadores ?? []))
      .catch(() => {})
  }, [tipoFuente])

  // Si el usuario cambia el año y el mes seleccionado quedó en el futuro,
  // lo clamp al mes actual para que la selección sea siempre válida.
  useEffect(() => {
    if (anio === CURRENT_YEAR && mes > CURRENT_MONTH) {
      setMes(CURRENT_MONTH)
    }
  }, [anio, mes])

  // Resetear accion frente a carga previa cuando cambia OR/fuente, para que
  // no quede 'agregar' seleccionado si despues cambian a un OR que no lo
  // permite (solo EEP_PEREIRA SDL puede agregar).
  useEffect(() => {
    setAccionCargaPrevia("reemplazar")
  }, [orId, tipoFuente])

  const fuenteActual = FUENTES.find((f) => f.tipo === tipoFuente)
  const requiereOR  = fuenteActual?.requiresOR ?? false
  // Multi-archivo: por FUENTES (INSUMOS_STR siempre) o por mapeo del OR cuando
  // es SDL (ej. EMSA tiene multi_archivos:true en su mapeo_sdl_json y debe
  // permitir subir 3 archivos juntos).
  const operadorActual    = operadores.find((o) => o.id === orId)
  const mapeoMultiSdl     = tipoFuente === "SDL"
    && operadorActual?.mapeo_sdl_json?.multi_archivos === true
  const isMultiFile = (fuenteActual?.multiFile ?? false) || mapeoMultiSdl
  const paso1Ok     = tipoFuente !== null && (!requiereOR || orId !== "")
  const hasFiles    = isMultiFile ? files.length > 0 : file !== null

  // ── Dropzone handlers ──────────────────────────────────────────────────────

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? [])
    if (isMultiFile) {
      // Append to existing list (deduplicate by name+size)
      const map = new Map(files.map(f => [`${f.name}|${f.size}`, f]))
      for (const f of list) map.set(`${f.name}|${f.size}`, f)
      setFiles(Array.from(map.values()))
    } else {
      setFile(list[0] ?? null)
    }
    setError(null)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const list = Array.from(e.dataTransfer.files ?? [])
    if (list.length === 0) return
    if (isMultiFile) {
      const map = new Map(files.map(f => [`${f.name}|${f.size}`, f]))
      for (const f of list) map.set(`${f.name}|${f.size}`, f)
      setFiles(Array.from(map.values()))
    } else {
      setFile(list[0] ?? null)
    }
    setError(null)
  }

  function removeFile(idx: number) {
    setFiles(files.filter((_, i) => i !== idx))
  }

  // ── Step navigation ───────────────────────────────────────────────────────

  async function handleSiguienteStep1() {
    if (!paso1Ok) return

    // FACTURACION: no se sube archivo, se consulta directo a Metabase y se
    // salta al paso 2 con el preview.
    if (tipoFuente === "FACTURACION") {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/cargas/preview-facturacion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anio, mes }),
        })
        let data: Record<string, unknown> | null = null
        let rawText = ""
        try {
          rawText = await res.text()
          data = rawText ? JSON.parse(rawText) : null
        } catch {
          const status = `HTTP ${res.status} ${res.statusText}`
          const preview = rawText.length > 200 ? rawText.slice(0, 200) + "..." : rawText
          setError(`${status} — respuesta no-JSON del servidor. ${preview ? "Body: " + preview : "Body vacio."}`)
          return
        }
        if (!res.ok) {
          const detalle = data && typeof data === "object" && "detalle" in data ? ` (${data.detalle})` : ""
          const msg = data && typeof data === "object" && "error" in data ? String(data.error) : "Error al consultar Metabase."
          setError(`${msg}${detalle}`)
          return
        }
        const d = data as Record<string, unknown>
        setPreview((d.preview as Record<string, unknown>[]) ?? [])
        setFilasCompletas((d.filasCompletas as unknown[]) ?? [])
        setTotal((d.total as number) ?? 0)
        setAlertas((d.alertas as string[]) ?? [])
        setErroresCriticos((d.erroresCriticos as string[]) ?? [])
        setExisteCargaPrevia((d.existeCargaPrevia as boolean) ?? false)
        setCargaPreviaId(d.cargaPreviaId as string | undefined)
        setStep(2)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(`Error de red al consultar Metabase: ${msg}`)
      } finally {
        setLoading(false)
      }
      return
    }

    setStep(1)
  }

  async function handleSiguienteStep2() {
    if (isMultiFile) {
      if (files.length === 0) { setError("Seleccioná al menos un archivo."); return }
    } else {
      if (!file) { setError("Seleccioná un archivo."); return }
    }
    setLoading(true)
    setError(null)

    // ── XM: parsear en el navegador para evitar el limite de 4.5 MB de Vercel
    // (los archivos XM con datos diarios suelen superarlo).
    if (tipoFuente === "XM" && file) {
      try {
        const [{ parsearXM }, checkRes] = await Promise.all([
          import("@/lib/parsers/xm"),
          fetch("/api/cargas/check-previa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ anio, mes, tipoFuente, orId: orId || undefined }),
          }),
        ])
        if (!checkRes.ok) {
          const t = await checkRes.text()
          let msg = "Error al validar el periodo."
          try { const j = JSON.parse(t); msg = j.error ?? msg } catch { /* keep default */ }
          setError(msg); return
        }
        const checkData = await checkRes.json()
        const ab = await file.arrayBuffer()
        const u8 = new Uint8Array(ab)
        const result = await parsearXM(u8, null, anio, mes)
        setPreview((result.filas as unknown as Record<string, unknown>[]).slice(0, 20))
        setFilasCompletas(result.filas)
        setTotal(result.filas.length)
        setAlertas(result.alertas)
        setErroresCriticos(result.erroresCriticos)
        setExisteCargaPrevia(checkData.existeCargaPrevia ?? false)
        setCargaPreviaId(checkData.cargaPreviaId)
        setStep(2)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(`Error al parsear el archivo XM en el navegador: ${msg}`)
      } finally {
        setLoading(false)
      }
      return
    }

    try {
      const fd = new FormData()
      if (isMultiFile) {
        files.forEach((f) => fd.append("files", f))
      } else {
        fd.append("file", file!)
      }
      fd.append("anio", String(anio))
      fd.append("mes", String(mes))
      fd.append("tipoFuente", tipoFuente!)
      if (orId) fd.append("orId", orId)

      const res = await fetch("/api/cargas/preview", { method: "POST", body: fd })
      // Intentar JSON; si falla, leer como texto para que el mensaje sea util
      let data: Record<string, unknown> | null = null
      let rawText = ""
      try {
        rawText = await res.text()
        data = rawText ? JSON.parse(rawText) : null
      } catch {
        // La respuesta no fue JSON valido (timeout, 413, 500 HTML, etc.)
        const status = `HTTP ${res.status} ${res.statusText}`
        const preview = rawText.length > 200 ? rawText.slice(0, 200) + "..." : rawText
        setError(`${status} — respuesta no-JSON del servidor. ${preview ? "Body: " + preview : "Body vacio."}`)
        return
      }
      if (!res.ok) {
        const detalle = data && typeof data === "object" && "detalle" in data ? ` (${data.detalle})` : ""
        const msg = data && typeof data === "object" && "error" in data ? String(data.error) : "Error al procesar el archivo."
        setError(`${msg}${detalle}`)
        return
      }
      const d = data as Record<string, unknown>
      setPreview((d.preview as Record<string, unknown>[]) ?? [])
      setFilasCompletas((d.filasCompletas as unknown[]) ?? [])
      setTotal((d.total as number) ?? 0)
      setAlertas((d.alertas as string[]) ?? [])
      setErroresCriticos((d.erroresCriticos as string[]) ?? [])
      setExisteCargaPrevia((d.existeCargaPrevia as boolean) ?? false)
      setCargaPreviaId(d.cargaPreviaId as string | undefined)
      setStep(2)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Error de red al procesar el archivo: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmar() {
    // Justificacion solo requerida cuando se reemplaza (la opcion 'agregar'
    // no la pide porque las dos cargas coexisten).
    if (existeCargaPrevia && accionCargaPrevia === "reemplazar" && !justificacion.trim()) {
      setError("Ingresá una justificación para reemplazar la carga existente.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const nombreArchivo = isMultiFile
        ? (files.length === 1 ? files[0]!.name : `${files.length} archivos`)
        : (file?.name ?? "")
      const res = await fetch("/api/cargas/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meta: { anio, mes, tipoFuente, orId: orId || undefined, nombreArchivo },
          filasCompletas,
          justificacion: accionCargaPrevia === "reemplazar" ? (justificacion || undefined) : undefined,
          cargaPreviaId,
          accionCargaPrevia: existeCargaPrevia ? accionCargaPrevia : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const base = data.error ?? "Error al confirmar."
        const detalle = data.detalle ? ` — ${String(data.detalle).slice(0, 300)}` : ""
        setError(`${base}${detalle}`)
        return
      }
      router.push("/cargas")
    } catch {
      setError("Error de red al confirmar la carga.")
    } finally {
      setLoading(false)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  const previewCols = preview.length > 0 ? Object.keys(preview[0] ?? {}) : []

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: "860px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#111827", marginBottom: "4px" }}>
            Nueva carga de fuente
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            Sigue los pasos para cargar un archivo de datos al sistema
          </p>
        </div>
        <a href="/cargas" style={{
          fontSize: "0.8rem", color: "#374151", border: "1px solid #e5e7eb",
          borderRadius: "6px", padding: "6px 14px", textDecoration: "none",
          backgroundColor: "#ffffff",
        }}>
          ← Volver al historial
        </a>
      </div>

      {/* Steps indicator */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "24px" }}>
        {["Configurar", "Cargar archivo", "Confirmar"].map((label, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", flex: i < 2 ? "1" : "0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              <div style={{
                width: "28px", height: "28px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.8rem", fontWeight: 700,
                backgroundColor: step === i ? ACCENT : step > i ? ACCENT : "#e5e7eb",
                color: step >= i ? "#050f0d" : "#9ca3af",
              }}>
                {i + 1}
              </div>
              <span style={{
                fontSize: "0.85rem", fontWeight: step === i ? 600 : 400,
                color: step === i ? "#111827" : step > i ? ACCENT : "#9ca3af",
              }}>
                {label}
              </span>
            </div>
            {i < 2 && (
              <div style={{
                flex: 1, height: "1px", margin: "0 12px",
                backgroundColor: step > i ? ACCENT : "#e5e7eb",
              }}/>
            )}
          </div>
        ))}
      </div>

      {/* Panel */}
      <div style={{
        backgroundColor: "#ffffff", borderRadius: "12px",
        border: "1px solid #e5e7eb", padding: "24px",
      }}>

        {/* ── Step 0: Configurar ── */}
        {step === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

            {/* Período */}
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#111827", marginBottom: "10px" }}>
                Período de conciliación
              </label>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 500 }}>Año</label>
                  <select
                    value={anio}
                    onChange={(e) => setAnio(Number(e.target.value))}
                    style={{ width: "100px", padding: "7px 10px", borderRadius: "7px", border: "1px solid #d1d5db", fontSize: "0.875rem" }}
                  >
                    <option value={CURRENT_YEAR - 2}>{CURRENT_YEAR - 2}</option>
                    <option value={CURRENT_YEAR - 1}>{CURRENT_YEAR - 1}</option>
                    <option value={CURRENT_YEAR}>{CURRENT_YEAR}</option>
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 500 }}>Mes</label>
                  <select
                    value={mes}
                    onChange={(e) => setMes(Number(e.target.value))}
                    style={{ width: "160px", padding: "7px 10px", borderRadius: "7px", border: "1px solid #d1d5db", fontSize: "0.875rem" }}
                  >
                    {MESES.map((m, i) => {
                      // Si el año seleccionado es el actual, sólo permitir meses hasta el actual
                      const futuro = anio === CURRENT_YEAR && i + 1 > CURRENT_MONTH
                      if (futuro) return null
                      return <option key={i + 1} value={i + 1}>{m}</option>
                    })}
                  </select>
                </div>
              </div>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: "6px" }}>
                No se permiten cargas para períodos futuros.
              </p>
            </div>

            {/* Tipo de fuente */}
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#111827", marginBottom: "10px" }}>
                Tipo de fuente
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                {FUENTES.map((f) => {
                  const selected = tipoFuente === f.tipo
                  return (
                    <button
                      key={f.tipo}
                      type="button"
                      onClick={() => { setTipoFuente(f.tipo); if (!f.requiresOR) setOrId("") }}
                      style={{
                        display: "flex", flexDirection: "column", gap: "6px",
                        padding: "12px 14px", borderRadius: "9px", textAlign: "left",
                        border: selected ? `2px solid ${ACCENT}` : "1px solid #e5e7eb",
                        backgroundColor: selected ? `${ACCENT}15` : "#fafafa",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                             fill="none" stroke={selected ? ACCENT : "#374151"}
                             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d={f.icon}/>
                        </svg>
                        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: selected ? ACCENT : "#111827" }}>
                          {f.label}
                        </span>
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "#6b7280", lineHeight: "1.4" }}>
                        {f.desc}
                      </span>
                      {f.requiresOR && (
                        <span style={{
                          fontSize: "0.65rem", fontWeight: 600, color: selected ? ACCENT : "#9ca3af",
                          textTransform: "uppercase", letterSpacing: "0.05em",
                        }}>
                          Requiere OR
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* OR selector */}
            {requiereOR && (
              <div>
                <label style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", color: "#111827", marginBottom: "6px" }}>
                  Operador de Red <span style={{ color: "#ef4444" }}>*</span>
                </label>
                {operadores.length > 0 ? (
                  <select
                    value={orId}
                    onChange={(e) => setOrId(e.target.value)}
                    style={{ width: "320px", padding: "7px 10px", borderRadius: "7px", border: "1px solid #d1d5db", fontSize: "0.875rem" }}
                  >
                    <option value="">Seleccionar operador…</option>
                    {operadores.map((o) => (
                      <option key={o.id} value={o.id}>{o.codigo} — {o.nombre}</option>
                    ))}
                  </select>
                ) : (
                  <p style={{ fontSize: "0.82rem", color: "#6b7280" }}>No hay operadores activos registrados.</p>
                )}
              </div>
            )}

            {/* Next */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={!paso1Ok || loading}
                onClick={handleSiguienteStep1}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "9px 20px", borderRadius: "7px", border: "none",
                  fontSize: "0.875rem", fontWeight: 600, cursor: paso1Ok && !loading ? "pointer" : "not-allowed",
                  backgroundColor: paso1Ok && !loading ? ACCENT : "#e5e7eb",
                  color: paso1Ok && !loading ? "#050f0d" : "#9ca3af",
                }}
              >
                {loading
                  ? (tipoFuente === "FACTURACION" ? "Consultando Metabase…" : "Procesando…")
                  : (tipoFuente === "FACTURACION" ? "Consultar Metabase" : "Siguiente")}
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: Cargar archivo ── */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <div>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
                Cargar archivo
              </h2>
              <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                Arrastra el archivo Excel o CSV del período seleccionado
              </p>
            </div>

            {/* Dropzone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                border: `2px dashed ${dragOver ? ACCENT : hasFiles ? ACCENT : "#d1d5db"}`,
                borderRadius: "10px", padding: "40px 24px",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
                cursor: "pointer", backgroundColor: dragOver ? `${ACCENT}08` : hasFiles ? `${ACCENT}06` : "#fafafa",
                transition: "border-color 0.15s, background-color 0.15s",
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
                   fill="none" stroke={hasFiles ? ACCENT : "#9ca3af"}
                   strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
              </svg>
              <div style={{ fontSize: "0.9rem", fontWeight: 500, color: hasFiles ? ACCENT : "#374151" }}>
                {isMultiFile
                  ? (files.length > 0
                      ? `${files.length} archivo${files.length > 1 ? "s" : ""} seleccionado${files.length > 1 ? "s" : ""}`
                      : "Haz clic o arrastra los archivos aquí")
                  : (file ? file.name : "Haz clic o arrastra tu archivo aquí")}
              </div>
              {!hasFiles && (
                <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                  .xlsx, .xls, .csv — máx. 32 MB {isMultiFile && "por archivo"}
                </div>
              )}
              {!isMultiFile && file && (
                <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  {(file.size / 1024).toFixed(1)} KB — haz clic para cambiar
                </div>
              )}
              {isMultiFile && files.length > 0 && (
                <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  Haz clic para agregar más archivos
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple={isMultiFile}
                style={{ display: "none" }}
                onChange={onFileChange}
              />
            </div>

            {/* Lista de archivos (multi-file mode) */}
            {isMultiFile && files.length > 0 && (
              <div style={{
                border: "1px solid #e5e7eb", borderRadius: "8px",
                backgroundColor: "#ffffff", overflow: "hidden",
              }}>
                <div style={{
                  padding: "8px 14px", backgroundColor: "#f9fafb",
                  fontSize: "0.75rem", fontWeight: 600, color: "#6b7280",
                  borderBottom: "1px solid #e5e7eb", textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}>
                  Archivos a cargar
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 14px", borderBottom: i < files.length - 1 ? "1px solid #f3f4f6" : "none",
                      fontSize: "0.85rem",
                    }}>
                      <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.name} <span style={{ color: "#9ca3af", fontSize: "0.78rem" }}>({(f.size / 1024).toFixed(1)} KB)</span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          color: "#dc2626", fontSize: "0.78rem", fontWeight: 500,
                          padding: "2px 6px",
                        }}
                      >
                        Quitar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && (
              <div style={{
                padding: "10px 14px", borderRadius: "7px",
                border: "1px solid #fca5a5", backgroundColor: "#fef2f2",
                fontSize: "0.85rem", color: "#dc2626",
              }}>
                {error}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button
                type="button"
                onClick={() => { setStep(0); setFile(null); setFiles([]); setError(null) }}
                style={{
                  padding: "9px 20px", borderRadius: "7px",
                  border: "1px solid #e5e7eb", backgroundColor: "#ffffff",
                  fontSize: "0.875rem", fontWeight: 500, cursor: "pointer", color: "#374151",
                }}
              >
                ← Atrás
              </button>
              <button
                type="button"
                disabled={!hasFiles || loading}
                onClick={handleSiguienteStep2}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "9px 20px", borderRadius: "7px", border: "none",
                  fontSize: "0.875rem", fontWeight: 600,
                  cursor: hasFiles && !loading ? "pointer" : "not-allowed",
                  backgroundColor: hasFiles && !loading ? ACCENT : "#e5e7eb",
                  color: hasFiles && !loading ? "#050f0d" : "#9ca3af",
                }}
              >
                {loading ? "Procesando…" : "Vista previa →"}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Confirmar ── */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
                Confirmar carga
              </h2>
              <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                Revisa los primeros registros antes de guardar.{" "}
                <strong style={{ color: "#111827" }}>{total.toLocaleString()} registros</strong> en total.
              </p>
            </div>

            {/* Alertas */}
            {erroresCriticos.length > 0 && (
              <div style={{ padding: "12px 14px", borderRadius: "7px", border: "1px solid #fca5a5", backgroundColor: "#fef2f2" }}>
                <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "#dc2626", marginBottom: "6px" }}>Errores críticos</p>
                <ul style={{ paddingLeft: "16px", margin: 0 }}>
                  {erroresCriticos.map((e, i) => (
                    <li key={i} style={{ fontSize: "0.8rem", color: "#dc2626" }}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {alertas.length > 0 && (
              <div style={{ padding: "12px 14px", borderRadius: "7px", border: "1px solid #fde68a", backgroundColor: "#fffbeb" }}>
                <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "#92400e", marginBottom: "6px" }}>Alertas</p>
                <ul style={{ paddingLeft: "16px", margin: 0 }}>
                  {alertas.map((a, i) => (
                    <li key={i} style={{ fontSize: "0.8rem", color: "#92400e" }}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Carga previa warning */}
            {existeCargaPrevia && (() => {
              // EEP Pereira (SDL) puede AGREGAR cargas complementarias sin
              // reemplazar (envia fronteras de distintos NT en meses
              // distintos). Resto de ORs solo permiten reemplazar.
              const orCodigo = operadores.find((o) => o.id === orId)?.codigo
              const permiteAgregar = tipoFuente === "SDL"
                && (orCodigo === "EEP_PEREIRA" || orCodigo === "EPM")
              return (
                <div style={{ padding: "12px 14px", borderRadius: "7px", border: "1px solid #fde68a", backgroundColor: "#fffbeb" }}>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#92400e", marginBottom: "10px" }}>
                    Ya existe una carga SDL para este período y operador.
                    {permiteAgregar ? " Elegí qué hacer:" : " Ingresá una justificación para reemplazarla."}
                  </p>

                  {permiteAgregar && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => setAccionCargaPrevia("reemplazar")}
                        style={{
                          padding: "8px 14px", borderRadius: 7, fontSize: "0.82rem",
                          fontWeight: 600, cursor: "pointer",
                          background: accionCargaPrevia === "reemplazar" ? "#92400e" : "#fff",
                          color:      accionCargaPrevia === "reemplazar" ? "#fff"    : "#92400e",
                          border: "1px solid #92400e",
                        }}
                      >
                        Reemplazar existente
                      </button>
                      <button
                        type="button"
                        onClick={() => setAccionCargaPrevia("agregar")}
                        style={{
                          padding: "8px 14px", borderRadius: 7, fontSize: "0.82rem",
                          fontWeight: 600, cursor: "pointer",
                          background: accionCargaPrevia === "agregar" ? "#92400e" : "#fff",
                          color:      accionCargaPrevia === "agregar" ? "#fff"    : "#92400e",
                          border: "1px solid #92400e",
                        }}
                      >
                        Agregar archivo
                      </button>
                    </div>
                  )}

                  {accionCargaPrevia === "reemplazar" && (
                    <textarea
                      value={justificacion}
                      onChange={(e) => setJustificacion(e.target.value)}
                      placeholder="Motivo del reemplazo…"
                      rows={2}
                      style={{
                        width: "100%", padding: "8px 10px", borderRadius: "7px",
                        border: "1px solid #d1d5db", fontSize: "0.85rem",
                        resize: "vertical", boxSizing: "border-box",
                      }}
                    />
                  )}

                  {accionCargaPrevia === "agregar" && (
                    <p style={{ fontSize: "0.78rem", color: "#78350f", margin: 0 }}>
                      Ambos archivos quedarán cargados. Útil cuando el OR envía
                      archivos complementarios en momentos distintos (EEP Pereira
                      por nivel de tensión, EPM activa y reactiva por separado).
                    </p>
                  )}
                </div>
              )
            })()}

            {/* Preview table */}
            {preview.length > 0 && (
              <div style={{ overflowX: "auto", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f9fafb" }}>
                      {previewCols.map((col) => (
                        <th key={col} style={{
                          padding: "8px 12px", textAlign: "left", fontWeight: 600,
                          color: "#374151", borderBottom: "1px solid #e5e7eb",
                          whiteSpace: "nowrap",
                        }}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        {previewCols.map((col) => (
                          <td key={col} style={{
                            padding: "7px 12px", color: "#374151",
                            whiteSpace: "nowrap", maxWidth: "200px",
                            overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            {String(row[col] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {total > preview.length && (
                  <div style={{ padding: "8px 12px", fontSize: "0.75rem", color: "#9ca3af", borderTop: "1px solid #e5e7eb" }}>
                    Mostrando {preview.length} de {total.toLocaleString()} registros
                  </div>
                )}
              </div>
            )}

            {error && (
              <div style={{
                padding: "10px 14px", borderRadius: "7px",
                border: "1px solid #fca5a5", backgroundColor: "#fef2f2",
                fontSize: "0.85rem", color: "#dc2626",
              }}>
                {error}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button
                type="button"
                onClick={() => { setStep(1); setError(null) }}
                style={{
                  padding: "9px 20px", borderRadius: "7px",
                  border: "1px solid #e5e7eb", backgroundColor: "#ffffff",
                  fontSize: "0.875rem", fontWeight: 500, cursor: "pointer", color: "#374151",
                }}
              >
                ← Atrás
              </button>
              <button
                type="button"
                disabled={loading || erroresCriticos.length > 0}
                onClick={handleConfirmar}
                style={{
                  padding: "9px 24px", borderRadius: "7px", border: "none",
                  fontSize: "0.875rem", fontWeight: 600,
                  cursor: loading || erroresCriticos.length > 0 ? "not-allowed" : "pointer",
                  backgroundColor: erroresCriticos.length > 0 ? "#e5e7eb" : ACCENT,
                  color: erroresCriticos.length > 0 ? "#9ca3af" : "#050f0d",
                }}
              >
                {loading ? "Guardando…" : "Confirmar carga"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
