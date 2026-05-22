"use client"

import type { DetalleEnvio } from "./types"

interface DetalleEnvioModalProps {
  abierto: boolean
  envio: DetalleEnvio | null
  cargando: boolean
  onCerrar: () => void
  // Opcional: solo disponible cuando estado === "ERROR" y el lote sigue EN_PROGRESO
  onReenviar?: () => void
}

// Stub FE-1 — retorna null cuando cerrado
// La visualización del detalle completo (OC, payload, reintentos) se implementa en FE-3
export default function DetalleEnvioModal({ abierto, onCerrar }: DetalleEnvioModalProps) {
  if (!abierto) return null

  return (
    <div role="dialog" aria-modal="true" aria-label="Detalle de envío">
      <p>Detalle de envío — placeholder FE-1</p>
      <button type="button" onClick={onCerrar}>
        Cerrar
      </button>
    </div>
  )
}
