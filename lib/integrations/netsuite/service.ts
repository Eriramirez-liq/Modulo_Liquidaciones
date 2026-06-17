/**
 * Capa de servicio del módulo NetSuite (Cargos STR).
 *
 * Aísla TODA la lógica de dominio del HTTP. Los handlers de BE-3+ solo orquestan:
 * validan con Zod, llaman a estas funciones y serializan el resultado/error.
 *
 * Invariantes críticas (ver plan §B.3, §B.4, §B.7):
 *  - PRECISIÓN: las sumas de `registros_str.valor_cop` se trabajan como
 *    `Prisma.Decimal`. PROHIBIDO `Number()` sobre montos.
 *  - CONCURRENCIA: `crearLote` corre en transacción con `pg_advisory_xact_lock`
 *    como PRIMERA sentencia → un solo lote EN_PROGRESO global.
 *  - IDEMPOTENCIA: `idempotency_key = sha256(lote|periodo|or|monto)` único +
 *    `updateMany` con guard de estado en `procesarLote`.
 *  - SECUENCIAL: `procesarLote` procesa un envío a la vez, esperando a que el
 *    actual termine (PROCESADO/ERROR/TIMEOUT) antes del siguiente.
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.3, §B.4, F-B2.
 */

import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { NETSUITE_LOTE_LOCK_KEY, NETSUITE_TIMEOUT_MS } from "./config"
import { getNetsuiteClient } from "./client"
import { envioToDto, snapshotToPayload, type EnvioConOperador } from "./mapper"
import { netsuiteResponseSchema, type NetsuiteResponse } from "./types"
import type {
  CargoInput,
  EnvioDto,
  EstadoEnvioPorCargoDto,
  LoteDto,
  LoteResumenDto,
} from "./types"
import {
  CargoYaProcesadoError,
  EnvioNoEncontradoError,
  EnvioNoReenviableError,
  LoteEnCursoError,
  LoteNoCancelableError,
  LoteNoEncontradoError,
  LoteNoProcesableError,
  MontoCeroError,
  OrNoEncontradoError,
  SinDatosError,
  type ConflictoCargo,
} from "./errors"

// ─── Tipos internos ────────────────────────────────────────────────────────────

/** Lote con relaciones suficientes para construir un LoteDto. */
type LoteConRelaciones = Prisma.LoteNetsuiteGetPayload<{
  include: {
    iniciado_por: { select: { id: true; nombre: true } }
    envios: { include: { operador_red: true } }
  }
}>

const INCLUDE_LOTE_COMPLETO = {
  iniciado_por: { select: { id: true, nombre: true } },
  envios: {
    include: { operador_red: true },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.LoteNetsuiteInclude

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** sha256 hex de la clave de idempotencia del envío. */
function idempotencyKey(
  loteId: string,
  periodoId: string,
  orId: string,
  montoSnapshot: string,
): string {
  return createHash("sha256")
    .update(`${loteId}|${periodoId}|${orId}|${montoSnapshot}`)
    .digest("hex")
}

/** Deriva "AAAA-MM" del período a partir de anio/mes. */
function mesFacturacionDe(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}`
}

/** Construye el DTO de lote a partir de la entidad con relaciones. */
function loteToDto(lote: LoteConRelaciones): LoteDto {
  const envios: EnvioDto[] = lote.envios.map((e) =>
    envioToDto(e as EnvioConOperador),
  )

  const total = envios.length
  const pendientes = envios.filter(
    (e) => e.estado === "PENDIENTE" || e.estado === "PROCESANDO",
  ).length
  const procesados = envios.filter((e) => e.estado === "PROCESADO").length
  const errores = envios.filter((e) => e.estado === "ERROR").length

  return {
    id: lote.id,
    estado: lote.estado,
    iniciadoAt: lote.iniciado_at.toISOString(),
    finalizadoAt: lote.finalizado_at ? lote.finalizado_at.toISOString() : null,
    iniciadoPor: { id: lote.iniciado_por.id, nombre: lote.iniciado_por.nombre },
    totales: { total, pendientes, procesados, errores },
    envios,
  }
}

// ─── crearLote ───────────────────────────────────────────────────────────────────

/**
 * Crea un lote nuevo con un envío PENDIENTE por cada cargo.
 *
 * Toda la operación corre dentro de una transacción cuya PRIMERA sentencia es el
 * advisory lock, de modo que la verificación de lote en curso, la validación de
 * CARGO_YA_PROCESADO (anti-TOCTOU, F-B2) y la inserción son atómicas respecto a
 * la creación concurrente de otros lotes.
 */
export async function crearLote(
  userId: string,
  cargos: CargoInput[],
): Promise<LoteDto> {
  // Códigos únicos preservando primera aparición (para mensajes deterministas).
  const orCodigos = Array.from(new Set(cargos.map((c) => c.orCodigo)))

  const loteId = await db.$transaction(async (tx) => {
    // 1. Advisory lock — PRIMERA sentencia. Serializa la creación de lotes.
    // Se usa $executeRawUnsafe con la clave interpolada: pasar un BigInt como
    // parámetro de $executeRaw dispara un bug de serialización de Prisma
    // ("Expected Flat JSON array"). La clave es una constante del código (no
    // input de usuario), así que la interpolación es segura.
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(${NETSUITE_LOTE_LOCK_KEY.toString()})`,
    )

    // 2. ¿Ya hay un lote EN_PROGRESO?
    const enCurso = await tx.loteNetsuite.findFirst({
      where: { estado: "EN_PROGRESO" },
      include: { iniciado_por: { select: { id: true, nombre: true } } },
    })
    if (enCurso) {
      throw new LoteEnCursoError(
        enCurso.id,
        enCurso.iniciado_at.toISOString(),
        { nombre: enCurso.iniciado_por.nombre },
      )
    }

    // 3. Resolver orCodigo → or_id. Si falta alguno → 404.
    const operadores = await tx.configuracionOR.findMany({
      where: { codigo: { in: orCodigos } },
      select: { id: true, codigo: true },
    })
    const orIdPorCodigo = new Map(operadores.map((o) => [o.codigo, o.id]))
    for (const codigo of orCodigos) {
      if (!orIdPorCodigo.has(codigo)) {
        throw new OrNoEncontradoError(codigo)
      }
    }

    // Lista resuelta de cargos (periodoId, orCodigo, orId), sin duplicados exactos.
    const resueltos = cargos.map((c) => ({
      periodoId: c.periodoId,
      orCodigo: c.orCodigo,
      orId: orIdPorCodigo.get(c.orCodigo)!,
    }))

    // 4. CARGO_YA_PROCESADO — dentro de la tx + lock (anti-TOCTOU, F-B2).
    const procesadosPrevios = await tx.envioNetsuiteCargoSTR.findMany({
      where: {
        estado: "PROCESADO",
        OR: resueltos.map((r) => ({ periodo_id: r.periodoId, or_id: r.orId })),
      },
      select: {
        periodo_id: true,
        or_id: true,
        numero_oc: true,
        lote_id: true,
        operador_red: { select: { codigo: true } },
      },
    })
    if (procesadosPrevios.length > 0) {
      const conflictos: ConflictoCargo[] = procesadosPrevios.map((p) => ({
        periodoId: p.periodo_id,
        orCodigo: p.operador_red.codigo,
        numeroOc: p.numero_oc,
        loteId: p.lote_id,
      }))
      throw new CargoYaProcesadoError(conflictos)
    }

    // 5. Snapshot de monto + mes_consumo por cargo. Acumular conflictos.
    const sinDatos: ConflictoCargo[] = []
    const montoCero: ConflictoCargo[] = []

    interface CargoListo {
      periodoId: string
      orId: string
      orCodigo: string
      montoSnapshot: string // Decimal.toFixed(2)
      mesConsumo: string
      mesFacturacion: string
    }
    const listos: CargoListo[] = []

    // Cache de período → mes_facturacion para no re-consultar.
    const periodoIds = Array.from(new Set(resueltos.map((r) => r.periodoId)))
    const periodos = await tx.periodoConciliacion.findMany({
      where: { id: { in: periodoIds } },
      select: { id: true, anio: true, mes: true },
    })
    const mesFactPorPeriodo = new Map(
      periodos.map((p) => [p.id, mesFacturacionDe(p.anio, p.mes)]),
    )

    for (const r of resueltos) {
      // SUM(valor_cop) como Decimal — NUNCA Number().
      const agg = await tx.registroSTR.aggregate({
        where: { periodo_id: r.periodoId, or_id: r.orId },
        _sum: { valor_cop: true },
      })
      const suma: Prisma.Decimal | null = agg._sum.valor_cop

      if (suma === null) {
        sinDatos.push({ periodoId: r.periodoId, orCodigo: r.orCodigo })
        continue
      }
      if (suma.isZero()) {
        montoCero.push({
          periodoId: r.periodoId,
          orCodigo: r.orCodigo,
          monto: suma.toFixed(2),
        })
        continue
      }

      // mes_consumo representativo: el menor "AAAA-MM" presente en los registros.
      const mesAgg = await tx.registroSTR.aggregate({
        where: { periodo_id: r.periodoId, or_id: r.orId },
        _min: { mes_consumo: true },
      })
      const mesConsumo = mesAgg._min.mes_consumo ?? ""

      listos.push({
        periodoId: r.periodoId,
        orId: r.orId,
        orCodigo: r.orCodigo,
        montoSnapshot: suma.toFixed(2),
        mesConsumo,
        mesFacturacion: mesFactPorPeriodo.get(r.periodoId) ?? "",
      })
    }

    if (sinDatos.length > 0) throw new SinDatosError(sinDatos)
    if (montoCero.length > 0) throw new MontoCeroError(montoCero)

    // 6. Crear el lote.
    const lote = await tx.loteNetsuite.create({
      data: {
        estado: "EN_PROGRESO",
        total_envios: listos.length,
        iniciado_por_id: userId,
      },
      select: { id: true },
    })

    // 7. Crear los envíos PENDIENTE con su idempotency_key.
    for (const c of listos) {
      await tx.envioNetsuiteCargoSTR.create({
        data: {
          lote_id: lote.id,
          periodo_id: c.periodoId,
          or_id: c.orId,
          monto_snapshot_cop: new Prisma.Decimal(c.montoSnapshot),
          mes_consumo: c.mesConsumo,
          mes_facturacion: c.mesFacturacion,
          estado: "PENDIENTE",
          idempotency_key: idempotencyKey(
            lote.id,
            c.periodoId,
            c.orId,
            c.montoSnapshot,
          ),
        },
      })
    }

    return lote.id
  })

  // Releer fuera de la tx para devolver el DTO completo (el lock ya se liberó).
  return obtenerLote(loteId)
}

// ─── procesarLote ─────────────────────────────────────────────────────────────────

/** Mapea la respuesta del cliente NetSuite a los campos de persistencia OK. */
function datosOk(resp: Extract<NetsuiteResponse, { status: "ok" }>) {
  return {
    estado: "PROCESADO" as const,
    numero_oc: resp.documentNumber,
    netsuite_internal_id: resp.internalId,
    respuesta_ok_json: resp as unknown as Prisma.InputJsonValue,
    error_mensaje: null,
    error_codigo: null,
    error_payload_json: Prisma.JsonNull,
    respondido_at: new Date(),
  }
}

/** Campos de persistencia para un envío en ERROR. */
function datosError(params: {
  codigo: string
  mensaje: string
  payload?: Prisma.InputJsonValue
}) {
  return {
    estado: "ERROR" as const,
    error_codigo: params.codigo,
    error_mensaje: params.mensaje,
    error_payload_json: params.payload ?? Prisma.JsonNull,
    respondido_at: new Date(),
  }
}

/**
 * Procesa un único envío: llama al cliente con timeout, valida la respuesta con
 * Zod (R4) y persiste el resultado. Devuelve sin lanzar: cualquier fallo se
 * traduce en persistencia de ERROR.
 */
async function procesarEnvio(envio: EnvioConOperador): Promise<void> {
  const client = getNetsuiteClient()
  const payload = snapshotToPayload(envio)

  let resp: NetsuiteResponse
  try {
    // Timeout de 30s vía race (el mock no expone AbortSignal; el cliente real
    // de Fase 2 usará AbortController internamente con el mismo umbral).
    resp = await conTimeout(client.enviarOrden(payload), NETSUITE_TIMEOUT_MS)
  } catch (e) {
    if (e instanceof TimeoutError) {
      await db.envioNetsuiteCargoSTR.update({
        where: { id: envio.id },
        data: datosError({
          codigo: "TIMEOUT",
          mensaje: "NetSuite no respondió en 30 segundos",
          payload: { request: payload } as unknown as Prisma.InputJsonValue,
        }),
      })
      return
    }
    // Excepción de red u otra → ERROR NETWORK.
    await db.envioNetsuiteCargoSTR.update({
      where: { id: envio.id },
      data: datosError({
        codigo: "NETWORK",
        mensaje: "Error de red al conectar con NetSuite",
        payload: { request: payload } as unknown as Prisma.InputJsonValue,
      }),
    })
    return
  }

  // R4: validar la respuesta. Si no cumple el schema (p.ej. OK sin
  // documentNumber/internalId), tratar como ERROR explícito.
  const parsed = netsuiteResponseSchema.safeParse(resp)
  if (!parsed.success) {
    await db.envioNetsuiteCargoSTR.update({
      where: { id: envio.id },
      data: datosError({
        codigo: "RESPUESTA_INVALIDA",
        mensaje: "NetSuite respondió con un formato inesperado",
        payload: {
          request: payload,
          response: resp,
        } as unknown as Prisma.InputJsonValue,
      }),
    })
    return
  }

  if (parsed.data.status === "ok") {
    await db.envioNetsuiteCargoSTR.update({
      where: { id: envio.id },
      data: datosOk(parsed.data),
    })
  } else {
    await db.envioNetsuiteCargoSTR.update({
      where: { id: envio.id },
      data: datosError({
        codigo: parsed.data.code,
        mensaje: parsed.data.message,
        payload: {
          request: payload,
          response: parsed.data,
        } as unknown as Prisma.InputJsonValue,
      }),
    })
  }
}

/**
 * Procesa todos los envíos PENDIENTE/ERROR del lote de forma ESTRICTAMENTE
 * secuencial: uno a la vez, esperando a que el actual termine.
 *
 * Idempotente (R11): cada envío se toma con `updateMany` + guard de estado; si
 * `count === 0`, otro worker ya lo tomó y se salta. Al final, si todos los
 * envíos están en {PROCESADO, ERROR}, marca el lote COMPLETADO.
 */
export async function procesarLote(loteId: string): Promise<void> {
  const lote = await db.loteNetsuite.findUnique({ where: { id: loteId } })
  if (!lote) throw new LoteNoEncontradoError()
  if (lote.estado !== "EN_PROGRESO") throw new LoteNoProcesableError()

  // IDs a procesar (snapshot inicial). El guard atómico evita doble proceso.
  const pendientes = await db.envioNetsuiteCargoSTR.findMany({
    where: { lote_id: loteId, estado: { in: ["PENDIENTE", "ERROR"] } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })

  for (const { id } of pendientes) {
    // Respetar cancelación: si el lote dejó de estar EN_PROGRESO, parar.
    const estadoActual = await db.loteNetsuite.findUnique({
      where: { id: loteId },
      select: { estado: true },
    })
    if (!estadoActual || estadoActual.estado !== "EN_PROGRESO") break

    // Tomar el envío atómicamente.
    const tomado = await db.envioNetsuiteCargoSTR.updateMany({
      where: { id, estado: { in: ["PENDIENTE", "ERROR"] } },
      data: { estado: "PROCESANDO", intentos: { increment: 1 }, enviado_at: new Date() },
    })
    if (tomado.count === 0) continue // otro worker lo tomó

    const envio = await db.envioNetsuiteCargoSTR.findUnique({
      where: { id },
      include: { operador_red: true },
    })
    if (!envio) continue

    await procesarEnvio(envio as EnvioConOperador)
  }

  await actualizarEstadoLote(loteId)
}

/**
 * Recalcula el estado del lote: si no quedan envíos PENDIENTE/PROCESANDO, lo
 * marca COMPLETADO con `finalizado_at` y los totales OK/ERROR.
 */
async function actualizarEstadoLote(loteId: string): Promise<void> {
  const lote = await db.loteNetsuite.findUnique({
    where: { id: loteId },
    select: { estado: true },
  })
  if (!lote || lote.estado !== "EN_PROGRESO") return

  const envios = await db.envioNetsuiteCargoSTR.findMany({
    where: { lote_id: loteId },
    select: { estado: true },
  })
  const enVuelo = envios.some(
    (e) => e.estado === "PENDIENTE" || e.estado === "PROCESANDO",
  )
  if (enVuelo) return

  const totalOk = envios.filter((e) => e.estado === "PROCESADO").length
  const totalError = envios.filter((e) => e.estado === "ERROR").length

  await db.loteNetsuite.update({
    where: { id: loteId },
    data: {
      estado: "COMPLETADO",
      finalizado_at: new Date(),
      total_ok: totalOk,
      total_error: totalError,
    },
  })
}

// ─── reenviar ────────────────────────────────────────────────────────────────────

/**
 * Reenvía un envío individual en estado ERROR (lote EN_PROGRESO). Síncrono:
 * espera la respuesta del cliente y devuelve el EnvioDto actualizado.
 */
export async function reenviar(envioId: string): Promise<EnvioDto> {
  const envio = await db.envioNetsuiteCargoSTR.findUnique({
    where: { id: envioId },
    include: { lote: { select: { estado: true } } },
  })
  if (!envio) throw new EnvioNoEncontradoError()
  if (envio.estado !== "ERROR" || envio.lote.estado !== "EN_PROGRESO") {
    throw new EnvioNoReenviableError()
  }

  // Tomar atómicamente (solo si sigue en ERROR).
  const tomado = await db.envioNetsuiteCargoSTR.updateMany({
    where: { id: envioId, estado: "ERROR" },
    data: { estado: "PROCESANDO", intentos: { increment: 1 }, enviado_at: new Date() },
  })
  if (tomado.count === 0) throw new EnvioNoReenviableError()

  const conOperador = await db.envioNetsuiteCargoSTR.findUnique({
    where: { id: envioId },
    include: { operador_red: true },
  })
  if (!conOperador) throw new EnvioNoEncontradoError()

  await procesarEnvio(conOperador as EnvioConOperador)
  await actualizarEstadoLote(conOperador.lote_id)

  const actualizado = await db.envioNetsuiteCargoSTR.findUnique({
    where: { id: envioId },
    include: { operador_red: true },
  })
  if (!actualizado) throw new EnvioNoEncontradoError()

  return envioToDto(actualizado as EnvioConOperador)
}

// ─── cancelarLote ─────────────────────────────────────────────────────────────────

/**
 * Cancela un lote EN_PROGRESO sin envíos PROCESANDO. Marca CANCELADO.
 */
export async function cancelarLote(loteId: string): Promise<LoteDto> {
  await db.$transaction(async (tx) => {
    const lote = await tx.loteNetsuite.findUnique({
      where: { id: loteId },
      select: { estado: true },
    })
    if (!lote) throw new LoteNoEncontradoError()
    if (lote.estado !== "EN_PROGRESO") throw new LoteNoCancelableError()

    const enProceso = await tx.envioNetsuiteCargoSTR.count({
      where: { lote_id: loteId, estado: "PROCESANDO" },
    })
    if (enProceso > 0) throw new LoteNoCancelableError()

    await tx.loteNetsuite.update({
      where: { id: loteId },
      data: { estado: "CANCELADO", finalizado_at: new Date() },
    })
  })

  return obtenerLote(loteId)
}

// ─── obtenerEstadosPorCargo ────────────────────────────────────────────────────────

/** Fila cruda devuelta por la query DISTINCT ON. */
interface EstadoRow {
  id: string
  periodo_id: string
  or_codigo: string
  estado: EnvioDto["estado"]
  numero_oc: string | null
  error_mensaje: string | null
  lote_id: string
  createdAt: Date
}

/**
 * Devuelve el último envío por `(periodoId, orCodigo)` para los cargos pedidos.
 * Una sola query Postgres con DISTINCT ON. La clave del Record es
 * `${periodoId}|${orCodigo}`.
 */
export async function obtenerEstadosPorCargo(
  periodoIds: string[],
  orCodigos: string[],
): Promise<Record<string, EstadoEnvioPorCargoDto>> {
  if (periodoIds.length === 0 || orCodigos.length === 0) return {}

  // Nombre real de tabla: envios_netsuite_cargo_str. Columnas snake_case;
  // createdAt en camelCase (requiere comillas). Parámetros con arrays text[].
  const rows = await db.$queryRaw<EstadoRow[]>`
    SELECT DISTINCT ON (e.periodo_id, c.codigo)
      e.id,
      e.periodo_id,
      c.codigo AS or_codigo,
      e.estado,
      e.numero_oc,
      e.error_mensaje,
      e.lote_id,
      e."createdAt"
    FROM envios_netsuite_cargo_str e
    JOIN configuracion_or c ON c.id = e.or_id
    WHERE e.periodo_id = ANY(${periodoIds}::text[])
      AND c.codigo = ANY(${orCodigos}::text[])
    ORDER BY e.periodo_id, c.codigo, e."createdAt" DESC
  `

  const resultado: Record<string, EstadoEnvioPorCargoDto> = {}
  for (const row of rows) {
    const key = `${row.periodo_id}|${row.or_codigo}`
    resultado[key] = {
      ultimoEnvioId: row.id,
      estado: row.estado,
      numeroOc: row.numero_oc,
      errorMensaje: row.error_mensaje,
      loteId: row.lote_id,
      fecha: row.createdAt.toISOString(),
    }
  }
  return resultado
}

// ─── obtenerLote / obtenerLoteActivo ───────────────────────────────────────────────

/** Devuelve un lote por id con todos sus envíos. */
export async function obtenerLote(loteId: string): Promise<LoteDto> {
  const lote = await db.loteNetsuite.findUnique({
    where: { id: loteId },
    include: INCLUDE_LOTE_COMPLETO,
  })
  if (!lote) throw new LoteNoEncontradoError()
  return loteToDto(lote)
}

/**
 * Lista lotes para el historial, ordenados por `iniciado_at` desc. Devuelve
 * resúmenes (sin envíos): los totales se leen de las columnas persistidas del
 * lote. El detalle con envíos sale de `obtenerLote`.
 */
export async function listarLotes(limite = 50): Promise<LoteResumenDto[]> {
  const lotes = await db.loteNetsuite.findMany({
    orderBy: { iniciado_at: "desc" },
    take: limite,
    include: { iniciado_por: { select: { id: true, nombre: true } } },
  })

  return lotes.map((l) => ({
    id: l.id,
    estado: l.estado,
    totalEnvios: l.total_envios,
    totalOk: l.total_ok,
    totalError: l.total_error,
    iniciadoAt: l.iniciado_at.toISOString(),
    finalizadoAt: l.finalizado_at ? l.finalizado_at.toISOString() : null,
    iniciadoPor: { id: l.iniciado_por.id, nombre: l.iniciado_por.nombre },
  }))
}

/** Devuelve el lote EN_PROGRESO actual, o null si no hay ninguno. */
export async function obtenerLoteActivo(): Promise<LoteDto | null> {
  const lote = await db.loteNetsuite.findFirst({
    where: { estado: "EN_PROGRESO" },
    orderBy: { iniciado_at: "desc" },
    include: INCLUDE_LOTE_COMPLETO,
  })
  return lote ? loteToDto(lote) : null
}

// ─── Timeout helper ─────────────────────────────────────────────────────────────────

class TimeoutError extends Error {
  constructor() {
    super("timeout")
    this.name = "TimeoutError"
  }
}

/** Resuelve `p` o rechaza con TimeoutError si tarda más de `ms`. */
function conTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

// Re-export del tipo para el handler (BE-4), que puede importarlo desde el service.
export type { EstadoEnvioPorCargoDto }
