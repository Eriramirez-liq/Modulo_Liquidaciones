import * as XLSX from "xlsx"
import { FilaXM, ResultadoParser } from "@/lib/parsers/types"

// ─── Helpers de normalización y resolución de columnas ──────────────────────

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
}

function resolveCol(headers: string[], candidates: string[]): number {
  for (const cand of candidates) {
    const candN = norm(cand)
    // 1. Match exacto (case- y acento-insensible)
    for (let i = 0; i < headers.length; i++) {
      if (norm(headers[i] ?? "") === candN) return i
    }
    // 2. Match por substring (header contiene el candidato)
    for (let i = 0; i < headers.length; i++) {
      if (norm(headers[i] ?? "").includes(candN)) return i
    }
  }
  return -1
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return isNaN(v) ? null : v
  const s = String(v).replace(/[^0-9.,\-]/g, "").trim()
  if (!s) return null
  const n = parseFloat(s.replace(/,/g, ""))
  return isNaN(n) ? null : n
}

// Convierte un serial de Excel (días desde 1899-12-30) a Date UTC.
// No depende de XLSX.SSF (que a veces no está disponible en runtime).
function excelSerialToDate(serial: number): Date | null {
  if (typeof serial !== "number" || !isFinite(serial)) return null
  // Excel "epoch": 1899-12-30 (compensa el bug del año bisiesto 1900)
  const epochMs = Date.UTC(1899, 11, 30)
  const d = new Date(epochMs + serial * 86400 * 1000)
  return isNaN(d.getTime()) ? null : d
}

// Convierte el valor de la columna FECHA a "AAAA-MM".
// Acepta: serial de Excel (número), ISO yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy.
function fechaAPeriodo(v: unknown): string | null {
  if (v == null || v === "") return null

  // Serial de Excel
  if (typeof v === "number") {
    const d = excelSerialToDate(v)
    if (d) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    }
  }

  const s = String(v).trim()
  if (!s) return null

  // ISO: 2026-04-15 o 2026/04/15
  let m = s.match(/^(\d{4})[-/](\d{1,2})/)
  if (m) return `${m[1]}-${(m[2] ?? "").padStart(2, "0")}`

  // dd/mm/yyyy o dd-mm-yyyy
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (m) return `${m[3]}-${(m[2] ?? "").padStart(2, "0")}`

  // Último recurso: parser nativo
  const d = new Date(s)
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  }
  return null
}

// ─── Parser principal ──────────────────────────────────────────────────────

/**
 * Parser del Reporte CGM/XM.
 *
 * Mapeo de columnas del archivo:
 *   - "CODIGO SIC"   → SIC
 *   - "DESCRIPTION"  → Nombre
 *   - "FECHA"        → Periodo (derivado: AAAA-MM)
 *   - "Total"        → Activa XM (sumado por frontera+período)
 *
 * Lógica:
 *   El archivo trae registros por día. Agregamos sumando "Total" por
 *   (CODIGO SIC, AAAA-MM) y devolvemos una fila consolidada por frontera.
 */
export async function parsearXM(
  buffer: Buffer,
  _periodoId: string | null,
  anio: number,
  mes: number
): Promise<ResultadoParser<FilaXM>> {
  void _periodoId
  try {
    return await parsearXMInternal(buffer, anio, mes)
  } catch (e) {
    // Cualquier error inesperado se devuelve como erroreCritico para que la
    // API responda JSON limpio en vez de un 500 que el wizard ve como "error de red".
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)
    return {
      filas: [],
      alertas: [],
      erroresCriticos: [`Error inesperado en el parser XM: ${msg}`],
    }
  }
}

async function parsearXMInternal(
  buffer: Buffer,
  anio: number,
  mes: number,
): Promise<ResultadoParser<FilaXM>> {
  const alertas: string[]         = []
  const erroresCriticos: string[] = []

  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false })
  } catch (e) {
    erroresCriticos.push(`No se pudo leer el archivo: ${e}`)
    return { filas: [], alertas, erroresCriticos }
  }

  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    erroresCriticos.push("El archivo no tiene hojas.")
    return { filas: [], alertas, erroresCriticos }
  }
  const ws = wb.Sheets[sheetName]
  if (!ws) {
    erroresCriticos.push("No se pudo abrir la hoja principal.")
    return { filas: [], alertas, erroresCriticos }
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
  }) as (string | number)[][]

  if (matrix.length === 0) {
    erroresCriticos.push("El archivo está vacío.")
    return { filas: [], alertas, erroresCriticos }
  }

  // Auto-detectar fila de header: primera fila (de las primeras 15) que
  // contenga alguna de las palabras clave esperadas.
  const HEADER_KEYS = ["CODIGO SIC", "DESCRIPTION", "FECHA", "TOTAL"]
  let headerRowIdx = -1
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const rowText = (matrix[i] ?? []).map(v => norm(String(v ?? ""))).join("|")
    if (HEADER_KEYS.some(k => rowText.includes(k))) {
      headerRowIdx = i
      break
    }
  }
  if (headerRowIdx < 0) headerRowIdx = 0

  const headers = (matrix[headerRowIdx] ?? []).map(h => String(h ?? "").trim())
  const colSic    = resolveCol(headers, ["CODIGO SIC", "CODIGO_SIC", "SIC"])
  const colNombre = resolveCol(headers, ["DESCRIPTION", "DESCRIPCION", "NOMBRE"])
  const colFecha  = resolveCol(headers, ["FECHA", "DATE", "PERIODO"])
  const colTotal  = resolveCol(headers, ["TOTAL", "ACTIVA"])

  const headersDisp = headers.map(h => `"${h}"`).join(", ")
  if (colSic    < 0) erroresCriticos.push(`Columna "CODIGO SIC" no encontrada. Disponibles: [${headersDisp}]`)
  if (colNombre < 0) erroresCriticos.push(`Columna "DESCRIPTION" no encontrada. Disponibles: [${headersDisp}]`)
  if (colFecha  < 0) erroresCriticos.push(`Columna "FECHA" no encontrada. Disponibles: [${headersDisp}]`)
  if (colTotal  < 0) erroresCriticos.push(`Columna "Total" no encontrada. Disponibles: [${headersDisp}]`)
  if (erroresCriticos.length > 0) return { filas: [], alertas, erroresCriticos }

  // Agregar por (codigo_frontera, periodo)
  type Agg = { SIC: string; Nombre: string | null; Periodo: string; suma: number }
  const map = new Map<string, Agg>()
  let filasOmitidas = 0

  for (let i = headerRowIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? []
    const sic = String(row[colSic] ?? "").trim()
    if (!sic) continue

    const nombreRaw = String(row[colNombre] ?? "").trim()
    const periodo   = fechaAPeriodo(row[colFecha])
    if (!periodo) { filasOmitidas++; continue }

    const total = toNum(row[colTotal])
    if (total == null) { filasOmitidas++; continue }

    const key = `${sic}|${periodo}`
    const existing = map.get(key)
    if (existing) {
      existing.suma += total
    } else {
      map.set(key, {
        SIC:     sic,
        Nombre:  nombreRaw || null,
        Periodo: periodo,
        suma:    total,
      })
    }
  }

  if (filasOmitidas > 0) {
    alertas.push(`${filasOmitidas} filas omitidas por FECHA o Total inválidos.`)
  }

  // Validar que la FECHA del archivo coincida con el período del wizard
  const periodoWizard = `${anio}-${String(mes).padStart(2, "0")}`
  const periodosEnArchivo = new Set(Array.from(map.values()).map(a => a.Periodo))
  if (periodosEnArchivo.size === 1 && !periodosEnArchivo.has(periodoWizard)) {
    const unico = Array.from(periodosEnArchivo)[0]
    alertas.push(
      `El archivo cubre el período ${unico} pero se está cargando en ${periodoWizard}.`,
    )
  } else if (periodosEnArchivo.size > 1) {
    alertas.push(
      `El archivo contiene ${periodosEnArchivo.size} períodos distintos. ` +
      "Cada (frontera, período) se totaliza por separado.",
    )
  }

  const filas: FilaXM[] = Array.from(map.values())
    .sort((a, b) => a.SIC.localeCompare(b.SIC))
    .map(a => ({
      SIC:         a.SIC,
      Nombre:      a.Nombre,
      Periodo:     a.Periodo,
      "Activa XM": a.suma,
    }))

  if (filas.length === 0 && erroresCriticos.length === 0) {
    alertas.push("No se generaron filas — revisar columnas FECHA y Total.")
  }

  return { filas, alertas, erroresCriticos }
}
