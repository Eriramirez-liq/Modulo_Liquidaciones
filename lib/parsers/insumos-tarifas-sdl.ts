import * as XLSX from "xlsx"
import {
  calcularTarifas, OR_TIPO, OR_AREA_ADD,
  type AreaDistribucion, type ComponentesTarifa,
} from "@/lib/engine/tarifas-sdl"

/**
 * Parser de los insumos de Tarifas SDL (12 archivos "Cargos ADD" + 21 "Uso de
 * la red") y calculo de las tarifas activa/reactiva por OR / nivel / propiedad.
 *
 * Replica los 2 scripts Python del negocio:
 *   - ADD: LiquidacionDefinitivos{Area}Nivel{N}_*.xlsx -> DT por (area, nivel).
 *   - USO: Cargo_Cobro_Uso_Red-Definitivo{COD}-*.xlsx -> DT1/2/3, CDI, CDN4,
 *     PR1/2/3 por OR.
 *
 * Luego combina (NT de ADD o USO segun OR_TIPO; CDI/CDN4/PR siempre de USO) y
 * aplica las formulas de calcularTarifas().
 */

export interface FilaTarifaSDL {
  or_codigo:         string
  nivel_tension:     string   // "1" | "2" | "3"
  propiedad_activos: string   // "OR" | "COMPARTIDO" | "USUARIO"
  tarifa_activa:     number
  tarifa_reactiva:   number
}

export interface ResultadoInsumosTarifas {
  filas:           FilaTarifaSDL[]
  alertas:         string[]
  erroresCriticos: string[]
  // Resumen de cobertura para la UI
  orsConTarifa:    string[]
  orsSinDatos:     string[]
}

// Codigos de mercado (nombre de archivo USO) con OR fijo. El resto se resuelve
// leyendo la celda B1.
const COD_MERCADO_OR: Record<string, string> = {
  SOLM: "AIRE", CRCM: "EEP CARTAGO", PEIM: "EEP PEREIRA",
  TOLM: "CELSIA TOLIMA", VACM: "CELSIA VALLE",
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()
}

// Normaliza un nombre de OR al codigo del sistema (EEP CARTAGO -> EEP_CARTAGO).
function orCodigo(nombre: string): string {
  return norm(nombre).replace(/[\s-]+/g, "_")
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return isNaN(v) ? null : v
  const s = String(v).replace(/[^0-9.,\-]/g, "").trim()
  if (!s) return null
  const n = parseFloat(s.replace(/,/g, ""))
  return isNaN(n) ? null : n
}

function leerHoja(data: Uint8Array, hoja?: string): (string | number)[][] {
  const wb = XLSX.read(data, { type: "array", cellDates: false, dense: true })
  const sheetName = hoja && wb.SheetNames.includes(hoja) ? hoja : wb.SheetNames[0] ?? ""
  const ws = wb.Sheets[sheetName]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
    header: 1, defval: "", raw: true,
  }) as unknown as (string | number)[][]
}

function detectarTipo(nombre: string): "ADD" | "USO" | null {
  const n = norm(nombre)
  if (n.includes("LIQUIDACIONDEFINITIVO")) return "ADD"
  if (n.includes("CARGO_COBRO_USO_RED") || n.includes("CARGOCOBROUSORED")) return "USO"
  return null
}

function areaDelNombre(nombre: string): AreaDistribucion | null {
  const n = norm(nombre)
  if (n.includes("CENTRO"))    return "CENTRO"
  if (n.includes("OCCIDENTE")) return "OCCIDENTE"
  if (n.includes("ORIENTE"))   return "ORIENTE"
  if (n.includes("SUR"))       return "SUR"
  return null
}

function nivelDelNombre(nombre: string): 1 | 2 | 3 | null {
  const n = norm(nombre)
  if (n.includes("NIVEL1")) return 1
  if (n.includes("NIVEL2")) return 2
  if (n.includes("NIVEL3")) return 3
  return null
}

type DatosUso = { dt1: number; dt2: number; dt3: number; cdi: number; cdn4: number; pr1: number; pr2: number; pr3: number }

// Parsea un archivo USO DE LA RED (hoja "Cargos_Definitivos").
function parsearUso(nombre: string, data: Uint8Array): { or: string; datos: DatosUso } | null {
  const raw = leerHoja(data, "Cargos_Definitivos")
  if (raw.length < 10) return null

  // OR: por codigo de mercado del nombre, o de la celda B1.
  let or = ""
  const codMatch = nombre.match(/Definitivo([A-Z]{3,5})-/i)
  const cod = codMatch ? codMatch[1]!.toUpperCase() : ""
  if (COD_MERCADO_OR[cod]) {
    or = COD_MERCADO_OR[cod]
  } else {
    const b1 = String(raw[0]?.[1] ?? "")
    or = b1.includes("-") ? (b1.split("-")[1] ?? "").trim().split(/\s+/)[0] ?? "" : b1.trim()
  }
  if (norm(or) === "CARIBEMAR") or = "AFINIA"
  if (!or) return null

  // DT1/2/3: filas 7,8,9 (idx 6,7,8), columna "Cargo monomio" (col F, idx 5).
  const dt1 = toNum(raw[6]?.[5]) ?? 0
  const dt2 = toNum(raw[7]?.[5]) ?? 0
  const dt3 = toNum(raw[8]?.[5]) ?? 0

  // Localizar fila "CDI" (col C idx2), "Nivel4" (col G idx6) y el marcador de fin.
  let cdiStart = -1, cdn4Start = -1, fin = -1
  for (let i = 0; i < raw.length; i++) {
    const c = norm(String(raw[i]?.[2] ?? ""))
    const g = norm(String(raw[i]?.[6] ?? ""))
    const b = norm(String(raw[i]?.[1] ?? ""))
    if (cdiStart < 0 && c === "CDI") cdiStart = i
    if (cdn4Start < 0 && g === "NIVEL4") cdn4Start = i
    if (fin < 0 && (b.includes("PLANES DE GESTION") || b.includes("COBRO DE LA REMUNERACION")))
      fin = i
  }
  const sumar = (start: number, col: number): number => {
    if (start < 0) return 0
    const hasta = fin > start ? fin : raw.length
    let s = 0
    for (let i = start + 1; i < hasta; i++) s += toNum(raw[i]?.[col]) ?? 0
    return s
  }
  const cdi  = sumar(cdiStart, 2)
  const cdn4 = sumar(cdn4Start, 6)

  // PR1/PR2/PR3: fila con col B = "PR1"/"PR2"/"PR3", valor en col C (idx2).
  const buscarPR = (etq: string): number => {
    for (let i = 0; i < raw.length; i++) {
      if (norm(String(raw[i]?.[1] ?? "")) === etq) return toNum(raw[i]?.[2]) ?? 0
    }
    return 0
  }
  return {
    or,
    datos: { dt1, dt2, dt3, cdi, cdn4, pr1: buscarPR("PR1"), pr2: buscarPR("PR2"), pr3: buscarPR("PR3") },
  }
}

// Parsea un archivo ADD: devuelve el cargo (DT) del area-nivel.
// Robusto: ubica la fila de encabezado ("Operador" / "Cargo") y toma el primer
// valor numerico de las filas de datos, sin asumir columna ni fila fijas
// (el layout puede variar entre periodos).
function parsearAdd(nombre: string, data: Uint8Array): { area: AreaDistribucion; nivel: number; dt: number } | null {
  const area = areaDelNombre(nombre)
  const nivel = nivelDelNombre(nombre)
  if (!area || !nivel) return null
  const raw = leerHoja(data)

  // Fila de encabezado: la que menciona "OPERADOR" (el header real, no el
  // titulo "Cargos ADD" que tambien contiene "CARGO").
  let hdr = -1
  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const fila = (raw[i] ?? []).map(c => norm(String(c ?? "")))
    if (fila.some(c => c.includes("OPERADOR"))) { hdr = i; break }
  }
  const start = hdr >= 0 ? hdr + 1 : 4

  // Solo celdas NUMERICAS puras (no extraer digitos de texto como "Nivel 1").
  const numPuro = (v: unknown): number | null => {
    if (typeof v === "number") return isNaN(v) ? null : v
    const s = String(v ?? "").trim()
    if (!s || !/^[$\s]*-?[\d.,]+[$\s%]*$/.test(s)) return null
    return toNum(s)
  }

  // El cargo es el primer numero puro > 1 en una fila de datos (la fila trae el
  // operador en texto + el cargo). Es el mismo para todos los OR del area-nivel.
  for (let i = start; i < raw.length; i++) {
    for (const celda of raw[i] ?? []) {
      const v = numPuro(celda)
      if (v != null && v > 1) return { area, nivel, dt: v }
    }
  }
  return null
}

export function parsearInsumosTarifasSDL(
  archivos: { nombre: string; data: Uint8Array }[],
): ResultadoInsumosTarifas {
  const alertas: string[] = []
  const erroresCriticos: string[] = []

  // 1. Clasificar y parsear.
  const addDT: Partial<Record<AreaDistribucion, { 1?: number; 2?: number; 3?: number }>> = {}
  const usoPorOR = new Map<string, DatosUso>()

  for (const f of archivos) {
    const tipo = detectarTipo(f.nombre)
    if (tipo === "ADD") {
      const r = parsearAdd(f.nombre, f.data)
      if (!r) { alertas.push(`ADD no reconocido: ${f.nombre}`); continue }
      addDT[r.area] = { ...(addDT[r.area] ?? {}), [r.nivel]: r.dt }
    } else if (tipo === "USO") {
      const r = parsearUso(f.nombre, f.data)
      if (!r) { alertas.push(`USO no reconocido: ${f.nombre}`); continue }
      usoPorOR.set(orCodigo(r.or), r.datos)
    } else {
      alertas.push(`Archivo ignorado (no es ADD ni USO): ${f.nombre}`)
    }
  }

  // 2. Combinar y calcular por cada OR conocido (21).
  const filas: FilaTarifaSDL[] = []
  const orsConTarifa: string[] = []
  const orsSinDatos: string[] = []

  for (const or of Object.keys(OR_TIPO)) {
    const tipo = OR_TIPO[or]!
    const uso = usoPorOR.get(or)
    if (!uso) { orsSinDatos.push(or); continue }  // sin archivo USO no hay CDI/CDN4/PR

    let nt1: number, nt2: number, nt3: number
    if (tipo === "ADD") {
      const area = OR_AREA_ADD[or]
      const dt = area ? addDT[area] : undefined
      if (!dt || dt[1] == null || dt[2] == null || dt[3] == null) {
        orsSinDatos.push(or); continue  // falta el ADD de su area
      }
      nt1 = dt[1]; nt2 = dt[2]; nt3 = dt[3]
    } else {
      nt1 = uso.dt1; nt2 = uso.dt2; nt3 = uso.dt3
    }

    const comp: ComponentesTarifa = {
      nt1, nt2, nt3, cdi: uso.cdi, cdn4: uso.cdn4, pr1: uso.pr1, pr2: uso.pr2, pr3: uso.pr3,
    }
    const t = calcularTarifas(comp)
    orsConTarifa.push(or)
    filas.push(
      { or_codigo: or, nivel_tension: "1", propiedad_activos: "OR",         tarifa_activa: t.activa.nt1_or,         tarifa_reactiva: t.reactiva.nt1_or },
      { or_codigo: or, nivel_tension: "1", propiedad_activos: "COMPARTIDO", tarifa_activa: t.activa.nt1_compartido, tarifa_reactiva: t.reactiva.nt1_compartido },
      { or_codigo: or, nivel_tension: "1", propiedad_activos: "USUARIO",    tarifa_activa: t.activa.nt1_usuario,    tarifa_reactiva: t.reactiva.nt1_usuario },
      { or_codigo: or, nivel_tension: "2", propiedad_activos: "USUARIO",    tarifa_activa: t.activa.nt2_usuario,    tarifa_reactiva: t.reactiva.nt2_usuario },
      { or_codigo: or, nivel_tension: "3", propiedad_activos: "USUARIO",    tarifa_activa: t.activa.nt3_usuario,    tarifa_reactiva: t.reactiva.nt3_usuario },
    )
  }

  if (filas.length === 0) {
    erroresCriticos.push("No se calcularon tarifas. Verificá que estén los archivos ADD y Uso de la red.")
  }
  return { filas, alertas, erroresCriticos, orsConTarifa, orsSinDatos }
}
