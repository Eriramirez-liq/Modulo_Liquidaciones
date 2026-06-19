import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/dashboard?periodoId=...
 *
 * KPIs del módulo Inicio. El período recibido es el de CONSUMO
 * (PeriodoConciliacion.{anio,mes}); el dashboard lo MUESTRA como mes en curso /
 * facturación (consumo + 1) — esa derivación la hace el frontend.
 *
 * KPIs:
 *  - Cargo STR    = Σ registros_str.valor_cop del período.
 *  - Cargo SDL    = Σ (valor_sdl_cop + valor_reactiva_cop) de registros_sdl
 *                   (preliquidación activa + reactiva, sin duplicados).
 *  - Pérdidas     = contingencias pendientes (lógica existente).
 *  - Provisiones  = lógica existente.
 *  - Compensaciones = placeholder (lógica pendiente de definir).
 *  - Congruencia  = % de fronteras FACTURADAS cuyo nivel de tensión y propiedad
 *                   de activos coinciden con SDL y TC1 (las ausentes en SDL/TC1
 *                   cuentan como NO congruentes).
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const periodoId = searchParams.get("periodoId") ?? undefined

  const empty = {
    totalFronteras: 0, sinDiferencia: 0,
    provisiones: 0, valorProvisiones: 0,
    contingenciasAbiertas: 0, valorContingencias: 0,
    disputas: 0, valorDisputas: 0,
    alertasManuales: 0, incompletas: 0, errores: 0,
    impactoEstimado: 0,
    // KPIs del panel principal
    cargoStrCop: 0,
    cargoSdlCop: 0, cargoSdlActivaCop: 0, cargoSdlReactivaCop: 0,
    compensacionesCop: null as number | null,
    congruenciaPct: 0, congruentes: 0, fronterasFacturadas: 0,
  }

  if (!periodoId) return NextResponse.json(empty)

  const [
    resultados, provisiones, contingenciasAgg, disputas,
    strAgg, sdlAgg, facturacion, sdlClasif, tc1Clasif,
  ] = await Promise.all([
    db.resultadoConciliacion.findMany({
      where: { periodo_id: periodoId },
      select: {
        caso: true, resultado_l1: true,
        impacto_financiero_l1: true, impacto_financiero_l2: true,
        requiere_alerta_manual: true,
      },
    }),
    db.provision.count({ where: { periodo_id: periodoId } }),
    db.contingencia.aggregate({
      where: { periodo_id: periodoId, estado: "PENDIENTE" },
      _count: { _all: true },
      _sum:   { costo_estimado_cop: true },
    }),
    db.disputa.count({ where: { periodo_id: periodoId } }),
    // Cargo STR
    db.registroSTR.aggregate({
      where: { periodo_id: periodoId },
      _sum: { valor_cop: true },
    }),
    // Cargo SDL (activa + reactiva), excluyendo duplicados
    db.registroSDL.aggregate({
      where: { periodo_id: periodoId, es_duplicado: false },
      _sum: { valor_sdl_cop: true, valor_reactiva_cop: true },
    }),
    // Congruencia — clasificación por frontera en las 3 fuentes
    db.registroFacturacion.findMany({
      where: { periodo_id: periodoId },
      select: { codigo_frontera: true, nivel_tension: true, propiedad_activos: true },
    }),
    db.registroSDL.findMany({
      where: { periodo_id: periodoId, es_duplicado: false },
      select: { codigo_frontera: true, nivel_tension: true, propiedad_activos: true },
    }),
    db.registroTC1.findMany({
      where: { periodo_id: periodoId },
      select: { codigo_frontera: true, nivel_tension: true, propiedad_activos: true },
    }),
  ])

  const totalFronteras   = resultados.length
  const sinDiferencia    = resultados.filter(r => r.caso === "A1").length
  const alertasManuales  = resultados.filter(r => r.requiere_alerta_manual).length
  const incompletas      = resultados.filter(r => r.caso === "INCOMPLETA").length
  const errores          = resultados.filter(r => r.caso === "ERROR").length
  const valorProvisiones = resultados.reduce((s, r) => s + Number(r.impacto_financiero_l1 ?? 0), 0)
  const valorDisputas    = resultados.reduce((s, r) => s + Number(r.impacto_financiero_l2 ?? 0), 0)
  const valorContingencias = Number(contingenciasAgg._sum.costo_estimado_cop ?? 0)

  // ── Cargo STR / SDL ──────────────────────────────────────────────────────
  const cargoStrCop        = Number(strAgg._sum.valor_cop ?? 0)
  const cargoSdlActivaCop  = Number(sdlAgg._sum.valor_sdl_cop ?? 0)
  const cargoSdlReactivaCop = Number(sdlAgg._sum.valor_reactiva_cop ?? 0)
  const cargoSdlCop        = cargoSdlActivaCop + cargoSdlReactivaCop

  // ── Congruencia (NT + propiedad entre facturación, SDL y TC1) ────────────
  const norm = (v: string | null | undefined) =>
    (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()
  const keyFrontera = (c: string | null | undefined) => norm(c)

  type Clasif = { nt: string; prop: string }
  const indexar = (rows: { codigo_frontera: string; nivel_tension: string | null; propiedad_activos: string | null }[]) => {
    const m = new Map<string, Clasif>()
    for (const r of rows) {
      const k = keyFrontera(r.codigo_frontera)
      if (!k || m.has(k)) continue // primera aparición por frontera
      m.set(k, { nt: norm(r.nivel_tension), prop: norm(r.propiedad_activos) })
    }
    return m
  }
  const sdlMap = indexar(sdlClasif)
  const tc1Map = indexar(tc1Clasif)

  // Denominador = fronteras facturadas (distintas). Congruente si NT y propiedad
  // coinciden en facturación, SDL y TC1 (las ausentes en SDL/TC1 → no congruentes).
  const facVistas = new Set<string>()
  let congruentes = 0
  for (const f of facturacion) {
    const k = keyFrontera(f.codigo_frontera)
    if (!k || facVistas.has(k)) continue
    facVistas.add(k)
    const sdlc = sdlMap.get(k)
    const tc1c = tc1Map.get(k)
    if (!sdlc || !tc1c) continue
    const ntFac = norm(f.nivel_tension)
    const propFac = norm(f.propiedad_activos)
    const ntOk   = ntFac !== "" && ntFac === sdlc.nt && ntFac === tc1c.nt
    const propOk = propFac !== "" && propFac === sdlc.prop && propFac === tc1c.prop
    if (ntOk && propOk) congruentes++
  }
  const fronterasFacturadas = facVistas.size
  const congruenciaPct = fronterasFacturadas > 0
    ? Math.round((congruentes / fronterasFacturadas) * 100)
    : 0

  return NextResponse.json({
    totalFronteras, sinDiferencia,
    provisiones, valorProvisiones,
    contingenciasAbiertas: contingenciasAgg._count._all,
    valorContingencias,
    disputas, valorDisputas,
    alertasManuales, incompletas, errores,
    impactoEstimado: valorProvisiones + valorDisputas + valorContingencias,
    // Panel principal
    cargoStrCop,
    cargoSdlCop, cargoSdlActivaCop, cargoSdlReactivaCop,
    compensacionesCop: null, // placeholder — lógica pendiente
    congruenciaPct, congruentes, fronterasFacturadas,
  })
}
