import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"

/**
 * Conciliacion TC1 vs Facturacion.
 *
 * Cruza las fronteras de Facturacion (universo maestro) con los RegistroTC1
 * del periodo+OR por codigo de frontera y compara DOS indicadores:
 *   - nivel de tension
 *   - propiedad de activos
 *
 * Resultado por frontera: SIN_DIFERENCIA | DIFERENCIA | INCOMPLETA.
 * Idempotente: borra y regenera los resultados del periodo (y OR si se filtra).
 */

export interface OpcionesTC1 {
  anio:   number
  mes:    number
  orId?:  string
  userId: string
}

export interface ResumenTC1 {
  periodoId:      string
  periodoStr:     string
  totalFronteras: number
  sinDiferencia:  number
  diffNivelTension: number
  diffPropiedad:    number
  incompletas:      number
}

const normKey = (s: string | null | undefined): string =>
  (s ?? "").trim().toUpperCase()

// Nivel de tension: comparar como entero si ambos parsean; sino string norm.
function mismoNivel(fac: string | null, tc1: string | null): boolean {
  if (fac == null || tc1 == null) return false
  const a = parseInt(fac, 10), b = parseInt(tc1, 10)
  if (!isNaN(a) && !isNaN(b)) return a === b
  return normKey(fac) === normKey(tc1)
}

// Propiedad: Facturacion usa "OR"/"Usuario"/"Compartido"; TC1 deriva
// "OR"/"USUARIO"/"COMPARTIDO". Comparar normalizado.
function mismaPropiedad(fac: string | null, tc1: string | null): boolean {
  if (fac == null || tc1 == null) return false
  return normKey(fac) === normKey(tc1)
}

export async function ejecutarConciliacionTC1(opts: OpcionesTC1): Promise<ResumenTC1> {
  const { anio, mes, orId, userId } = opts
  const periodoStr = `${anio}-${String(mes).padStart(2, "0")}`

  const periodo = await db.periodoConciliacion.findUnique({
    where: { uq_periodo_anio_mes: { anio, mes } },
    select: { id: true },
  })
  if (!periodo) {
    throw new Error(`No existe el periodo ${periodoStr}. Cargá Facturación y TC1 primero.`)
  }

  // Filtro opcional por OR (Facturacion usa texto operador_red = codigo del OR)
  let facOrFilter: { operador_red?: string } = {}
  if (orId) {
    const or = await db.configuracionOR.findUnique({
      where: { id: orId }, select: { codigo: true },
    })
    if (!or) throw new Error(`OR ${orId} no encontrado.`)
    facOrFilter = { operador_red: or.codigo }
  }

  // Facturacion (universo maestro) + TC1 del periodo.
  const [facturacion, tc1] = await Promise.all([
    db.registroFacturacion.findMany({
      where: { periodo_id: periodoStr, ...facOrFilter },
      select: { codigo_frontera: true, nombre_usuario: true, operador_red: true,
                nivel_tension: true, propiedad_activos: true },
    }),
    db.registroTC1.findMany({
      where: { periodo_id: periodoStr, ...(orId ? { or_id: orId } : {}) },
      select: { codigo_frontera: true, nivel_tension: true, propiedad_activos: true, or_id: true },
    }),
  ])

  const tc1ByFrontera = new Map(tc1.map(t => [normKey(t.codigo_frontera), t]))

  type Row = Omit<Prisma.ResultadoConciliacionTC1CreateManyInput, "id">
  const resultados: Row[] = []
  let sinDif = 0, diffNT = 0, diffProp = 0, incompletas = 0

  for (const f of facturacion) {
    const t = tc1ByFrontera.get(normKey(f.codigo_frontera))

    // Nivel de tension TC1 puede venir "1","2",... ; propiedad "USUARIO"/"OR"/"COMPARTIDO".
    const ntFac = f.nivel_tension ?? null
    const ntTc1 = t?.nivel_tension ?? null
    const prFac = f.propiedad_activos ?? null
    const prTc1 = t?.propiedad_activos ?? null

    let caso: string
    let diffNivel = false
    let diffPr = false
    const obs: string[] = []

    if (!t) {
      caso = "INCOMPLETA"
      obs.push("Frontera no encontrada en TC1.")
      incompletas++
    } else {
      // Solo evaluamos diff cuando ambos lados tienen dato.
      const ntComparable = ntFac != null && ntTc1 != null
      const prComparable = prFac != null && prTc1 != null
      if (ntComparable && !mismoNivel(ntFac, ntTc1)) diffNivel = true
      if (prComparable && !mismaPropiedad(prFac, prTc1)) diffPr = true

      if (!ntComparable || !prComparable) {
        caso = "INCOMPLETA"
        if (!ntComparable) obs.push("Falta nivel de tensión en Facturación o TC1.")
        if (!prComparable) obs.push("Falta propiedad de activos en Facturación o TC1.")
        incompletas++
      } else if (diffNivel || diffPr) {
        caso = "DIFERENCIA"
      } else {
        caso = "SIN_DIFERENCIA"
        sinDif++
      }
    }

    if (diffNivel) diffNT++
    if (diffPr)    diffProp++

    resultados.push({
      periodo_id:         periodo.id,
      or_id:              t?.or_id ?? orId ?? null,
      codigo_frontera:    f.codigo_frontera,
      nombre_usuario:     f.nombre_usuario,
      operador_red:       f.operador_red,
      nivel_tension_fac:  ntFac,
      nivel_tension_tc1:  ntTc1,
      diff_nivel_tension: diffNivel,
      propiedad_fac:      prFac,
      propiedad_tc1:      prTc1,
      diff_propiedad:     diffPr,
      caso,
      observaciones:      obs.length > 0 ? obs.join("; ") : null,
      conciliado_por_id:  userId,
    })
  }

  // Persistir (idempotente): borrar resultados del periodo (y OR si filtra) y recrear.
  const fronteras = facturacion.map(f => f.codigo_frontera)
  await db.$transaction(async (tx) => {
    await tx.resultadoConciliacionTC1.deleteMany({
      where: {
        periodo_id: periodo.id,
        ...(orId ? { or_id: orId } : {}),
        codigo_frontera: { in: fronteras },
      },
    })
    if (resultados.length > 0) {
      await tx.resultadoConciliacionTC1.createMany({ data: resultados })
    }
    await tx.logAuditoria.create({
      data: {
        usuario_id: userId,
        accion:     "EJECUTAR_CONCILIACION",
        entidad:    "resultados_conciliacion_tc1",
        entidad_id: periodo.id,
        detalle: {
          tipo: "TC1", periodo: periodoStr, or_id: orId,
          totalFronteras: facturacion.length,
          diffNivelTension: diffNT, diffPropiedad: diffProp, incompletas,
        } as Prisma.InputJsonValue,
      },
    })
  }, { timeout: 60_000 })

  return {
    periodoId:        periodo.id,
    periodoStr,
    totalFronteras:   facturacion.length,
    sinDiferencia:    sinDif,
    diffNivelTension: diffNT,
    diffPropiedad:    diffProp,
    incompletas,
  }
}
