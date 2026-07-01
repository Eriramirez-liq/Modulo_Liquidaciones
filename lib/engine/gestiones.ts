/**
 * Modulo Gestiones — lectura de fronteras CON DIFERENCIA por concepto.
 *
 * Fuentes (solo lectura):
 *   - SDL: db.resultadoConciliacion   (periodo_id = CUID de PeriodoConciliacion)
 *   - TC1: db.resultadoConciliacionTC1(periodo_id = CUID; verificado: se persiste
 *          `periodo_id: periodo.id` en lib/engine/conciliacion-tc1.ts)
 *   - COT: en construccion → siempre []
 *
 * Este modulo arma la lista de fronteras con diferencia y la mergea con el
 * accionable guardado (gestiones_frontera). La logica de dominio vive aca; el
 * Route Handler solo orquesta.
 */

import { db } from "@/lib/db"
import type { Prisma } from "@prisma/client"

// Umbral (kWh) para la regla de ACTIVA en SDL.
const UMBRAL = 100

export type ConceptoGestionStr = "SDL" | "TC1" | "COT"

// Campos ajustables en un AJUSTE_APLICADO (sin "incompleta", que no es ajustable).
export const CAMPOS_AJUSTABLES = [
  "activa",
  "inductiva",
  "capacitiva",
  "factor_m",
  "nivel_tension",
  "propiedad",
] as const
export type CampoAjustable = (typeof CAMPOS_AJUSTABLES)[number]

// Campo de un item de diff (incluye "incompleta", que no es ajustable).
export type CampoDiff = CampoAjustable | "incompleta"

export interface DiffItem {
  campo: CampoDiff
  fac: string | null
  or: string | null
}

export interface GestionResumen {
  accion: string
  datosAjustados: string[]
  observacion: string | null
  gestionadoAt: string
}

// Shape EXACTO que devuelve el GET por cada fila.
export interface FilaGestion {
  concepto: ConceptoGestionStr
  periodoId: string
  codigoFrontera: string
  operadorNombre: string | null
  orId: string | null
  caso: string
  eFac: string | null
  eXm: string | null
  eSdl: string | null
  diffs: DiffItem[]
  gestion: GestionResumen | null
}

// Decimal (Prisma) → string, preservando null.
const dec = (v: Prisma.Decimal | null | undefined): string | null =>
  v == null ? null : v.toString()

// abs(a - b) sobre Decimals ausentes = Infinity (no comparable) → no dispara regla.
const absDelta = (a: Prisma.Decimal | null, b: Prisma.Decimal | null): number => {
  if (a == null || b == null) return NaN
  return Math.abs(Number(a) - Number(b))
}

/**
 * Trae el accionable guardado del periodo+concepto indexado por codigo_frontera.
 * Una sola query; se usa para poblar `gestion` en cada fila.
 */
async function mapaGestiones(
  periodoId: string,
  concepto: ConceptoGestionStr,
): Promise<Map<string, GestionResumen>> {
  const filas = await db.gestionFrontera.findMany({
    where: { periodo_id: periodoId, concepto },
    select: {
      codigo_frontera: true,
      accion: true,
      datos_ajustados: true,
      observacion: true,
      gestionado_at: true,
    },
  })
  const m = new Map<string, GestionResumen>()
  for (const g of filas) {
    m.set(g.codigo_frontera, {
      accion: g.accion,
      datosAjustados: g.datos_ajustados,
      observacion: g.observacion,
      gestionadoAt: g.gestionado_at.toISOString(),
    })
  }
  return m
}

/**
 * SDL: fronteras con diferencia = cualquier flag en true, caso INCOMPLETA/ERROR,
 * o la regla de ACTIVA (los tres montos presentes y ambos deltas > UMBRAL).
 */
async function listarSDL(
  periodoId: string,
  orId: string | undefined,
): Promise<FilaGestion[]> {
  const rows = await db.resultadoConciliacion.findMany({
    where: {
      periodo_id: periodoId,
      ...(orId ? { or_id: orId } : {}),
    },
    orderBy: { codigo_frontera: "asc" },
    // No usamos `take` en la query: filtramos por diferencia en memoria y
    // recortamos a 500 despues.
  })

  const gestiones = await mapaGestiones(periodoId, "SDL")
  const out: FilaGestion[] = []

  for (const r of rows) {
    const incompleta = r.caso === "INCOMPLETA" || r.caso === "ERROR"

    // Regla de ACTIVA: los tres montos presentes y ambos deltas superan el umbral.
    const activaAplica =
      r.e_fac != null &&
      r.e_sdl != null &&
      r.e_xm != null &&
      absDelta(r.e_fac, r.e_sdl) > UMBRAL &&
      absDelta(r.e_sdl, r.e_xm) > UMBRAL

    const tieneDiff =
      r.diff_inductiva ||
      r.diff_capacitiva ||
      r.diff_factor_m ||
      r.diff_nivel_tension ||
      r.diff_propiedad ||
      incompleta ||
      activaAplica

    if (!tieneDiff) continue

    const diffs: DiffItem[] = []
    if (activaAplica) diffs.push({ campo: "activa", fac: dec(r.e_fac), or: dec(r.e_sdl) })
    if (r.diff_inductiva) diffs.push({ campo: "inductiva", fac: dec(r.ind_pen_fac), or: dec(r.ind_pen_sdl) })
    if (r.diff_capacitiva) diffs.push({ campo: "capacitiva", fac: dec(r.cap_pen_fac), or: dec(r.cap_pen_sdl) })
    if (r.diff_factor_m) diffs.push({ campo: "factor_m", fac: dec(r.factor_m_fac), or: dec(r.factor_m_sdl) })
    if (r.diff_nivel_tension) diffs.push({ campo: "nivel_tension", fac: r.nivel_tension_fac, or: r.nivel_tension_sdl })
    if (r.diff_propiedad) diffs.push({ campo: "propiedad", fac: r.propiedad_activos_fac, or: r.propiedad_activos_sdl })
    if (incompleta) diffs.push({ campo: "incompleta", fac: null, or: null })

    out.push({
      concepto: "SDL",
      periodoId,
      codigoFrontera: r.codigo_frontera,
      operadorNombre: r.operador_red,
      orId: r.or_id,
      caso: r.caso,
      eFac: dec(r.e_fac),
      eXm: dec(r.e_xm),
      eSdl: dec(r.e_sdl),
      diffs,
      gestion: gestiones.get(r.codigo_frontera) ?? null,
    })
  }

  return out.slice(0, 500)
}

/**
 * TC1: fronteras con diferencia = caso != "SIN_DIFERENCIA".
 * (Es decir DIFERENCIA por nivel_tension/propiedad, o INCOMPLETA.)
 */
async function listarTC1(
  periodoId: string,
  orId: string | undefined,
): Promise<FilaGestion[]> {
  const rows = await db.resultadoConciliacionTC1.findMany({
    where: {
      periodo_id: periodoId,
      caso: { not: "SIN_DIFERENCIA" },
      ...(orId ? { or_id: orId } : {}),
    },
    orderBy: { codigo_frontera: "asc" },
  })

  const gestiones = await mapaGestiones(periodoId, "TC1")
  const out: FilaGestion[] = []

  for (const r of rows) {
    const incompleta = r.caso === "INCOMPLETA"
    const diffs: DiffItem[] = []
    if (r.diff_nivel_tension) diffs.push({ campo: "nivel_tension", fac: r.nivel_tension_fac, or: r.nivel_tension_tc1 })
    if (r.diff_propiedad) diffs.push({ campo: "propiedad", fac: r.propiedad_fac, or: r.propiedad_tc1 })
    if (incompleta) diffs.push({ campo: "incompleta", fac: null, or: null })

    out.push({
      concepto: "TC1",
      periodoId,
      codigoFrontera: r.codigo_frontera,
      operadorNombre: r.operador_red,
      orId: r.or_id,
      caso: r.caso,
      eFac: null,
      eXm: null,
      eSdl: null,
      diffs,
      gestion: gestiones.get(r.codigo_frontera) ?? null,
    })
  }

  return out.slice(0, 500)
}

/**
 * Lista fronteras con diferencia para el concepto indicado, mergeadas con su
 * accionable. COT devuelve [] (modulo en construccion).
 */
export async function listarGestiones(
  concepto: ConceptoGestionStr,
  periodoId: string | undefined,
  orId: string | undefined,
): Promise<FilaGestion[]> {
  // Sin periodo no hay universo de fronteras que listar.
  if (!periodoId) return []

  switch (concepto) {
    case "SDL":
      return listarSDL(periodoId, orId)
    case "TC1":
      return listarTC1(periodoId, orId)
    case "COT":
      return []
  }
}
