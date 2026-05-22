"use client"

import type { CargoSeleccionado } from "./types"

interface ModalConfirmarLoteProps {
  abierto: boolean
  cargos: CargoSeleccionado[]
  enviando: boolean
  error: string | null
  onConfirmar: () => void
  onCancelar: () => void
}

// Stub FE-1 — retorna null cuando cerrado, placeholder mínimo cuando abierto
// La implementación real (lista de cargos, totales, estados) se hace en FE-4
export default function ModalConfirmarLote({
  abierto,
  onConfirmar,
  onCancelar,
}: ModalConfirmarLoteProps) {
  if (!abierto) return null

  return (
    <div role="dialog" aria-modal="true" aria-label="Confirmar creación de lote OC">
      <p>Confirmar lote — placeholder FE-1</p>
      <button type="button" onClick={onConfirmar}>
        Confirmar
      </button>
      <button type="button" onClick={onCancelar}>
        Cancelar
      </button>
    </div>
  )
}
