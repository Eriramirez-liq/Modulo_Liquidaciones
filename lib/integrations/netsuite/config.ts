/**
 * Constantes de configuración del módulo de integración NetSuite (Cargos STR).
 *
 * Estas constantes NO se leen de variables de entorno: son invariantes del
 * diseño (límite por plan de Vercel, clave del advisory lock, timeout HTTP).
 * Las credenciales y el modo (mock/real) SÍ se leen de env, pero eso vive en
 * `client.ts` / `real-client.ts`, nunca aquí y nunca con prefijo NEXT_PUBLIC_.
 *
 * Ver plan: mejoras/netsuite-backend-plan.md §B.3, §B.4, D8, T1.
 */

/**
 * Máximo de envíos por lote.
 *
 * Confirmado 2026-05-25: Vercel Hobby con `maxDuration = 60s`.
 * Margen estimado: 25 envíos × ~2s ≈ 50s, dentro del límite de 60s.
 * Si la operación crece, evaluar Vercel Pro (sube a 100) — ver plan TD-2.
 */
export const MAX_ENVIOS_POR_LOTE = 25

/**
 * Clave del advisory lock de Postgres para serializar la creación de lotes.
 *
 * `pg_advisory_xact_lock(bigint)` garantiza que solo un `crearLote` corra a la
 * vez a nivel de toda la base (no por instancia serverless). El lock se libera
 * automáticamente al commit/rollback de la transacción.
 *
 * El valor es una constante arbitraria pero estable: cambiarla rompería la
 * exclusión mutua con transacciones que ya estén usando el valor anterior.
 */
export const NETSUITE_LOTE_LOCK_KEY = BigInt("0xCA90577210000001")

/**
 * Timeout por llamada HTTP a NetSuite (T1, confirmado 2026-05-25).
 *
 * Vencido el plazo: el envío pasa a ERROR con `error_codigo = "TIMEOUT"` y
 * `error_mensaje = "NetSuite no respondió en 30 segundos"`. El worker continúa
 * con el siguiente envío inmediatamente (procesamiento estrictamente secuencial).
 */
export const NETSUITE_TIMEOUT_MS = 30_000
