"use client"

import type { EstadoEnvioKey, EstadoEnvioUI } from "./types"
import { CeldaMonto } from "./CeldaMonto"

interface FilaOperadorProps {
  // Identidad del operador
  operador: { codigo: string; nombre: string }

  // Períodos visibles en la tabla (columnas)
  periodos: { id: string; mes_consumo: string; mes_facturacion: string }[]

  // Monto por periodoId
  valoresPorPeriodo: Record<string, number>

  // Suma total de todos los períodos visibles
  total: number

  // Mapa de estados de envío indexado por "${periodoId}|${orCodigo}"
  estadosEnvio: Record<EstadoEnvioKey, EstadoEnvioUI>

  // Selección (solo activa cuando hay un único período de facturación filtrado)
  seleccionado: boolean
  onToggleSeleccion: (orCodigo: string) => void
  onClickCeldaConEnvio: (envioId: string) => void

  // Cuando hay >1 período filtrado los checkboxes se deshabilitan
  modoSeleccion: boolean

  // Mostrar columna de total (true cuando hay >1 período)
  mostrarTotal: boolean
}

// Helper local de formato de moneda
function formatCurrency(v: number): string {
  return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}

export function FilaOperador({
  operador,
  periodos,
  valoresPorPeriodo,
  total,
  estadosEnvio,
  seleccionado,
  onToggleSeleccion,
  onClickCeldaConEnvio,
  modoSeleccion,
  mostrarTotal,
}: FilaOperadorProps) {
  const tdBase: React.CSSProperties = {
    padding: "8px 12px",
    fontSize: 14,
    border: "1px solid #e5e7eb",
    verticalAlign: "middle",
  }

  return (
    <tr
      style={{
        background: seleccionado ? "#f0fdf4" : undefined,
      }}
    >
      {/* Columna operador: checkbox (en modoSeleccion) + nombre */}
      <td style={{ ...tdBase, fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {modoSeleccion && (
            <input
              type="checkbox"
              checked={seleccionado}
              onChange={() => onToggleSeleccion(operador.codigo)}
              style={{
                width: 15,
                height: 15,
                accentColor: "#07c5a8",
                cursor: "pointer",
                flexShrink: 0,
              }}
              aria-label={`Seleccionar ${operador.nombre}`}
            />
          )}
          <span>{operador.nombre}</span>
        </div>
      </td>

      {/* Celdas de monto por período */}
      {periodos.map(periodo => {
        const key: EstadoEnvioKey = `${periodo.id}|${operador.codigo}`
        const estadoEnvio = estadosEnvio[key] ?? null
        const monto = valoresPorPeriodo[periodo.id] ?? 0

        // Solo PROCESADO y ERROR abren el DetalleEnvioModal.
        // PENDIENTE y PROCESANDO no tienen detalle útil que mostrar.
        const puedeAbrirDetalle =
          estadoEnvio?.estado === "PROCESADO" || estadoEnvio?.estado === "ERROR"

        return (
          <CeldaMonto
            key={periodo.id}
            periodoId={periodo.id}
            orCodigo={operador.codigo}
            monto={monto}
            estadoEnvio={estadoEnvio}
            onClick={
              puedeAbrirDetalle
                ? () => onClickCeldaConEnvio(estadoEnvio.ultimoEnvioId)
                : undefined
            }
          />
        )
      })}

      {/* Columna total (solo cuando hay >1 período) */}
      {mostrarTotal && (
        <td
          style={{
            ...tdBase,
            textAlign: "right",
            fontFamily: "monospace",
            fontWeight: 600,
            color: "#374151",
          }}
        >
          {formatCurrency(total)}
        </td>
      )}
    </tr>
  )
}

export default FilaOperador
