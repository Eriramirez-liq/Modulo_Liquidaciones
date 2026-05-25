"use client"

import { useState, useEffect } from "react"
import type { LoteEnCursoUI } from "./types"

interface PanelLoteEnCursoProps {
  lote: LoteEnCursoUI
  /** FE-5.5: momento del último cambio observado en los totales del lote.
   *  null si el lote aún no arrancó o ya terminó. */
  lastProgressAt: Date | null
  puedeCancelar: boolean
  onCancelar: () => void
  onVerDetalle: () => void
  onCerrar: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** FE-5.5: formatea segundos en texto legible para los warnings de timeout */
function formatMinutos(segundos: number): string {
  const min = Math.floor(segundos / 60)
  if (min < 1) return `${segundos}s`
  return `${min} min`
}

/** Formatea el tiempo transcurrido desde una fecha ISO en texto legible */
function tiempoTranscurrido(isoString: string): string {
  const ahora = Date.now()
  const inicio = new Date(isoString).getTime()
  const segundos = Math.floor((ahora - inicio) / 1000)

  if (segundos < 60) return "hace un momento"
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} d`
}

// ---------------------------------------------------------------------------
// PanelLoteEnCurso
// Banner sticky que muestra el progreso de un lote en tiempo real.
// Animación de entrada via globals.css (@keyframes panel-slide-in).
// ---------------------------------------------------------------------------

export default function PanelLoteEnCurso({
  lote,
  lastProgressAt,
  puedeCancelar,
  onCancelar,
  onCerrar,
}: PanelLoteEnCursoProps) {
  const { totales, iniciadoAt, iniciadoPor, estado } = lote

  // -- Confirmación en dos pasos del botón Cancelar --
  const [confirmando, setConfirmando] = useState(false)

  // -- Tiempo transcurrido (actualiza cada 30s) --
  const [tiempoLabel, setTiempoLabel] = useState(() => tiempoTranscurrido(iniciadoAt))

  // -- FE-5.5: tiempo sin progreso (en segundos), actualiza cada 10s --
  const [tiempoSinProgreso, setTiempoSinProgreso] = useState(0)

  useEffect(() => {
    setTiempoLabel(tiempoTranscurrido(iniciadoAt))
    const interval = setInterval(() => {
      setTiempoLabel(tiempoTranscurrido(iniciadoAt))
    }, 30_000)
    return () => clearInterval(interval)
  }, [iniciadoAt])

  // -- FE-5.5: calcular tiempoSinProgreso cada 10s --
  // Solo corre cuando el lote está EN_PROGRESO y se conoce lastProgressAt.
  useEffect(() => {
    if (estado !== "EN_PROGRESO" || lastProgressAt === null) {
      setTiempoSinProgreso(0)
      return
    }

    // Calcular el valor inicial de inmediato (no esperar el primer tick)
    setTiempoSinProgreso(Math.floor((Date.now() - lastProgressAt.getTime()) / 1000))

    const interval = setInterval(() => {
      setTiempoSinProgreso(Math.floor((Date.now() - lastProgressAt.getTime()) / 1000))
    }, 10_000)

    return () => clearInterval(interval)
  }, [estado, lastProgressAt])

  // -- Timer para resetear confirmación si no se hace click en 3s --
  useEffect(() => {
    if (!confirmando) return
    const timer = setTimeout(() => setConfirmando(false), 3000)
    return () => clearTimeout(timer)
  }, [confirmando])

  // -- FE-5.5: nivel de alerta por tiempo sin progreso --
  const nivelAlerta: "ok" | "lento" | "colgado" =
    estado !== "EN_PROGRESO" ? "ok" :
    tiempoSinProgreso > 600 ? "colgado" :  // > 10 min
    tiempoSinProgreso > 300 ? "lento" :    // > 5 min
    "ok"

  // -- Barra de progreso --
  const completados = totales.procesados + totales.errores
  const total = totales.total
  const porcentaje = total > 0 ? Math.round((completados / total) * 100) : 0

  // -- Color del estado --
  const esEnProgreso = estado === "EN_PROGRESO"
  const esCompletado = estado === "COMPLETADO"
  const esCancelado  = estado === "CANCELADO"

  const etiquetaEstado = esEnProgreso
    ? "Lote en curso"
    : esCompletado
      ? "Lote completado"
      : "Lote cancelado"

  const colorPunto = esEnProgreso ? "#b45309" : esCompletado ? "#15803d" : "#9ca3af"
  const colorBarraBg = esCompletado ? "#d1fae5" : esCancelado ? "#f3f4f6" : "#fde68a"
  const colorBarraFill = esCompletado
    ? "#10b981"
    : esCancelado
      ? "#9ca3af"
      : "#10b981"

  const nombreCorto = iniciadoPor.nombre.split(" ").slice(0, 2).join(" ")

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${etiquetaEstado}: ${completados} de ${total} envíos procesados`}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: esCancelado ? "#f9fafb" : "#fef3c7",
        border: `1px solid ${esCancelado ? "#e5e7eb" : "#fde68a"}`,
        borderRadius: 8,
        padding: "12px 20px",
        marginBottom: 12,
        animation: "panel-slide-in 0.2s ease-out",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      }}
    >
      {/* Fila 1: título + botón cerrar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {/* Punto de estado animado */}
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: colorPunto,
              flexShrink: 0,
              animation: esEnProgreso ? "panel-pulse 2s ease-in-out infinite" : undefined,
            }}
          />
          <span style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            color: esCancelado ? "#6b7280" : "#92400e",
          }}>
            {etiquetaEstado}
          </span>
          <span style={{ fontSize: "0.8rem", color: "#b45309" }}>·</span>
          <span style={{ fontSize: "0.8rem", color: "#92400e" }}>
            iniciado por {nombreCorto}
          </span>
          <span style={{ fontSize: "0.8rem", color: "#b45309" }}>·</span>
          <span style={{ fontSize: "0.8rem", color: "#92400e" }}>
            {tiempoLabel}
          </span>
        </div>

        {/* Botón cerrar (oculta el panel, no cancela el lote) */}
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Ocultar panel de lote (el lote sigue en curso)"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#92400e",
            fontSize: "1.1rem",
            lineHeight: 1,
            padding: "2px 4px",
            borderRadius: 4,
            flexShrink: 0,
            opacity: 0.7,
          }}
        >
          ×
        </button>
      </div>

      {/* Fila 2: barra de progreso */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div
          role="progressbar"
          aria-valuenow={porcentaje}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progreso: ${porcentaje}%`}
          style={{
            flex: 1,
            height: 8,
            borderRadius: 4,
            background: colorBarraBg,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${porcentaje}%`,
              background: colorBarraFill,
              borderRadius: 4,
              transition: "width 0.5s ease",
              backgroundImage: esEnProgreso && porcentaje < 100
                ? "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)"
                : undefined,
              backgroundSize: "200% 100%",
              animation: esEnProgreso && porcentaje < 100 ? "shimmer 2s infinite" : undefined,
            }}
          />
        </div>
        <span style={{
          fontSize: "0.8rem",
          color: "#92400e",
          whiteSpace: "nowrap",
          fontWeight: 600,
          minWidth: 48,
          textAlign: "right",
        }}>
          {completados} / {total}
        </span>
      </div>

      {/* Fila 3: contadores + botón cancelar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 8,
      }}>
        {/* Contadores */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span style={{
            fontSize: "0.8rem",
            color: "#15803d",
            fontWeight: totales.procesados > 0 ? 600 : 400,
          }}>
            <span aria-hidden="true">✓ </span>
            {totales.procesados} procesado{totales.procesados !== 1 ? "s" : ""}
          </span>
          <span style={{
            fontSize: "0.8rem",
            color: totales.errores > 0 ? "#dc2626" : "#9ca3af",
            fontWeight: totales.errores > 0 ? 700 : 400,
          }}>
            <span aria-hidden="true">✗ </span>
            {totales.errores} error{totales.errores !== 1 ? "es" : ""}
          </span>
          <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
            <span aria-hidden="true">⏳ </span>
            {totales.pendientes} pendiente{totales.pendientes !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Botón cancelar (solo si está en progreso y el usuario puede cancelar) */}
        {esEnProgreso && puedeCancelar && (
          <button
            type="button"
            onClick={() => {
              if (!confirmando) {
                setConfirmando(true)
              } else {
                setConfirmando(false)
                onCancelar()
              }
            }}
            aria-label={
              confirmando
                ? "Confirmar cancelación del lote"
                : "Cancelar lote (requiere confirmación)"
            }
            style={{
              background: confirmando ? "#dc2626" : "#fee2e2",
              color: confirmando ? "#fff" : "#b91c1c",
              border: `1px solid ${confirmando ? "#dc2626" : "#fca5a5"}`,
              borderRadius: 6,
              padding: "5px 12px",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s, color 0.15s",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {confirmando ? "¿Confirmar cancelación?" : "Cancelar lote"}
          </button>
        )}
      </div>

      {/* FE-5.5: warnings de timeout — pill amarilla (lento) o banner rojo (colgado) */}
      {/* Se muestran solo cuando el lote está EN_PROGRESO y llevan más de 5 / 10 min sin cambios */}
      {nivelAlerta === "lento" && (
        <div
          role="status"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            borderRadius: 999,
            fontSize: 13,
            color: "#92400e",
            fontWeight: 500,
            marginTop: 8,
          }}
        >
          <span aria-hidden="true">⏱</span>
          Este lote tarda más de lo normal ({formatMinutos(tiempoSinProgreso)})
        </div>
      )}
      {nivelAlerta === "colgado" && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: 6,
            fontSize: 13,
            color: "#991b1b",
            fontWeight: 500,
            marginTop: 8,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
          <span>
            Este lote parece colgado ({formatMinutos(tiempoSinProgreso)} sin cambios).
            Verificá en NetSuite antes de cancelar o reintentar.
          </span>
        </div>
      )}
    </div>
  )
}
