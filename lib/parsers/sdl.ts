import * as XLSX from "xlsx"
import { FilaSDL, ResultadoParser } from "@/lib/parsers/types"

// ─── Types ────────────────────────────────────────────────────────────────────

interface MapeoSDL {
  tipo_archivo?: "xlsx" | "csv"
  hoja?: number
  fila_inicio?: number
  separador_csv?: string
  columnas?: Record<string, string | null>
  multi_archivos?: boolean
  filtro_filas?: { columna: string; valor: string }
  codigo_frontera_split?: string
}

type Row = Record<string, string>

// ─── Default mapeo (used when mapeo_sdl_json is NULL) ────────────────────────

const MAPEO_DEFAULT: MapeoSDL = {
  tipo_archivo: "xlsx",
  hoja: 0,
  fila_inicio: 2,
  columnas: {
    codigo_frontera: "CODIGO_FRONTERA",
    energia_kwh:     "ENERGIA_KWH",
    valor_cop:       "VALOR_COP",
    periodo:         "PERIODO",
  },
}

// ─── Column resolution (tolerant: strip accents, case-insensitive, substring) ─

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
}

function resolveCol(headers: string[], name: string): string | null {
  const nameN = norm(name)
  if (!nameN) return null
  // exact match
  for (const h of headers) if (norm(h) === nameN) return h
  // header contains the search term
  for (const h of headers) if (norm(h).includes(nameN)) return h
  // search term contains the header — require ≥4 chars to prevent
  // single-letter column names (e.g. "M") matching unrelated searches
  for (const h of headers) {
    const hN = norm(h)
    if (hN.length >= 4 && nameN.includes(hN)) return h
  }
  return null
}

function resolveColMulti(headers: string[], candidates: string[]): string | null {
  for (const c of candidates) {
    const r = resolveCol(headers, c)
    if (r) return r
  }
  return null
}

function toNum(v: string | undefined | null): number | null {
  if (v == null || v === "") return null
  // Strip currency symbols, spaces, and non-numeric chars except . , -
  let s = String(v).replace(/[^0-9.,\-]/g, "").trim()
  if (!s) return null
  if (s.includes(",") && s.includes(".")) {
    // Both separators: last one is the decimal
    const lastComma = s.lastIndexOf(",")
    const lastDot   = s.lastIndexOf(".")
    if (lastComma > lastDot) {
      // "1.234.567,89" → European: dots=thousands, comma=decimal
      s = s.replace(/\./g, "").replace(",", ".")
    } else {
      // "1,234,567.89" → US: commas=thousands, dot=decimal
      s = s.replace(/,/g, "")
    }
  } else if (s.includes(",")) {
    const parts = s.split(",")
    // "1,56" (2 parts, last ≤2 chars) → decimal comma; else thousands
    if (parts.length === 2 && (parts[1]?.length ?? 0) <= 2) {
      s = s.replace(",", ".")
    } else {
      s = s.replace(/,/g, "")
    }
  } else if ((s.match(/\./g) ?? []).length > 1) {
    // "1.234.567" → multiple dots = thousands separators
    s = s.replace(/\./g, "")
  }
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

// ─── File reader ──────────────────────────────────────────────────────────────

function readRows(buffer: Buffer, mapeo: MapeoSDL): Row[] {
  const tipo     = mapeo.tipo_archivo ?? "xlsx"
  const hoja     = mapeo.hoja ?? 0
  const skip     = Math.max(0, (mapeo.fila_inicio ?? 2) - 2)

  if (tipo === "csv") {
    const sep  = mapeo.separador_csv ?? ","
    const encodings: BufferEncoding[] = ["utf8", "latin1"]
    let text = ""
    for (const enc of encodings) {
      try { text = buffer.toString(enc); break } catch { /* try next */ }
    }
    const lines = text.split(/\r?\n/)
    const headerLine = lines[skip] ?? ""
    const headers = headerLine.split(sep).map(h => h.replace(/^"|"$/g, "").trim())
    const rows: Row[] = []
    for (let i = skip + 1; i < lines.length; i++) {
      const line = (lines[i] ?? "").trim()
      if (!line) continue
      const vals = line.split(sep).map(v => v.replace(/^"|"$/g, "").trim())
      const row: Row = {}
      headers.forEach((h, j) => { row[h] = vals[j] ?? "" })
      rows.push(row)
    }
    return rows
  }

  // xlsx / xls — use raw:true so numeric cells return as numbers, avoiding
  // locale-formatted strings like "$ 1.234.567,89" that break parseFloat
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false })
  const sheetName = typeof hoja === "number" ? wb.SheetNames[hoja] : hoja
  const ws = wb.Sheets[sheetName ?? wb.SheetNames[0] ?? ""]
  if (!ws) return []

  const raw = XLSX.utils.sheet_to_json<Row>(ws, {
    header: 1,
    defval: "",
    raw: true,
    skipHidden: false,
  }) as unknown as (string | number)[][]

  if (raw.length <= skip) return []
  const headers = (raw[skip] ?? []).map(h => String(h ?? "").trim())
  const rows: Row[] = []
  for (let i = skip + 1; i < raw.length; i++) {
    const vals = raw[i] ?? []
    const row: Row = {}
    headers.forEach((h, j) => { row[h] = String(vals[j] ?? "").trim() })
    rows.push(row)
  }
  return rows
}

// ─── Preprocessors ────────────────────────────────────────────────────────────
// Each returns { rows, mapeo } with any calculated columns added to rows
// and column-name overrides added to mapeo.columnas.

type PreResult = { rows: Row[]; mapeo: MapeoSDL }

function preAfinia(rows: Row[], mapeo: MapeoSDL, buffer: Buffer): PreResult {
  const m    = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  // 1. Nombre de frontera: column is DES_CLIENTE in AFINIA files
  const colDes = resolveCol(headers, "DES_CLIENTE")
  if (colDes) cols["nombre_frontera"] = colDes

  // 2. Tarifa reactiva: calculated as valor_reactiva / energia_reactiva
  const colVR = resolveCol(headers, cols["valor_reactiva_cop"] ?? "PEN. ENERGIA REACTIVA PEAJES")
  const colER = resolveCol(headers, cols["energia_reactiva_ind_pen"] ?? "ENERGIA REACTIVA PEAJES")
  if (colVR && colER) {
    rows = rows.map(r => {
      const vr = toNum(r[colVR])
      const er = toNum(r[colER])
      const tar = er && er > 0 ? (vr ?? 0) / er : null
      return { ...r, __TARIFA_REACTIVA__: tar != null ? String(tar) : "" }
    })
    cols["tarifa_reactiva"] = "__TARIFA_REACTIVA__"
  }

  // 3. Propiedad activos: from "CONSOLIDADO PEAJES" sheet, looked up by SIC
  //    Rules: NT=2 → "Usuario"; NT=1, prop=0 → "OR"; NT=1, prop=1/101 → "Usuario"
  try {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: false })
    const sheetConsolidado = wb.SheetNames.find(s =>
      norm(s).includes("CONSOLIDADO") || norm(s).includes("PEAJES")
    )
    if (sheetConsolidado) {
      const wsC = wb.Sheets[sheetConsolidado]!
      const rawC = XLSX.utils.sheet_to_json<Row>(wsC, {
        header: 1, defval: "", raw: true,
      }) as unknown as (string | number)[][]

      if (rawC.length > 1) {
        const cHeaders = (rawC[0] ?? []).map(h => String(h).trim())
        const cColSIC  = resolveCol(cHeaders, "SIC")
        const cColProp = resolveCol(cHeaders, "PROPIEDAD_ACTIVOS")

        if (cColSIC && cColProp) {
          // Build lookup: SIC → propiedad numeric value
          const propLookup = new Map<string, number>()
          for (let i = 1; i < rawC.length; i++) {
            const cRow: Row = {}
            cHeaders.forEach((h, j) => { cRow[h] = String(rawC[i]?.[j] ?? "").trim() })
            const sic  = (cRow[cColSIC]  ?? "").trim()
            const prop = toNum(cRow[cColProp])
            if (sic && prop != null) propLookup.set(sic, prop)
          }

          const colSIC = resolveCol(headers, cols["codigo_frontera"] ?? "SIC")
          const colNT  = resolveCol(headers, cols["nivel_tension"]   ?? "NIVEL TENSION")
          if (colSIC && colNT) {
            rows = rows.map(r => {
              const sic  = (r[colSIC] ?? "").trim()
              const nt   = toNum(r[colNT]) ?? 0
              const prop = propLookup.get(sic) ?? null

              let mapped: string
              if (nt === 2) {
                mapped = "Usuario"
              } else if (prop === 0) {
                mapped = "OR"
              } else {
                mapped = "Usuario"
              }
              return { ...r, __PROPIEDAD__: mapped }
            })
            cols["propiedad_activos"] = "__PROPIEDAD__"
          }
        }
      }
    }
  } catch {
    // CONSOLIDADO PEAJES sheet not found or unreadable — propiedad stays unset
  }

  return { rows, mapeo: m }
}

function preAire(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  const colPen = resolveCol(headers, "PENALIZACIONREACTIVA$")
  const colCap = resolveCol(headers, "REACTIVACAPACITIVA$")
  if (colPen && colCap) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_REACTIVA__: String(
        (toNum(r[colPen]) ?? 0) + (toNum(r[colCap]) ?? 0)
      ),
    }))
    cols["valor_reactiva_cop"] = "__VALOR_REACTIVA__"
  }

  const colCopT = resolveCol(headers, "PENALIZACIONREACTIVA$")
  const colKwh  = resolveCol(headers, "PENALIZACIONREACTIVA")
  const colM    = resolveCol(headers, "FactorM")
  if (colCopT && colKwh && colM) {
    rows = rows.map(r => {
      const cop = toNum(r[colCopT]) ?? 0
      const kwh = toNum(r[colKwh])
      const fm  = toNum(r[colM])
      const tar = kwh && fm ? cop / kwh / fm : null
      return { ...r, __TARIFA_REACTIVA__: tar != null ? String(tar) : "" }
    })
    cols["tarifa_reactiva"] = "__TARIFA_REACTIVA__"
  }

  const colNT = resolveCol(headers, "NT")
  if (colNT) {
    rows = rows.map(r => ({
      ...r,
      __NT__: (r[colNT] ?? "").replace(/\D/g, "") || "",
    }))
    cols["nivel_tension"] = "__NT__"
  }

  const colProp = resolveCol(headers, "PROPIETARIO_ACTIVO")
  if (colProp) {
    rows = rows.map(r => {
      const v = (r[colProp] ?? "").trim().toUpperCase()
      const mapped = v.includes("OPERADOR DE RED") ? "OR"
                   : v.includes("USUARIO") ? "Usuario"
                   : (r[colProp] ?? "").trim()
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }

  return { rows, mapeo: m }
}

function preCelsiaTolima(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})
  const colProp = resolveCol(headers, "Propiedad Activo")
  if (colProp) {
    rows = rows.map(r => {
      const v = (r[colProp] ?? "").trim().toUpperCase()
      const mapped = (v === "N/A" || v === "" || v.includes("USUARIO")) ? "Usuario"
                   : v.includes("50%") && v.includes("OPERADOR") ? "Compartido"
                   : v.includes("OPERADOR") ? "OR"
                   : (r[colProp] ?? "").trim()
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }
  return { rows, mapeo: m }
}

function preCens(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  // CENS: nivel_tension from "NT_PRO", no extra transforms
  return { rows, mapeo: deepCloneMapeo(mapeo) }
}

function preCeo(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})
  const colProp = resolveCol(headers, "Propiedad Activo")
  if (colProp) {
    rows = rows.map(r => {
      const v = (r[colProp] ?? "").trim().toUpperCase()
      const mapped = v.includes("USUARIO") ? "Usuario"
                   : v.includes("OPERADOR") ? "OR"
                   : (r[colProp] ?? "").trim()
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }
  return { rows, mapeo: m }
}

function preChec(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  // CHEC: codigo_frontera may have format "Frt18771-INCOCO_NO.8" → "Frt18771"
  // This is handled by the split_char mechanism in mapeo, not here
  return { rows, mapeo: m }
}

function preEbsa(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})
  // EBSA: filter rows where a column indicates "ACTIVA" type if present
  const colTipo = resolveCol(headers, "TIPO")
  if (colTipo) {
    rows = rows.filter(r => (r[colTipo] ?? "").trim().toUpperCase() === "ACTIVA" || (r[colTipo] ?? "").trim() === "")
  }
  return { rows, mapeo: m }
}

function preEdeq(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})
  const colProp = resolveCol(headers, "Propiedad")
  if (colProp) {
    rows = rows.map(r => {
      const v = (r[colProp] ?? "").trim().toUpperCase()
      const mapped = v.includes("USUARIO") ? "Usuario"
                   : v.includes("OPERADOR") ? "OR"
                   : (r[colProp] ?? "").trim()
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }
  return { rows, mapeo: m }
}

function preEepc(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  // EEP_CARTAGO / EEP_PEREIRA: standard xlsx, no extra transforms
  return { rows, mapeo: deepCloneMapeo(mapeo) }
}

function preEmsa(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  // EMSA: multi_archivos handled at wizard level; here just normalize
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})
  // codigo_frontera_split: "CODIGO" may contain "Frt12345-extra" → take before "-"
  const colCod = resolveCol(headers, cols["codigo_frontera"] ?? "CODIGO")
  if (colCod) {
    rows = rows.map(r => {
      const raw = r[colCod] ?? ""
      const split = raw.includes("-") ? (raw.split("-")[0] ?? "").trim() : raw.trim()
      return { ...r, __COD__: split }
    })
    cols["codigo_frontera"] = "__COD__"
  }
  return { rows, mapeo: m }
}

function preEssa(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})
  const colProp = resolveCol(headers, "PROPIEDAD")
  if (colProp) {
    rows = rows.map(r => {
      const v = (r[colProp] ?? "").trim().toUpperCase()
      const mapped = v.includes("USUARIO") ? "Usuario"
                   : v.includes("OPERADOR") || v === "OR" ? "OR"
                   : (r[colProp] ?? "").trim()
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }
  return { rows, mapeo: m }
}

function preRuitoque(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  return { rows, mapeo: deepCloneMapeo(mapeo) }
}

function preEnel(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  return { rows, mapeo: deepCloneMapeo(mapeo) }
}

function preCedenar(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  return { rows, mapeo: deepCloneMapeo(mapeo) }
}

// ─── Preprocessor registry ───────────────────────────────────────────────────

type PreFn = (rows: Row[], mapeo: MapeoSDL, buffer: Buffer) => PreResult

const PREPROCESSORS: Record<string, PreFn> = {
  AFINIA:        preAfinia,
  AIRE:          preAire,
  CEDENAR:       preCedenar,
  CELSIA_TOLIMA: preCelsiaTolima,
  CELSIA_VALLE:  preCelsiaTolima,
  CETSA:         preCelsiaTolima,
  CENS:          preCens,
  CEO:           preCeo,
  CHEC:          preChec,
  EBSA:          preEbsa,
  EDEQ:          preEdeq,
  EEP_CARTAGO:   preEepc,
  EEP_PEREIRA:   preEepc,
  ENEL:          preEnel,
  EMSA:          preEmsa,
  ESSA:          preEssa,
  RUITOQUE:      preRuitoque,
}

function deepCloneMapeo(m: MapeoSDL): MapeoSDL {
  return { ...m, columnas: { ...(m.columnas ?? {}) } }
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export async function parsearSDL(
  buffer: Buffer,
  mapeoRaw: Record<string, unknown> | null,
  orId: string,
  _periodoId: string | null,
  anio: number,
  mes: number,
  orCodigo?: string,
): Promise<ResultadoParser<FilaSDL>> {
  const alertas: string[]         = []
  const erroresCriticos: string[] = []
  const filas: FilaSDL[]          = []

  const mapeo: MapeoSDL = mapeoRaw
    ? (mapeoRaw as MapeoSDL)
    : MAPEO_DEFAULT

  // ── Read file ──────────────────────────────────────────────────────────────
  let rows: Row[]
  try {
    rows = readRows(buffer, mapeo)
  } catch (e) {
    erroresCriticos.push(`No se pudo leer el archivo: ${e}`)
    return { filas, alertas, erroresCriticos }
  }

  if (rows.length === 0) {
    erroresCriticos.push("El archivo está vacío o no tiene datos.")
    return { filas, alertas, erroresCriticos }
  }

  // ── Preprocessor ──────────────────────────────────────────────────────────
  const codigo = (orCodigo ?? orId ?? "").toUpperCase()
  const preFn  = PREPROCESSORS[codigo]
  let m = mapeo
  if (preFn) {
    try {
      const result = preFn(rows, m, buffer)
      rows = result.rows
      m    = result.mapeo
    } catch (e) {
      alertas.push(`Preprocesador OR ${codigo} falló (${e}); se continúa con datos crudos.`)
    }
  }

  const headers = Object.keys(rows[0] ?? {})
  const cols    = m.columnas ?? {}

  // ── Resolve columns ────────────────────────────────────────────────────────
  const colFrontera = resolveCol(headers, cols["codigo_frontera"] ?? "CODIGO_FRONTERA")
  const colEnergia  = resolveCol(headers, cols["energia_kwh"]     ?? "ENERGIA_KWH")
  // valor_cop is optional — when null in config (e.g. EMSA), default valor to 0
  const valorCopKey = cols["valor_cop"] ?? null
  const colValor    = valorCopKey ? resolveCol(headers, valorCopKey) : null
  const colPeriodo  = cols["periodo"]
    ? resolveCol(headers, cols["periodo"])
    : null
  const colNombre   = cols["nombre_frontera"]
    ? resolveCol(headers, cols["nombre_frontera"])
    : resolveColMulti(headers, ["NOMBRE_FRONTERA", "NOMBRE FRONTERA", "NOMBRE"])
  const colTension  = cols["nivel_tension"]
    ? resolveCol(headers, cols["nivel_tension"])
    : resolveColMulti(headers, ["NIVEL TENSION", "NIVEL DE TENSION", "NIVEL TENSIÓN", "NT", "NT_PRO"])
  const colProp     = cols["propiedad_activos"]
    ? resolveCol(headers, cols["propiedad_activos"])
    : resolveColMulti(headers, ["PROPIEDAD", "PROPIEDAD ACTIVO", "PROPIETARIO_ACTIVO"])
  const colReacInd  = cols["energia_reactiva_ind_pen"] ? resolveCol(headers, cols["energia_reactiva_ind_pen"]) : null
  const colReacCap  = cols["energia_reactiva_cap_pen"] ? resolveCol(headers, cols["energia_reactiva_cap_pen"]) : null
  const colValReac  = cols["valor_reactiva_cop"]        ? resolveCol(headers, cols["valor_reactiva_cop"])       : null
  const colTarReac  = cols["tarifa_reactiva"]            ? resolveCol(headers, cols["tarifa_reactiva"])          : null
  const colTarSDL   = cols["tarifa_sdl"]                 ? resolveCol(headers, cols["tarifa_sdl"])               : null
  const colFactorM  = cols["factor_m"]                   ? resolveCol(headers, cols["factor_m"])                 : null

  const dispHeaders = headers.slice(0, 20).map(h => `"${h}"`).join(", ")
  if (!colFrontera) {
    erroresCriticos.push(`Columna codigo_frontera no encontrada: "${cols["codigo_frontera"]}". Disponibles: [${dispHeaders}]`)
  }
  if (!colEnergia) {
    erroresCriticos.push(`Columna energia_kwh no encontrada: "${cols["energia_kwh"]}". Disponibles: [${dispHeaders}]`)
  }
  if (valorCopKey && !colValor) {
    erroresCriticos.push(`Columna valor_cop no encontrada: "${valorCopKey}". Disponibles: [${dispHeaders}]`)
  }
  if (erroresCriticos.length > 0) return { filas, alertas, erroresCriticos }

  // ── Row filter ─────────────────────────────────────────────────────────────
  const filtro = m.filtro_filas
  if (filtro) {
    const colF = resolveCol(headers, filtro.columna)
    if (colF) {
      rows = rows.filter(r => r[colF]?.trim().toUpperCase() === filtro.valor.trim().toUpperCase())
    }
  }

  const splitChar    = m.codigo_frontera_split ?? null
  const periodoDefault = `${anio}-${String(mes).padStart(2, "0")}`
  const fronterasVistas = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i]!
    const fila   = i + 2 // 1-based with header

    let codFrontera = (row[colFrontera!] ?? "").trim()
    if (!codFrontera) continue
    if (splitChar && codFrontera.includes(splitChar)) {
      codFrontera = codFrontera.split(splitChar)[0]!.trim()
    }

    const esDuplicado = fronterasVistas.has(codFrontera)
    if (esDuplicado) {
      alertas.push(`Fila ${fila}: frontera duplicada en el archivo: ${codFrontera}`)
    }
    fronterasVistas.add(codFrontera)

    const energia = toNum(row[colEnergia!])
    // null valor_cop → default to 0 (row is still valid; preserves row count)
    const valor   = colValor ? (toNum(row[colValor]) ?? 0) : 0

    if (energia == null) continue // blank/summary row — skip silently
    if (energia < 0) {
      erroresCriticos.push(`Fila ${fila}: energía negativa`); continue
    }
    if (valor < 0) {
      erroresCriticos.push(`Fila ${fila}: valor_cop negativo`); continue
    }

    const tarifaSDL = colTarSDL
      ? (toNum(row[colTarSDL]) ?? 0)
      : energia > 0 ? valor / energia : 0

    const periodoSDL = colPeriodo
      ? ((row[colPeriodo] ?? "").trim() || periodoDefault)
      : periodoDefault

    // Use null (not undefined) for optional fields so JSON serialization keeps
    // the keys and the preview table can show all columns regardless of which
    // row appears first.
    filas.push({
      codigo_frontera:          codFrontera,
      nombre_frontera:          colNombre  ? (row[colNombre]?.trim()  || null) : null,
      periodo_sdl:              periodoSDL,
      energia_sdl_kwh:          energia,
      valor_sdl_cop:            valor,
      tarifa_sdl:               tarifaSDL,
      nivel_tension:            colTension ? (row[colTension]?.trim() || null) : null,
      propiedad_activos:        colProp    ? (row[colProp]?.trim()    || null) : null,
      energia_reactiva_ind_pen: colReacInd ? toNum(row[colReacInd])          : null,
      energia_reactiva_cap_pen: colReacCap ? toNum(row[colReacCap])          : null,
      valor_reactiva_cop:       colValReac ? toNum(row[colValReac])          : null,
      tarifa_reactiva:          colTarReac ? toNum(row[colTarReac])          : null,
      factor_m:                 colFactorM ? toNum(row[colFactorM])          : null,
      es_duplicado:             esDuplicado,
    } as FilaSDL)
  }

  return { filas, alertas, erroresCriticos }
}
