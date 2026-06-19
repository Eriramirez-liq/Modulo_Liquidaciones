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
 *
 * DEBE estar dentro del rango de `bigint` CON SIGNO de Postgres
 * (−2^63 .. 2^63−1). El valor anterior (0xCA90577210000001) excedía 2^63−1 y
 * Postgres lo rechazaba ("bigint out of range").
 */
export const NETSUITE_LOTE_LOCK_KEY = BigInt("8312907210000001")

/**
 * Timeout por llamada HTTP a NetSuite (T1, confirmado 2026-05-25).
 *
 * Vencido el plazo: el envío pasa a ERROR con `error_codigo = "TIMEOUT"` y
 * `error_mensaje = "NetSuite no respondió en 30 segundos"`. El worker continúa
 * con el siguiente envío inmediatamente (procesamiento estrictamente secuencial).
 */
export const NETSUITE_TIMEOUT_MS = 30_000

/**
 * Umbral de antigüedad (en minutos) para considerar COLGADO un lote EN_PROGRESO.
 *
 * El procesamiento normal de un lote termina en <60s (límite `maxDuration` de
 * Vercel Hobby; un lote completo de 25 envíos × ~2s ≈ 50s). Por lo tanto, un
 * lote que sigue EN_PROGRESO pasados varios minutos quedó colgado: su
 * `procesarLote` se cortó (deploy a mitad, crash, congelamiento de la función).
 *
 * Como solo puede haber UN lote EN_PROGRESO global (advisory lock + verificación
 * en `crearLote`), un lote colgado bloquea permanentemente la creación de nuevos
 * lotes. Este umbral define cuándo es seguro cancelarlo automáticamente:
 *  - El cron de limpieza lo usa para barrer lotes viejos.
 *  - `crearLote` lo usa para auto-recuperarse del lote en curso si está stale.
 *
 * 15 min da un margen amplio sobre los ~60s normales: nunca cancela un lote que
 * realmente está procesando.
 */
export const STALE_LOTE_MINUTOS = 15
