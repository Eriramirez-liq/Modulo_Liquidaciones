import Link from "next/link"
import { TablaHistorial } from "@/components/cargas/TablaHistorial"
import { PanelEstadoPeriodo } from "@/components/cargas/PanelEstadoPeriodo"

export default function CargasPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Cargas de fuentes</h1>
        <Link
          href="/cargas/nueva"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Nueva carga
        </Link>
      </div>
      <PanelEstadoPeriodo />
      <TablaHistorial />
    </div>
  )
}
