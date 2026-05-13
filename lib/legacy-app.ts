export function legacyAppUrl(path: string): string {
  const base = process.env.FLASK_APP_URL ?? "http://localhost:5001"
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}
