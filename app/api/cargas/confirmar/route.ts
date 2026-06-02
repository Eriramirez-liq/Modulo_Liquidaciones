import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import {
  FilaFacturacion,
  FilaXM,
  FilaSDL,
  FilaBalance,
  FilaTC1,
} from "@/lib/parsers/types"
import type { FilaSTR } from "@/lib/parsers/insumos-str"
import { confirmarBodySchema } from "@/lib/validation/cargas"
import { esPeriodoPermitido } from "@/lib/utils/periodos"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  // Validación de body con Zod. Mantiene el comportamiento previo: si el shape
  // es inválido devolvemos 400. El schema deriva del tipo ConfirmarBody que
  // existía aquí inline; no endurece validaciones.
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "Body inválido: JSON malformado" },
      { status: 400 }
    )
  }
  const parsed = confirmarBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "VALIDATION_ERROR",
        message: "Datos incompletos",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }
  const { meta, filasCompletas, justificacion, cargaPreviaId, accionCargaPrevia } = parsed.data
  // Default: si hay carga previa pero no se especifico accion, asumimos
  // "reemplazar" (preserva el comportamiento previo del wizard para otros ORs).
  const accion: "reemplazar" | "agregar" | null =
    cargaPreviaId
      ? (accionCargaPrevia ?? "reemplazar")
      : null

  // INSUMOS_STR puede confirmarse aunque filasCompletas esté vacío
  // (la lógica de análisis puede aún no estar implementada y querer registrar
  // la carga de los archivos para auditoría).
  if (meta.tipoFuente !== "INSUMOS_STR" && !filasCompletas?.length) {
    return NextResponse.json({ error: "Datos incompletos" }, { status: 400 })
  }

  // Solo se puede cargar hasta el mes anterior (periodo de consumo cerrado).
  if (!esPeriodoPermitido(meta.anio, meta.mes)) {
    return NextResponse.json(
      { error: "Solo se puede cargar hasta el mes anterior (mes de consumo). No se permite el mes en curso ni futuros." },
      { status: 400 }
    )
  }

  // Justificacion solo requerida cuando se reemplaza (agregar no la pide).
  if (accion === "reemplazar" && !justificacion?.trim()) {
    return NextResponse.json(
      { error: "Se requiere justificación para reemplazar una carga existente" },
      { status: 400 }
    )
  }

  // Codigo del OR (lo necesitamos para validar "agregar" y para decidir el
  // merge de EPM mas abajo).
  const orCodigo = meta.orId
    ? (await db.configuracionOR.findUnique({
        where: { id: meta.orId },
        select: { codigo: true },
      }))?.codigo ?? null
    : null

  // "Agregar" solo permitido para SDL de ORs que reciben archivos en
  // momentos distintos para el mismo periodo:
  //   - EEP_PEREIRA: archivos complementarios por NT (coexisten).
  //   - EPM: archivo de activa y archivo de reactiva (se fusionan por SIC).
  if (accion === "agregar") {
    if (meta.tipoFuente !== "SDL") {
      return NextResponse.json(
        { error: "La opción 'Agregar' solo aplica a cargas SDL." },
        { status: 400 }
      )
    }
    if (!meta.orId) {
      return NextResponse.json(
        { error: "La opción 'Agregar' requiere indicar el Operador de Red." },
        { status: 400 }
      )
    }
    if (orCodigo !== "EEP_PEREIRA" && orCodigo !== "EPM") {
      return NextResponse.json(
        { error: "La opción 'Agregar' solo está disponible para EEP Pereira y EPM." },
        { status: 400 }
      )
    }
  }

  // EPM con accion "agregar" fusiona por codigo_frontera (activa + reactiva
  // en un solo registro) en vez de coexistir como EEP Pereira.
  const esMergeEpm = accion === "agregar" && orCodigo === "EPM"

  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined

  try {
    const resultado = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      // Upsert del período
      const periodo = await tx.periodoConciliacion.upsert({
        where: { uq_periodo_anio_mes: { anio: meta.anio, mes: meta.mes } },
        update: {},
        create: {
          anio: meta.anio,
          mes: meta.mes,
          creado_por_id: session.user.id,
        },
      })

      // Si reemplazamos, borrar los registros derivados de la carga previa
      // ANTES de crear la nueva. Asi la conciliacion no ve datos viejos
      // mezclados con nuevos. Si "agregamos", no tocamos nada.
      if (accion === "reemplazar" && cargaPreviaId) {
        switch (meta.tipoFuente) {
          case "FACTURACION":
            await tx.registroFacturacion.deleteMany({ where: { carga_id: cargaPreviaId } })
            break
          case "XM":
            await tx.registroXM.deleteMany({ where: { carga_id: cargaPreviaId } })
            break
          case "SDL":
            await tx.registroSDL.deleteMany({ where: { carga_id: cargaPreviaId } })
            break
          case "BALANCE":
            await tx.registroBalance.deleteMany({ where: { carga_id: cargaPreviaId } })
            break
          // INSUMOS_STR no entra aca (ya borra registros antes de insertar)
        }
        // Audit trail: la nueva carga apunta a la vieja con reemplaza_id
        // (se setea abajo en el create). No agregamos estado REEMPLAZADA
        // porque el enum EstadoCarga no lo contempla y `reemplaza_id` ya
        // sirve como puntero.
      }

      // Crear CargaFuente. reemplaza_id solo cuando es reemplazo real,
      // no cuando se agrega en paralelo (en ese caso ambas cargas coexisten).
      const carga = await tx.cargaFuente.create({
        data: {
          periodo_id: periodo.id,
          tipo_fuente: meta.tipoFuente,
          or_id: meta.orId ?? null,
          nombre_archivo: meta.nombreArchivo,
          estado: "COMPLETADA",
          total_registros: filasCompletas.length,
          registros_procesados: filasCompletas.length,
          registros_error: 0,
          justificacion_reemplazo: accion === "reemplazar" ? (justificacion ?? null) : null,
          reemplaza_id:            accion === "reemplazar" ? (cargaPreviaId ?? null) : null,
          cargado_por_id: session.user.id,
        },
      })

      const periodoStr = `${meta.anio}-${String(meta.mes).padStart(2, "0")}`

      // Insertar registros según tipo
      switch (meta.tipoFuente) {
        case "FACTURACION": {
          // Las filas ya vienen mapeadas desde /preview-facturacion (Metabase).
          // El shape es FilaFacturacion con campos derivados (nivel_tension,
          // propiedad_activos) y opcionales.
          const filas = filasCompletas as FilaFacturacion[]
          if (filas.length === 0) break

          await tx.registroFacturacion.createMany({
            data: filas.map((f) => ({
              carga_id:                 carga.id,
              periodo_id:               periodoStr,
              codigo_frontera:          f.codigo_frontera,
              nombre_usuario:           f.nombre_usuario,
              operador_red:             f.operador_red,
              energia_kwh:              f.energia_kwh,
              nt_raw:                   f.nt_raw,
              nivel_tension:            f.nivel_tension,
              propiedad_activos:        f.propiedad_activos,
              energia_reactiva_ind_tot: f.energia_reactiva_ind_tot,
              energia_reactiva_cap_tot: f.energia_reactiva_cap_tot,
              energia_reactiva_ind_pen: f.energia_reactiva_ind_pen,
              energia_reactiva_cap_pen: f.energia_reactiva_cap_pen,
              factor_m:                 f.factor_m,
              g_bia:                    f.g_bia,
              g_bolsa_bia:              f.g_bolsa_bia,
              t_bia:                    f.t_bia,
              d_bia:                    f.d_bia,
              pr_bia:                   f.pr_bia,
              r_bia:                    f.r_bia,
              c_bia:                    f.c_bia,
              tarifa_total_bia:         f.tarifa_total_bia,
            })),
          })
          break
        }
        case "XM": {
          const filas = filasCompletas as FilaXM[]
          await tx.registroXM.createMany({
            data: filas.map((f) => ({
              carga_id:        carga.id,
              periodo_id:      periodoStr,
              codigo_frontera: f.SIC,
              nombre_frontera: f.Nombre ?? null,
              energia_xm_kwh:  f["Activa XM"],
            })),
          })
          break
        }
        case "SDL": {
          const filas = filasCompletas as FilaSDL[]

          if (esMergeEpm) {
            // EPM: fusionar por codigo_frontera con los registros existentes
            // del periodo+or (el archivo de reactiva completa el de activa ya
            // cargado, o viceversa). Para evitar N updates dentro de la
            // transaccion (causaba timeout "Transaction not found"), hacemos el
            // merge EN MEMORIA y luego 1 deleteMany + 1 createMany.
            const existentes = await tx.registroSDL.findMany({
              where: { periodo_id: periodoStr, or_id: meta.orId! },
            })
            const porFrontera = new Map(existentes.map(e => [e.codigo_frontera, e]))

            // Reglas de merge por tipo de campo (robustas al orden de carga):
            // - ACTIVA (energia/valor/tarifa_sdl): preferir el valor
            //   significativo (no null y no 0). El archivo de reactiva los trae
            //   en 0 y no debe pisar los de activa.
            // - REACTIVA (ind/cap/valor_reac/tarifa_reac/factor_m): preferir el
            //   valor nuevo si no es null (incluido 0, que es dato valido);
            //   sino conservar el existente.
            // - Strings: preferir el no vacio.
            const numOf = (v: Prisma.Decimal | number | null | undefined): number | null =>
              v == null ? null : Number(v)
            const activaSig = (exist: Prisma.Decimal | null, nuevo: number | null | undefined): number => {
              const e = numOf(exist), n = numOf(nuevo)
              if (e != null && e !== 0) return e
              if (n != null && n !== 0) return n
              return e ?? n ?? 0
            }
            const reactivaMerge = (exist: Prisma.Decimal | null, nuevo: number | null | undefined): number | null => {
              const n = numOf(nuevo)
              if (n != null) return n
              return numOf(exist)
            }
            const strMerge = (exist: string | null, nuevo: string | null | undefined): string | null =>
              (nuevo && nuevo.trim()) ? nuevo : (exist ?? null)

            // Conjunto union de fronteras (existentes + nuevas).
            const nuevasPorFrontera = new Map(filas.map(f => [f.codigo_frontera, f]))
            const todasFronteras = new Set<string>([
              ...existentes.map(e => e.codigo_frontera),
              ...filas.map(f => f.codigo_frontera),
            ])

            const merged: Prisma.RegistroSDLCreateManyInput[] = []
            for (const cod of todasFronteras) {
              const prev = porFrontera.get(cod)
              const f    = nuevasPorFrontera.get(cod)
              merged.push({
                carga_id: carga.id,
                periodo_id: periodoStr,
                or_id: meta.orId!,
                codigo_frontera: cod,
                nombre_frontera:   strMerge(prev?.nombre_frontera ?? null, f?.nombre_frontera),
                periodo_sdl:       f?.periodo_sdl ?? prev?.periodo_sdl ?? periodoStr,
                energia_sdl_kwh:   activaSig(prev?.energia_sdl_kwh ?? null, f?.energia_sdl_kwh),
                valor_sdl_cop:     activaSig(prev?.valor_sdl_cop ?? null, f?.valor_sdl_cop),
                tarifa_sdl:        activaSig(prev?.tarifa_sdl ?? null, f?.tarifa_sdl),
                nivel_tension:     strMerge(prev?.nivel_tension ?? null, f?.nivel_tension),
                propiedad_activos: strMerge(prev?.propiedad_activos ?? null, f?.propiedad_activos),
                energia_reactiva_ind_pen: reactivaMerge(prev?.energia_reactiva_ind_pen ?? null, f?.energia_reactiva_ind_pen),
                energia_reactiva_cap_pen: reactivaMerge(prev?.energia_reactiva_cap_pen ?? null, f?.energia_reactiva_cap_pen),
                valor_reactiva_cop:       reactivaMerge(prev?.valor_reactiva_cop ?? null, f?.valor_reactiva_cop),
                tarifa_reactiva:          reactivaMerge(prev?.tarifa_reactiva ?? null, f?.tarifa_reactiva),
                factor_m:                 reactivaMerge(prev?.factor_m ?? null, f?.factor_m),
                es_duplicado: false,
              })
            }

            // Reemplazar los existentes del periodo+or por el conjunto mergeado.
            await tx.registroSDL.deleteMany({
              where: { periodo_id: periodoStr, or_id: meta.orId! },
            })
            if (merged.length > 0) {
              await tx.registroSDL.createMany({ data: merged })
            }
            break
          }

          await tx.registroSDL.createMany({
            data: filas.map((f) => ({
              carga_id: carga.id,
              periodo_id: periodoStr,
              or_id: meta.orId!,
              codigo_frontera: f.codigo_frontera,
              nombre_frontera: f.nombre_frontera ?? null,
              periodo_sdl: f.periodo_sdl,
              energia_sdl_kwh: f.energia_sdl_kwh,
              valor_sdl_cop: f.valor_sdl_cop,
              tarifa_sdl: f.tarifa_sdl,
              // Campos que el motor de conciliacion usa para comparar los 6
              // indicadores con Facturacion. Sin esto, el motor siempre ve
              // null en sdl y reporta 'sin diff' en factor_m/reactivas/
              // nivel_tension/propiedad/etc.
              nivel_tension:            f.nivel_tension            ?? null,
              propiedad_activos:        f.propiedad_activos        ?? null,
              energia_reactiva_ind_pen: f.energia_reactiva_ind_pen ?? null,
              energia_reactiva_cap_pen: f.energia_reactiva_cap_pen ?? null,
              valor_reactiva_cop:       f.valor_reactiva_cop       ?? null,
              tarifa_reactiva:          f.tarifa_reactiva          ?? null,
              factor_m:                 f.factor_m                 ?? null,
              es_duplicado:             f.es_duplicado             ?? false,
            })),
          })
          break
        }
        case "BALANCE": {
          const filas = filasCompletas as FilaBalance[]
          await tx.registroBalance.createMany({
            data: filas.map((f) => ({
              carga_id: carga.id,
              or_id: meta.orId!,
              codigo_frontera: f.codigo_frontera,
              periodo_ajuste: f.periodo_ajuste,
              energia_balance_kwh: f.energia_balance_kwh,
              valor_balance_cop: f.valor_balance_cop,
              tarifa_balance: f.tarifa_balance,
              periodo_tarifa: f.periodo_tarifa,
            })),
          })
          break
        }
        case "TC1": {
          // Sobrescritura por periodo+or: cada carga reemplaza la anterior del
          // mismo OR para el periodo (el TC1 es una foto del estado actual).
          const filas = filasCompletas as FilaTC1[]
          await tx.registroTC1.deleteMany({
            where: { periodo_id: periodoStr, or_id: meta.orId! },
          })
          if (filas.length === 0) break
          await tx.registroTC1.createMany({
            data: filas.map((f) => ({
              carga_id:               carga.id,
              periodo_id:             periodoStr,
              or_id:                  meta.orId!,
              codigo_frontera:        f.codigo_frontera,
              niu:                    f.niu,
              nivel_tension:          f.nivel_tension,
              nivel_tension_primario: f.nivel_tension_primario,
              pct_propiedad_activo:   f.pct_propiedad_activo,
              propiedad_activos:      f.propiedad_activos,
              tipo_conexion:          f.tipo_conexion,
              conexion_red:           f.conexion_red,
              id_comercializador:     f.id_comercializador,
              detalle_json:           (f.detalle as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            })),
          })
          break
        }
        case "INSUMOS_STR": {
          // Sobrescritura: cada carga reemplaza a las anteriores del mismo
          // período. Borramos todos los registros_str del período antes de
          // insertar los nuevos. Los cargas_fuente previas permanecen como
          // historial pero quedan con 0 registros efectivos.
          await tx.registroSTR.deleteMany({
            where: { periodo_id: periodo.id },
          })

          const filas = filasCompletas as FilaSTR[]
          if (filas.length === 0) break
          // Resolver or_codigo → or_id (cache)
          const codigos = Array.from(new Set(filas.map(f => f.or_codigo).filter(Boolean)))
          const ors = await tx.configuracionOR.findMany({
            where: { codigo: { in: codigos } },
            select: { id: true, codigo: true },
          })
          const codigoToId = new Map(ors.map(o => [o.codigo, o.id]))
          const datos = filas
            .map((f) => {
              const orId = codigoToId.get(f.or_codigo)
              if (!orId) return null
              return {
                carga_id: carga.id,
                periodo_id: periodo.id,
                or_id: orId,
                mes_consumo: f.mes_consumo,
                valor_cop: f.valor_cop,
                detalle_json: f.detalle as Prisma.InputJsonValue ?? Prisma.JsonNull,
              }
            })
            .filter((d): d is NonNullable<typeof d> => d !== null)
          if (datos.length > 0) {
            await tx.registroSTR.createMany({ data: datos })
          }
          break
        }
      }

      // Log de auditoría. "agregar" comparte CARGAR_FUENTE porque el enum
      // AccionAuditoria no tiene una accion AGREGAR_FUENTE; el detalle JSON
      // contiene accion_carga_previa para distinguirlas.
      const accionAudit = accion === "reemplazar" ? "REEMPLAZAR_FUENTE" : "CARGAR_FUENTE"
      await tx.logAuditoria.create({
        data: {
          usuario_id: session.user.id,
          accion: accionAudit,
          entidad: "cargas_fuente",
          entidad_id: carga.id,
          detalle: {
            tipo_fuente: meta.tipoFuente,
            or_id: meta.orId,
            nombre_archivo: meta.nombreArchivo,
            total_registros: filasCompletas.length,
            carga_previa_id: cargaPreviaId,
            accion_carga_previa: accion,
            justificacion,
          },
          ip,
        },
      })

      return { cargaId: carga.id, totalGuardados: filasCompletas.length }
    }, { timeout: 60_000, maxWait: 10_000 })  // 60s para cargas grandes (merge EPM, etc.)

    return NextResponse.json(resultado)
  } catch (e) {
    console.error("Error al confirmar carga:", e)
    return NextResponse.json(
      { error: "Error al guardar la carga", detalle: String(e) },
      { status: 500 }
    )
  }
}
