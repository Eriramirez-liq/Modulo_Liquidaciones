import type { FilaFacturacion, ResultadoParser } from "@/lib/parsers/types"

// ─── Helpers internos ───────────────────────────────────────────────────────

function construirFindCol(columnas: string[]) {
  const lookup: Record<string, string> = {}
  for (const c of columnas) lookup[c.toLowerCase().replace(/[\s_]+/g, "")] = c
  return (...candidatos: string[]): string | null => {
    for (const cand of candidatos) {
      const key = cand.toLowerCase().replace(/[\s_]+/g, "")
      if (lookup[key]) return lookup[key]
    }
    return null
  }
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return isNaN(v) ? null : v
  const s = String(v).replace(/[^0-9.,\-]/g, "").trim()
  if (!s) return null
  const n = parseFloat(s.replace(/,/g, ""))
  return isNaN(n) ? null : n
}

/**
 * Deriva nivel_tension y propiedad_activos del codigo NT que viene en
 * la facturacion de BIA. Codigos validos:
 *   1, 11  → NT 1, Propiedad OR
 *   12     → NT 1, Propiedad Usuario
 *   13     → NT 1, Propiedad Compartido
 *   20     → NT 2, Propiedad Usuario
 *   30     → NT 3, Propiedad Usuario
 */
export function derivarNivelYPropiedad(
  ntRaw: string | null | undefined,
): { nivel: string | null; propiedad: string | null } {
  if (ntRaw == null) return { nivel: null, propiedad: null }
  const n = parseInt(String(ntRaw).trim(), 10)
  if (isNaN(n)) return { nivel: null, propiedad: null }
  if (n === 1 || n === 11) return { nivel: "1", propiedad: "OR" }
  if (n === 12)            return { nivel: "1", propiedad: "Usuario" }
  if (n === 13)            return { nivel: "1", propiedad: "Compartido" }
  if (n === 20)            return { nivel: "2", propiedad: "Usuario" }
  if (n === 30)            return { nivel: "3", propiedad: "Usuario" }
  return { nivel: null, propiedad: null }
}

/**
 * Normaliza un valor de la columna Period a "AAAA-MM".
 * Acepta MM-YYYY (formato Metabase), YYYY-MM, YYYY-MM-DD, etc.
 */
function normalizarPeriodo(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  // YYYY-MM o YYYY/MM
  let m = s.match(/^(\d{4})[-/](\d{1,2})/)
  if (m) return `${m[1]}-${(m[2] ?? "").padStart(2, "0")}`
  // MM-YYYY o MM/YYYY
  m = s.match(/^(\d{1,2})[-/](\d{4})/)
  if (m) return `${m[2]}-${(m[1] ?? "").padStart(2, "0")}`
  return null
}

// ─── Mapeador principal ─────────────────────────────────────────────────────

/**
 * Mapea las filas que devuelve la query de Metabase (con columnas como SIC,
 * Active Energy, NT, etc.) al shape FilaFacturacion que persiste el sistema.
 *
 * No filtra por periodo — eso lo hace el route handler antes de llamar aqui.
 */
export function mapearFilasMetabase(
  rows: Record<string, unknown>[],
  columnas: string[],
): ResultadoParser<FilaFacturacion> {
  const alertas: string[]         = []
  const erroresCriticos: string[] = []
  const filas: FilaFacturacion[]  = []

  if (rows.length === 0) {
    return { filas, alertas, erroresCriticos }
  }

  const findCol = construirFindCol(columnas)

  // Columnas requeridas
  const colSic      = findCol("SIC", "codigo_sic", "codigo_frontera", "frontera")
  const colPeriod   = findCol("Period", "periodo")
  const colEnergia  = findCol("Active Energy", "active_energy", "energia_activa", "energia_kwh")
  const colNT       = findCol("NT", "nivel_tension")
  const colReactInd = findCol("Reactive Inductive Pen", "reactive_inductive_pen", "energia_reactiva_ind")
  const colReactCap = findCol("Reactive Capacitive Pen", "reactive_capacitive_pen", "energia_reactiva_cap")
  const colFactor   = findCol("Factor", "factor_m")

  // Columnas opcionales (para conciliacion balance)
  const colNombre   = findCol("Cliente", "Client", "Nombre", "Usuario", "nombre_usuario")
  const colOR       = findCol("Operador", "OR", "operador_red")
  const colG        = findCol("G", "Tarifa G", "g_bia")
  const colT        = findCol("T", "Tarifa T", "t_bia")
  const colD        = findCol("D", "Tarifa D", "d_bia")
  const colPR       = findCol("PR", "Tarifa PR", "pr_bia")
  const colR        = findCol("R", "Tarifa R", "r_bia")
  const colC        = findCol("C", "Tarifa C", "c_bia")
  const colTarTotal = findCol("Tarifa Total", "tarifa_total_bia", "tarifa_total")

  // Validar columnas requeridas
  const faltantes: string[] = []
  if (!colSic)      faltantes.push("SIC")
  if (!colPeriod)   faltantes.push("Period")
  if (!colEnergia)  faltantes.push("Active Energy")
  if (!colNT)       faltantes.push("NT")
  if (!colReactInd) faltantes.push("Reactive Inductive Pen")
  if (!colReactCap) faltantes.push("Reactive Capacitive Pen")
  if (!colFactor)   faltantes.push("Factor")

  if (faltantes.length > 0) {
    erroresCriticos.push(
      `Columnas requeridas no encontradas en Metabase: ${faltantes.join(", ")}. ` +
      `Columnas disponibles: [${columnas.join(", ")}]`,
    )
    return { filas, alertas, erroresCriticos }
  }

  // Mapear cada fila
  let ntNoReconocido = 0
  for (const r of rows) {
    const codigo = String(r[colSic!] ?? "").trim()
    if (!codigo) continue

    const periodo = normalizarPeriodo(r[colPeriod!])
    if (!periodo) continue

    const ntRaw = String(r[colNT!] ?? "").trim() || null
    const { nivel, propiedad } = derivarNivelYPropiedad(ntRaw)
    if (ntRaw && !nivel) ntNoReconocido++

    filas.push({
      codigo_frontera:          codigo,
      periodo,
      nombre_usuario:           colNombre ? (String(r[colNombre] ?? "").trim() || null) : null,
      operador_red:             colOR     ? (String(r[colOR]     ?? "").trim() || null) : null,
      energia_kwh:              toNum(r[colEnergia!]) ?? 0,
      nt_raw:                   ntRaw,
      nivel_tension:            nivel,
      propiedad_activos:        propiedad,
      energia_reactiva_ind_pen: toNum(r[colReactInd!]),
      energia_reactiva_cap_pen: toNum(r[colReactCap!]),
      factor_m:                 toNum(r[colFactor!]),
      g_bia:            colG        ? toNum(r[colG])        : null,
      t_bia:            colT        ? toNum(r[colT])        : null,
      d_bia:            colD        ? toNum(r[colD])        : null,
      pr_bia:           colPR       ? toNum(r[colPR])       : null,
      r_bia:            colR        ? toNum(r[colR])        : null,
      c_bia:            colC        ? toNum(r[colC])        : null,
      tarifa_total_bia: colTarTotal ? toNum(r[colTarTotal]) : null,
    })
  }

  if (ntNoReconocido > 0) {
    alertas.push(
      `${ntNoReconocido} filas tienen un codigo NT no reconocido (esperados: 1, 11, 12, 13, 20, 30). ` +
      "Esas filas quedan sin nivel_tension ni propiedad_activos.",
    )
  }

  return { filas, alertas, erroresCriticos }
}
