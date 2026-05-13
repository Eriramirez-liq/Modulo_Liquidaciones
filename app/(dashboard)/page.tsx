import { auth } from "@/lib/auth"
import { Zap, GitMerge, Globe, BarChart3 } from "lucide-react"

export default async function InicioPage() {
  const session = await auth()

  const stats = [
    { label: "Conciliaciones del mes", value: "—", accent: false },
    { label: "Fronteras activas", value: "—", accent: false },
    { label: "Diferencias pendientes", value: "—", accent: true },
    { label: "Provisiones abiertas", value: "—", accent: false },
  ]

  const accesos = [
    { label: "Conciliaciones", desc: "Gestionar períodos y resultados", icon: GitMerge, href: "/conciliaciones" },
    { label: "Fronteras", desc: "Configurar fronteras de medición", icon: Globe, href: "/fronteras" },
    { label: "Reportes", desc: "Exportar y visualizar informes", icon: BarChart3, href: "/reportes" },
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Bienvenida */}
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
          Bienvenido, {session?.user.nombre.split(" ")[0]}
        </h1>
        <p style={{ fontSize: "0.875rem", color: "var(--bia-text-muted)", margin: 0 }}>
          Sistema de conciliación de energía eléctrica por frontera
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
        {stats.map((stat) => (
          <div key={stat.label} className="bia-stat-card">
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--bia-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {stat.label}
            </span>
            <span
              style={{
                fontSize: "1.4rem",
                fontWeight: 700,
                color: stat.accent ? "var(--bia-accent)" : "var(--bia-text-primary)",
              }}
            >
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      {/* Accesos rápidos */}
      <div>
        <h2
          style={{
            fontSize: "1rem",
            fontWeight: 600,
            color: "var(--bia-text-primary)",
            letterSpacing: "-0.02em",
            margin: "0 0 16px",
          }}
        >
          Accesos rápidos
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
          {accesos.map((item) => {
            const Icon = item.icon
            return (
              <a
                key={item.href}
                href={item.href}
                className="bia-card"
                style={{
                  textDecoration: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: "var(--bia-accent-dim)",
                    border: "1px solid var(--bia-accent-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon size={18} color="var(--bia-accent)" />
                </div>
                <div>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: "0.875rem",
                      color: "var(--bia-text-primary)",
                      marginBottom: 2,
                    }}
                  >
                    {item.label}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--bia-text-muted)" }}>
                    {item.desc}
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      </div>

      {/* Banner de entorno */}
      <div
        style={{
          background: "#141414",
          border: "1px solid #2E2E2E",
          borderRadius: 10,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Zap size={16} color="#2DFFC2" />
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "#2DFFC2" }}>
              Entorno local operativo
            </div>
            <div style={{ fontSize: "0.8rem", color: "#999" }}>
              Los modulos de carga y conciliacion se ejecutan en el backend Flask local
            </div>
          </div>
        </div>
        <span
          style={{
            background: "#1E1E1E",
            border: "1px solid #2E2E2E",
            color: "#2DFFC2",
            borderRadius: 6,
            padding: "5px 12px",
            fontWeight: 600,
            fontSize: "0.78rem",
          }}
        >
          v0.1.0
        </span>
      </div>
    </div>
  )
}
