import * as XLSX from "xlsx"
import { type FilaTC1, type ResultadoParser, TC1_COLUMNAS } from "./types"

/**
 * Parser del archivo TC1 (configuracion tecnica por OR).
 *
 * Cada OR nombra las columnas distinto (con/sin "DE", abreviaciones, typos
 * como "FROTERA", truncados como ENEL "Nivel de T", sufijos "-(11)",
 * EMCALI usa "SIC" para la frontera, etc.) y algunos archivos traen filas
 * vacias antes del header (ESSA). Por eso:
 *   - Se detecta la fila de header escaneando las primeras filas.
 *   - El match de columnas clave es por patrones (tokens incluidos/excluidos).
 *
 * - Acepta CSV y XLSX (SheetJS detecta el formato del buffer).
 * - Filtra por ID_COMERCIALIZADOR = 62371 (BIA) SI existe esa columna; si el
 *   archivo no la trae (ya viene pre-filtrado) se cargan todas las filas.
 * - codigo_frontera = Codigo Frontera Comercial (clave de cruce con Facturacion).
 * - propiedad_activos se deriva de PORC_PROPIEDAD_DEL_ACTIVO:
 *     0 o 101 -> USUARIO, 50 -> COMPARTIDO, 100 -> OR.
 * - detalle ESTANDARIZADO a las 33 columnas canonicas TC1 por POSICION
 *   (layout CREG fijo), para el posterior push a Metabase.
 */

const ID_COMERCIALIZADOR_BIA = 62371

// Quita caracteres de control (< 0x20) y DEL (0x7F). Algunos CSV (AFINIA)
// traen null bytes \x00 alrededor de los valores; sin limpiarlos el cruce de
// fronteras fallaria. Conserva acentos, espacios internos y demas.
function limpiar(v: unknown): string {
  const s = String(v ?? "")
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 32 && c !== 127) out += s[i]
  }
  return out.trim()
}

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

// Busca el indice del primer header normalizado que contenga todos los tokens
// de algun grupo de `incluye` y ninguno de `excluye`.
function buscar(headersNorm: string[], incluye: string[][], excluye: string[] = []): number {
  for (const grupo of incluye) {
    for (let i = 0; i < headersNorm.length; i++) {
      const h = headersNorm[i] ?? ""
      if (!h) continue
      if (grupo.every(t => h.includes(t)) && !excluye.some(t => h.includes(t))) return i
    }
  }
  return -1
}

function buscarExacto(headersNorm: string[], valores: string[]): number {
  for (let i = 0; i < headersNorm.length; i++) {
    if (valores.includes(headersNorm[i] ?? "")) return i
  }
  return -1
}

// Detecta la fila de header: la de las primeras 15 que mas keywords TC1 contiene.
function detectarHeaderRow(raw: (string | number)[][]): number {
  const KW = ["NIU", "NIVELTENSION", "PROP", "FRONT", "COMERC", "CONEXION", "TENSION"]
  let best = 0, bestScore = 0
  const lim = Math.min(raw.length, 15)
  for (let i = 0; i < lim; i++) {
    const cells = (raw[i] ?? []).map(c => normCol(String(c ?? "")))
    let score = 0
    for (const kw of KW) if (cells.some(c => c.includes(kw))) score++
    if (score > bestScore) { bestScore = score; best = i }
  }
  return bestScore >= 3 ? best : 0
}

// Acepta Uint8Array (Buffer en server lo satisface) para poder parsear tanto
// en el servidor como en el navegador (archivos grandes que superan el limite
// de upload de Vercel; igual que XM).
export async function parsearTC1(
  data: Uint8Array,
  anio: number,
  mes: number,
): Promise<ResultadoParser<FilaTC1>> {
  const alertas: string[]         = []
  const erroresCriticos: string[] = []
  const filas: FilaTC1[]          = []
  // Periodo (metadata): primera columna del shape de Metabase, formato "M-AAAA"
  // (ej. febrero 2026 -> "2-2026"). NO viene en el archivo del OR.
  const periodoMeta = `${mes}-${anio}`

  let raw: (string | number)[][]
  try {
    // dense:true almacena la hoja como array de arrays (no un objeto con una
    // clave por celda). Imprescindible para CSV gigantes como CELSIA_VALLE
    // (102MB) / CELSIA_TOLIMA (82MB): sin dense, XLSX crea millones de
    // propiedades y V8 lanza "Too many properties to enumerate".
    const wb = XLSX.read(data, { type: "array", cellDates: false, dense: true })
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

  const hRow = detectarHeaderRow(raw)
  if (raw.length < hRow + 2) {
    erroresCriticos.push("El archivo está vacío o no tiene datos.")
    return { filas, alertas, erroresCriticos }
  }

  const headersOrig = (raw[hRow] ?? []).map(h => limpiar(h))
  const headersNorm = headersOrig.map(normCol)

  // Columnas "ruido" que algunos OR intercalan y que NO son parte del formato
  // canonico (ej. ENEL mete "CX" = sigla del comercializador entre
  // ID_COMERCIALIZADOR e ID_MERCADO, desalineando el mapeo por posicion).
  // Se descartan: el mapeo posicional usa solo las columnas "mantenidas".
  const DESCARTAR_HEADER = new Set([
    "CX", "SIGLA", "SIGLAS", "SIGLAAGENTE", "SIGLASAGENTE", "SIGLACOMERCIALIZADOR",
  ])
  // Indices de columnas a conservar para el mapeo posicional a las 33 canonicas.
  const idxMantener: number[] = []
  headersNorm.forEach((h, i) => { if (!DESCARTAR_HEADER.has(h)) idxMantener.push(i) })

  // Codigo frontera comercial. Evitar columnas de autogeneracion/exportacion.
  // "FROTERA" cubre el typo de CEDENAR (COD_FROTERA_COMERCIAL, sin la N).
  let idxCodigo = buscar(headersNorm, [["FRONT", "COMERC"], ["FROTERA", "COMERC"]], ["AUTO", "GENERA", "EXPORT"])
  if (idxCodigo < 0) idxCodigo = buscar(headersNorm, [["FRONT"], ["FROTERA"]], ["AUTO", "GENERA", "EXPORT", "PRIMARI"])
  if (idxCodigo < 0) idxCodigo = buscarExacto(headersNorm, ["SIC"]) // EMCALI

  // Nivel de tension (la del usuario, NO la primaria).
  let idxNivel = buscarExacto(headersNorm, ["NIVELTENSION", "NIVELDETENSION", "NIVELDET"])
  if (idxNivel < 0) idxNivel = buscar(headersNorm, [["NIVEL", "TENSION"]], ["PRIMARI", "PRIM", "USUARIO", "EXPORT", "CTO"])

  // Propiedad del activo (porcentaje). Todas las variantes contienen "PROP".
  const idxPorc = buscar(headersNorm, [["PROP"]])

  // ID comercializador (opcional; EMCALI lo trunca a "IDCOMER").
  const idxIdCom = buscar(headersNorm, [["IDCOMER"]], ["FRONT"])

  // Otras columnas que persistimos en campos dedicados.
  const idxNiu    = buscarExacto(headersNorm, ["NIU"])
  const idxNTP    = buscar(headersNorm, [["NIVEL", "TENSION", "PRIM"]], ["EXPORT"])
  const idxTipoCx = buscar(headersNorm, [["TIPO", "CONEXION"]])
  const idxConRed = buscar(headersNorm, [["CONEXION", "RED"]])

  if (idxCodigo < 0) {
    erroresCriticos.push(
      `No se encontró la columna de Código Frontera Comercial. ` +
      `Columnas disponibles: [${headersOrig.join(", ")}]`,
    )
    return { filas, alertas, erroresCriticos }
  }

  const cell = (row: (string | number)[], idx: number): string =>
    idx >= 0 ? limpiar(row[idx]) : ""

  const filtraId = idxIdCom >= 0
  if (!filtraId) {
    alertas.push(
      "No se halló la columna ID_COMERCIALIZADOR; se cargan todas las filas " +
      "(archivo asumido pre-filtrado por BIA 62371).",
    )
  }

  let filtradas = 0
  for (let i = hRow + 1; i < raw.length; i++) {
    const row = raw[i] ?? []

    if (filtraId) {
      const idn = parseInt(cell(row, idxIdCom), 10)
      if (idn !== ID_COMERCIALIZADOR_BIA) { filtradas++; continue }
    }

    const cod = cell(row, idxCodigo)
    if (!cod) continue

    // detalle ESTANDARIZADO = shape de Metabase: "Periodo" (metadata) + las 33
    // columnas canonicas TC1 mapeadas por POSICION (el layout CREG es fijo;
    // los nombres de header varian). Se mapea sobre las columnas "mantenidas"
    // (sin las ruido intercaladas como la sigla "CX" de ENEL), realineando.
    const detalle: Record<string, string> = {}
    detalle["Periodo"] = periodoMeta
    TC1_COLUMNAS.forEach((canon, k) => {
      const colIdx = idxMantener[k]
      detalle[canon] = colIdx != null ? limpiar(row[colIdx]) : ""
    })
    // Override de seguridad: para las columnas criticas usamos el valor
    // detectado por nombre (validado en los 21 OR), por si algun archivo
    // tuviera el orden corrido.
    detalle["COD_FRONTERA_COMERCIAL"]    = cod
    if (idxNivel  >= 0) detalle["NIVEL_DE_TENSION"]          = cell(row, idxNivel)
    if (idxPorc   >= 0) detalle["PORC_PROPIEDAD_DEL_ACTIVO"] = cell(row, idxPorc)
    if (idxIdCom  >= 0) detalle["ID_COMERCIALIZADOR"]        = cell(row, idxIdCom)
    if (idxNTP    >= 0) detalle["NIVEL_DE_TENSION_PRIMARIO"] = cell(row, idxNTP)
    if (idxTipoCx >= 0) detalle["TIPO_DE_CONEXION"]          = cell(row, idxTipoCx)
    if (idxConRed >= 0) detalle["CONEXION_RED"]              = cell(row, idxConRed)
    if (idxNiu    >= 0) detalle["NIU"]                       = cell(row, idxNiu)

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
      id_comercializador:     filtraId ? String(ID_COMERCIALIZADOR_BIA) : (cell(row, idxIdCom) || null),
      detalle,
    })
  }

  if (filtradas > 0) {
    alertas.push(`${filtradas} filas omitidas (ID_COMERCIALIZADOR distinto de ${ID_COMERCIALIZADOR_BIA}).`)
  }
  if (filas.length === 0) {
    alertas.push("No se encontraron filas con frontera válida para cargar.")
  }

  return { filas, alertas, erroresCriticos }
}
