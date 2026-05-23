"use client"

import { useEffect } from "react"

export interface ToastData {
  tipo: "ok" | "warning" | "error"
  mensaje: string
}

interface ToastProps {
  toast: ToastData | null
  onClose: () => void
}

const COLORES: Record<ToastData["tipo"], { bg: string; border: string; color: string; icono: string }> = {
  ok: {
    bg: "#f0fdf4",
    border: "#86efac",
    color: "#166534",
    icono: "✓",
  },
  warning: {
    bg: "#fffbeb",
    border: "#fcd34d",
    color: "#92400e",
    icono: "⚠",
  },
  error: {
    bg: "#fef2f2",
    border: "#fca5a5",
    color: "#b91c1c",
    icono: "✗",
  },
}

export default function Toast({ toast, onClose }: ToastProps) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [toast, onClose])

  if (!toast) return null

  const estilo = COLORES[toast.tipo]

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 100,
        background: estilo.bg,
        border: `1px solid ${estilo.border}`,
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
        maxWidth: 360,
        animation: "fadeInUp 0.2s ease",
      }}
    >
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <span
        style={{
          fontWeight: 700,
          fontSize: "1rem",
          color: estilo.color,
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {estilo.icono}
      </span>
      <span
        style={{
          fontSize: "0.875rem",
          color: estilo.color,
          lineHeight: 1.4,
        }}
      >
        {toast.mensaje}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar notificación"
        style={{
          marginLeft: "auto",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: estilo.color,
          fontSize: "1rem",
          padding: "0 0 0 8px",
          opacity: 0.7,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}
