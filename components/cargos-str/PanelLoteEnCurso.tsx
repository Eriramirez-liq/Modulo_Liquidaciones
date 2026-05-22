"use client"

import type { LoteEnCursoUI } from "./types"

interface PanelLoteEnCursoProps {
  lote: LoteEnCursoUI
  puedeCancelar: boolean
  onCancelar: () => void
  onVerDetalle: () => void
  onCerrar: () => void
}

// Stub FE-1 — placeholder sin estilos ni lógica de polling
// La barra de progreso y el polling en tiempo real se implementan en FE-5
export default function PanelLoteEnCurso(_props: PanelLoteEnCursoProps): null {
  return null
}
