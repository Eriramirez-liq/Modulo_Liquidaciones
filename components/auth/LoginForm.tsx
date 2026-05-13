"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

const ALLOWED_DOMAIN = "@bia.app"

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Correo o contraseña incorrectos.",
  AccessDenied:      "Acceso denegado. Solo se permiten cuentas @bia.app.",
  Default:           "Ocurrió un error al iniciar sesión. Intentá de nuevo.",
}

export function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const errorCode    = searchParams.get("error")

  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [loading,  setLoading]  = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const serverError = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default)
    : null

  const error = localError ?? serverError

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)

    // Validación de dominio en frontend
    if (!email.toLowerCase().trim().endsWith(ALLOWED_DOMAIN)) {
      setLocalError(`Solo se permiten cuentas ${ALLOWED_DOMAIN}.`)
      return
    }

    setLoading(true)
    const result = await signIn("credentials", {
      email:    email.toLowerCase().trim(),
      password,
      redirect: false,
    })
    setLoading(false)

    if (result?.ok) {
      router.push("/")
      router.refresh()
    } else {
      setLocalError(ERROR_MESSAGES.CredentialsSignin ?? "Error al ingresar.")
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-tight">BIA Conciliación</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acceso restringido a cuentas{" "}
            <span className="font-medium text-foreground">@bia.app</span>
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="nombre@bia.app"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  )
}
