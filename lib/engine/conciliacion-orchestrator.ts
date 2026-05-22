import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import {
  clasificarFrontera,
  type CasoConciliacion,
  type TarifaBIA,
} from "./conciliacion-sdl"

/**
 * Orquesta la ejecución de la conciliación SDL para un período.
 *
 * Flujo:
 *   1. Resolver el PeriodoConciliacion (anio, mes) y opcionalmente el OR.
 *   2. Cargar RegistroFacturacion, RegistroXM y RegistroSDL del período.
 *   3. Indexar XM y SDL por codigo_frontera para matchear contra Facturación
 *      (Facturación es el universo maestro de fronteras).
 *   4. Por cada Facturación: invocar el motor puro → arma ResultadoConciliacion
 *      + Provision/Contingencia/Disputa derivados.
 *   5. En una transacción: borrar resultados previos del período (idempotente)
 *      e insertar los nuevos.
 *   6. Log de auditoría + resumen agregado.
 */

export interface OpcionesEjecucion {
  anio:    number
  mes:     number
  orId?:   string         // si se pasa, solo se concilian fronteras del OR
  userId:  string         // para auditoría
}

export interface ResumenConciliacion {
  periodoId:              string
  periodoStr:             string         // "AAAA-MM"
  totalFronteras:         number
  porCaso:                Record<CasoConciliacion, number>
  provisiones:            { cantidad: number; valor_total: number }
  contingencias:          { cantidad: number; energia_total: number }
  disputas:               { cantidad: number; valor_total: number }
  alertasManual:          number
  incompletas:            number
  fronterasNoEnFacturacion: { xm: number; sdl: number }
}

export async function ejecutarConciliacion(
  opts: OpcionesEjecucion,
): Promise<ResumenConciliacion> {
  const { anio, mes, orId, userId } = opts
  const periodoStr = `${anio}-${String(mes).padStart(2, "0")}`

  // 1. Resolver período
  const periodo = await db.periodoConciliacion.findUnique({
    where: { uq_periodo_anio_mes: { anio, mes } },
    select: { id: true, estado: true },
  })
  if (!periodo) {
    throw new Error(`No existe el periodo ${periodoStr}. Cargá al menos una fuente primero.`)
  }

  // 2. Resolver OR opcional (mapeamos codigo para filtrar Facturacion que usa texto)
  let orFilter: { sdl?: { or_id: string }; facturacion?: { operador_red: string } } = {}
  if (orId) {
    const or = await db.configuracionOR.findUnique({
      where: { id: orId },
      select: { codigo: true },
    })
    if (!or) throw new Error(`OR ${orId} no encontrado.`)
    orFilter = {
      sdl:         { or_id: orId },
      facturacion: { operador_red: or.codigo },
    }
  }

  // 3. Cargar las tres fuentes en paralelo
  const [facturacion, xm, sdl] = await Promise.all([
    db.registroFacturacion.findMany({
      where: { periodo_id: periodoStr, ...(orFilter.facturacion ?? {}) },
    }),
    db.registroXM.findMany({
      where: { periodo_id: periodoStr },
    }),
    db.registroSDL.findMany({
      where: { periodo_id: periodoStr, ...(orFilter.sdl ?? {}) },
    }),
  ])

  // Indexar XM y SDL por codigo_frontera
  const xmByFrontera  = new Map(xm.map(r  => [r.codigo_frontera, r]))
  const sdlByFrontera = new Map(sdl.map(r => [r.codigo_frontera, r]))

  // Detectar fronteras "huérfanas" (en XM/SDL pero no en Facturacion)
  const facFronteras = new Set(facturacion.map(f => f.codigo_frontera))
  const xmHuerfanas  = xm.filter(r  => !facFronteras.has(r.codigo_frontera)).length
  const sdlHuerfanas = sdl.filter(r => !facFronteras.has(r.codigo_frontera)).length

  // 4. Clasificar cada Facturacion + construir registros a persistir
  type PendingProvision = Omit<Prisma.ProvisionCreateManyInput, "id" | "createdAt" | "updatedAt">
  type PendingContingencia = Omit<Prisma.ContingenciaCreateManyInput, "id" | "createdAt" | "updatedAt">
  type PendingDisputa = Omit<Prisma.DisputaCreateManyInput, "id" | "createdAt" | "updatedAt">

  const resultadosToCreate: Prisma.ResultadoConciliacionCreateManyInput[] = []
  // Las provisiones/contingencias/disputas necesitan resultado_id (que aún no existe).
  // Las indexamos por codigo_frontera para mapear luego.
  const provisionesPorFrontera:    Map<string, Omit<PendingProvision, "resultado_id">>    = new Map()
  const contingenciasPorFrontera:  Map<string, Omit<PendingContingencia, "resultado_id">> = new Map()
  const disputasPorFrontera:       Map<string, Omit<PendingDisputa, "resultado_id">>      = new Map()

  const porCaso: Record<CasoConciliacion, number> = {
    A1: 0, B1: 0, B2: 0, C1: 0, C2: 0,
    D1: 0, D2: 0, D3: 0, D4: 0,
    INCOMPLETA: 0, ERROR: 0,
  }
  let alertasManual = 0
  let incompletas   = 0

  for (const f of facturacion) {
    const xmRec  = xmByFrontera.get(f.codigo_frontera)
    const sdlRec = sdlByFrontera.get(f.codigo_frontera)

    const tarifa: TarifaBIA = {
      g_bia:      f.g_bia      != null ? Number(f.g_bia)      : null,
      t_bia:      f.t_bia      != null ? Number(f.t_bia)      : null,
      d_bia:      f.d_bia      != null ? Number(f.d_bia)      : null,
      pr_bia:     f.pr_bia     != null ? Number(f.pr_bia)     : null,
      r_bia:      f.r_bia      != null ? Number(f.r_bia)      : null,
      c_bia:      f.c_bia      != null ? Number(f.c_bia)      : null,
      tarifa_sdl: sdlRec       != null ? Number(sdlRec.tarifa_sdl) : null,
    }

    const r = clasificarFrontera({
      e_fac: Number(f.energia_kwh),
      e_xm:  xmRec  ? Number(xmRec.energia_xm_kwh)   : null,
      e_sdl: sdlRec ? Number(sdlRec.energia_sdl_kwh) : null,
      tarifa,
    })

    porCaso[r.caso] += 1
    if (r.requiere_alerta_manual) alertasManual++
    if (r.caso === "INCOMPLETA") incompletas++

    // ResultadoConciliacion (uno por frontera)
    resultadosToCreate.push({
      periodo_id:             periodo.id,
      codigo_frontera:        f.codigo_frontera,
      nombre_usuario:         f.nombre_usuario,
      operador_red:           f.operador_red,
      or_id:                  sdlRec?.or_id ?? null,
      e_fac:                  f.energia_kwh,
      e_xm:                   xmRec?.energia_xm_kwh   ?? null,
      e_sdl:                  sdlRec?.energia_sdl_kwh ?? null,
      delta_l1:               r.delta_l1,
      delta_l2:               r.delta_l2,
      caso:                   r.caso,
      resultado_l1:           r.resultado_l1 ?? null,
      resultado_l2:           r.resultado_l2 ?? null,
      impacto_financiero_l1:  r.impacto_financiero_l1 ?? null,
      impacto_financiero_l2:  r.impacto_financiero_l2 ?? null,
      requiere_alerta_manual: r.requiere_alerta_manual,
      observaciones:          r.observaciones.length > 0 ? r.observaciones.join("; ") : null,
    })

    // Derivados según resultado_l1
    if (r.resultado_l1 === "PROVISION_L1" || r.resultado_l1 === "PROVISION_COMBINADA") {
      const tipo = r.caso === "D3" ? "D3"
                 : r.caso === "D2" ? "COMBINADA"
                 : "L1"
      provisionesPorFrontera.set(f.codigo_frontera, {
        periodo_id:             periodo.id,
        codigo_frontera:        f.codigo_frontera,
        or_id:                  sdlRec?.or_id ?? null,
        tipo,
        energia_kwh:            new Prisma.Decimal(Math.abs(r.delta_l1)),
        valor_provisionado_cop: new Prisma.Decimal(r.impacto_financiero_l1 ?? 0),
        componentes_json: ({
          caso: r.caso,
          delta_l1: r.delta_l1,
          delta_l2: r.delta_l2,
          tarifa,
          observaciones: r.observaciones,
        } as unknown) as Prisma.InputJsonValue,
        estado:        "PENDIENTE",
        creado_por_id: userId,
      })
    } else if (r.resultado_l1 === "CONTINGENCIA_L1") {
      contingenciasPorFrontera.set(f.codigo_frontera, {
        periodo_id:           periodo.id,
        codigo_frontera:      f.codigo_frontera,
        or_id:                sdlRec?.or_id ?? null,
        energia_kwh:          new Prisma.Decimal(Math.abs(r.delta_l1)),
        costo_calculado_cop:  null, // se valoriza al recibir cobro del OR
        estado:               "PENDIENTE",
        resultado_tipo:       "PENDIENTE",
        descripcion:          r.observaciones.length > 0 ? r.observaciones.join("; ") : null,
        creado_por_id:        userId,
      })
    }

    // Disputas (resultado_l2)
    if (r.resultado_l2 === "DISPUTA_L2") {
      if (!sdlRec?.or_id) {
        // No podemos crear Disputa sin or_id (es required en el schema).
        // Lo dejamos como observación en el ResultadoConciliacion.
        const last = resultadosToCreate[resultadosToCreate.length - 1]
        if (last) {
          const obs = last.observaciones ?? ""
          last.observaciones = (obs ? obs + "; " : "") +
            "Disputa L2 no creada: falta or_id (no hay SDL para esta frontera)."
        }
      } else {
        const valorDisputa = r.impacto_financiero_l2 ?? 0
        const deltaDisputa = r.caso === "C1" ? Math.abs(r.delta_l2)
                           : r.caso === "C2" ? Math.abs(r.delta_l2)
                           : r.caso === "D1" ? Math.abs(r.delta_l2)
                           : 0
        disputasPorFrontera.set(f.codigo_frontera, {
          periodo_id:         periodo.id,
          codigo_frontera:    f.codigo_frontera,
          or_id:              sdlRec.or_id,
          energia_exceso_kwh: new Prisma.Decimal(deltaDisputa),
          valor_disputa_cop:  new Prisma.Decimal(valorDisputa),
          estado:             "ABIERTA",
          descripcion:        `Caso ${r.caso}. ` + (r.observaciones.join("; ") || ""),
          abierta_por_id:     userId,
        })
      }
    }
  }

  // 5. Transaction: limpiar previos + insertar nuevos
  await db.$transaction(async (tx) => {
    // Borrar cruces_balance que apunten a provisiones/contingencias del período
    await tx.cruceBalance.deleteMany({
      where: {
        OR: [
          { provision:    { periodo_id: periodo.id, ...(orId ? { or_id: orId } : {}) } },
          { contingencia: { periodo_id: periodo.id, ...(orId ? { or_id: orId } : {}) } },
        ],
      },
    })
    // Borrar derivados
    const whereDerivados = { periodo_id: periodo.id, ...(orId ? { or_id: orId } : {}) }
    await tx.disputa.deleteMany({ where: whereDerivados })
    await tx.contingencia.deleteMany({ where: whereDerivados })
    await tx.provision.deleteMany({ where: whereDerivados })
    // Borrar ResultadoConciliacion (FK origen)
    await tx.resultadoConciliacion.deleteMany({
      where: { periodo_id: periodo.id, ...(orId ? { or_id: orId } : {}) },
    })

    // Insertar resultados
    if (resultadosToCreate.length > 0) {
      await tx.resultadoConciliacion.createMany({ data: resultadosToCreate })
    }

    // Lookup id por (periodo_id, codigo_frontera) para resolver resultado_id
    const creados = await tx.resultadoConciliacion.findMany({
      where: { periodo_id: periodo.id },
      select: { id: true, codigo_frontera: true },
    })
    const idByFrontera = new Map(creados.map(c => [c.codigo_frontera, c.id]))

    // Insertar provisiones, contingencias, disputas
    const provisionesData = Array.from(provisionesPorFrontera.entries())
      .map(([frontera, p]) => {
        const rid = idByFrontera.get(frontera)
        if (!rid) return null
        return { ...p, resultado_id: rid }
      })
      .filter((p): p is Prisma.ProvisionCreateManyInput => p !== null)
    if (provisionesData.length > 0) {
      await tx.provision.createMany({ data: provisionesData })
    }

    const contingenciasData = Array.from(contingenciasPorFrontera.entries())
      .map(([frontera, c]) => {
        const rid = idByFrontera.get(frontera)
        if (!rid) return null
        return { ...c, resultado_id: rid }
      })
      .filter((c): c is Prisma.ContingenciaCreateManyInput => c !== null)
    if (contingenciasData.length > 0) {
      await tx.contingencia.createMany({ data: contingenciasData })
    }

    const disputasData = Array.from(disputasPorFrontera.entries())
      .map(([frontera, d]) => {
        const rid = idByFrontera.get(frontera)
        if (!rid) return null
        return { ...d, resultado_id: rid }
      })
      .filter((d): d is Prisma.DisputaCreateManyInput => d !== null)
    if (disputasData.length > 0) {
      await tx.disputa.createMany({ data: disputasData })
    }

    // Auditoría
    await tx.logAuditoria.create({
      data: {
        usuario_id: userId,
        accion:     "EJECUTAR_CONCILIACION",
        entidad:    "periodos_conciliacion",
        entidad_id: periodo.id,
        detalle: {
          periodo:        periodoStr,
          or_id:          orId,
          totalFronteras: facturacion.length,
          porCaso,
          provisiones:    provisionesData.length,
          contingencias:  contingenciasData.length,
          disputas:       disputasData.length,
        } as Prisma.InputJsonValue,
      },
    })
  }, { timeout: 60_000 })  // 60s para conciliaciones grandes

  // 6. Resumen agregado
  const valorProvisiones = Array.from(provisionesPorFrontera.values())
    .reduce((s, p) => s + Number(p.valor_provisionado_cop), 0)
  const energiaContingencias = Array.from(contingenciasPorFrontera.values())
    .reduce((s, c) => s + Number(c.energia_kwh), 0)
  const valorDisputas = Array.from(disputasPorFrontera.values())
    .reduce((s, d) => s + Number(d.valor_disputa_cop), 0)

  return {
    periodoId:    periodo.id,
    periodoStr,
    totalFronteras: facturacion.length,
    porCaso,
    provisiones:   { cantidad: provisionesPorFrontera.size,   valor_total: valorProvisiones },
    contingencias: { cantidad: contingenciasPorFrontera.size, energia_total: energiaContingencias },
    disputas:      { cantidad: disputasPorFrontera.size,      valor_total: valorDisputas },
    alertasManual,
    incompletas,
    fronterasNoEnFacturacion: { xm: xmHuerfanas, sdl: sdlHuerfanas },
  }
}
