"use client"

import Link from "next/link"

export function LoginForm() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded border border-border bg-card p-6">
      <h1 className="mb-2 text-xl font-semibold">Ingreso</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Entorno local activo. Puedes continuar al panel para probar los flujos.
      </p>
      <Link
        href="/"
        className="inline-flex rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Continuar al panel
      </Link>
    </div>
  )
}
