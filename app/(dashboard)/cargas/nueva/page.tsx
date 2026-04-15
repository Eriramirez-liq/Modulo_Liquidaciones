import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { WizardCarga } from "@/components/cargas/WizardCarga"

export default function NuevaCargaPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 820 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href="/cargas"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: "0.82rem",
            color: "var(--bia-text-muted)",
            textDecoration: "none",
          }}
        >
          <ChevronLeft size={14} />
          Cargas
        </Link>
        <span style={{ color: "var(--bia-text-muted)", fontSize: "0.82rem" }}>/</span>
        <span style={{ fontSize: "0.82rem", color: "var(--bia-text-secondary)", fontWeight: 500 }}>
          Nueva carga
        </span>
      </div>

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
          Nueva carga de fuente
        </h1>
        <p style={{ fontSize: "0.875rem", color: "var(--bia-text-muted)", margin: 0 }}>
          Selecciona el período, tipo de fuente y sube el archivo para procesarlo
        </p>
      </div>

      <WizardCarga />
    </div>
  )
}
