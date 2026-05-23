import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import {
  FilaFacturacion,
  FilaXM,
  FilaSDL,
  FilaBalance,
} from "@/lib/parsers/types"
import type { FilaSTR } from "@/lib/parsers/insumos-str"
import { confirmarBodySchema } from "@/lib/validation/cargas"

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
  const { meta, filasCompletas, justificacion, cargaPreviaId } = parsed.data

  // INSUMOS_STR puede confirmarse aunque filasCompletas esté vacío
  // (la lógica de análisis puede aún no estar implementada y querer registrar
  // la carga de los archivos para auditoría).
  if (meta.tipoFuente !== "INSUMOS_STR" && !filasCompletas?.length) {
    return NextResponse.json({ error: "Datos incompletos" }, { status: 400 })
  }

  // No permitir cargas para períodos futuros (safety net si llaman a confirmar directo)
  const ahora = new Date()
  const anioActual = ahora.getFullYear()
  const mesActual  = ahora.getMonth() + 1
  if (meta.anio > anioActual || (meta.anio === anioActual && meta.mes > mesActual)) {
    return NextResponse.json(
      { error: "No se pueden cargar archivos para períodos futuros." },
      { status: 400 }
    )
  }

  if (cargaPreviaId && !justificacion?.trim()) {
    return NextResponse.json(
      { error: "Se requiere justificación para reemplazar una carga existente" },
      { status: 400 }
    )
  }

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

      // Crear CargaFuente
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
          justificacion_reemplazo: justificacion ?? null,
          reemplaza_id: cargaPreviaId ?? null,
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

      // Log de auditoría
      const accion = cargaPreviaId ? "REEMPLAZAR_FUENTE" : "CARGAR_FUENTE"
      await tx.logAuditoria.create({
        data: {
          usuario_id: session.user.id,
          accion,
          entidad: "cargas_fuente",
          entidad_id: carga.id,
          detalle: {
            tipo_fuente: meta.tipoFuente,
            or_id: meta.orId,
            nombre_archivo: meta.nombreArchivo,
            total_registros: filasCompletas.length,
            reemplaza_id: cargaPreviaId,
            justificacion,
          },
          ip,
        },
      })

      return { cargaId: carga.id, totalGuardados: filasCompletas.length }
    })

    return NextResponse.json(resultado)
  } catch (e) {
    console.error("Error al confirmar carga:", e)
    return NextResponse.json(
      { error: "Error al guardar la carga", detalle: String(e) },
      { status: 500 }
    )
  }
}
