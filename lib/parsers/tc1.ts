import * as XLSX from "xlsx"
import { type FilaTC1, type ResultadoParser } from "./types"

/**
 * Parser del archivo TC1 (configuracion tecnica por OR).
 *
 * - Acepta CSV y XLSX (SheetJS detecta el formato del buffer).
 * - Filtra las filas por ID_COMERCIALIZADOR = 62371 (BIA). Los archivos de
 *   algunos OR traen fronteras de varios comercializadores; solo cargamos las
 *   de BIA.
 * - Mapea las columnas conocidas (TC1_COLUMNAS); las columnas extra del
 *   archivo se omiten.
 * - codigo_frontera = COD_FRONTERA_COMERCIAL (clave de cruce con Facturacion).
 * - propiedad_activos se deriva de PORC_PROPIEDAD_DEL_ACTIVO:
 *     0 o 101 -> USUARIO, 50 -> COMPARTIDO, 100 -> OR.
 */

const ID_COMERCIALIZADOR_BIA = "62371"

// Normaliza un header a solo [A-Z0-9]: quita acentos, espacios, guiones,
// underscores y cualquier caracter invisible (BOM, zero-width, etc.). Esto
// hace el match robusto ante variaciones de nombre entre OR
// (ej. "CODIGO_CONEXION" vs "CODIGO_DE_CONEXION" siguen difiriendo, pero
// "COD_FRONTERA_COMERCIAL" matchea aunque tenga caracteres ocultos).
function normCol(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function mapPropiedad(porc: string | null): string | null {
  if (porc == null || porc === "") return null
  const n = parseInt(porc, 10)
  if (isNaN(n)) return null
  if (n === 0 || n === 101) return "USUARIO"
  if (n === 50)             return "COMPARTIDO"
  if (n === 100)            return "OR"
  return null
}

export async function parsearTC1(buffer: Buffer): Promise<ResultadoParser<FilaTC1>> {
  const alertas: string[]         = []
  const erroresCriticos: string[] = []
  const filas: FilaTC1[]          = []

  let raw: (string | number)[][]
  try {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: false })
    const ws = wb.Sheets[wb.SheetNames[0] ?? ""]
    if (!ws) {
      erroresCriticos.push("El archivo no tiene hojas.")
      return { filas, alertas, erroresCriticos }
    }
    raw = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
      header: 1, defval: "", raw: true,
    }) as unknown as (string | number)[][]
  } catch (e) {
    erroresCriticos.push(`No se pudo leer el archivo: ${e}`)
    return { filas, alertas, erroresCriticos }
  }

  if (raw.length < 2) {
    erroresCriticos.push("El archivo está vacío o no tiene datos.")
    return { filas, alertas, erroresCriticos }
  }

  const headersOrig = (raw[0] ?? []).map(h => String(h ?? "").trim())
  const headersNorm = headersOrig.map(normCol)

  const findIdx = (...cands: string[]): number => {
    for (const c of cands) {
      const i = headersNorm.indexOf(normCol(c))
      if (i >= 0) return i
    }
    return -1
  }

  // Acepta variantes de nombre entre OR (con/sin "DE", abreviaciones, etc.)
  const idxCodigo = findIdx("COD_FRONTERA_COMERCIAL", "CODIGO_FRONTERA_COMERCIAL")
  const idxNivel  = findIdx("NIVEL_DE_TENSION", "NIVEL_TENSION")
  const idxPorc   = findIdx("PORC_PROPIEDAD_DEL_ACTIVO", "PROPIEDAD_ACTIVO", "PROPIEDAD_DEL_ACTIVO")
  const idxIdCom  = findIdx("ID_COMERCIALIZADOR")
  const idxNiu    = findIdx("NIU")
  const idxNTP    = findIdx("NIVEL_DE_TENSION_PRIMARIO", "NIVEL_TENSION_PRIMARIO")
  const idxTipoCx = findIdx("TIPO_DE_CONEXION", "TIPO_CONEXION")
  const idxConRed = findIdx("CONEXION_RED")

  const faltantes: string[] = []
  if (idxCodigo < 0) faltantes.push("COD_FRONTERA_COMERCIAL")
  if (idxIdCom < 0)  faltantes.push("ID_COMERCIALIZADOR")
  if (faltantes.length > 0) {
    erroresCriticos.push(
      `Columnas requeridas no encontradas: ${faltantes.join(", ")}. ` +
      `Columnas disponibles: [${headersOrig.join(", ")}]`,
    )
    return { filas, alertas, erroresCriticos }
  }

  const cell = (row: (string | number)[], idx: number): string =>
    idx >= 0 ? String(row[idx] ?? "").trim() : ""

  let filtradas = 0
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] ?? []

    // Filtro por comercializador BIA.
    if (cell(row, idxIdCom) !== ID_COMERCIALIZADOR_BIA) { filtradas++; continue }

    const cod = cell(row, idxCodigo)
    if (!cod) continue

    // detalle: todas las columnas del archivo (los nombres varian entre OR;
    // guardamos todo para no perder data y para el futuro push a Metabase).
    const detalle: Record<string, string> = {}
    headersOrig.forEach((h, j) => {
      if (h) detalle[h] = String(row[j] ?? "").trim()
    })

    const porc = cell(row, idxPorc) || null
    filas.push({
      codigo_frontera:        cod,
      niu:                    cell(row, idxNiu)    || null,
      nivel_tension:          cell(row, idxNivel)  || null,
      nivel_tension_primario: cell(row, idxNTP)    || null,
      pct_propiedad_activo:   porc,
      propiedad_activos:      mapPropiedad(porc),
      tipo_conexion:          cell(row, idxTipoCx) || null,
      conexion_red:           cell(row, idxConRed) || null,
      id_comercializador:     ID_COMERCIALIZADOR_BIA,
      detalle,
    })
  }

  if (filtradas > 0) {
    alertas.push(`${filtradas} filas omitidas (ID_COMERCIALIZADOR distinto de ${ID_COMERCIALIZADOR_BIA}).`)
  }
  if (filas.length === 0) {
    alertas.push(`No se encontraron filas con ID_COMERCIALIZADOR ${ID_COMERCIALIZADOR_BIA}.`)
  }

  return { filas, alertas, erroresCriticos }
}
