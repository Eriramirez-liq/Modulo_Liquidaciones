import { TablaHistorial } from "@/components/cargas/TablaHistorial"
import { PanelEstadoPeriodo } from "@/components/cargas/PanelEstadoPeriodo"

export default function CargasPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PanelEstadoPeriodo />
      <TablaHistorial />
    </div>
  )
}
