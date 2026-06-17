/**
 * Errores tipados del módulo NetSuite.
 *
 * Cada error de dominio lleva un `codigo` string conocido por el frontend
 * (ver plan §B.2, tabla de códigos) y los datos asociados que el handler de
 * BE-3+ necesita para armar el body de respuesta con el shape uniforme:
 *
 *   { error: "CODIGO_DOMINIO", message: string, ...campos extra }
 *
 * NUNCA se filtran stack traces ni detalles internos al cliente: el handler usa
 * `toResponse()` para serializar solo lo necesario.
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.2, F-B2.
 */

/** Conflicto reportado al crear lote: un cargo `(periodoId, orCodigo)`. */
export interface ConflictoCargo {
  periodoId: string
  orCodigo: string
  /** Monto agregado (solo para MONTO_CERO). String para precisión. */
  monto?: string
  /** Número de OC del envío previo (solo para CARGO_YA_PROCESADO). */
  numeroOc?: string | null
  /** Lote del envío previo (solo para CARGO_YA_PROCESADO). */
  loteId?: string
}

/** Forma serializable de un error de dominio para la respuesta HTTP. */
export interface NetsuiteErrorResponseBody {
  error: string
  message: string
  loteEnCursoId?: string
  iniciadoAt?: string
  iniciadoPor?: { nombre: string }
  conflictos?: ConflictoCargo[]
  orCodigo?: string
}

/**
 * Error base. Subclases definen `codigo`, `httpStatus` y los campos extra que
 * exponen vía `toResponse()`.
 */
export abstract class NetsuiteServiceError extends Error {
  abstract readonly codigo: string
  abstract readonly httpStatus: number

  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }

  /**
   * Serializa al shape de error del plan §B.2. Las subclases sobreescriben
   * para agregar sus campos específicos. NUNCA incluir stack ni detalles internos.
   */
  toResponse(): NetsuiteErrorResponseBody {
    return { error: this.codigo, message: this.message }
  }
}

// ─── Errores de creación de lote ───────────────────────────────────────────────

/** Ya existe un lote EN_PROGRESO. HTTP 409. */
export class LoteEnCursoError extends NetsuiteServiceError {
  readonly codigo = "LOTE_EN_CURSO"
  readonly httpStatus = 409

  constructor(
    public readonly loteEnCursoId: string,
    public readonly iniciadoAt: string,
    public readonly iniciadoPor: { nombre: string },
  ) {
    super("Ya existe un lote en curso. Espere a que finalice o cancélelo.")
  }

  override toResponse(): NetsuiteErrorResponseBody {
    return {
      error: this.codigo,
      message: this.message,
      loteEnCursoId: this.loteEnCursoId,
      iniciadoAt: this.iniciadoAt,
      iniciadoPor: this.iniciadoPor,
    }
  }
}

/** Algún cargo no tiene registros_str. HTTP 400. */
export class SinDatosError extends NetsuiteServiceError {
  readonly codigo = "SIN_DATOS"
  readonly httpStatus = 400

  constructor(public readonly conflictos: ConflictoCargo[]) {
    super("Uno o más cargos no tienen datos de Cargos STR cargados.")
  }

  override toResponse(): NetsuiteErrorResponseBody {
    return { error: this.codigo, message: this.message, conflictos: this.conflictos }
  }
}

/** Algún cargo tiene monto agregado 0. HTTP 422. */
export class MontoCeroError extends NetsuiteServiceError {
  readonly codigo = "MONTO_CERO"
  readonly httpStatus = 422

  constructor(public readonly conflictos: ConflictoCargo[]) {
    super("Uno o más cargos tienen monto cero y no pueden enviarse.")
  }

  override toResponse(): NetsuiteErrorResponseBody {
    return { error: this.codigo, message: this.message, conflictos: this.conflictos }
  }
}

/** Algún cargo ya tiene un envío PROCESADO. HTTP 422. */
export class CargoYaProcesadoError extends NetsuiteServiceError {
  readonly codigo = "CARGO_YA_PROCESADO"
  readonly httpStatus = 422

  constructor(public readonly conflictos: ConflictoCargo[]) {
    super("Uno o más cargos ya fueron procesados (tienen OC) y fueron omitidos.")
  }

  override toResponse(): NetsuiteErrorResponseBody {
    return { error: this.codigo, message: this.message, conflictos: this.conflictos }
  }
}

/** Un orCodigo no existe en configuracion_or. HTTP 404. */
export class OrNoEncontradoError extends NetsuiteServiceError {
  readonly codigo = "OR_NO_ENCONTRADO"
  readonly httpStatus = 404

  constructor(public readonly orCodigo: string) {
    super(`El operador de red "${orCodigo}" no está registrado.`)
  }

  override toResponse(): NetsuiteErrorResponseBody {
    return { error: this.codigo, message: this.message, orCodigo: this.orCodigo }
  }
}

// ─── Errores de lote / envío ───────────────────────────────────────────────────

/** Lote inexistente. HTTP 404. */
export class LoteNoEncontradoError extends NetsuiteServiceError {
  readonly codigo = "LOTE_NO_ENCONTRADO"
  readonly httpStatus = 404

  constructor() {
    super("El lote no existe.")
  }
}

/** Lote no está EN_PROGRESO (ya completado o cancelado). HTTP 409. */
export class LoteNoProcesableError extends NetsuiteServiceError {
  readonly codigo = "LOTE_NO_PROCESABLE"
  readonly httpStatus = 409

  constructor() {
    super("El lote no puede procesarse porque no está en progreso.")
  }
}

/** Envío inexistente. HTTP 404. */
export class EnvioNoEncontradoError extends NetsuiteServiceError {
  readonly codigo = "ENVIO_NO_ENCONTRADO"
  readonly httpStatus = 404

  constructor() {
    super("El envío no existe.")
  }
}

/** Envío no reenviable: no está en ERROR o su lote no está EN_PROGRESO. HTTP 409. */
export class EnvioNoReenviableError extends NetsuiteServiceError {
  readonly codigo = "ENVIO_NO_REENVIABLE"
  readonly httpStatus = 409

  constructor() {
    super("El envío no puede reenviarse: debe estar en ERROR y su lote en progreso.")
  }
}

/** Lote no cancelable: no está EN_PROGRESO o hay envíos PROCESANDO. HTTP 409. */
export class LoteNoCancelableError extends NetsuiteServiceError {
  readonly codigo = "LOTE_NO_CANCELABLE"
  readonly httpStatus = 409

  constructor() {
    super("El lote no puede cancelarse: debe estar en progreso y sin envíos en proceso.")
  }
}

/** Type guard para distinguir errores de dominio de errores inesperados. */
export function isNetsuiteServiceError(e: unknown): e is NetsuiteServiceError {
  return e instanceof NetsuiteServiceError
}
