"""
Dashboard de Seguimiento — M4
Endpoints:
  GET /                                      → página principal
  GET /api/dashboard/historico               → histórico 12 meses
  GET /api/dashboard/<periodo_id>/resumen    → KPIs del período
  GET /api/dashboard/<periodo_id>/por-operador
  GET /api/dashboard/<periodo_id>/estado-fuentes
"""
from __future__ import annotations

from flask import Blueprint, render_template, request, jsonify
from flask_login import login_required
from sqlalchemy import select, func

from app.models import (
    db,
    PeriodoConciliacion, ConfiguracionOR, CargaFuente, User,
    ResultadoConciliacion, CasoConciliacion,
    Provision, EstadoProvision,
    Contingencia, EstadoContingencia,
    Disputa, EstadoDisputa,
    CruceBalance, TipoResultadoCruce,
)

bp = Blueprint("dashboard", __name__)


# ── Página principal ──────────────────────────────────────────────────────────

@bp.route("/")
@login_required
def index():
    periodos = PeriodoConciliacion.query.order_by(
        PeriodoConciliacion.anio.desc(),
        PeriodoConciliacion.mes.desc(),
    ).all()
    return render_template("dashboard/index.html", periodos=periodos)


# ── API: Histórico (debe ir antes de <periodo_id> para no colisionar) ─────────

@bp.route("/api/dashboard/historico")
@login_required
def api_historico():
    meses = min(request.args.get("meses", 12, type=int), 24)

    periodos = db.session.execute(
        select(PeriodoConciliacion)
        .order_by(
            PeriodoConciliacion.anio.desc(),
            PeriodoConciliacion.mes.desc(),
        )
        .limit(meses)
    ).scalars().all()

    data = []
    for p in reversed(periodos):
        label = f"{p.anio}-{p.mes:02d}"

        # Distribución por caso
        casos_rows = db.session.execute(
            select(ResultadoConciliacion.caso, func.count(ResultadoConciliacion.id))
            .where(ResultadoConciliacion.periodo_id == p.id)
            .group_by(ResultadoConciliacion.caso)
        ).all()
        casos = {c.value: cnt for c, cnt in casos_rows}

        # Saldo provisiones pendientes
        prov_cop = db.session.execute(
            select(func.coalesce(func.sum(Provision.valor_provisionado_cop), 0))
            .where(
                Provision.periodo_id == p.id,
                Provision.estado != EstadoProvision.CRUZADO_TOTAL,
            )
        ).scalar() or 0

        # Contingencias abiertas (conteo)
        cont_abiertas = db.session.execute(
            select(func.count(Contingencia.id))
            .where(
                Contingencia.periodo_id == p.id,
                Contingencia.estado == EstadoContingencia.PENDIENTE,
            )
        ).scalar() or 0

        # Ingresos y costos de cruces vinculados a provisiones del período
        ingresos = db.session.execute(
            select(func.coalesce(func.sum(CruceBalance.valor_cruzado_cop), 0))
            .join(Provision, CruceBalance.provision_id == Provision.id)
            .where(
                Provision.periodo_id == p.id,
                CruceBalance.tipo_resultado == TipoResultadoCruce.INGRESO,
            )
        ).scalar() or 0

        costos = db.session.execute(
            select(func.coalesce(func.sum(CruceBalance.valor_cruzado_cop), 0))
            .join(Provision, CruceBalance.provision_id == Provision.id)
            .where(
                Provision.periodo_id == p.id,
                CruceBalance.tipo_resultado == TipoResultadoCruce.COSTO,
            )
        ).scalar() or 0

        data.append({
            "label":               label,
            "A1":                  casos.get("A1", 0),
            "contingencias":       casos.get("B1", 0) + casos.get("D1", 0),
            "provisiones":         casos.get("B2", 0) + casos.get("D2", 0) + casos.get("D3", 0),
            "disputas":            casos.get("C1", 0) + casos.get("C2", 0),
            "alertas":             casos.get("D4", 0),
            "incompletas":         casos.get("INCOMPLETA", 0),
            "saldo_provisiones":   float(prov_cop),
            "cont_abiertas":       cont_abiertas,
            "ingresos_cop":        float(ingresos),
            "costos_cop":          float(costos),
        })

    return jsonify({"ok": True, "data": data})


# ── API: Resumen KPIs del período ─────────────────────────────────────────────

@bp.route("/api/dashboard/<periodo_id>/resumen")
@login_required
def api_resumen(periodo_id):
    periodo = db.session.get(PeriodoConciliacion, periodo_id)
    if not periodo:
        return jsonify({"ok": False, "error": "Período no encontrado"}), 404

    # Total fronteras conciliadas
    total = db.session.execute(
        select(func.count(ResultadoConciliacion.id))
        .where(ResultadoConciliacion.periodo_id == periodo_id)
    ).scalar() or 0

    # Distribución por caso
    casos_rows = db.session.execute(
        select(ResultadoConciliacion.caso, func.count(ResultadoConciliacion.id))
        .where(ResultadoConciliacion.periodo_id == periodo_id)
        .group_by(ResultadoConciliacion.caso)
    ).all()
    casos = {c.value: cnt for c, cnt in casos_rows}

    distribucion = {
        "A1":                casos.get("A1", 0),
        "contingencias_l1":  casos.get("B1", 0) + casos.get("D1", 0),
        "provisiones":       casos.get("B2", 0) + casos.get("D2", 0) + casos.get("D3", 0),
        "disputas":          casos.get("C1", 0) + casos.get("C2", 0),
        "alertas_manuales":  casos.get("D4", 0),
        "incompletas":       casos.get("INCOMPLETA", 0),
        "errores":           casos.get("ERROR", 0),
        # por caso individual para la dona
        "casos_raw":         casos,
    }

    # Impacto financiero estimado total
    impacto_row = db.session.execute(
        select(
            func.coalesce(func.sum(ResultadoConciliacion.impacto_financiero_l1), 0),
            func.coalesce(func.sum(ResultadoConciliacion.impacto_financiero_l2), 0),
        )
        .where(ResultadoConciliacion.periodo_id == periodo_id)
    ).one()
    impacto_total = float(impacto_row[0] or 0) + float(impacto_row[1] or 0)

    # Saldo provisiones (pendientes + parciales)
    prov_row = db.session.execute(
        select(
            func.coalesce(func.sum(Provision.valor_provisionado_cop), 0),
            func.coalesce(func.sum(Provision.energia_kwh), 0),
        )
        .where(
            Provision.periodo_id == periodo_id,
            Provision.estado != EstadoProvision.CRUZADO_TOTAL,
        )
    ).one()
    saldo_prov_cop = float(prov_row[0] or 0)
    saldo_prov_kwh = float(prov_row[1] or 0)

    # Contingencias abiertas
    cont_abiertas = db.session.execute(
        select(func.count(Contingencia.id))
        .where(
            Contingencia.periodo_id == periodo_id,
            Contingencia.estado == EstadoContingencia.PENDIENTE,
        )
    ).scalar() or 0

    # Valor en disputa (activas)
    disp_cop = db.session.execute(
        select(func.coalesce(func.sum(Disputa.valor_disputa_cop), 0))
        .where(
            Disputa.periodo_id == periodo_id,
            Disputa.estado == EstadoDisputa.ABIERTA,
        )
    ).scalar() or 0

    # Top 10 fronteras por impacto financiero absoluto en L1
    top10_rows = db.session.execute(
        select(
            ResultadoConciliacion.codigo_frontera,
            ResultadoConciliacion.caso,
            ResultadoConciliacion.impacto_financiero_l1,
            ResultadoConciliacion.operador_red,
        )
        .where(
            ResultadoConciliacion.periodo_id == periodo_id,
            ResultadoConciliacion.impacto_financiero_l1.isnot(None),
        )
        .order_by(func.abs(ResultadoConciliacion.impacto_financiero_l1).desc())
        .limit(10)
    ).all()

    top10 = [
        {
            "codigo_frontera": r.codigo_frontera,
            "caso":            r.caso.value,
            "impacto_l1":      float(r.impacto_financiero_l1),
            "operador_red":    r.operador_red or "—",
        }
        for r in top10_rows
    ]

    return jsonify({
        "ok":                  True,
        "periodo_label":       f"{periodo.anio}-{periodo.mes:02d}",
        "total":               total,
        "distribucion":        distribucion,
        "casos_raw":           casos,
        "impacto_total_cop":   impacto_total,
        "saldo_provision_cop": saldo_prov_cop,
        "saldo_provision_kwh": saldo_prov_kwh,
        "cont_abiertas":       cont_abiertas,
        "valor_disputa_cop":   float(disp_cop),
        "top10":               top10,
    })


# ── API: Por Operador de Red ───────────────────────────────────────────────────

@bp.route("/api/dashboard/<periodo_id>/por-operador")
@login_required
def api_por_operador(periodo_id):
    # Casos agrupados por OR
    rows = db.session.execute(
        select(
            ResultadoConciliacion.or_id,
            ResultadoConciliacion.caso,
            func.count(ResultadoConciliacion.id).label("cnt"),
        )
        .where(ResultadoConciliacion.periodo_id == periodo_id)
        .group_by(ResultadoConciliacion.or_id, ResultadoConciliacion.caso)
    ).all()

    or_map: dict[str, dict] = {}
    for or_id, caso, cnt in rows:
        key = or_id or "__sin_or__"
        if key not in or_map:
            or_map[key] = {}
        or_map[key][caso.value if caso else "NONE"] = cnt

    # Período anterior para cálculo de tendencia
    periodo_actual = db.session.get(PeriodoConciliacion, periodo_id)
    prev_totals: dict[str, int] = {}
    if periodo_actual:
        prev_periodo = db.session.execute(
            select(PeriodoConciliacion)
            .where(
                (PeriodoConciliacion.anio * 12 + PeriodoConciliacion.mes)
                < (periodo_actual.anio * 12 + periodo_actual.mes)
            )
            .order_by(
                (PeriodoConciliacion.anio * 12 + PeriodoConciliacion.mes).desc()
            )
            .limit(1)
        ).scalar_one_or_none()

        if prev_periodo:
            prev_rows = db.session.execute(
                select(
                    ResultadoConciliacion.or_id,
                    func.count(ResultadoConciliacion.id),
                )
                .where(ResultadoConciliacion.periodo_id == prev_periodo.id)
                .group_by(ResultadoConciliacion.or_id)
            ).all()
            prev_totals = {
                (or_id or "__sin_or__"): cnt for or_id, cnt in prev_rows
            }

    result = []
    for or_key, casos in or_map.items():
        real_id = or_key if or_key != "__sin_or__" else None
        or_obj  = db.session.get(ConfiguracionOR, real_id) if real_id else None
        total   = sum(casos.values())

        prov_row = db.session.execute(
            select(
                func.coalesce(func.sum(Provision.valor_provisionado_cop), 0),
                func.count(Provision.id),
            )
            .where(
                Provision.periodo_id == periodo_id,
                Provision.or_id == real_id,
                Provision.estado != EstadoProvision.CRUZADO_TOTAL,
            )
        ).one()

        cont_abiertas = db.session.execute(
            select(func.count(Contingencia.id))
            .where(
                Contingencia.periodo_id == periodo_id,
                Contingencia.or_id == real_id,
                Contingencia.estado == EstadoContingencia.PENDIENTE,
            )
        ).scalar() or 0

        disp_abiertas = db.session.execute(
            select(func.count(Disputa.id))
            .where(
                Disputa.periodo_id == periodo_id,
                Disputa.or_id == real_id,
                Disputa.estado == EstadoDisputa.ABIERTA,
            )
        ).scalar() or 0

        prev_total = prev_totals.get(or_key, 0)
        tendencia  = total - prev_total if prev_total else 0

        result.append({
            "or_nombre":          or_obj.nombre if or_obj else "Sin OR asignado",
            "or_codigo":          or_obj.codigo if or_obj else "—",
            "total":              total,
            "A1":                 casos.get("A1", 0),
            "contingencias":      casos.get("B1", 0) + casos.get("D1", 0),
            "provisiones":        casos.get("B2", 0) + casos.get("D2", 0) + casos.get("D3", 0),
            "disputas":           casos.get("C1", 0) + casos.get("C2", 0),
            "alertas":            casos.get("D4", 0),
            "saldo_prov_cop":     float(prov_row[0] or 0),
            "cont_abiertas":      cont_abiertas,
            "disp_abiertas":      disp_abiertas,
            "tendencia":          tendencia,
        })

    result.sort(key=lambda x: x["total"], reverse=True)
    return jsonify({"ok": True, "items": result[:20]})


# ── API: Estado de fuentes del período ────────────────────────────────────────

@bp.route("/api/dashboard/<periodo_id>/estado-fuentes")
@login_required
def api_estado_fuentes(periodo_id):
    cargas = db.session.execute(
        select(CargaFuente)
        .where(CargaFuente.periodo_id == periodo_id)
        .order_by(CargaFuente.tipo_fuente, CargaFuente.created_at.desc())
    ).scalars().all()

    # Más reciente por tipo + OR
    seen: dict[str, CargaFuente] = {}
    for c in cargas:
        key = f"{c.tipo_fuente.value}_{c.or_id or 'global'}"
        if key not in seen:
            seen[key] = c

    result = []
    for c in seen.values():
        or_obj  = db.session.get(ConfiguracionOR, c.or_id) if c.or_id else None
        usuario = db.session.get(User, c.cargado_por_id) if c.cargado_por_id else None
        total   = c.total_registros or 0
        proc    = c.registros_procesados or 0
        result.append({
            "tipo":        c.tipo_fuente.value,
            "or_nombre":   or_obj.nombre if or_obj else "—",
            "estado":      c.estado.value,
            "total":       total,
            "procesados":  proc,
            "errores_reg": c.registros_error or 0,
            "usuario":     usuario.nombre if usuario else "—",
            "fecha":       c.created_at.strftime("%Y-%m-%d %H:%M"),
        })

    result.sort(key=lambda x: (x["tipo"], x["or_nombre"]))
    return jsonify({"ok": True, "fuentes": result})
