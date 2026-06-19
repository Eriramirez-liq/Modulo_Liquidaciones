/**
 * GET /api/cargos-str/netsuite/cron/limpiar-lotes — Cron de limpieza (R3).
 *
 * Cancela los lotes EN_PROGRESO colgados (su `procesarLote` se cortó y quedaron
 * bloqueando la creación de nuevos lotes). Lo dispara el cron de Vercel definido
 * en `vercel.json` (diario 06:00 UTC; Hobby permite 1x/día).
 *
 * AUTH (sin NextAuth: el cron NO tiene sesión).
 *   - Vercel inyecta `Authorization: Bearer <CRON_SECRET>` cuando la env
 *     `CRON_SECRET` está configurada. Si está set y NO coincide → 401.
 *   - Si `CRON_SECRET` no está definida (p.ej. preview), se permite la ejecución
 *     pero se logea un warning para no romper el ambiente.
 *
 * La auto-recuperación de `crearLote` cubre el caso inmediato; este cron es la
 * red de seguridad periódica.
 */

import { NextRequest, NextResponse } from "next/server"
import { limpiarLotesColgados } from "@/lib/integrations/netsuite/service"
import { logNetsuite } from "@/lib/integrations/netsuite/audit"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret) {
    const header = request.headers.get("authorization")
    if (header !== `Bearer ${cronSecret}`) {
      logNetsuite("cron.limpiar_lotes_no_autorizado", "warn", {})
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
    }
  } else {
    // Sin secret configurado: permitir pero advertir (no romper en preview).
    logNetsuite("cron.limpiar_lotes_sin_secret", "warn", {})
  }

  try {
    const { cancelados, loteIds } = await limpiarLotesColgados()
    return NextResponse.json({ ok: true, cancelados, loteIds }, { status: 200 })
  } catch (e) {
    // Fallar ruidosamente en logs; no filtrar detalle interno al cliente.
    console.error("[netsuite/cron/limpiar-lotes] error inesperado:", e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
