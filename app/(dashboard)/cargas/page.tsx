import Link from "next/link"
import { Upload } from "lucide-react"
import { PanelEstadoPeriodo } from "@/components/cargas/PanelEstadoPeriodo"
import { TablaHistorial } from "@/components/cargas/TablaHistorial"

export default function CargasPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--bia-text-primary)",
              letterSpacing: "-0.02em",
              margin: "0 0 4px",
            }}
          >
            Carga de fuentes
          </h1>
          <p style={{ fontSize: "0.875rem", color: "var(--bia-text-muted)", margin: 0 }}>
            Gestiona la carga de archivos de Facturación, XM, SDL y Balance por período
          </p>
        </div>
        <Link href="/cargas/nueva" className="bia-btn-primary" style={{ textDecoration: "none", flexShrink: 0 }}>
          <Upload size={16} />
          Nueva carga
        </Link>
      </div>

      {/* Panel de estado por período */}
      <PanelEstadoPeriodo />

      {/* Historial */}
      <TablaHistorial />
    </div>
  )
}
