"use client"

import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"

const TITLES: Record<string, string> = {
  "/":               "Inicio",
  "/cargas":         "Cargas",
  "/cargas/nueva":   "Nueva carga de fuente",
  "/conciliaciones": "Conciliaciones",
  "/gestiones":      "Gestiones",
  "/operadores":     "Operadores",
  "/fronteras":      "Fronteras",
  "/reportes":       "Reportes",
  "/administracion": "Administración",
}

function getTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname]
  for (const [path, title] of Object.entries(TITLES)) {
    if (path !== "/" && pathname.startsWith(path + "/")) return title
  }
  return "BIA Energy"
}

type Props = { userName?: string }

export function TopBar({ userName }: Props) {
  const pathname = usePathname()
  return (
    <header style={{
      height: "56px", borderBottom: "1px solid #e5e7eb",
      backgroundColor: "#ffffff", padding: "0 24px",
      display: "flex", alignItems: "center",
      justifyContent: "space-between", flexShrink: 0,
    }}>
      <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "#111827" }}>
        {getTitle(pathname)}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{userName ?? "Usuario"}</span>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          style={{
            fontSize: "0.8rem", color: "#6b7280", background: "none",
            border: "1px solid #e5e7eb", cursor: "pointer",
            padding: "4px 12px", borderRadius: "6px",
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  )
}
