import * as XLSX from "xlsx"
import { ResultadoParser } from "@/lib/parsers/types"

export type FilaSTR = {
  or_codigo:    string                  // Código del operador (AFINIA, AIRE, …)
  mes_consumo:  string                  // "AAAA-MM"
  valor_cop:    number
  archivo:      string                  // Nombre del archivo de origen
  tipo:         "FACTURA" | "REFACTURA"
  detalle?:     Record<string, unknown>
}

// ─── Homologación de códigos de columna → código de operador ────────────────
// Las columnas de los archivos BalSTR contienen códigos como "CMMD", "CSID"…
// Mapeamos a los códigos de configuracion_or (whitelist STR).
const HOMOLOGACION: Record<string, string> = {
  CMMD: "AFINIA",
  CSID: "AIRE",
  CSSD: "AIRE",            // mismo OR (se suman ambas columnas)
  ENID: "ENELAR",
  CHCD: "CHEC",
  CDND: "CEDENAR",
  CNSD: "CENS",
  ESSD: "ESSA",
  CQTD: "ELECTROCAQUETA",
  HLAD: "ELECTROHUILA",
  EMSD: "EMSA",
  EBSD: "EBSA",
  CASD: "ENERCA",
  EEPD: "EEP_PEREIRA",
  EBPD: "BAJO_PUTUMAYO",
  EPSD: "CELSIA_VALLE",
  EPTD: "PUTUMAYO",
  EDQD: "EDEQ",
  EGVD: "ENERGUAVIARE",
  EDPD: "DISPAC",
  EPMD: "EPM",
  EMID: "EMCALI",
  CEOD: "CEO",
  ENDD: "ENEL",
}

// ─── Diccionario mes en nombre → número (1-12) ─────────────────────────────
// Las claves más largas van primero para que "enero" no quede capturado por "ene".
const MES_MAP: Array<[string, number]> = [
  ["enero", 1], ["ene", 1],
  ["febrero", 2], ["feb", 2],
  ["marzo", 3], ["mar", 3],
  ["abril", 4], ["abr", 4],
  ["mayo", 5], ["may", 5],
  ["junio", 6], ["jun", 6],
  ["julio", 7], ["jul", 7],
  ["agosto", 8], ["ago", 8],
  ["septiembre", 9], ["sep", 9],
  ["octubre", 10], ["oct", 10],
  ["noviembre", 11], ["nov", 11],
  ["diciembre", 12], ["dic", 12],
]

function detectarMesConsumo(nombreArchivo: string): number | null {
  const lower = nombreArchivo.toLowerCase()
  for (const [key, num] of MES_MAP) {
    if (lower.includes(`-${key}`) || lower.includes(`_${key}`)) return num
  }
  return null
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return isNaN(v) ? null : v
  const s = String(v).replace(/[^0-9.,\-]/g, "").trim()
  if (!s) return null
  // Quitar comas como separador de miles
  const n = parseFloat(s.replace(/,/g, ""))
  return isNaN(n) ? null : n
}

// Auto-detecta la fila del header eligiendo aquella con la MAYOR cantidad
// de celdas individuales que contienen códigos de operador.
//
// Esto evita el falso positivo donde una fila descriptiva con todos los
// códigos en una sola celda (ej. "Reporte ... CMMD CSID CSSD") era elegida
// en vez del header real donde cada código está en una celda separada.
function detectarFilaHeader(matrix: (string | number)[][]): number {
  const codigos = Object.keys(HOMOLOGACION)
  const maxScan = Math.min(matrix.length, 20)
  let best = 6  // default: equivalente a Python header=6
  let bestScore = 0
  for (let i = 0; i < maxScan; i++) {
    const row = matrix[i] ?? []
    let cellsWithCode = 0
    for (const cell of row) {
      const text = String(cell ?? "").toUpperCase()
      if (codigos.some(c => text.includes(c))) cellsWithCode++
    }
    if (cellsWithCode > bestScore) {
      best = i
      bestScore = cellsWithCode
    }
  }
  return best
}

// Busca una pestaña por nombre tolerando diferencias de espacios,
// underscores y mayúsculas (ej. "BalSTR01_Ajuste" ≡ "BalSTR01 Ajuste").
function buscarPestana(wb: XLSX.WorkBook, nombre: string): XLSX.WorkSheet | null {
  const norm = (s: string) => s.replace(/[\s_]+/g, "").toUpperCase()
  const target = norm(nombre)
  for (const sheetName of wb.SheetNames) {
    if (norm(sheetName) === target) return wb.Sheets[sheetName] ?? null
  }
  return null
}

// Búsqueda flexible de la fila BIAC-BIAE:
//   - Revisa las primeras 4 columnas (no solo la B)
//   - Normaliza espacios, mayúsculas y cualquier tipo de guión (- – —)
//   - Sólo requiere que el texto contenga "BIAC" y "BIAE"
function buscarFilaBiac(matrix: (string | number)[][], desde: number): number {
  for (let i = desde; i < matrix.length; i++) {
    const row = matrix[i] ?? []
    for (let col = 0; col <= 3; col++) {
      const text = String(row[col] ?? "")
        .replace(/[–—]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase()
      if (text.includes("BIAC") && text.includes("BIAE")) {
        return i
      }
    }
  }
  return -1
}

/**
 * Parsea uno o varios archivos de Insumos STR (BalanceSTR*.xlsx).
 *
 * Algoritmo:
 *   1. Detectar tipo (FACTURA o REFACTURA) por substring en el nombre
 *   2. Detectar mes_consumo por substring de mes (ene, feb, …) con separador
 *   3. Leer las pestañas correspondientes con header en fila 7 (skip 6)
 *   4. Buscar la fila donde la columna B contiene "BIAC - BIAE"
 *   5. Por cada columna cuyo nombre contenga un código del homologador,
 *      tomar el valor de esa fila y acumularlo por (operador, mes_consumo)
 */
export async function parsearInsumosSTR(
  buffers: { buffer: Buffer; nombre: string }[],
  anio: number,
  mes: number,
): Promise<ResultadoParser<FilaSTR>> {
  const filas: FilaSTR[]          = []
  const alertas: string[]         = []
  const erroresCriticos: string[] = []

  if (buffers.length === 0) {
    erroresCriticos.push("No se recibió ningún archivo.")
    return { filas, alertas, erroresCriticos }
  }

  // ── PASO 1: Determinar mes_consumo del LOTE ─────────────────────────────
  // Buscamos en el archivo FACTURA (tipofactu) primero. Ese mes se aplica
  // a TODOS los archivos del upload, incluidas las REFACTURAs — replicando
  // el comportamiento del script Python original.
  let mesConsumoNum: number | null = null
  let mesConsumoSource = ""
  for (const { nombre } of buffers) {
    const lower = nombre.toLowerCase()
    if (lower.includes("tipofactu") && !lower.includes("tiporefactu")) {
      mesConsumoNum = detectarMesConsumo(nombre)
      if (mesConsumoNum) { mesConsumoSource = nombre; break }
    }
  }
  // Fallback: si no hay FACTURA, usar el primer archivo con un mes detectable
  if (mesConsumoNum == null) {
    for (const { nombre } of buffers) {
      mesConsumoNum = detectarMesConsumo(nombre)
      if (mesConsumoNum) { mesConsumoSource = nombre; break }
    }
  }
  if (mesConsumoNum == null) {
    erroresCriticos.push(
      "No se pudo determinar el mes de consumo del lote: ningún archivo " +
      'tiene un mes válido en su nombre (ej. "-ene", "_feb", ...).',
    )
    return { filas, alertas, erroresCriticos }
  }
  const anioConsumo = mesConsumoNum > mes ? anio - 1 : anio
  const mesConsumoStr = `${anioConsumo}-${String(mesConsumoNum).padStart(2, "0")}`
  alertas.push(
    `Mes de consumo del lote: ${mesConsumoStr} ` +
    `(detectado de "${mesConsumoSource}").`,
  )

  // ── PASO 2: Procesar cada archivo con el mes_consumo del lote ───────────
  for (const { buffer, nombre } of buffers) {
    const lower = nombre.toLowerCase()

    let tipo: "FACTURA" | "REFACTURA"
    let pestanas: string[]
    if (lower.includes("tiporefactu")) {
      tipo = "REFACTURA"
      pestanas = ["BalSTR01_Ajuste", "BalSTR02_Ajuste"]
    } else if (lower.includes("tipofactu")) {
      tipo = "FACTURA"
      pestanas = ["BalSTR01", "BalSTR02"]
    } else {
      alertas.push(`[${nombre}] omitido — el nombre no contiene "tipofactu" ni "tiporefactu".`)
      continue
    }

    // ── 3-5. Leer pestañas y acumular ───────────────────────────────────
    const valoresPorOR: Record<string, number> = {}
    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(buffer, { type: "buffer", cellDates: false })
    } catch (e) {
      alertas.push(`[${nombre}] no se pudo leer como Excel: ${e}`)
      continue
    }

    // Acumular diagnósticos por pestaña (para reportar si no se encontró BIAC-BIAE)
    const diagnosticos: string[] = []

    for (const tabName of pestanas) {
      const ws = buscarPestana(wb, tabName)
      if (!ws) continue  // pestaña no existe — silencioso

      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: "",
        raw: true,
      }) as unknown as (string | number)[][]

      if (matrix.length === 0) {
        diagnosticos.push(`pestaña "${tabName}" vacía`)
        continue
      }

      // Auto-detectar fila del header
      const filaHeader = detectarFilaHeader(matrix)
      const headers = (matrix[filaHeader] ?? []).map(h => String(h ?? "").trim())

      // Buscar fila BIAC-BIAE flexible (primeras 4 columnas, normalizando dashes/espacios)
      const filaBiacIdx = buscarFilaBiac(matrix, filaHeader + 1)
      if (filaBiacIdx < 0) {
        const sample: string[] = []
        for (let i = filaHeader + 1; i < Math.min(matrix.length, filaHeader + 8); i++) {
          const cellA = String(matrix[i]?.[0] ?? "").trim()
          const cellB = String(matrix[i]?.[1] ?? "").trim()
          const combined = [cellA, cellB].filter(Boolean).join(" | ")
          if (combined) sample.push(combined)
        }
        diagnosticos.push(
          `pestaña "${tabName}": BIAC-BIAE no encontrado (header detectado fila ${filaHeader + 1}). ` +
          `Primeras filas: ${sample.slice(0, 3).join("  ·  ") || "(vacías)"}`,
        )
        continue
      }
      const biacRow = matrix[filaBiacIdx] ?? []

      // Match de códigos en headers — case-insensitive vía toUpperCase
      for (let j = 0; j < headers.length; j++) {
        const headerUpper = (headers[j] ?? "").toUpperCase()
        for (const [codigo, orCodigo] of Object.entries(HOMOLOGACION)) {
          if (headerUpper.includes(codigo)) {
            const val = toNum(biacRow[j])
            if (val != null) {
              valoresPorOR[orCodigo] = (valoresPorOR[orCodigo] ?? 0) + val
            }
            break
          }
        }
      }
    }

    if (Object.keys(valoresPorOR).length === 0) {
      const diag = diagnosticos.length > 0 ? ` — ${diagnosticos.join(" | ")}` : ""
      alertas.push(`[${nombre}] no se encontró fila "BIAC - BIAE" o no hubo valores para los operadores${diag}.`)
      continue
    }

    // Una fila por operador con valor distinto de cero (incluye negativos)
    for (const [orCodigo, valor] of Object.entries(valoresPorOR)) {
      filas.push({
        or_codigo:   orCodigo,
        mes_consumo: mesConsumoStr,
        valor_cop:   valor,
        archivo:     nombre,
        tipo,
        detalle: { tipo, archivo: nombre },
      })
    }
  }

  if (filas.length === 0 && erroresCriticos.length === 0) {
    alertas.push("No se generaron registros — revisá los archivos cargados.")
  }

  return { filas, alertas, erroresCriticos }
}
