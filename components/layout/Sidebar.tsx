import Link from "next/link"

type SidebarProps = {
  userRol?: string
  userName?: string
}

const links = [
  { href: "/", label: "Inicio" },
  { href: "/cargas", label: "Cargas" },
  { href: "/conciliaciones", label: "Conciliaciones" },
  { href: "/fronteras", label: "Fronteras" },
  { href: "/reportes", label: "Reportes" },
  { href: "/administracion", label: "Administración" },
]

export function Sidebar({ userRol, userName }: SidebarProps) {
  return (
    <aside className="w-64 border-r border-border bg-background p-4">
      <div className="mb-6">
        <p className="text-sm font-semibold">BIA Conciliación</p>
        <p className="text-xs text-muted-foreground">{userName ?? "Usuario"}</p>
        <p className="text-xs text-muted-foreground">{userRol ?? "Sin rol"}</p>
      </div>
      <nav className="flex flex-col gap-2">
        {links.map((item) => (
          <Link key={item.href} href={item.href} className="rounded px-2 py-1 text-sm hover:bg-muted">
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
