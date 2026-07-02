"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

type NavItem = { href: string; label: string; icon: string }

const NAV_ITEMS: NavItem[] = [
  { href: "/",               label: "Inicio",         icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/cargas",         label: "Cargas",         icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" },
  { href: "/conciliaciones", label: "Conciliaciones", icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { href: "/tarifas-sdl",    label: "Tarifas SDL",    icon: "M9 7h6m-6 4h6m-3 4h3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" },
  { href: "/cargos-str",     label: "Cargos STR",     icon: "M9 7h6m-6 4h6m-6 4h6M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" },
  { href: "/gestiones",      label: "Gestiones",      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { href: "/proyeccion-cargos-or", label: "Proyección Cargos OR", icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" },
  { href: "/reportes",       label: "Reportes",       icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
]

const ADMIN_ICON =
  "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"

function initials(nombre: string): string {
  const parts = nombre.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0]?.[0] ?? "U").toUpperCase()
  return (parts[0]?.[0] ?? "").toUpperCase() + (parts[parts.length - 1]?.[0] ?? "").toUpperCase()
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(href + "/")
}

type Props = { userRol?: string; userName?: string }

export function Sidebar({ userRol, userName }: Props) {
  const pathname = usePathname()
  const name = userName ?? "Usuario"
  const rol  = userRol  ?? "ANALISTA"
  const accent = "#07c5a8"

  return (
    <aside style={{
      width: "240px", minWidth: "240px", height: "100vh",
      display: "flex", flexDirection: "column",
      backgroundColor: "#ffffff", borderRight: "1px solid #e5e7eb",
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 16px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{
          width: "32px", height: "32px", borderRadius: "8px",
          backgroundColor: accent, display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0,
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="#050f0d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <div style={{ lineHeight: "1.2" }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#111827" }}>BIA Energy</div>
          <div style={{ fontSize: "0.72rem", color: "#6b7280" }}>Módulo de Liquidaciones</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "0 8px", overflowY: "auto" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          {NAV_ITEMS.map(({ href, label, icon }) => {
            const active = isActive(pathname, href)
            return (
              <li key={href}>
                <Link href={href} style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "8px 10px", borderRadius: "7px",
                  fontSize: "0.875rem", fontWeight: active ? 600 : 400,
                  color: active ? "#ffffff" : "#374151",
                  backgroundColor: active ? accent : "transparent",
                  textDecoration: "none",
                }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                       fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d={icon}/>
                  </svg>
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>

        {rol === "ADMINISTRADOR" && (
          <>
            <div style={{
              fontSize: "0.68rem", fontWeight: 600, color: "#9ca3af",
              textTransform: "uppercase", letterSpacing: "0.08em",
              padding: "14px 10px 6px",
            }}>
              Sistema
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              <li>
                {(() => {
                  const active = isActive(pathname, "/administracion")
                  return (
                    <Link href="/administracion" style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "8px 10px", borderRadius: "7px",
                      fontSize: "0.875rem", fontWeight: active ? 600 : 400,
                      color: active ? "#ffffff" : "#374151",
                      backgroundColor: active ? accent : "transparent",
                      textDecoration: "none",
                    }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                           fill="none" stroke="currentColor" strokeWidth="2"
                           strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d={ADMIN_ICON}/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                      Administración
                    </Link>
                  )
                })()}
              </li>
            </ul>
          </>
        )}
      </nav>

      <hr style={{ margin: "0 16px", border: "none", borderTop: "1px solid #e5e7eb" }}/>

      {/* User */}
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{
          width: "32px", height: "32px", borderRadius: "50%",
          backgroundColor: accent, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: "0.75rem", fontWeight: 700,
          color: "#050f0d", flexShrink: 0,
        }}>
          {initials(name)}
        </div>
        <div style={{ overflow: "hidden" }}>
          <div style={{
            fontSize: "0.8rem", fontWeight: 600, color: "#111827",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {name}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6b7280" }}>
            {rol === "ADMINISTRADOR" ? "Administrador" : "Analista"}
          </div>
        </div>
      </div>
    </aside>
  )
}
