type TopBarProps = {
  userName?: string
  userRol?: string
}

export function TopBar({ userName, userRol }: TopBarProps) {
  return (
    <header className="border-b border-border bg-background px-6 py-3">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-muted-foreground">Panel de control</h1>
        <p className="text-sm text-muted-foreground">
          {userName ?? "Usuario"} - {userRol ?? "Rol"}
        </p>
      </div>
    </header>
  )
}
