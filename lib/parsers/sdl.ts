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
    // Intento UTF-8 primero; si aparecen caracteres de reemplazo (�),
    // el archivo es Latin-1 / cp1252 y reintentamos con ese encoding.
    let text = buffer.toString("utf8")
    if (text.includes("�")) {
      text = buffer.toString("latin1")
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

  // Auto-detect header row: si la fila indicada por fila_inicio no parece
  // contener headers (pocas celdas con texto, ningún término esperado),
  // escanea las primeras 15 filas y elige la que mejor coincida.
  const finalSkip = detectHeaderRow(raw, skip)

  const rawHeaders = (raw[finalSkip] ?? []).map(h => String(h ?? "").trim())

  // Algunos archivos (EEP Pereira/Cartago) tienen DOS columnas con el mismo
  // header (ej. "Tarifa Reactiva" debajo de "Reactiva Capacitiva" y debajo de
  // "Reactiva Inductiva"). Sin prefijo de grupo, ambas se mapean al mismo
  // key del Row y la segunda sobreescribe a la primera.
  // Fix: si hay duplicados, leer la fila anterior (que en archivos con merged
  // cells suele tener el header de grupo) y usarla como prefijo.
  const countByNorm = new Map<string, number>()
  for (const h of rawHeaders) {
    const n = norm(h)
    if (n) countByNorm.set(n, (countByNorm.get(n) ?? 0) + 1)
  }
  const prevRow = finalSkip > 0
    ? (raw[finalSkip - 1] ?? []).map(h => String(h ?? "").trim())
    : []
  const headers = rawHeaders.map((h, j) => {
    const n = norm(h)
    if (!n || (countByNorm.get(n) ?? 0) <= 1) return h
    // Buscar el header de grupo en la fila anterior. Cuando hay merged cells
    // en xlsx, el valor solo aparece en la primera columna del rango; las
    // demas vienen vacias. Por eso miramos hacia la izquierda si la celda
    // directa esta vacia.
    let group: string = prevRow[j] ?? ""
    if (!group) {
      for (let k = j - 1; k >= 0; k--) {
        const prev = prevRow[k]
        if (prev) { group = prev; break }
      }
    }
    return group ? `${group} ${h}` : h
  })

  const rows: Row[] = []
  for (let i = finalSkip + 1; i < raw.length; i++) {
    const vals = raw[i] ?? []
    const row: Row = {}
    headers.forEach((h, j) => { row[h] = String(vals[j] ?? "").trim() })
    rows.push(row)
  }
  return rows
}

// Detecta la fila de cabecera con score = (matches a términos típicos * 10)
// + cantidad de celdas con texto no vacío. Las cabeceras suelen tener muchas
// columnas de texto y contener palabras como SIC, CODIGO, ACTIVA, FRONTERA…
function detectHeaderRow(raw: (string | number)[][], hint: number): number {
  const TERMS = [
    "SIC", "CODIGO", "CÓDIGO", "FRONTERA", "ACTIVA", "REACTIVA",
    "TENSION", "TENSIÓN", "PEAJE", "FACTOR", "VALOR", "PERIODO",
    "CONSUMO", "ENERGIA", "ENERGÍA", "NIVEL",
  ]
  const score = (row: (string | number)[] | undefined): number => {
    if (!row) return -1
    const cells = row.map(v => String(v ?? "").trim())
    const nonEmpty = cells.filter(c => c.length > 0).length
    if (nonEmpty < 3) return -1
    const textCells = cells.filter(c => c.length > 0 && isNaN(Number(c.replace(/,/g, "")))).length
    const joined = cells.join(" ").toUpperCase()
    const matches = TERMS.filter(t => joined.includes(t)).length
    return matches * 100 + textCells * 5 + nonEmpty
  }

  let best = hint
  let bestScore = score(raw[hint])

  // Si la fila hint ya tiene buen score (≥1 match a término típico), confiar en ella
  if (bestScore >= 100) return hint

  // Si no, escanear las primeras 15 filas
  const maxScan = Math.min(15, raw.length)
  for (let i = 0; i < maxScan; i++) {
    const s = score(raw[i])
    if (s > bestScore) { best = i; bestScore = s }
  }
  return best
}

// ─── Preprocessors ────────────────────────────────────────────────────────────
// Each returns { rows, mapeo } with any calculated columns added to rows
// and column-name overrides added to mapeo.columnas.

type PreResult = { rows: Row[]; mapeo: MapeoSDL }

// Convert "dd/m/aaaa", "dd/mm/yyyy", "yyyy-mm-dd" → "AAAA-MM"
function fechaAPeriodo(s: string): string | null {
  const v = s.trim()
  if (!v || ["nan", "none", ""].includes(v.toLowerCase())) return null
  for (const sep of ["/", "-"]) {
    const parts = v.split(sep)
    if (parts.length === 3) {
      const [a, b, c] = [parts[0]!.trim(), parts[1]!.trim(), parts[2]!.trim()]
      if (c.length === 4) {
        const m = parseInt(b, 10)
        if (!isNaN(m)) return `${c}-${String(m).padStart(2, "0")}`
      }
      if (a.length === 4) {
        const m = parseInt(b, 10)
        if (!isNaN(m)) return `${a}-${String(m).padStart(2, "0")}`
      }
    }
  }
  return null
}

function preAfinia(rows: Row[], mapeo: MapeoSDL, buffer: Buffer): PreResult {
  const m    = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  // 1. Nombre de frontera: DES_CLIENTE
  const colDes = resolveCol(headers, "DES_CLIENTE")
  if (colDes) cols["nombre_frontera"] = colDes

  // 2. Valor activa = "PEAJES REGIONALES REGULADOS OTROS"
  //                 + "PEAJES REGIONALES NO REGULADOS OTRO"
  const colReg   = resolveCol(headers, "PEAJES REGIONALES REGULADOS OTROS")
  const colNoreg = resolveCol(headers, "PEAJES REGIONALES NO REGULADOS OTRO")
  if (colReg && colNoreg) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_ACTIVA__: String(
        (toNum(r[colReg]) ?? 0) + (toNum(r[colNoreg]) ?? 0)
      ),
    }))
    cols["valor_cop"] = "__VALOR_ACTIVA__"
  }

  // 3. Tarifa reactiva = "PEN. REACTIVA IND ($) - M APLICADA FINAL"
  //                    / "ENERGIA REACTIVA PEAJES"
  //                    / "M"
  const colNum = resolveCol(headers, "PEN. REACTIVA IND ($) - M APLICADA FINAL")
  const colDen = resolveCol(headers, "ENERGIA REACTIVA PEAJES")
  const colMA  = resolveCol(headers, "M")
  if (colNum && colDen && colMA) {
    rows = rows.map(r => {
      const num = toNum(r[colNum])
      const den = toNum(r[colDen])
      const mm  = toNum(r[colMA])
      let tar: number | null = null
      if (num != null && den && den !== 0 && mm && mm !== 0) {
        tar = num / den / mm
      }
      return { ...r, __TARIFA_REACTIVA__: tar != null ? String(tar) : "" }
    })
    cols["tarifa_reactiva"] = "__TARIFA_REACTIVA__"
  }

  // 4. CONSOLIDADO PEAJES sheet: periodo from LIQ_FECHA_INICIO, propiedad lookup
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
        const cColFecha = resolveCol(cHeaders, "LIQ_FECHA_INICIO")
        const cColSIC   = resolveCol(cHeaders, "SIC")
        const cColProp  = resolveCol(cHeaders, "PROPIEDAD_ACTIVOS")
            ?? resolveCol(cHeaders, "PROPIEDAD")

        // Build row dicts once
        const cRows: Row[] = []
        for (let i = 1; i < rawC.length; i++) {
          const cRow: Row = {}
          cHeaders.forEach((h, j) => { cRow[h] = String(rawC[i]?.[j] ?? "").trim() })
          cRows.push(cRow)
        }

        // 4a. Periodo from first valid LIQ_FECHA_INICIO
        if (cColFecha) {
          for (const cr of cRows) {
            const p = fechaAPeriodo(cr[cColFecha] ?? "")
            if (p) {
              rows = rows.map(r => ({ ...r, __PERIODO__: p }))
              cols["periodo"] = "__PERIODO__"
              break
            }
          }
        }

        // 4b. Propiedad lookup by SIC → 0=OR, 1/101=Usuario
        if (cColSIC && cColProp) {
          const propLookup = new Map<string, string>()
          for (const cr of cRows) {
            const sic = (cr[cColSIC] ?? "").trim()
            const propRaw = (cr[cColProp] ?? "").trim()
            const propStripped = propRaw.split(".")[0] ?? propRaw
            if (!sic) continue
            if (propStripped === "0") propLookup.set(sic, "OR")
            else if (propStripped === "1" || propStripped === "101") propLookup.set(sic, "Usuario")
            else if (propRaw && !["nan", "none", ""].includes(propRaw.toLowerCase())) propLookup.set(sic, propRaw)
          }

          const colSIC = resolveCol(headers, cols["codigo_frontera"] ?? "SIC")
          if (colSIC && propLookup.size > 0) {
            rows = rows.map(r => {
              const sic = (r[colSIC] ?? "").trim()
              return { ...r, __PROPIEDAD__: propLookup.get(sic) ?? "" }
            })
            cols["propiedad_activos"] = "__PROPIEDAD__"
          }
        }
      }
    }
  } catch {
    // CONSOLIDADO PEAJES not readable — periodo/propiedad stay unset
  }

  return { rows, mapeo: m }
}

function preAire(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  // ── Core columns: AIRE files use non-standard names ─────────────────────
  const colSic     = resolveCol(headers, "CODIGOSIC")
  const colConsumo = resolveCol(headers, "CONSUMOTOTAL")
  const colValor   = resolveCol(headers, "TRANSPORTEREGIONAL")
  const colCli     = resolveCol(headers, "CLIENTE")
  if (colSic)     cols["codigo_frontera"] = colSic
  if (colConsumo) cols["energia_kwh"]     = colConsumo
  if (colValor)   cols["valor_cop"]       = colValor
  if (colCli)     cols["nombre_frontera"] = colCli

  // ── Energía reactiva (kWh) ──────────────────────────────────────────────
  // PENALIZACIONREACTIVA  (sin $) = energía reactiva inductiva (kWh)
  // REACTIVACAPACITIVA    (sin $) = energía reactiva capacitiva (kWh)
  // Resolución defensiva: usar índice por nombre exacto para evitar que el
  // substring match agarre "PENALIZACIONREACTIVA$" en vez del kWh.
  const headerIdx: Record<string, string> = {}
  for (const h of headers) headerIdx[norm(h)] = h
  const colKwhInd = headerIdx["PENALIZACIONREACTIVA"] ?? null
  const colKwhCap = headerIdx["REACTIVACAPACITIVA"]   ?? null
  if (colKwhInd) cols["energia_reactiva_ind_pen"] = colKwhInd
  if (colKwhCap) cols["energia_reactiva_cap_pen"] = colKwhCap

  // ── Valor reactiva (COP) = PENALIZACIONREACTIVA$ + REACTIVACAPACITIVA$ ──
  const colValInd = headerIdx["PENALIZACIONREACTIVA$"] ?? null
  const colValCap = headerIdx["REACTIVACAPACITIVA$"]   ?? null
  if (colValInd || colValCap) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_REACTIVA__: String(
        (colValInd ? toNum(r[colValInd]) ?? 0 : 0) +
        (colValCap ? toNum(r[colValCap]) ?? 0 : 0)
      ),
    }))
    cols["valor_reactiva_cop"] = "__VALOR_REACTIVA__"
  }

  // ── Factor M ────────────────────────────────────────────────────────────
  const colFactorM = resolveCol(headers, "FactorM") ?? resolveCol(headers, "Factor M")
  if (colFactorM) cols["factor_m"] = colFactorM

  // ── Tarifa reactiva = PENALIZACIONREACTIVA$ / PENALIZACIONREACTIVA / M ──
  if (colValInd && colKwhInd && colFactorM) {
    rows = rows.map(r => {
      const cop = toNum(r[colValInd])
      const kwh = toNum(r[colKwhInd])
      const fm  = toNum(r[colFactorM])
      let tar: number | null = null
      if (cop != null && kwh && kwh !== 0 && fm && fm !== 0) {
        tar = cop / kwh / fm
      }
      return { ...r, __TARIFA_REACTIVA__: tar != null ? String(tar) : "" }
    })
    cols["tarifa_reactiva"] = "__TARIFA_REACTIVA__"
  }

  // ── Nivel de tensión: extraer dígitos ("N3" → "3", "N2" → "2") ──────────
  const colNT = resolveCol(headers, "NT")
  if (colNT) {
    rows = rows.map(r => ({
      ...r,
      __NT__: (r[colNT] ?? "").replace(/\D/g, "") || "",
    }))
    cols["nivel_tension"] = "__NT__"
  }

  // ── Propiedad: NT 2/3 → Usuario; NT 1 → leer columna PROPIETARIO_ACTIVO ─
  const colProp = resolveCol(headers, "PROPIETARIO_ACTIVO")
  if (colNT || colProp) {
    rows = rows.map(r => {
      const ntStr = (r["__NT__"] ?? "").trim()
      const nt    = parseInt(ntStr, 10)
      let mapped = ""
      if (nt === 2 || nt === 3) {
        mapped = "Usuario"
      } else if (nt === 1 && colProp) {
        const v = (r[colProp] ?? "").trim().toUpperCase()
        if      (v.includes("OPERADOR DE RED")) mapped = "OR"
        else if (v.includes("USUARIO"))         mapped = "Usuario"
        else                                     mapped = (r[colProp] ?? "").trim()
      } else if (colProp) {
        // NT vacío/ilegible — usar la columna directamente como respaldo
        const v = (r[colProp] ?? "").trim().toUpperCase()
        if      (v.includes("OPERADOR DE RED")) mapped = "OR"
        else if (v.includes("USUARIO"))         mapped = "Usuario"
        else                                     mapped = (r[colProp] ?? "").trim()
      }
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }

  return { rows, mapeo: m }
}

// ─── CELSIA_TOLIMA (también CELSIA_VALLE y CETSA — mismo formato) ────────────
function preCelsiaTolima(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  // Mapeo explícito de columnas (el seed tiene caracteres corruptos como
  // "C?igo SIC" porque se guardó sin UTF-8). El preprocesador resuelve
  // los nombres correctos directamente desde el archivo decodificado.
  const colSic     = resolveCol(headers, "Código SIC")  ?? resolveCol(headers, "Codigo SIC")
  const colNT      = resolveCol(headers, "Nivel Tensión") ?? resolveCol(headers, "Nivel Tension")
  const colKwh     = resolveCol(headers, "Activa KWh")
  const colValor   = resolveCol(headers, "$Peaje Activa")
  const colValReac = resolveCol(headers, "$Peaje Reactiva")
  const colReacInd = resolveCol(headers, "Reactiva Inductiva Penalizada kVAr")
  const colReacCap = resolveCol(headers, "Reactiva Capacitiva Penal kVAr")
  const colFactorM = resolveCol(headers, "Factor M")
  const colTarAct  = resolveCol(headers, "Tarifa Activa $/KWh")
  const colTarReac = resolveCol(headers, "Tarifa Reactiva $/kVAr")
  const colNombre  = resolveCol(headers, "Nombre Facturación")
                  ?? resolveCol(headers, "Nombre Facturacion")

  if (colSic)     cols["codigo_frontera"]          = colSic
  if (colNT)      cols["nivel_tension"]            = colNT
  if (colKwh)     cols["energia_kwh"]              = colKwh
  if (colValor)   cols["valor_cop"]                = colValor
  if (colValReac) cols["valor_reactiva_cop"]       = colValReac
  if (colReacInd) cols["energia_reactiva_ind_pen"] = colReacInd
  if (colReacCap) cols["energia_reactiva_cap_pen"] = colReacCap
  if (colFactorM) cols["factor_m"]                 = colFactorM
  if (colTarAct)  cols["tarifa_sdl"]               = colTarAct
  if (colTarReac) cols["tarifa_reactiva"]          = colTarReac
  if (colNombre)  cols["nombre_frontera"]          = colNombre

  // Propiedad: 100% USUARIO/N/A → Usuario, 100% OPERADOR → OR, 50% OPERADOR → Compartido
  const colProp = resolveCol(headers, "Propiedad Activo")
  if (colProp) {
    rows = rows.map(r => {
      const v = (r[colProp] ?? "").trim().toUpperCase()
      let mapped: string
      if (v === "N/A" || v === "" || v.includes("USUARIO")) mapped = "Usuario"
      else if (v.includes("50%") && v.includes("OPERADOR")) mapped = "Compartido"
      else if (v.includes("OPERADOR")) mapped = "OR"
      else mapped = (r[colProp] ?? "").trim()
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }
  return { rows, mapeo: m }
}

// ─── CENS ────────────────────────────────────────────────────────────────────
function preCens(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  const CENS_PROP: Record<string, string> = {
    "1_100": "OR", "1_50": "Compartido", "1_0": "Usuario",
    "1-0":   "Usuario", "2_100": "Usuario", "2_0": "Usuario",
  }

  // NT_PRO → "1_100" => "1" | "1-0" => "1"
  const colNTPRO = resolveCol(headers, "NT_PRO")
  if (colNTPRO) {
    rows = rows.map(r => {
      const raw = (r[colNTPRO] ?? "").trim()
      const nt = (raw.split("_")[0] ?? "").split("-")[0] ?? ""
      const prop = CENS_PROP[raw] ?? ""
      return { ...r, __NT__: nt, __PROPIEDAD__: prop }
    })
    cols["nivel_tension"]     = "__NT__"
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }

  // Valor reactiva = Valor R_Inductiva + Valor R_Capacitiva
  const colValInd = resolveCol(headers, "Valor R_Inductiva")
  const colValCap = resolveCol(headers, "Valor R_Capacitiva")
  if (colValInd || colValCap) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_REACTIVA__: String(
        (colValInd ? toNum(r[colValInd]) ?? 0 : 0) +
        (colValCap ? toNum(r[colValCap]) ?? 0 : 0)
      ),
    }))
    cols["valor_reactiva_cop"] = "__VALOR_REACTIVA__"
  }

  // Tarifa reactiva: se toma directamente de la columna "Tarifa Reactiva"
  // del archivo (configurado en el mapeo). Antes la calculabamos como
  // Valor R_Inductiva / R_Inductiva / Factor M, pero eso fallaba cuando
  // reactiva = 0 (division por cero -> null) en fronteras donde el archivo
  // si traia el valor explicito.

  return { rows, mapeo: m }
}

// ─── CEO ─────────────────────────────────────────────────────────────────────
function preCeo(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  // Mapeo explícito (en caso de que el seed tenga nombres ligeramente
  // distintos por encoding o variantes del archivo)
  const colSic     = resolveCol(headers, "Código SIC") ?? resolveCol(headers, "Codigo SIC")
  const colKwh     = resolveCol(headers, "Activa KWh")
  const colValor   = resolveCol(headers, "$ Peaje Activa") ?? resolveCol(headers, "$Peaje Activa")
  const colValReac = resolveCol(headers, "$ Peaje Reactiva") ?? resolveCol(headers, "$Peaje Reactiva")
  const colReacInd = resolveCol(headers, "Reactiva Inductiva Penal kVAr")
  const colFactorM = resolveCol(headers, "Factor_m") ?? resolveCol(headers, "Factor M")
  const colNT      = resolveCol(headers, "Nivel Tensión") ?? resolveCol(headers, "Nivel Tension")
  const colPer     = resolveCol(headers, "Periodo")

  if (colSic)     cols["codigo_frontera"]          = colSic
  if (colKwh)     cols["energia_kwh"]              = colKwh
  if (colValor)   cols["valor_cop"]                = colValor
  if (colValReac) cols["valor_reactiva_cop"]       = colValReac
  if (colReacInd) cols["energia_reactiva_ind_pen"] = colReacInd
  if (colFactorM) cols["factor_m"]                 = colFactorM
  if (colNT)      cols["nivel_tension"]            = colNT
  if (colPer)     cols["periodo"]                  = colPer

  // Propiedad: 100% OPERADOR → OR | 100% USUARIO → Usuario
  const colProp = resolveCol(headers, "Propiedad Activo")
  if (colProp) {
    rows = rows.map(r => {
      const v = (r[colProp] ?? "").trim().toUpperCase()
      const mapped = v.includes("OPERADOR") ? "OR"
                   : v.includes("USUARIO")  ? "Usuario"
                   : (r[colProp] ?? "").trim()
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }
  return { rows, mapeo: m }
}

// ─── CHEC ────────────────────────────────────────────────────────────────────
function preChec(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  // Propiedad from "PORCENTAJE CDI": 0%→Usuario, 50%→Compartido, 100%→OR
  const colProp = resolveCol(headers, "PORCENTAJE CDI")
  if (colProp) {
    rows = rows.map(r => {
      const v = (r[colProp] ?? "").trim().toUpperCase()
      let mapped: string
      if (v.startsWith("0%"))        mapped = "Usuario"
      else if (v.startsWith("50%"))  mapped = "Compartido"
      else if (v.startsWith("100%")) mapped = "OR"
      else mapped = (r[colProp] ?? "").trim()
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }
  return { rows, mapeo: m }
}

// ─── EBSA (vertical → horizontal pivot) ──────────────────────────────────────
function preEbsa(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m    = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  const colSic    = resolveCol(headers, "CODIGO SIC")
  const colEng    = resolveCol(headers, "ENERGIA")
  const colKwh    = resolveCol(headers, "KW-H")
  const colValor  = resolveCol(headers, "VALOR")
  const colNT     = resolveCol(headers, "NT")
  const colAnio   = resolveCol(headers, "AÑO") ?? resolveCol(headers, "ANO")
  const colMes    = resolveCol(headers, "MES")
  const colPer    = resolveCol(headers, "PERIODO")
  const colValorM = resolveCol(headers, "VALOR M")

  if (!colSic || !colEng) return { rows, mapeo: m }

  const activas:  Row[] = []
  const reactivas: Row[] = []
  for (const r of rows) {
    const e = (r[colEng] ?? "").trim().toUpperCase()
    if (e === "ACTIVA")    activas.push(r)
    else if (e === "REACTIVA") reactivas.push(r)
  }
  if (activas.length === 0) return { rows, mapeo: m }

  // Base: first ACTIVA per SIC
  const baseMap = new Map<string, Row>()
  for (const a of activas) {
    const sic = (a[colSic] ?? "").trim()
    if (sic && !baseMap.has(sic)) baseMap.set(sic, { ...a })
  }
  let base = Array.from(baseMap.values())

  // Periodo from AÑO + MES (first valid row)
  if (colAnio && colMes) {
    for (const a of activas) {
      const ay = (a[colAnio] ?? "").trim()
      const my = (a[colMes]  ?? "").trim()
      if (ay && my && !["nan", "none", ""].includes(ay.toLowerCase())) {
        const aN = parseInt(ay, 10)
        const mN = parseInt(my, 10)
        if (!isNaN(aN) && !isNaN(mN)) {
          const per = `${aN}-${String(mN).padStart(2, "0")}`
          base = base.map(r => ({ ...r, __PERIODO__: per }))
          cols["periodo"] = "__PERIODO__"
          break
        }
      }
    }
  }

  // Group reactivas by SIC and sub-type
  const reactBySic = new Map<string, Row[]>()
  const reactIndBySic = new Map<string, Row[]>()
  const reactCapBySic = new Map<string, Row[]>()
  for (const r of reactivas) {
    const sic = (r[colSic] ?? "").trim()
    if (!sic) continue
    if (!reactBySic.has(sic)) reactBySic.set(sic, [])
    reactBySic.get(sic)!.push(r)
    if (colPer) {
      const p = (r[colPer] ?? "").toUpperCase()
      if (p.includes("MONOMIA")) {
        if (!reactIndBySic.has(sic)) reactIndBySic.set(sic, [])
        reactIndBySic.get(sic)!.push(r)
      }
      if (p.includes("CAPACIT")) {
        if (!reactCapBySic.has(sic)) reactCapBySic.set(sic, [])
        reactCapBySic.get(sic)!.push(r)
      }
    } else {
      if (!reactIndBySic.has(sic)) reactIndBySic.set(sic, [])
      reactIndBySic.get(sic)!.push(r)
    }
  }

  // Valor reactiva (sum VALOR all REACTIVA rows by SIC)
  if (colValor && reactBySic.size > 0) {
    base = base.map(b => {
      const sic = (b[colSic] ?? "").trim()
      const sum = (reactBySic.get(sic) ?? [])
        .reduce((s, r) => s + (toNum(r[colValor]) ?? 0), 0)
      return { ...b, __VALOR_REAC__: String(sum) }
    })
    cols["valor_reactiva_cop"] = "__VALOR_REAC__"
  }

  // Factor M cascade: reactIndBySic → reactBySic → activas
  const fmLookup = new Map<string, number>()
  if (colValorM) {
    const firstValid = (arr: Row[]): number | null => {
      for (const r of arr) {
        const n = toNum(r[colValorM])
        if (n != null) return n
      }
      return null
    }
    for (const sic of new Set([...reactBySic.keys(), ...activas.map(a => (a[colSic] ?? "").trim())])) {
      if (!sic) continue
      const fromInd = firstValid(reactIndBySic.get(sic) ?? [])
      const fromReac = fromInd != null ? fromInd : firstValid(reactBySic.get(sic) ?? [])
      const final = fromReac != null ? fromReac : firstValid(activas.filter(a => (a[colSic] ?? "").trim() === sic))
      if (final != null) fmLookup.set(sic, final)
    }
    base = base.map(b => {
      const sic = (b[colSic] ?? "").trim()
      const fm = fmLookup.get(sic)
      return { ...b, __FACTOR_M__: fm != null ? String(fm) : "" }
    })
    cols["factor_m"] = "__FACTOR_M__"
  }

  // Energia reactiva ind/cap (kWh / Factor M)
  if (colKwh && reactIndBySic.size > 0) {
    base = base.map(b => {
      const sic = (b[colSic] ?? "").trim()
      const kwh = (reactIndBySic.get(sic) ?? []).reduce((s, r) => s + (toNum(r[colKwh]) ?? 0), 0)
      const fm  = fmLookup.get(sic) ?? 1
      const val = fm && fm !== 0 ? kwh / fm : kwh
      return { ...b, __REAC_IND__: String(val) }
    })
    cols["energia_reactiva_ind_pen"] = "__REAC_IND__"
  }
  if (colKwh && reactCapBySic.size > 0) {
    base = base.map(b => {
      const sic = (b[colSic] ?? "").trim()
      const kwh = (reactCapBySic.get(sic) ?? []).reduce((s, r) => s + (toNum(r[colKwh]) ?? 0), 0)
      const fm  = fmLookup.get(sic) ?? 1
      const val = fm && fm !== 0 ? kwh / fm : kwh
      return { ...b, __REAC_CAP__: String(val) }
    })
    cols["energia_reactiva_cap_pen"] = "__REAC_CAP__"
  }

  // Tarifa reactiva = Σ VALOR / Σ KWH per SIC
  if (colValor && colKwh && reactBySic.size > 0) {
    base = base.map(b => {
      const sic = (b[colSic] ?? "").trim()
      const reacs = reactBySic.get(sic) ?? []
      const v = reacs.reduce((s, r) => s + (toNum(r[colValor]) ?? 0), 0)
      const k = reacs.reduce((s, r) => s + (toNum(r[colKwh])   ?? 0), 0)
      const tar = k && k > 0 ? v / k : null
      return { ...b, __TARIFA_REAC__: tar != null ? String(tar) : "" }
    })
    cols["tarifa_reactiva"] = "__TARIFA_REAC__"
  }

  // Propiedad from NT: 2/3 → Usuario; 1 → "" (pendiente Tarifas)
  if (colNT) {
    base = base.map(b => {
      const nt = toNum(b[colNT])
      const mapped = (nt === 2 || nt === 3) ? "Usuario" : ""
      return { ...b, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }

  // EBSA pivot done — remove filtro_filas if it was set
  delete m.filtro_filas

  return { rows: base, mapeo: m }
}

// ─── EDEQ ────────────────────────────────────────────────────────────────────
function preEdeq(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  const colNivel  = resolveCol(headers, "Nivel de Tensión  de la Frontera")
                 ?? resolveCol(headers, "Nivel de Tension de la Frontera")
                 ?? resolveCol(headers, "Nivel de Tensión de la Frontera")
  const colProp   = resolveCol(headers, "Propiedad")
  const colValInd = resolveCol(headers, "Valor Reactiva Inductiva Penalizada")
  const colValCap = resolveCol(headers, "Valor Reactiva Capacitiva Penalizada")
  const colKwhInd = resolveCol(headers, "Energía Reactiva Inductiva Penalizada")
                 ?? resolveCol(headers, "Energia Reactiva Inductiva Penalizada")
  const colFactor = resolveCol(headers, "Factor M (Energia Reactiva )")
                 ?? resolveCol(headers, "Factor M (Energia Reactiva)")
                 ?? resolveCol(headers, "Factor M")

  // 1. Nivel = first digits of "Nivel 1 ..."
  if (colNivel) {
    rows = rows.map(r => {
      const match = (r[colNivel] ?? "").match(/\d+/)
      return { ...r, __NIVEL__: match ? match[0] : ((r[colNivel] ?? "").trim()) }
    })
    cols["nivel_tension"] = "__NIVEL__"
  }

  // 2. Propiedad: 100% EDEQ → OR, 100% USUARIO → Usuario, N/A + nivel 2/3 → Usuario
  if (colProp) {
    rows = rows.map(r => {
      const v = (r[colProp] ?? "").trim().toUpperCase()
      const niv = parseInt((r["__NIVEL__"] ?? "").trim(), 10)
      let mapped: string
      if (v.includes("EDEQ"))         mapped = "OR"
      else if (v.includes("USUARIO")) mapped = "Usuario"
      else if (v === "N/A" || v.includes("N/A")) {
        mapped = (niv === 2 || niv === 3) ? "Usuario" : ""
      } else mapped = (r[colProp] ?? "").trim()
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }

  // 3. Valor reactiva = Ind + Cap
  if (colValInd || colValCap) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_REAC__: String(
        (colValInd ? toNum(r[colValInd]) ?? 0 : 0) +
        (colValCap ? toNum(r[colValCap]) ?? 0 : 0)
      ),
    }))
    cols["valor_reactiva_cop"] = "__VALOR_REAC__"
  }

  // 4. Tarifa reactiva = Valor Ind / KWH Ind / Factor M
  if (colValInd && colKwhInd && colFactor) {
    rows = rows.map(r => {
      const v = toNum(r[colValInd])
      const k = toNum(r[colKwhInd])
      const f = toNum(r[colFactor])
      let tar: number | null = null
      if (v != null && k && k !== 0) {
        tar = v / k
        if (f && f !== 0) tar = tar / f
      }
      return { ...r, __TARIFA_REAC__: tar != null ? String(tar) : "" }
    })
    cols["tarifa_reactiva"] = "__TARIFA_REAC__"
  }

  return { rows, mapeo: m }
}

// ─── EEP_CARTAGO / EEP_PEREIRA ──────────────────────────────────────────────
function preEepc(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  const colNT     = resolveCol(headers, "Nivel Tension")
  const colValInd = resolveCol(headers, "Valor $ Reactiva Inductiva")
  const colValCap = resolveCol(headers, "Valor $ Reactiva Capacitiva")

  // Propiedad: NT 2/3 → Usuario; NT 1 → "" (pendiente Tarifas)
  if (colNT) {
    rows = rows.map(r => {
      const nt = toNum(r[colNT])
      const mapped = (nt === 2 || nt === 3) ? "Usuario" : ""
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }

  // Valor reactiva = Ind + Cap
  if (colValInd || colValCap) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_REAC__: String(
        (colValInd ? toNum(r[colValInd]) ?? 0 : 0) +
        (colValCap ? toNum(r[colValCap]) ?? 0 : 0)
      ),
    }))
    cols["valor_reactiva_cop"] = "__VALOR_REAC__"
  }

  return { rows, mapeo: m }
}

// ─── EMSA (multi-file; current wizard supports only 1 file) ─────────────────
function preEmsa(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  // Map core columns from Activa file
  const colCodigo = resolveCol(headers, "CODIGO")
  if (colCodigo) cols["codigo_frontera"] = colCodigo

  const colKwh = resolveCol(headers, "kWhR")
  if (colKwh) cols["energia_kwh"] = colKwh

  // valor_cop placeholder = 0 until Tarifas SDL module exists
  rows = rows.map(r => ({ ...r, __VALOR_COP__: "0" }))
  cols["valor_cop"] = "__VALOR_COP__"

  // Periodo from ANO + MES
  const colAno = resolveCol(headers, "ANO") ?? resolveCol(headers, "AÑO")
  const colMes = resolveCol(headers, "MES")
  if (colAno && colMes) {
    rows = rows.map(r => {
      const a = parseInt((r[colAno] ?? "").trim(), 10)
      const me = parseInt((r[colMes] ?? "").trim(), 10)
      const per = (!isNaN(a) && !isNaN(me)) ? `${a}-${String(me).padStart(2, "0")}` : ""
      return { ...r, __PERIODO__: per }
    })
    cols["periodo"] = "__PERIODO__"
  }

  // Nivel from "Nivel" column if exists
  const colNivel = resolveCol(headers, "Nivel")
  if (colNivel) cols["nivel_tension"] = colNivel

  return { rows, mapeo: m }
}

// ─── ESSA ────────────────────────────────────────────────────────────────────
function preEssa(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  // Auto-detect Factor M column: "M ENE", "M FEB", "M MAR", ...
  const factorMRegex = /^M\s+[A-Z]{2,4}$/
  let colFactorM: string | null = null
  for (const h of headers) {
    if (factorMRegex.test(norm(h))) { colFactorM = h; break }
  }
  if (colFactorM) cols["factor_m"] = colFactorM

  const colNT   = resolveCol(headers, "NIVEL TENSION")
  const colProp = resolveCol(headers, "PROPIEDAD")
  const colInd  = resolveCol(headers, "PEAJE INDUCTIVA")
  const colCap  = resolveCol(headers, "PEAJE CAPACITIVA")

  // Propiedad: NT 2/3 → Usuario; NT 1 + PROP=1 → Usuario; NT 1 + PROP=2 → OR
  if (colNT) {
    rows = rows.map(r => {
      const nt = toNum(r[colNT])
      let mapped = ""
      if (nt === 2 || nt === 3) mapped = "Usuario"
      else if (nt === 1 && colProp) {
        const p = toNum(r[colProp])
        if      (p === 1) mapped = "Usuario"
        else if (p === 2) mapped = "OR"
      }
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }

  // Valor reactiva = PEAJE INDUCTIVA + PEAJE CAPACITIVA
  if (colInd || colCap) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_REAC__: String(
        (colInd ? toNum(r[colInd]) ?? 0 : 0) +
        (colCap ? toNum(r[colCap]) ?? 0 : 0)
      ),
    }))
    cols["valor_reactiva_cop"] = "__VALOR_REAC__"
  }

  return { rows, mapeo: m }
}

// ─── RUITOQUE ────────────────────────────────────────────────────────────────
function preRuitoque(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  const colNT     = resolveCol(headers, "NT")
  const colValInd = resolveCol(headers, "Valor R_Inductiva")
  const colValCap = resolveCol(headers, "Valor R_Capacitiva")

  // Propiedad: NT 2/3 → Usuario, NT 1 → "" (pendiente Tarifas)
  if (colNT) {
    rows = rows.map(r => {
      const nt = toNum(r[colNT])
      const mapped = (nt === 2 || nt === 3) ? "Usuario" : ""
      return { ...r, __PROPIEDAD__: mapped }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }

  // Valor reactiva = Ind + Cap
  if (colValInd || colValCap) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_REAC__: String(
        (colValInd ? toNum(r[colValInd]) ?? 0 : 0) +
        (colValCap ? toNum(r[colValCap]) ?? 0 : 0)
      ),
    }))
    cols["valor_reactiva_cop"] = "__VALOR_REAC__"
  }

  return { rows, mapeo: m }
}

// ─── ENEL (multi-file; current wizard supports only 1 file) ─────────────────
function preEnel(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  // Map core columns from Activa file
  // Look for "SIC" in headers
  let colSic: string | null = null
  for (const h of headers) {
    if (norm(h).includes("SIC")) { colSic = h; break }
  }
  if (colSic) cols["codigo_frontera"] = colSic

  const colKwh        = resolveCol(headers, "CONSUMO ACTIVA")
  const colNT         = resolveCol(headers, "NIVEL TENSION")
  const colValorAct   = resolveCol(headers, "VALOR SDL ACT")
  const colValorReac  = resolveCol(headers, "VALOR SDL REAC")

  if (colKwh)       cols["energia_kwh"]       = colKwh
  if (colNT)        cols["nivel_tension"]     = colNT
  if (colValorAct)  cols["valor_cop"]         = colValorAct
  if (colValorReac) cols["valor_reactiva_cop"] = colValorReac

  // tarifa_sdl = VALOR SDL ACT / CONSUMO ACTIVA
  if (colValorAct && colKwh) {
    rows = rows.map(r => {
      const v = toNum(r[colValorAct])
      const k = toNum(r[colKwh])
      const tar = (v != null && k && k !== 0) ? v / k : null
      return { ...r, __TARIFA_ACT__: tar != null ? String(tar) : "" }
    })
    cols["tarifa_sdl"] = "__TARIFA_ACT__"
  }

  return { rows, mapeo: m }
}

// ─── CEDENAR ─────────────────────────────────────────────────────────────────
function preCedenar(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  const colTarAct  = resolveCol(headers, "VALOR TARIFA ACTIVA ($)")
  const colTarReac = resolveCol(headers, "VALOR TARIFA REACTIVA ($)")
  const colActiva  = resolveCol(headers, "Activa")
  const colPenal   = resolveCol(headers, "Penalizada")
  const colTarifaI = resolveCol(headers, "TARIFA I")
  const colUsuario = resolveCol(headers, "USUARIO")

  // Nombre de frontera: columna USUARIO
  if (colUsuario) cols["nombre_frontera"] = colUsuario

  // Tarifa SDL (activa): viene directa de "VALOR TARIFA ACTIVA ($)"
  if (colTarAct) cols["tarifa_sdl"] = colTarAct

  // Tarifa reactiva: viene directa de "VALOR TARIFA REACTIVA ($)"
  if (colTarReac) cols["tarifa_reactiva"] = colTarReac

  // Valor activa = VALOR TARIFA ACTIVA × Activa
  if (colTarAct && colActiva) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_ACTIVA__: String(
        (toNum(r[colTarAct]) ?? 0) * (toNum(r[colActiva]) ?? 0)
      ),
    }))
    cols["valor_cop"] = "__VALOR_ACTIVA__"
  }

  // Valor reactiva = Penalizada × VALOR TARIFA REACTIVA
  if (colPenal && colTarReac) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_REACTIVA__: String(
        (toNum(r[colPenal]) ?? 0) * (toNum(r[colTarReac]) ?? 0)
      ),
    }))
    cols["valor_reactiva_cop"] = "__VALOR_REACTIVA__"
  }

  // Propiedad from TARIFA I: 300/301→Usuario, 324→Compartido, 312→OR
  if (colTarifaI) {
    const M: Record<string, string> = { "300": "Usuario", "301": "Usuario", "324": "Compartido", "312": "OR" }
    rows = rows.map(r => {
      const raw = (r[colTarifaI] ?? "").trim().split(".")[0] ?? ""
      return { ...r, __PROPIEDAD__: M[raw] ?? "" }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }

  return { rows, mapeo: m }
}

// ─── ENERCA ──────────────────────────────────────────────────────────────────
//
// Archivo unico, headers en fila 4 / datos desde fila 5 (fila_inicio: 5).
// Mapeo directo se define en el seed; aqui solo dos transformaciones:
//
// 1. propiedad_activos: leer columna 'PROPIEDAD DE ACTIVO' + 'NT'.
//    - Si NT = 2 o 3 -> "Usuario" (siempre)
//    - Si NT = 1: "SI" -> Usuario, "NO" -> OR
//
// 2. valor_reactiva_cop = 'REACTIVA EN EXCESO LIQUIDADO' +
//    'CAPACTIVA EN EXCESO LIQUIDADO' (sumar las dos columnas).
function preEnerca(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  const colNT       = resolveCol(headers, "NT")
  const colPropRaw  = resolveCol(headers, "PROPIEDAD DE ACTIVO")
  if (colNT && colPropRaw) {
    rows = rows.map(r => {
      const nt = toNum(r[colNT])
      const propRaw = (r[colPropRaw] ?? "").trim().toUpperCase()
      let prop = ""
      if (nt === 2 || nt === 3) {
        prop = "Usuario"
      } else if (nt === 1) {
        if (propRaw === "SI" || propRaw === "SÍ") prop = "Usuario"
        else if (propRaw === "NO")                 prop = "OR"
      }
      return { ...r, __PROPIEDAD__: prop }
    })
    cols["propiedad_activos"] = "__PROPIEDAD__"
  }

  const colValReac = resolveCol(headers, "REACTIVA EN EXCESO LIQUIDADO")
  const colValCap  = resolveCol(headers, "CAPACTIVA EN EXCESO LIQUIDADO")
                  ?? resolveCol(headers, "CAPACITIVA EN EXCESO LIQUIDADO")
  if (colValReac || colValCap) {
    rows = rows.map(r => ({
      ...r,
      __VALOR_REAC__: String(
        (colValReac ? toNum(r[colValReac]) ?? 0 : 0) +
        (colValCap  ? toNum(r[colValCap])  ?? 0 : 0)
      ),
    }))
    cols["valor_reactiva_cop"] = "__VALOR_REAC__"
  }

  return { rows, mapeo: m }
}

// ─── EPM ───────────────────────────────────────────────────────────────────
//
// EPM envia 2 archivos en momentos distintos (activa y reactiva) que se
// cargan por separado con la accion "agregar" (como EEP Pereira). El
// preprocessor detecta el tipo de archivo por sus headers y mapea segun
// corresponda.
//
// Archivo de ACTIVA: headers en fila 13 / datos desde fila 14 (fila_inicio:14).
//   - Codigo SIC                 -> codigo_frontera
//   - Instalación                -> nombre_frontera
//   - ENERGÍA Activa SDL (KW)    -> energia_kwh
//   - INGRESO Activa SDL($)      -> valor_cop
//   - Cargo por Uso($/KWh)       -> tarifa_sdl
//   - Nivel de Tensión           -> nivel_tension (celda combinada, forward-fill,
//                                   "nivel 2" -> "2")
// Las filas de subtotal ("Total por nivel de tensión (nivel 1): ...") no
// tienen Codigo SIC valido y el parser principal las salta solo.
//
// Archivo de REACTIVA: pendiente de mapear (rama futura).
function preEpm(rows: Row[], mapeo: MapeoSDL, _buf: Buffer): PreResult {
  const m = deepCloneMapeo(mapeo)
  const cols = m.columnas!
  const headers = Object.keys(rows[0] ?? {})

  const colActiva = resolveCol(headers, "ENERGÍA Activa SDL (KW)")
                 ?? resolveCol(headers, "ENERGIA Activa SDL (KW)")
                 ?? resolveCol(headers, "ENERGÍA Activa SDL")
  const esActiva = colActiva != null

  if (esActiva) {
    const colSic    = resolveCol(headers, "Código SIC") ?? resolveCol(headers, "Codigo SIC")
    const colInst   = resolveCol(headers, "Instalación") ?? resolveCol(headers, "Instalacion")
    const colValor  = resolveCol(headers, "INGRESO Activa SDL($)") ?? resolveCol(headers, "INGRESO Activa SDL")
    const colTarifa = resolveCol(headers, "Cargo por Uso($/KWh)") ?? resolveCol(headers, "Cargo por Uso")
    const colNivel  = resolveCol(headers, "Nivel de Tensión") ?? resolveCol(headers, "Nivel de Tension")

    if (colSic)    cols["codigo_frontera"] = colSic
    if (colInst)   cols["nombre_frontera"] = colInst
    if (colActiva) cols["energia_kwh"]     = colActiva
    if (colValor)  cols["valor_cop"]       = colValor
    if (colTarifa) cols["tarifa_sdl"]      = colTarifa

    // Nivel de Tensión: celda combinada -> forward fill. El valor ("nivel 2")
    // aparece una vez al inicio del bloque y las filas siguientes vienen
    // vacias; se arrastra hasta el proximo valor. Extrae el numero.
    if (colNivel) {
      let ultimoNivel = ""
      rows = rows.map(r => {
        const raw = (r[colNivel] ?? "").trim()
        if (raw) {
          const match = raw.match(/(\d+)/)
          if (match) ultimoNivel = match[1]!
        }
        return { ...r, __NIVEL_EPM__: ultimoNivel }
      })
      cols["nivel_tension"] = "__NIVEL_EPM__"
    }
  }

  return { rows, mapeo: m }
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
  ENERCA:        preEnerca,
  EMSA:          preEmsa,
  EPM:           preEpm,
  ESSA:          preEssa,
  RUITOQUE:      preRuitoque,
}

function deepCloneMapeo(m: MapeoSDL): MapeoSDL {
  return { ...m, columnas: { ...(m.columnas ?? {}) } }
}

// ─── EMSA multi-archivo ──────────────────────────────────────────────────────
//
// EMSA envia 3 archivos .xlsx separados por periodo y se combinan en un solo
// RegistroSDL por frontera:
//   - Activa     (sheet ~ SDL-BIAC-15): CODIGO + kWhR (energia activa)
//   - Inductiva  (sheet ~ SDL-BIAC-INDUCTIVA): CODIGO + Nombre + Nivel +
//     TotalInduc (ind_pen) + M (factor_m) + Cobro (valor reactiva ind)
//   - Capacitiva (sheet ~ SDL-CMMC-CAPACITIVA): CODIGO + SumaCapacitiva (cap_pen)
//     + Cobro (valor reactiva cap, se suma al de inductiva)
//
// Politica: si una frontera solo aparece en algunos archivos, se crea el
// registro con los datos que haya (resto null).

type EmsaTipo = "ACTIVA" | "INDUCTIVA" | "CAPACITIVA" | "DESCONOCIDO"

function detectarTipoArchivoEmsa(rows: Row[]): EmsaTipo {
  if (rows.length === 0) return "DESCONOCIDO"
  const headers = Object.keys(rows[0] ?? {})
  const normH = headers.map(h => norm(h))
  if (normH.some(h => h.includes("TOTALINDUC")))      return "INDUCTIVA"
  if (normH.some(h => h.includes("SUMACAPACITIVA")))  return "CAPACITIVA"
  if (normH.some(h => h === "KWHR" || h.includes("KWHR"))) return "ACTIVA"
  return "DESCONOCIDO"
}

type EmsaAcumulado = {
  energia_kwh:              number | null  // de Activa
  nombre_frontera:          string | null  // de Inductiva (Capacitiva fallback)
  nivel_tension:            string | null  // de Inductiva (Capacitiva fallback)
  energia_reactiva_ind_pen: number | null  // de Inductiva
  energia_reactiva_cap_pen: number | null  // de Capacitiva
  factor_m:                 number | null  // de Inductiva (default 1 si no viene)
  cobro_ind:                number          // de Inductiva
  cobro_cap:                number          // de Capacitiva
  tarifa_reactiva:          number | null  // de Inductiva, columna COSTO_DISTRIBUCION
}

function procesarEmsaMulti(
  buffers: Buffer[],
  anio: number,
  mes: number,
  alertas: string[],
  erroresCriticos: string[],
): FilaSDL[] {
  // Mapeo minimo solo para que readRows pueda leer (fila_inicio=2 etc.)
  const mapeoLectura: MapeoSDL = {
    tipo_archivo: "xlsx",
    hoja: 0,
    fila_inicio: 2,
    columnas: {},
  }

  // Leer cada buffer y clasificarlo
  const acumulado = new Map<string, EmsaAcumulado>()
  const tiposVistos = new Set<EmsaTipo>()

  for (let i = 0; i < buffers.length; i++) {
    let rows: Row[] = []
    try {
      rows = readRows(buffers[i]!, mapeoLectura)
    } catch (e) {
      erroresCriticos.push(`Archivo ${i + 1}: no se pudo leer (${e})`)
      continue
    }
    if (rows.length === 0) {
      alertas.push(`Archivo ${i + 1}: sin datos, se ignora.`)
      continue
    }
    const tipo = detectarTipoArchivoEmsa(rows)
    if (tipo === "DESCONOCIDO") {
      alertas.push(
        `Archivo ${i + 1}: no se reconoce como Activa, Inductiva ni Capacitiva ` +
        `(headers esperados: kWhR / TotalInduc / SumaCapacitiva). Se ignora.`,
      )
      continue
    }
    if (tiposVistos.has(tipo)) {
      alertas.push(`Archivo ${i + 1}: tipo ${tipo} ya cargado, sobrescribe al anterior.`)
    }
    tiposVistos.add(tipo)

    const headers = Object.keys(rows[0] ?? {})
    const colCodigo = resolveCol(headers, "CODIGO")
    if (!colCodigo) {
      erroresCriticos.push(`Archivo ${i + 1} (${tipo}): falta columna CODIGO.`)
      continue
    }

    // Filtrar por "AGENTE COMERCIAL QUE IMPORTA" = BIAC. Las filas de otros
    // agentes (ej. CMMC) se omiten en los 3 archivos.
    const colAgente = resolveCol(headers, "AGENTE COMERCIAL QUE IMPORTA")
      ?? resolveCol(headers, "AGENTE COMERCIAL")
    if (colAgente) {
      const antes = rows.length
      rows = rows.filter(r => norm(String(r[colAgente] ?? "")) === "BIAC")
      const omitidas = antes - rows.length
      if (omitidas > 0) {
        alertas.push(`Archivo ${i + 1} (${tipo}): ${omitidas} filas omitidas (AGENTE COMERCIAL QUE IMPORTA distinto de BIAC).`)
      }
    } else {
      alertas.push(`Archivo ${i + 1} (${tipo}): no se halló la columna "AGENTE COMERCIAL QUE IMPORTA"; se cargan todas las filas.`)
    }

    if (tipo === "ACTIVA") {
      const colKwh = resolveCol(headers, "kWhR")
      for (const r of rows) {
        const cod = (r[colCodigo] ?? "").trim()
        if (!cod) continue
        const ent = acumulado.get(cod) ?? blankEmsa()
        if (colKwh) ent.energia_kwh = toNum(r[colKwh])
        acumulado.set(cod, ent)
      }
    } else if (tipo === "INDUCTIVA") {
      const colNom    = resolveCol(headers, "Nombre Frontera (KWH)") ?? resolveCol(headers, "Nombre Frontera") ?? resolveCol(headers, "Nombre")
      const colNivel  = resolveCol(headers, "Nivel")
      const colInduc  = resolveCol(headers, "TotalInduc")
      const colM      = resolveCol(headers, "M")
      const colCobro  = resolveCol(headers, "Cobro")
      const colTar    = resolveCol(headers, "COSTO_DISTRIBUCION") ?? resolveCol(headers, "COSTO DISTRIBUCION")
      for (const r of rows) {
        const cod = (r[colCodigo] ?? "").trim()
        if (!cod) continue
        const ent = acumulado.get(cod) ?? blankEmsa()
        if (colNom)   ent.nombre_frontera          = (r[colNom]?.trim() || null)
        if (colNivel) ent.nivel_tension            = (r[colNivel]?.trim() || null)
        if (colInduc) ent.energia_reactiva_ind_pen = toNum(r[colInduc])
        if (colM)     ent.factor_m                 = toNum(r[colM])
        if (colCobro) ent.cobro_ind                = toNum(r[colCobro]) ?? 0
        if (colTar)   ent.tarifa_reactiva          = toNum(r[colTar])
        acumulado.set(cod, ent)
      }
    } else if (tipo === "CAPACITIVA") {
      const colNom    = resolveCol(headers, "Nombre Frontera (KWH)") ?? resolveCol(headers, "Nombre Frontera") ?? resolveCol(headers, "Nombre")
      const colNivel  = resolveCol(headers, "Nivel")
      const colCap    = resolveCol(headers, "SumaCapacitiva")
      const colCobro  = resolveCol(headers, "Cobro")
      for (const r of rows) {
        const cod = (r[colCodigo] ?? "").trim()
        if (!cod) continue
        const ent = acumulado.get(cod) ?? blankEmsa()
        if (colCap)   ent.energia_reactiva_cap_pen = toNum(r[colCap])
        if (colCobro) ent.cobro_cap                = toNum(r[colCobro]) ?? 0
        // Fallback de Capacitiva si no llego por Inductiva
        if (colNom   && !ent.nombre_frontera) ent.nombre_frontera = (r[colNom]?.trim()   || null)
        if (colNivel && !ent.nivel_tension)   ent.nivel_tension   = (r[colNivel]?.trim() || null)
        acumulado.set(cod, ent)
      }
    }
  }

  // Construir FilaSDL[] a partir del map
  const periodoStr = `${anio}-${String(mes).padStart(2, "0")}`
  const filas: FilaSDL[] = []
  const fronterasVistas = new Set<string>()
  for (const [cod, ent] of acumulado.entries()) {
    if (fronterasVistas.has(cod)) continue
    fronterasVistas.add(cod)
    const energia = ent.energia_kwh ?? 0
    if (energia < 0) {
      erroresCriticos.push(`Frontera ${cod}: energia activa negativa.`)
      continue
    }
    filas.push({
      codigo_frontera:          cod,
      nombre_frontera:          ent.nombre_frontera,
      periodo_sdl:              periodoStr,
      energia_sdl_kwh:          energia,
      // EMSA no trae valor activa hoy (placeholder 0 hasta modulo Tarifas SDL)
      valor_sdl_cop:            0,
      tarifa_sdl:               0,
      nivel_tension:            ent.nivel_tension,
      propiedad_activos:        null,
      energia_reactiva_ind_pen: ent.energia_reactiva_ind_pen,
      energia_reactiva_cap_pen: ent.energia_reactiva_cap_pen,
      valor_reactiva_cop:       ent.cobro_ind + ent.cobro_cap,
      tarifa_reactiva:          ent.tarifa_reactiva,
      // Default factor_m = 1 cuando el archivo Inductiva no lo trae.
      factor_m:                 ent.factor_m ?? 1,
      es_duplicado:             false,
    })
  }
  return filas
}

function blankEmsa(): EmsaAcumulado {
  return {
    energia_kwh: null,
    nombre_frontera: null,
    nivel_tension: null,
    energia_reactiva_ind_pen: null,
    energia_reactiva_cap_pen: null,
    factor_m: null,
    cobro_ind: 0,
    cobro_cap: 0,
    tarifa_reactiva: null,
  }
}

// ─── ENEL multi-archivo ──────────────────────────────────────────────────────
//
// ENEL envia 2 archivos .xlsx por periodo que se combinan por CODIGO SIC:
//   - Preliquidacion consumos:
//       CODIGO SIC, NOMBRE CUENTA CONTRATO, CONSUMO ACTIVA, VALOR SDL ACT,
//       VALOR SDL REAC, NIVEL TENSION
//   - Informe energia reactiva:
//       CODIGO SIC, FACTOR M, EXCESO_REACTIVA_INDUCTIVA, EXCESO_REACTIVA_CAPACITIVA
//
// tarifa_sdl se calcula como VALOR SDL ACT / CONSUMO ACTIVA (igual logica
// que el preprocessor preEnel original).

type EnelTipo = "PRELIQ" | "REACTIVA" | "DESCONOCIDO"

function detectarTipoArchivoEnel(rows: Row[]): EnelTipo {
  if (rows.length === 0) return "DESCONOCIDO"
  const headers = Object.keys(rows[0] ?? {})
  const normH = headers.map(h => norm(h))
  if (normH.some(h => h.includes("EXCESOREACTIVA") || h.includes("EXCESO REACTIVA")))
    return "REACTIVA"
  if (normH.some(h => h.includes("FACTOR M")))
    return "REACTIVA"
  if (normH.some(h => h.includes("CONSUMO ACTIVA") || h.includes("VALOR SDL ACT")))
    return "PRELIQ"
  return "DESCONOCIDO"
}

type EnelAcumulado = {
  energia_kwh:              number | null   // de Preliq (CONSUMO ACTIVA)
  valor_sdl_cop:            number | null   // de Preliq (VALOR SDL ACT)
  valor_reactiva_cop:       number | null   // de Preliq (VALOR SDL REAC)
  nombre_frontera:          string | null   // de Preliq (NOMBRE CUENTA CONTRATO)
  nivel_tension:            string | null   // de Preliq (NIVEL TENSION)
  energia_reactiva_ind_pen: number | null   // de Reactiva (EXCESO_REACTIVA_INDUCTIVA)
  energia_reactiva_cap_pen: number | null   // de Reactiva (EXCESO_REACTIVA_CAPACITIVA)
  factor_m:                 number | null   // de Reactiva (FACTOR M)
}

function blankEnel(): EnelAcumulado {
  return {
    energia_kwh: null,
    valor_sdl_cop: null,
    valor_reactiva_cop: null,
    nombre_frontera: null,
    nivel_tension: null,
    energia_reactiva_ind_pen: null,
    energia_reactiva_cap_pen: null,
    factor_m: null,
  }
}

function procesarEnelMulti(
  buffers: Buffer[],
  anio: number,
  mes: number,
  alertas: string[],
  erroresCriticos: string[],
): FilaSDL[] {
  const mapeoLectura: MapeoSDL = {
    tipo_archivo: "xlsx",
    hoja: 0,
    fila_inicio: 2,
    columnas: {},
  }

  const acumulado = new Map<string, EnelAcumulado>()
  const tiposVistos = new Set<EnelTipo>()

  for (let i = 0; i < buffers.length; i++) {
    let rows: Row[] = []
    try {
      rows = readRows(buffers[i]!, mapeoLectura)
    } catch (e) {
      erroresCriticos.push(`Archivo ${i + 1}: no se pudo leer (${e})`)
      continue
    }
    if (rows.length === 0) {
      alertas.push(`Archivo ${i + 1}: sin datos, se ignora.`)
      continue
    }
    const tipo = detectarTipoArchivoEnel(rows)
    if (tipo === "DESCONOCIDO") {
      alertas.push(
        `Archivo ${i + 1}: no se reconoce como Preliquidacion (CONSUMO ACTIVA) ` +
        `ni Informe Reactiva (EXCESO_REACTIVA_INDUCTIVA / FACTOR M). Se ignora.`,
      )
      continue
    }
    if (tiposVistos.has(tipo)) {
      alertas.push(`Archivo ${i + 1}: tipo ${tipo} ya cargado, sobrescribe al anterior.`)
    }
    tiposVistos.add(tipo)

    const headers = Object.keys(rows[0] ?? {})
    // CODIGO SIC: buscar header que contenga "SIC"
    let colSic: string | null = null
    for (const h of headers) {
      if (norm(h).includes("SIC")) { colSic = h; break }
    }
    if (!colSic) {
      erroresCriticos.push(`Archivo ${i + 1} (${tipo}): falta columna CODIGO SIC.`)
      continue
    }

    if (tipo === "PRELIQ") {
      const colNom    = resolveCol(headers, "NOMBRE CUENTA CONTRATO")
                     ?? resolveCol(headers, "NOMBRE")
      const colKwh    = resolveCol(headers, "CONSUMO ACTIVA")
      const colValAct = resolveCol(headers, "VALOR SDL ACT")
      const colValRea = resolveCol(headers, "VALOR SDL REAC")
      const colNT     = resolveCol(headers, "NIVEL TENSION")
      for (const r of rows) {
        const cod = (r[colSic] ?? "").trim()
        if (!cod) continue
        const ent = acumulado.get(cod) ?? blankEnel()
        if (colNom)    ent.nombre_frontera     = (r[colNom]?.trim() || null)
        if (colKwh)    ent.energia_kwh         = toNum(r[colKwh])
        if (colValAct) ent.valor_sdl_cop       = toNum(r[colValAct])
        if (colValRea) ent.valor_reactiva_cop  = toNum(r[colValRea])
        if (colNT)     ent.nivel_tension       = (r[colNT]?.trim() || null)
        acumulado.set(cod, ent)
      }
    } else if (tipo === "REACTIVA") {
      const colFM   = resolveCol(headers, "FACTOR M")
      const colInd  = resolveCol(headers, "EXCESO_REACTIVA_INDUCTIVA")
                   ?? resolveCol(headers, "EXCESO REACTIVA INDUCTIVA")
      const colCap  = resolveCol(headers, "EXCESO_REACTIVA_CAPACITIVA")
                   ?? resolveCol(headers, "EXCESO REACTIVA CAPACITIVA")
      for (const r of rows) {
        const cod = (r[colSic] ?? "").trim()
        if (!cod) continue
        const ent = acumulado.get(cod) ?? blankEnel()
        if (colFM)  ent.factor_m                 = toNum(r[colFM])
        if (colInd) ent.energia_reactiva_ind_pen = toNum(r[colInd])
        if (colCap) ent.energia_reactiva_cap_pen = toNum(r[colCap])
        acumulado.set(cod, ent)
      }
    }
  }

  const periodoStr = `${anio}-${String(mes).padStart(2, "0")}`
  const filas: FilaSDL[] = []
  const fronterasVistas = new Set<string>()
  for (const [cod, ent] of acumulado.entries()) {
    if (fronterasVistas.has(cod)) continue
    fronterasVistas.add(cod)
    const energia = ent.energia_kwh ?? 0
    if (energia < 0) {
      erroresCriticos.push(`Frontera ${cod}: energia activa negativa.`)
      continue
    }
    const valor = ent.valor_sdl_cop ?? 0
    // tarifa_sdl = valor / energia (misma logica que preEnel original)
    const tarifaSdl = energia > 0 ? valor / energia : 0
    filas.push({
      codigo_frontera:          cod,
      nombre_frontera:          ent.nombre_frontera,
      periodo_sdl:              periodoStr,
      energia_sdl_kwh:          energia,
      valor_sdl_cop:            valor,
      tarifa_sdl:               tarifaSdl,
      nivel_tension:            ent.nivel_tension,
      propiedad_activos:        null,
      energia_reactiva_ind_pen: ent.energia_reactiva_ind_pen,
      energia_reactiva_cap_pen: ent.energia_reactiva_cap_pen,
      valor_reactiva_cop:       ent.valor_reactiva_cop,
      tarifa_reactiva:          null,
      factor_m:                 ent.factor_m,
      es_duplicado:             false,
    })
  }
  return filas
}

// ─── EPM archivo de REACTIVA ─────────────────────────────────────────────────
//
// El archivo de reactiva de EPM tiene DOS bloques apilados verticalmente, con
// el mismo layout de columnas, distinguidos por un titulo de grupo:
//   - "INGRESO POR EXCESO DE ENERGIA REACTIVA SDL XM" (bloque SDL)
//   - "INGRESO POR EXCESO DE ENERGIA REACTIVA STR XM" (bloque STR)
//
// Por frontera (cruce por Codigo SIC) se toma:
//   Del bloque SDL:
//     - ENERGIA Exceso reactiva inductiva  -> energia_reactiva_ind_pen
//     - ENERGIA Exceso reactiva capacitiva -> energia_reactiva_cap_pen
//     - INGRESO Exceso reactiva ($)        -> valor_reactiva_cop
//     - Factor M                           -> factor_m
//     - Cargo por Uso ($/KWh)              -> tarifa_reactiva (parte SDL)
//   Del bloque STR:
//     - Cargo por Uso ($/KWh)              -> tarifa_reactiva (parte STR)
//   tarifa_reactiva = cargo_uso_sdl + cargo_uso_str.
//
// Las filas de subtotal ("Total por nivel de tension...") no tienen Codigo SIC
// valido y se ignoran.
//
// energia activa / valor activa quedan en 0: este archivo se fusiona con el
// registro de activa ya cargado (merge por codigo_frontera en el confirmar).

function leerRawRows(buffer: Buffer): (string | number)[][] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0] ?? ""]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
    header: 1, defval: "", raw: true,
  }) as unknown as (string | number)[][]
}

// Detecta si un buffer es el archivo de reactiva de EPM (tiene el titulo
// "EXCESO DE ENERGIA REACTIVA" en alguna celda de las primeras filas).
function esArchivoReactivaEpm(buffer: Buffer): boolean {
  try {
    const raw = leerRawRows(buffer)
    const lim = Math.min(raw.length, 30)
    for (let i = 0; i < lim; i++) {
      for (const cell of raw[i] ?? []) {
        if (typeof cell === "string" && norm(cell).includes("EXCESO DE ENERGIA REACTIVA")) {
          return true
        }
      }
    }
  } catch { /* si no se puede leer, no es reactiva */ }
  return false
}

const RE_FRONTERA = /^FRT?\s*\d+/i

type EpmReacAcum = {
  nombre_frontera:          string | null
  nivel_tension:            string | null
  energia_reactiva_ind_pen: number | null
  energia_reactiva_cap_pen: number | null
  valor_reactiva_cop:       number | null
  factor_m:                 number | null
  cargo_sdl:                number | null
  cargo_str:                number | null
}

function procesarEpmReactiva(
  buffer: Buffer,
  anio: number,
  mes: number,
  alertas: string[],
  erroresCriticos: string[],
): FilaSDL[] {
  const raw = leerRawRows(buffer)
  if (raw.length === 0) {
    erroresCriticos.push("Archivo de reactiva EPM vacio o ilegible.")
    return []
  }

  // 1. Localizar fila de headers (primera con "Codigo SIC") y la fila del
  //    titulo del bloque STR.
  let headerRow = -1
  let filaTituloStr = -1
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] ?? []
    for (const cell of row) {
      if (typeof cell !== "string") continue
      const n = norm(cell)
      if (headerRow === -1 && n.includes("CODIGO SIC")) headerRow = i
      if (n.includes("REACTIVA STR XM")) filaTituloStr = i
    }
  }
  if (headerRow === -1) {
    erroresCriticos.push("Archivo de reactiva EPM: no se encontro la fila de headers (Codigo SIC).")
    return []
  }

  // 2. Mapear headers -> indice de columna (ambos bloques comparten layout).
  const headers = (raw[headerRow] ?? []).map(h => norm(String(h ?? "")))
  const findIdx = (...needles: string[]): number => {
    for (const nd of needles) {
      const idx = headers.findIndex(h => h.includes(nd))
      if (idx >= 0) return idx
    }
    return -1
  }
  const iCodigo = findIdx("CODIGO SIC")
  const iNombre = findIdx("INSTALACION")
  const iNivel  = findIdx("NIVEL DE TENSION")
  const iCargo  = findIdx("CARGO POR USO")
  const iFM     = headers.findIndex(h => h === "FACTOR M")
  const iInd    = findIdx("EXCESO REACTIVA INDUCTIVA")
  const iCap    = findIdx("EXCESO REACTIVA CAPACITIVA")
  const iValor  = headers.findIndex(h => h.includes("INGRESO") && h.includes("EXCESO REACTIVA"))

  if (iCodigo < 0) {
    erroresCriticos.push("Archivo de reactiva EPM: no se ubico la columna Codigo SIC.")
    return []
  }

  // 3. Recorrer filas, separando bloque SDL (antes del titulo STR) y STR.
  const acum = new Map<string, EpmReacAcum>()
  let nivelSdl = ""
  let nivelStr = ""
  const cellNum = (row: (string | number)[], idx: number): number | null =>
    idx >= 0 ? toNum(String(row[idx] ?? "")) : null
  const cellStr = (row: (string | number)[], idx: number): string =>
    idx >= 0 ? String(row[idx] ?? "").trim() : ""

  for (let i = headerRow + 1; i < raw.length; i++) {
    const row = raw[i] ?? []
    const enBloqueStr = filaTituloStr >= 0 && i > filaTituloStr

    // forward-fill nivel (celda combinada). "nivel 2" -> "2"
    const nivelRaw = cellStr(row, iNivel)
    if (nivelRaw) {
      const m = nivelRaw.match(/(\d+)/)
      if (m) { if (enBloqueStr) nivelStr = m[1]!; else nivelSdl = m[1]! }
    }

    const cod = cellStr(row, iCodigo)
    if (!RE_FRONTERA.test(cod)) continue // subtotal / fila vacia

    const ent = acum.get(cod) ?? blankEpmReac()
    if (!enBloqueStr) {
      // Bloque SDL: campos de reactiva
      ent.nombre_frontera          = cellStr(row, iNombre) || ent.nombre_frontera
      ent.nivel_tension            = (nivelSdl || ent.nivel_tension) || null
      ent.energia_reactiva_ind_pen = cellNum(row, iInd)
      ent.energia_reactiva_cap_pen = cellNum(row, iCap)
      ent.valor_reactiva_cop       = cellNum(row, iValor)
      ent.factor_m                 = cellNum(row, iFM)
      ent.cargo_sdl                = cellNum(row, iCargo)
    } else {
      // Bloque STR: solo el cargo por uso (para sumar a tarifa_reactiva)
      ent.cargo_str = cellNum(row, iCargo)
      if (!ent.nombre_frontera) ent.nombre_frontera = cellStr(row, iNombre) || null
      if (!ent.nivel_tension)   ent.nivel_tension   = nivelStr || null
    }
    acum.set(cod, ent)
  }

  if (acum.size === 0) {
    alertas.push("Archivo de reactiva EPM: no se encontraron fronteras con Codigo SIC valido.")
  }

  // 4. Construir FilaSDL[]. tarifa_reactiva = cargo_sdl + cargo_str.
  const periodoStr = `${anio}-${String(mes).padStart(2, "0")}`
  const filas: FilaSDL[] = []
  for (const [cod, ent] of acum.entries()) {
    const tarifaReactiva =
      (ent.cargo_sdl != null || ent.cargo_str != null)
        ? (ent.cargo_sdl ?? 0) + (ent.cargo_str ?? 0)
        : null
    filas.push({
      codigo_frontera:          cod,
      nombre_frontera:          ent.nombre_frontera,
      periodo_sdl:              periodoStr,
      // Activa va en 0/null: este archivo se fusiona con el de activa.
      energia_sdl_kwh:          0,
      valor_sdl_cop:            0,
      tarifa_sdl:               0,
      nivel_tension:            ent.nivel_tension,
      propiedad_activos:        null,
      energia_reactiva_ind_pen: ent.energia_reactiva_ind_pen,
      energia_reactiva_cap_pen: ent.energia_reactiva_cap_pen,
      valor_reactiva_cop:       ent.valor_reactiva_cop,
      tarifa_reactiva:          tarifaReactiva,
      factor_m:                 ent.factor_m,
      es_duplicado:             false,
    })
  }
  return filas
}

function blankEpmReac(): EpmReacAcum {
  return {
    nombre_frontera: null,
    nivel_tension: null,
    energia_reactiva_ind_pen: null,
    energia_reactiva_cap_pen: null,
    valor_reactiva_cop: null,
    factor_m: null,
    cargo_sdl: null,
    cargo_str: null,
  }
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export async function parsearSDL(
  bufferOrBuffers: Buffer | Buffer[],
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

  // EMSA / ENEL (y futuros ORs con multi_archivos) traen varios buffers que se
  // combinan por codigo_frontera. Si recibimos un array, delegamos al
  // handler especifico y salimos.
  if (Array.isArray(bufferOrBuffers)) {
    const codigoOR = (orCodigo ?? orId ?? "").toUpperCase()
    if (codigoOR === "EMSA") {
      const fs = procesarEmsaMulti(bufferOrBuffers, anio, mes, alertas, erroresCriticos)
      return { filas: fs, alertas, erroresCriticos }
    }
    if (codigoOR === "ENEL") {
      const fs = procesarEnelMulti(bufferOrBuffers, anio, mes, alertas, erroresCriticos)
      return { filas: fs, alertas, erroresCriticos }
    }
    erroresCriticos.push(
      `Multi-archivo SDL solo soportado para EMSA y ENEL. OR recibido: ${codigoOR}.`,
    )
    return { filas, alertas, erroresCriticos }
  }
  const buffer: Buffer = bufferOrBuffers

  // EPM archivo de reactiva: estructura especial (2 bloques apilados SDL/STR).
  // Se detecta por contenido. El de activa sigue el flujo normal (preEpm).
  {
    const codigoOR = (orCodigo ?? orId ?? "").toUpperCase()
    if (codigoOR === "EPM" && esArchivoReactivaEpm(buffer)) {
      const fs = procesarEpmReactiva(buffer, anio, mes, alertas, erroresCriticos)
      return { filas: fs, alertas, erroresCriticos }
    }
  }

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
  // Si hay codigo_frontera_split, NO inferir nombre_frontera por header.
  // El nombre se extrae del valor de la columna codigo_frontera (parte despues
  // del separador). Sin esta guarda, "NOMBRE FRONTERA" matchea por substring
  // inverso contra "FRONTERA" y el parser termina poniendo el valor completo
  // (codigo+nombre sin split) como nombre_frontera.
  const colNombre   = cols["nombre_frontera"]
    ? resolveCol(headers, cols["nombre_frontera"])
    : (m.codigo_frontera_split
        ? null
        : resolveColMulti(headers, ["NOMBRE_FRONTERA", "NOMBRE FRONTERA", "NOMBRE"]))
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

  const dispHeaders = headers.map(h => `"${h}"`).join(", ")
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
    // Si hay separador, el codigo es la parte ANTES del separador y
    // (cuando no hay columna nombre_frontera mapeada) el nombre es la
    // parte DESPUES. Ej: "Frt59357-ALTIPAL" -> codigo=Frt59357, nombre=ALTIPAL.
    let nombreFromSplit: string | null = null
    if (splitChar && codFrontera.includes(splitChar)) {
      const parts = codFrontera.split(splitChar)
      codFrontera = parts[0]!.trim()
      if (parts.length > 1) {
        nombreFromSplit = parts.slice(1).join(splitChar).trim() || null
      }
    }

    const esDuplicado = fronterasVistas.has(codFrontera)
    if (esDuplicado) {
      alertas.push(`Fila ${fila}: frontera duplicada en el archivo: ${codFrontera}`)
    }
    fronterasVistas.add(codFrontera)

    const energiaRaw = toNum(row[colEnergia!])
    // null valor_cop → default to 0 (row is still valid; preserves row count)
    const valorRaw   = colValor  ? toNum(row[colValor])  : null
    const tarifaRaw  = colTarSDL ? toNum(row[colTarSDL]) : null

    // Skipear solo si la fila parece summary/blank: sin energia, sin valor
    // y sin tarifa. Si tiene al menos uno de esos valores la fila se carga
    // (ej. EEP trae tarifa para fronteras sin consumo).
    if (energiaRaw == null && valorRaw == null && tarifaRaw == null) continue

    const energia = energiaRaw ?? 0
    const valor   = valorRaw   ?? 0

    if (energia < 0) {
      erroresCriticos.push(`Fila ${fila}: energía negativa`); continue
    }
    if (valor < 0) {
      erroresCriticos.push(`Fila ${fila}: valor_cop negativo`); continue
    }

    const tarifaSDL = tarifaRaw != null
      ? tarifaRaw
      : energia > 0 ? valor / energia : 0

    const periodoSDL = colPeriodo
      ? ((row[colPeriodo] ?? "").trim() || periodoDefault)
      : periodoDefault

    // Use null (not undefined) for optional fields so JSON serialization keeps
    // the keys and the preview table can show all columns regardless of which
    // row appears first.
    filas.push({
      codigo_frontera:          codFrontera,
      nombre_frontera:          colNombre  ? (row[colNombre]?.trim()  || null) : nombreFromSplit,
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
