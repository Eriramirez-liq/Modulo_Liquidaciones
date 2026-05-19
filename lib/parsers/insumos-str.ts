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

  for (const { buffer, nombre } of buffers) {
    const lower = nombre.toLowerCase()

    // ── 1. Determinar tipo y pestañas a leer ────────────────────────────
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

    // ── 2. Detectar mes de consumo ──────────────────────────────────────
    const mesConsumoNum = detectarMesConsumo(nombre)
    if (mesConsumoNum == null) {
      alertas.push(`[${nombre}] omitido — no se pudo detectar el mes de consumo (ej. -ene, _feb, ...).`)
      continue
    }
    // Si el mes de consumo es posterior al de facturación, asumimos año anterior
    const anioConsumo = mesConsumoNum > mes ? anio - 1 : anio
    const mesConsumoStr = `${anioConsumo}-${String(mesConsumoNum).padStart(2, "0")}`

    // ── 3-5. Leer pestañas y acumular ───────────────────────────────────
    const valoresPorOR: Record<string, number> = {}
    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(buffer, { type: "buffer", cellDates: false })
    } catch (e) {
      alertas.push(`[${nombre}] no se pudo leer como Excel: ${e}`)
      continue
    }

    for (const tabName of pestanas) {
      const ws = wb.Sheets[tabName]
      if (!ws) continue  // pestaña no existe — silencioso (algunos archivos solo tienen una)

      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: "",
        raw: true,
      }) as unknown as (string | number)[][]

      // header=6 en pandas → fila índice 6 (Excel fila 7) es el header
      if (matrix.length <= 6) continue
      const headers = (matrix[6] ?? []).map(h => String(h ?? "").trim())

      // Buscar fila con "BIAC - BIAE" en columna B (índice 1)
      let biacRow: (string | number)[] | null = null
      for (let i = 7; i < matrix.length; i++) {
        const cellB = String(matrix[i]?.[1] ?? "").trim()
        if (cellB.includes("BIAC - BIAE")) {
          biacRow = matrix[i] ?? null
          break
        }
      }
      if (!biacRow) continue

      // Para cada columna, si el header contiene un código → sumar al operador
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j] ?? ""
        for (const [codigo, orCodigo] of Object.entries(HOMOLOGACION)) {
          if (header.includes(codigo)) {
            const val = toNum(biacRow[j])
            if (val != null) {
              valoresPorOR[orCodigo] = (valoresPorOR[orCodigo] ?? 0) + val
            }
            break  // un código por header
          }
        }
      }
    }

    if (Object.keys(valoresPorOR).length === 0) {
      alertas.push(`[${nombre}] no se encontró fila "BIAC - BIAE" o no hubo valores para los operadores.`)
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
