import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import {
  clasificarFrontera,
  clasificarIndicadores,
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

export interface DetalleFrontera {
  codigo_frontera: string
  caso:            CasoConciliacion
  motivo:          string
}

export interface ResumenConciliacion {
  periodoId:              string
  periodoStr:             string         // "AAAA-MM"
  totalFronteras:         number         // Facturacion + huerfanas de XM/SDL
  porCaso:                Record<CasoConciliacion, number>
  // Conteos por indicador (fronteras con diff en ese indicador)
  sinDiferencia:          number         // sin diff en NINGUN indicador
  indicadores: {
    activa:         number               // caso != A1, INCOMPLETA, ERROR
    inductiva:      number               // diff_inductiva = true
    capacitiva:     number               // diff_capacitiva = true
    factor_m:       number               // diff_factor_m = true
    nivel_tension:  number               // diff_nivel_tension = true
    propiedad:      number               // diff_propiedad = true
  }
  provisiones:            { cantidad: number; valor_total: number }
  contingencias:          { cantidad: number; energia_total: number; valor_estimado_total: number }
  disputas:               { cantidad: number; valor_total: number }
  alertasManual:          number
  incompletas:            number         // caso INCOMPLETA (incluye huerfanas de XM/SDL)
  fronterasNoEnFacturacion: { xm: number; sdl: number }
  // Detalle de fronteras que requieren atencion
  detalleIncompletas:    DetalleFrontera[]
  detalleAlertaManual:   DetalleFrontera[]
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

  // Normalizar codigo_frontera para matcheo case-insensitive (trim + uppercase).
  // Facturacion puede traer codigos en mixed case ("Frt24040", "FRT32213") y los
  // archivos SDL/XM pueden venir distinto — comparar tal cual rompe el match.
  // Los registros se guardan en BD con su capitalizacion original; solo el lookup
  // se normaliza.
  const normKey = (s: string | null | undefined): string =>
    (s ?? "").trim().toUpperCase()

  const xmByFrontera  = new Map(xm.map(r  => [normKey(r.codigo_frontera), r]))
  const sdlByFrontera = new Map(sdl.map(r => [normKey(r.codigo_frontera), r]))

  // Detectar fronteras "huérfanas" (en XM/SDL pero no en Facturacion)
  const facFronteras = new Set(facturacion.map(f => normKey(f.codigo_frontera)))
  const xmHuerfanas  = xm.filter(r  => !facFronteras.has(normKey(r.codigo_frontera))).length
  const sdlHuerfanas = sdl.filter(r => !facFronteras.has(normKey(r.codigo_frontera))).length

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
  let alertasManual  = 0
  let incompletas    = 0
  let sinDiferencia  = 0
  let diffActiva     = 0
  let diffInductiva  = 0
  let diffCapacitiva = 0
  let diffFactorM    = 0
  let diffNivelT     = 0
  let diffPropiedad  = 0
  const detalleIncompletas:  DetalleFrontera[] = []
  const detalleAlertaManual: DetalleFrontera[] = []

  for (const f of facturacion) {
    const fKey   = normKey(f.codigo_frontera)
    const xmRec  = xmByFrontera.get(fKey)
    const sdlRec = sdlByFrontera.get(fKey)

    const tarifa: TarifaBIA = {
      g_bia:       f.g_bia        != null ? Number(f.g_bia)        : null,
      g_bolsa_bia: f.g_bolsa_bia  != null ? Number(f.g_bolsa_bia)  : null,
      t_bia:       f.t_bia        != null ? Number(f.t_bia)        : null,
      d_bia:       f.d_bia        != null ? Number(f.d_bia)        : null,
      pr_bia:      f.pr_bia       != null ? Number(f.pr_bia)       : null,
      r_bia:       f.r_bia        != null ? Number(f.r_bia)        : null,
      c_bia:       f.c_bia        != null ? Number(f.c_bia)        : null,
      tarifa_sdl:  sdlRec         != null ? Number(sdlRec.tarifa_sdl) : null,
    }

    const r = clasificarFrontera({
      e_fac: Number(f.energia_kwh),
      e_xm:  xmRec  ? Number(xmRec.energia_xm_kwh)   : null,
      e_sdl: sdlRec ? Number(sdlRec.energia_sdl_kwh) : null,
      tarifa,
    })

    // Indicadores extendidos (fac vs sdl). Si no hay SDL, todos los diff
    // quedan false y la frontera solo aparece como Incompleta (regla acordada).
    const ind = clasificarIndicadores({
      ind_pen_fac:           f.energia_reactiva_ind_pen != null ? Number(f.energia_reactiva_ind_pen) : null,
      ind_pen_sdl:           sdlRec?.energia_reactiva_ind_pen != null ? Number(sdlRec.energia_reactiva_ind_pen) : null,
      cap_pen_fac:           f.energia_reactiva_cap_pen != null ? Number(f.energia_reactiva_cap_pen) : null,
      cap_pen_sdl:           sdlRec?.energia_reactiva_cap_pen != null ? Number(sdlRec.energia_reactiva_cap_pen) : null,
      factor_m_fac:          f.factor_m != null ? Number(f.factor_m) : null,
      factor_m_sdl:          sdlRec?.factor_m != null ? Number(sdlRec.factor_m) : null,
      nivel_tension_fac:     f.nivel_tension ?? null,
      nivel_tension_sdl:     sdlRec?.nivel_tension ?? null,
      propiedad_activos_fac: f.propiedad_activos ?? null,
      propiedad_activos_sdl: sdlRec?.propiedad_activos ?? null,
    })

    porCaso[r.caso] += 1

    // Contar diff por indicador (excepto INCOMPLETA que se cuenta aparte)
    const esActivaConDiff = r.caso !== "A1" && r.caso !== "INCOMPLETA" && r.caso !== "ERROR"
    if (esActivaConDiff)    diffActiva++
    if (ind.diff_inductiva) diffInductiva++
    if (ind.diff_capacitiva) diffCapacitiva++
    if (ind.diff_factor_m)  diffFactorM++
    if (ind.diff_nivel_tension) diffNivelT++
    if (ind.diff_propiedad) diffPropiedad++

    // Sin diferencia = A1 en activa y ningun diff en los otros 5 indicadores.
    // Solo se cuenta si la frontera tiene SDL (sino caso == INCOMPLETA).
    if (r.caso === "A1"
        && !ind.diff_inductiva && !ind.diff_capacitiva
        && !ind.diff_factor_m && !ind.diff_nivel_tension && !ind.diff_propiedad) {
      sinDiferencia++
    }

    if (r.requiere_alerta_manual) {
      alertasManual++
      detalleAlertaManual.push({
        codigo_frontera: f.codigo_frontera,
        caso:            r.caso,
        motivo:          r.observaciones.length > 0 ? r.observaciones.join("; ") : "Caso requiere revisión manual",
      })
    }
    if (r.caso === "INCOMPLETA") {
      incompletas++
      detalleIncompletas.push({
        codigo_frontera: f.codigo_frontera,
        caso:            "INCOMPLETA",
        motivo:          r.observaciones.length > 0 ? r.observaciones.join("; ") : "Datos faltantes",
      })
    }

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
      // Indicadores extendidos
      ind_pen_fac:            f.energia_reactiva_ind_pen ?? null,
      ind_pen_sdl:            sdlRec?.energia_reactiva_ind_pen ?? null,
      ind_pen_delta:          ind.ind_pen_delta != null ? new Prisma.Decimal(ind.ind_pen_delta) : null,
      diff_inductiva:         ind.diff_inductiva,
      cap_pen_fac:            f.energia_reactiva_cap_pen ?? null,
      cap_pen_sdl:            sdlRec?.energia_reactiva_cap_pen ?? null,
      cap_pen_delta:          ind.cap_pen_delta != null ? new Prisma.Decimal(ind.cap_pen_delta) : null,
      diff_capacitiva:        ind.diff_capacitiva,
      factor_m_fac:           f.factor_m ?? null,
      factor_m_sdl:           sdlRec?.factor_m ?? null,
      diff_factor_m:          ind.diff_factor_m,
      nivel_tension_fac:      f.nivel_tension ?? null,
      nivel_tension_sdl:      sdlRec?.nivel_tension ?? null,
      diff_nivel_tension:     ind.diff_nivel_tension,
      propiedad_activos_fac:  f.propiedad_activos ?? null,
      propiedad_activos_sdl:  sdlRec?.propiedad_activos ?? null,
      diff_propiedad:         ind.diff_propiedad,
    })

    // Derivados según resultado_l1
    // - PROVISION_L1: B2, D2 (alerta manual), D3
    // - CONTINGENCIA_L1: B1, B1-ext, D1 (alerta manual)
    if (r.resultado_l1 === "PROVISION_L1") {
      const tipo = r.caso === "D3" ? "D3" : "L1"
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
      // Perdida: el motor ya calcula impacto_financiero_l1 con la formula
      // correspondiente al caso (B1, B1-ext, D1). Lo usamos como costo_estimado.
      const energia = Math.abs(r.delta_l1)
      const estimado = r.impacto_financiero_l1 != null
        ? new Prisma.Decimal(r.impacto_financiero_l1)
        : null
      contingenciasPorFrontera.set(f.codigo_frontera, {
        periodo_id:           periodo.id,
        codigo_frontera:      f.codigo_frontera,
        or_id:                sdlRec?.or_id ?? null,
        energia_kwh:          new Prisma.Decimal(energia),
        costo_estimado_cop:   estimado,
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
        // Disputas solo C1 y C2 (D1 ya no genera disputa, va por Contingencia + Alerta Manual)
        const valorDisputa = r.impacto_financiero_l2 ?? 0
        const deltaDisputa = (r.caso === "C1" || r.caso === "C2")
          ? Math.abs(r.delta_l2)
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

  // 4b. Procesar huerfanas (XM/SDL sin match en Facturacion) como INCOMPLETA.
  // Asi quedan visibles en el resumen y en la pestaña de Incompletas, en vez de
  // descartarse silenciosamente.
  // Cuando hay orId filter, las huerfanas XM se ignoran (no podemos saber a que
  // OR pertenecen porque XM no trae or_id). Las huerfanas SDL si se incluyen
  // porque ya vienen filtradas por or_id en el query.
  type Huerfana = {
    codigo:  string
    xmRec?:  typeof xm[number]
    sdlRec?: typeof sdl[number]
    or_id?:  string | null
  }
  const huerfanasByKey = new Map<string, Huerfana>()

  for (const s of sdl) {
    const k = normKey(s.codigo_frontera)
    if (facFronteras.has(k)) continue
    const existing = huerfanasByKey.get(k)
    if (existing) {
      existing.sdlRec = s
      existing.or_id ??= s.or_id
    } else {
      huerfanasByKey.set(k, { codigo: s.codigo_frontera, sdlRec: s, or_id: s.or_id })
    }
  }
  if (!orId) {
    // Solo procesar huerfanas XM si no estamos filtrando por OR.
    for (const x of xm) {
      const k = normKey(x.codigo_frontera)
      if (facFronteras.has(k)) continue
      const existing = huerfanasByKey.get(k)
      if (existing) {
        existing.xmRec = x
      } else {
        huerfanasByKey.set(k, { codigo: x.codigo_frontera, xmRec: x })
      }
    }
  }

  for (const h of huerfanasByKey.values()) {
    const motivos: string[] = ["No existe en Facturación"]
    if (!h.xmRec)  motivos.push("falta XM")
    if (!h.sdlRec) motivos.push("falta SDL")
    const motivo = motivos.join("; ")

    incompletas++
    porCaso.INCOMPLETA += 1
    detalleIncompletas.push({
      codigo_frontera: h.codigo,
      caso:            "INCOMPLETA",
      motivo,
    })

    resultadosToCreate.push({
      periodo_id:             periodo.id,
      codigo_frontera:        h.codigo,
      nombre_usuario:         null,
      operador_red:           null,
      or_id:                  h.or_id ?? null,
      e_fac:                  null,
      e_xm:                   h.xmRec?.energia_xm_kwh   ?? null,
      e_sdl:                  h.sdlRec?.energia_sdl_kwh ?? null,
      delta_l1:               null,
      delta_l2:               null,
      caso:                   "INCOMPLETA",
      resultado_l1:           "INCOMPLETA",
      resultado_l2:           "INCOMPLETA",
      impacto_financiero_l1:  null,
      impacto_financiero_l2:  null,
      requiere_alerta_manual: false,
      observaciones:          motivo,
    })
  }

  // 5. Transaction: limpiar previos + insertar nuevos
  //
  // Borrado idempotente: filtramos por las fronteras que vamos a re-conciliar
  // (no por or_id) porque ResultadoConciliacion puede tener or_id=null cuando
  // la frontera no tuvo match en SDL — si filtraramos por or_id, esas filas
  // sobrevivirian al DELETE y luego romperian el @@unique al re-insertar.
  const fronterasACincoliar = [
    ...facturacion.map(f => f.codigo_frontera),
    ...Array.from(huerfanasByKey.values()).map(h => h.codigo),
  ]
  const whereDerivados = {
    periodo_id:      periodo.id,
    codigo_frontera: { in: fronterasACincoliar },
  }

  await db.$transaction(async (tx) => {
    // Borrar cruces_balance que apunten a provisiones/contingencias afectadas
    await tx.cruceBalance.deleteMany({
      where: {
        OR: [
          { provision:    whereDerivados },
          { contingencia: whereDerivados },
        ],
      },
    })
    // Borrar derivados en orden FK
    await tx.disputa.deleteMany({       where: whereDerivados })
    await tx.contingencia.deleteMany({  where: whereDerivados })
    await tx.provision.deleteMany({     where: whereDerivados })
    // Borrar ResultadoConciliacion (FK origen)
    await tx.resultadoConciliacion.deleteMany({ where: whereDerivados })

    // Insertar resultados
    if (resultadosToCreate.length > 0) {
      await tx.resultadoConciliacion.createMany({ data: resultadosToCreate })
    }

    // Lookup id por (periodo_id, codigo_frontera) para resolver resultado_id.
    // Solo las fronteras que recien insertamos (no las de otros ORs en el
    // mismo periodo si la corrida fue filtrada por OR).
    const creados = await tx.resultadoConciliacion.findMany({
      where: whereDerivados,
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
  const valorEstimadoContingencias = Array.from(contingenciasPorFrontera.values())
    .reduce((s, c) => s + (c.costo_estimado_cop != null ? Number(c.costo_estimado_cop) : 0), 0)
  const valorDisputas = Array.from(disputasPorFrontera.values())
    .reduce((s, d) => s + Number(d.valor_disputa_cop), 0)

  return {
    periodoId:    periodo.id,
    periodoStr,
    totalFronteras: facturacion.length + huerfanasByKey.size,
    porCaso,
    sinDiferencia,
    indicadores: {
      activa:        diffActiva,
      inductiva:     diffInductiva,
      capacitiva:    diffCapacitiva,
      factor_m:      diffFactorM,
      nivel_tension: diffNivelT,
      propiedad:     diffPropiedad,
    },
    provisiones:   { cantidad: provisionesPorFrontera.size,   valor_total: valorProvisiones },
    contingencias: {
      cantidad:             contingenciasPorFrontera.size,
      energia_total:        energiaContingencias,
      valor_estimado_total: valorEstimadoContingencias,
    },
    disputas:      { cantidad: disputasPorFrontera.size,      valor_total: valorDisputas },
    alertasManual,
    incompletas,
    fronterasNoEnFacturacion: { xm: xmHuerfanas, sdl: sdlHuerfanas },
    detalleIncompletas,
    detalleAlertaManual,
  }
}
