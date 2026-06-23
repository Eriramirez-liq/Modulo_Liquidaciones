/**
 * Clasificación de congruencia entre las 3 fuentes: Facturación, SDL
 * (preliquidación) y TC1. Compara nivel de tensión y propiedad de activos por
 * frontera y determina el ESTADO de la diferencia.
 *
 * Estados (definidos por negocio):
 *   - "Cambio TC1"   → TC1 es la que difiere (Facturación y SDL coinciden).
 *   - "Cambio SDL"   → SDL es la que difiere (Facturación y TC1 coinciden).
 *   - "Cambio bills" → Facturación es la que difiere (SDL y TC1 coinciden).
 *   - "No se relaciona en el TC1" → está en Facturación y SDL, no en TC1.
 *   - "No se relaciona en el SDL" → está en Facturación y TC1, no en SDL.
 *   - "No se relaciona en Facturación" → está en SDL y TC1, no en Facturación.
 *   - "Revisar" → ninguna de las 3 coincide (o presencia insuficiente).
 *
 * Esta lógica es PURA (no toca DB) para reusarla en el reporte y el Excel.
 */

/** Clasificación de una fuente para una frontera, o null si no la trae. */
export type ClasifFuente = { nt: string; prop: string } | null

export const ESTADO_CONGRUENCIA = {
  CAMBIO_TC1: "Cambio TC1",
  CAMBIO_SDL: "Cambio SDL",
  CAMBIO_BILLS: "Cambio bills",
  SIN_TC1: "No se relaciona en el TC1",
  SIN_SDL: "No se relaciona en el SDL",
  SIN_FAC: "No se relaciona en Facturación",
  REVISAR: "Revisar",
} as const

export type EstadoCongruencia = (typeof ESTADO_CONGRUENCIA)[keyof typeof ESTADO_CONGRUENCIA]

export interface ResultadoCongruencia {
  estado: EstadoCongruencia
  /** "Nivel de tensión" | "Propiedad de activos" | "Ambas" | "—" */
  diferencia: string
  /** Valor(es) errado(s) (de la fuente que difiere). */
  datoErrado: string
  /** Valor(es) correcto(s) (de las fuentes que coinciden). */
  datoCorrecto: string
}

export function normalizar(v: string | null | undefined): string {
  return (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()
}

// ─── Herencia de base para fronteras con sufijo "_N" ──────────────────────────
// Las fronteras "hijas" (ej. FRT03464_1, FRT03464_2) deben tomar el nivel de
// tensión y la propiedad de activos de la frontera BASE (FRT03464, sin sufijo).

/** Clave base de una frontera normalizada: lo que va antes del primer "_". */
export function claveBase(clave: string): string {
  const i = clave.indexOf("_")
  return i >= 0 ? clave.slice(0, i) : clave
}

/** Código base (sin sufijo "_N") preservando la capitalización original. */
export function codigoBase(codigo: string): string {
  return codigo.split("_")[0] ?? codigo
}

export interface FuenteFila { clave: string; nt: string; prop: string }

/**
 * Construye el mapa baseKey → {nt, prop} a partir de las fronteras BASE (sin
 * "_") de las fuentes, en orden de prioridad (la primera gana; las siguientes
 * solo rellenan campos vacíos).
 */
export function construirBaseClasif(
  fuentesPriorizadas: FuenteFila[][],
): Map<string, { nt: string; prop: string }> {
  const base = new Map<string, { nt: string; prop: string }>()
  for (const fuente of fuentesPriorizadas) {
    for (const f of fuente) {
      if (!f.clave || f.clave.includes("_")) continue // solo fronteras base
      const cur = base.get(f.clave)
      if (!cur) base.set(f.clave, { nt: f.nt, prop: f.prop })
      else {
        if (!cur.nt && f.nt) cur.nt = f.nt
        if (!cur.prop && f.prop) cur.prop = f.prop
      }
    }
  }
  return base
}

/**
 * Clasificación efectiva de una frontera: si tiene sufijo "_N" y existe su base,
 * hereda {nt, prop} de la base; si no, usa la propia.
 */
export function clasifConHerencia(
  clave: string,
  propia: { nt: string; prop: string },
  base: Map<string, { nt: string; prop: string }>,
): { nt: string; prop: string } {
  if (!clave.includes("_")) return propia
  return base.get(claveBase(clave)) ?? propia
}

type Outlier = "IGUAL" | "FAC" | "SDL" | "TC1" | "TODAS"

/**
 * Determina cuál de las 3 fuentes difiere para un campo ya normalizado.
 *
 * IMPORTANTE: un valor VACÍO ("") = SIN DATO en esa fuente; se IGNORA en la
 * comparación (no es una diferencia). Solo se evalúa entre las fuentes que SÍ
 * tienen dato. Si menos de 2 fuentes tienen dato, o las que tienen dato
 * coinciden → "IGUAL" (no hay diferencia). Esto evita marcar falsamente
 * "Cambio X" cuando una fuente (ej. SDL) simplemente no reporta NT/propiedad.
 */
function outlier(fac: string, sdl: string, tc1: string): Outlier {
  const conDato: { src: "FAC" | "SDL" | "TC1"; v: string }[] = []
  if (fac !== "") conDato.push({ src: "FAC", v: fac })
  if (sdl !== "") conDato.push({ src: "SDL", v: sdl })
  if (tc1 !== "") conDato.push({ src: "TC1", v: tc1 })

  if (conDato.length < 2) return "IGUAL" // sin datos suficientes para comparar
  if (new Set(conDato.map(d => d.v)).size === 1) return "IGUAL" // los que tienen dato coinciden

  // Hay diferencia. Con las 3 con dato, el outlier es la que difiere de las otras
  // dos que coinciden; si las 3 difieren → TODAS. Con solo 2 con dato que
  // difieren → no hay mayoría → TODAS (sin culpable claro).
  if (conDato.length === 3) {
    if (fac === sdl) return "TC1"
    if (fac === tc1) return "SDL"
    if (sdl === tc1) return "FAC"
    return "TODAS"
  }
  return "TODAS"
}

const LABEL_FUENTE: Record<"FAC" | "SDL" | "TC1", string> = {
  FAC: "Facturación", SDL: "SDL", TC1: "TC1",
}

/**
 * Clasifica una frontera. Devuelve null si es CONGRUENTE (no va al reporte).
 *
 * @param fac/sdl/tc1 clasificación de cada fuente (null si la frontera no está
 *   en esa fuente). Los valores deben venir ya normalizados.
 */
export function clasificarCongruencia(
  fac: ClasifFuente,
  sdl: ClasifFuente,
  tc1: ClasifFuente,
): ResultadoCongruencia | null {
  const presentes = [fac, sdl, tc1].filter(Boolean).length

  // ── Fronteras presentes en solo 2 de 3 fuentes ───────────────────────────
  if (fac && sdl && !tc1) return faltante(ESTADO_CONGRUENCIA.SIN_TC1, fac, sdl)
  if (fac && tc1 && !sdl) return faltante(ESTADO_CONGRUENCIA.SIN_SDL, fac, tc1)
  if (sdl && tc1 && !fac) return faltante(ESTADO_CONGRUENCIA.SIN_FAC, sdl, tc1)

  // Presencia insuficiente (una sola fuente) → revisar.
  if (presentes < 2 || !fac || !sdl || !tc1) {
    return {
      estado: ESTADO_CONGRUENCIA.REVISAR,
      diferencia: "—",
      datoErrado: "—",
      datoCorrecto: "—",
    }
  }

  // ── Las 3 presentes: comparar NT y propiedad ─────────────────────────────
  const oNT = outlier(fac.nt, sdl.nt, tc1.nt)
  const oPR = outlier(fac.prop, sdl.prop, tc1.prop)
  if (oNT === "IGUAL" && oPR === "IGUAL") return null // congruente

  const difNT = oNT !== "IGUAL"
  const difPR = oPR !== "IGUAL"
  const diferencia = difNT && difPR ? "Ambas" : difNT ? "Nivel de tensión" : "Propiedad de activos"

  // Determinar la fuente culpable (la misma para todos los campos que difieren).
  const culpables = new Set<Outlier>()
  if (difNT) culpables.add(oNT)
  if (difPR) culpables.add(oPR)

  // Si hay un campo con las 3 distintas, o las diferencias apuntan a fuentes
  // distintas → no hay un único culpable → Revisar.
  if (culpables.has("TODAS") || culpables.size > 1) {
    return {
      estado: ESTADO_CONGRUENCIA.REVISAR,
      diferencia,
      datoErrado: detalleTresFuentes(fac, sdl, tc1, difNT, difPR),
      datoCorrecto: "—",
    }
  }

  const culpable = [...culpables][0] as "FAC" | "SDL" | "TC1"
  const estado =
    culpable === "TC1" ? ESTADO_CONGRUENCIA.CAMBIO_TC1 :
    culpable === "SDL" ? ESTADO_CONGRUENCIA.CAMBIO_SDL :
    ESTADO_CONGRUENCIA.CAMBIO_BILLS

  // Una fuente "correcta" (cualquiera de las que coinciden, distinta del culpable).
  const correcta: "FAC" | "SDL" | "TC1" = culpable === "FAC" ? "SDL" : "FAC"
  const val = { FAC: fac, SDL: sdl, TC1: tc1 }
  // Si el valor de la fuente culpable está vacío (sin dato), mostrarlo explícito
  // para que "dato errado" quede tan detallado como "dato correcto".
  const fmt = (v: string) => (v && v.trim() ? v : "(sin dato)")
  const partes: { errado: string; correcto: string }[] = []
  if (difNT) partes.push({ errado: `NT: ${fmt(val[culpable].nt)}`, correcto: `NT: ${fmt(val[correcta].nt)}` })
  if (difPR) partes.push({ errado: `Prop: ${fmt(val[culpable].prop)}`, correcto: `Prop: ${fmt(val[correcta].prop)}` })

  return {
    estado,
    diferencia,
    datoErrado: partes.map(p => p.errado).join(" / "),
    datoCorrecto: partes.map(p => p.correcto).join(" / "),
  }
}

/** Caso "falta una fuente": muestra los valores de las 2 presentes. */
function faltante(estado: EstadoCongruencia, a: ClasifFuente, b: ClasifFuente): ResultadoCongruencia {
  const difNT = a!.nt !== b!.nt
  const difPR = a!.prop !== b!.prop
  const diferencia =
    difNT && difPR ? "Ambas" : difNT ? "Nivel de tensión" : difPR ? "Propiedad de activos" : "—"
  return { estado, diferencia, datoErrado: "—", datoCorrecto: "—" }
}

/** Muestra los valores de las 3 fuentes para los campos que difieren (caso Revisar). */
function detalleTresFuentes(
  fac: ClasifFuente, sdl: ClasifFuente, tc1: ClasifFuente,
  difNT: boolean, difPR: boolean,
): string {
  const out: string[] = []
  if (difNT) out.push(`NT → ${LABEL_FUENTE.FAC}: ${fac!.nt}, ${LABEL_FUENTE.SDL}: ${sdl!.nt}, ${LABEL_FUENTE.TC1}: ${tc1!.nt}`)
  if (difPR) out.push(`Prop → ${LABEL_FUENTE.FAC}: ${fac!.prop}, ${LABEL_FUENTE.SDL}: ${sdl!.prop}, ${LABEL_FUENTE.TC1}: ${tc1!.prop}`)
  return out.join(" | ")
}
