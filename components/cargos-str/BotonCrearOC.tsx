"use client"

interface BotonCrearOCProps {
  cantidad: number
  disabled: boolean
  onAbrir: () => void
}

export function BotonCrearOC({ cantidad, disabled, onAbrir }: BotonCrearOCProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onAbrir}
      aria-label="Crear orden de compra para los cargos seleccionados"
      style={{
        background: disabled ? "#07c5a8" : "#07c5a8",
        color: "#ffffff",
        border: "none",
        borderRadius: 6,
        padding: "10px 18px",
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s ease",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={e => {
        if (!disabled) {
          ;(e.currentTarget as HTMLButtonElement).style.background = "#06b39a"
        }
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLButtonElement).style.background = "#07c5a8"
      }}
    >
      {cantidad > 0 ? `Crear OC (${cantidad})` : "Crear OC"}
    </button>
  )
}

export default BotonCrearOC
