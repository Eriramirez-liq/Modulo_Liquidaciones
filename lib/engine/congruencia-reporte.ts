import { db } from "@/lib/db"
import {
  clasificarCongruencia,
  clasifConHerencia,
  claveBase,
  codigoBase,
  construirBaseClasif,
  normalizar,
  type ClasifFuente,
} from "@/lib/engine/congruencia"

/**
 * Helper de servidor que construye el reporte de diferencias de congruencia
 * para un periodo. Centraliza la lógica de carga + indexación + clasificación
 * para reusarla entre el endpoint de reporte (JSON) y el de exportación (Excel),
 * evitando duplicar el armado del universo de fronteras.
 *
 * Reusa la lógica PURA de `clasificarCongruencia` (no la reimplementa).
 */

export interface FilaReporteCongruencia {
  /** Código de frontera crudo (SIC), preferido de Facturación → SDL → TC1. */
  sic: string
  /** Código del operador de red de la frontera, o null si no se pudo resolver. */
  or: string | null
  estado: string
  diferencia: string
  datoErrado: string
  datoCorrecto: string
}

/** Datos crudos de una frontera para una fuente, indexados por clave normalizada. */
interface DatosFuente {
  codigoCrudo: string
  clasif: ClasifFuente
  /** Código de OR resuelto para esta fuente, si aplica. */
  or: string | null
}

/**
 * Construye el reporte de congruencia (solo fronteras NO congruentes) para el
 * periodo indicado por su clave string "AAAA-MM".
 */
export async function obtenerReporteCongruencia(
  periodoStr: string,
): Promise<FilaReporteCongruencia[]> {
  // ── Carga en paralelo de las 3 fuentes (solo columnas necesarias) ──────────
  const [facturacion, sdl, tc1, operadores] = await Promise.all([
    db.registroFacturacion.findMany({
      where: { periodo_id: periodoStr },
      select: {
        codigo_frontera: true,
        nivel_tension: true,
        propiedad_activos: true,
        operador_red: true,
      },
    }),
    db.registroSDL.findMany({
      where: { periodo_id: periodoStr, es_duplicado: false },
      select: {
        codigo_frontera: true,
        nivel_tension: true,
        propiedad_activos: true,
        or_id: true,
      },
    }),
    db.registroTC1.findMany({
      where: { periodo_id: periodoStr },
      select: {
        codigo_frontera: true,
        nivel_tension: true,
        propiedad_activos: true,
        or_id: true,
      },
    }),
    db.configuracionOR.findMany({ select: { id: true, codigo: true } }),
  ])

  // Mapa or_id (CUID) → código de OR, para resolver SDL/TC1.
  const orPorId = new Map<string, string>()
  for (const o of operadores) orPorId.set(o.id, o.codigo)

  // Mapa de clasificación de las fronteras BASE (sin "_"), prioridad Fac→SDL→TC1.
  // Las fronteras "hijas" (FRT_1, FRT_2) heredan NT/propiedad de su base.
  const baseClasif = construirBaseClasif([
    facturacion.map(f => ({ clave: normalizar(f.codigo_frontera), nt: normalizar(f.nivel_tension), prop: normalizar(f.propiedad_activos) })),
    sdl.map(s => ({ clave: normalizar(s.codigo_frontera), nt: normalizar(s.nivel_tension), prop: normalizar(s.propiedad_activos) })),
    tc1.map(t => ({ clave: normalizar(t.codigo_frontera), nt: normalizar(t.nivel_tension), prop: normalizar(t.propiedad_activos) })),
  ])

  // ── Indexación por clave BASE (las fronteras "_N" se colapsan en su base, que
  //    es la frontera principal a conciliar). Primera aparición por fuente. ────
  const idxFac = new Map<string, DatosFuente>()
  const idxSdl = new Map<string, DatosFuente>()
  const idxTc1 = new Map<string, DatosFuente>()

  for (const f of facturacion) {
    const claveFull = normalizar(f.codigo_frontera)
    const clave = claveBase(claveFull)
    if (idxFac.has(clave)) continue
    idxFac.set(clave, {
      codigoCrudo: codigoBase(f.codigo_frontera),
      clasif: clasifConHerencia(claveFull, { nt: normalizar(f.nivel_tension), prop: normalizar(f.propiedad_activos) }, baseClasif),
      or: f.operador_red ?? null,
    })
  }

  for (const s of sdl) {
    const claveFull = normalizar(s.codigo_frontera)
    const clave = claveBase(claveFull)
    if (idxSdl.has(clave)) continue
    idxSdl.set(clave, {
      codigoCrudo: codigoBase(s.codigo_frontera),
      clasif: clasifConHerencia(claveFull, { nt: normalizar(s.nivel_tension), prop: normalizar(s.propiedad_activos) }, baseClasif),
      or: s.or_id ? orPorId.get(s.or_id) ?? null : null,
    })
  }

  for (const t of tc1) {
    const claveFull = normalizar(t.codigo_frontera)
    const clave = claveBase(claveFull)
    if (idxTc1.has(clave)) continue
    idxTc1.set(clave, {
      codigoCrudo: codigoBase(t.codigo_frontera),
      clasif: clasifConHerencia(claveFull, { nt: normalizar(t.nivel_tension), prop: normalizar(t.propiedad_activos) }, baseClasif),
      or: t.or_id ? orPorId.get(t.or_id) ?? null : null,
    })
  }

  // Universo = unión de fronteras de las 3 fuentes (por clave normalizada).
  const universo = new Set<string>([...idxFac.keys(), ...idxSdl.keys(), ...idxTc1.keys()])

  const filas: FilaReporteCongruencia[] = []
  for (const clave of universo) {
    const fac = idxFac.get(clave)
    const sdl_ = idxSdl.get(clave)
    const tc1_ = idxTc1.get(clave)

    const resultado = clasificarCongruencia(
      fac?.clasif ?? null,
      sdl_?.clasif ?? null,
      tc1_?.clasif ?? null,
    )
    // null → frontera congruente: no va al reporte.
    if (!resultado) continue

    // SIC crudo: preferir Facturación → SDL → TC1.
    const sic = fac?.codigoCrudo ?? sdl_?.codigoCrudo ?? tc1_?.codigoCrudo ?? clave
    // OR de la frontera: preferir SDL/TC1 (código del or_id), si no operador_red de Facturación.
    const or = sdl_?.or ?? tc1_?.or ?? fac?.or ?? null

    filas.push({
      sic,
      or,
      estado: resultado.estado,
      diferencia: resultado.diferencia,
      datoErrado: resultado.datoErrado,
      datoCorrecto: resultado.datoCorrecto,
    })
  }

  filas.sort((a, b) => a.sic.localeCompare(b.sic))
  return filas
}
