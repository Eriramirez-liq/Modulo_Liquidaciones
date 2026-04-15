"""Conciliaciones — motor de conciliación y visualización de resultados."""
from decimal import Decimal
from flask import Blueprint, render_template, request, jsonify
from flask_login import login_required, current_user
from sqlalchemy import select, func

from app.models import (
    db, PeriodoConciliacion, ResultadoConciliacion, ConfiguracionOR,
    CasoConciliacion, Provision, Contingencia, Disputa,
    EstadoProvision, EstadoContingencia, EstadoDisputa,
)
from app.engine import ejecutar_conciliacion, ejecutar_conciliacion_tarifa

bp = Blueprint("conciliaciones", __name__, url_prefix="/conciliaciones")


@bp.route("/")
@login_required
def index():
    periodos = PeriodoConciliacion.query.order_by(
        PeriodoConciliacion.anio.desc(),
        PeriodoConciliacion.mes.desc()
    ).all()
    operadores = ConfiguracionOR.query.filter_by(activo=True).order_by(ConfiguracionOR.codigo).all()
    return render_template("conciliaciones/index.html", periodos=periodos, operadores=operadores)


@bp.route("/api/<periodo_id>/ejecutar", methods=["POST"])
@login_required
def api_ejecutar(periodo_id):
    """Ejecuta el Motor de Conciliación."""
    PeriodoConciliacion.query.get_or_404(periodo_id)
    body = request.get_json(force=True) or {}
    or_id_filter     = body.get("or_id") or None
    tipo_liquidacion = body.get("tipo_liquidacion") or None
    try:
        if tipo_liquidacion == "TC1":
            resumen = ejecutar_conciliacion_tarifa(
                periodo_id, current_user.id,
                or_id_filter=or_id_filter,
            )
        else:
            resumen = ejecutar_conciliacion(
                periodo_id, current_user.id,
                or_id_filter=or_id_filter,
                tipo_liquidacion=tipo_liquidacion,
            )
        return jsonify({"ok": True, "resumen": resumen})
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 422
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.route("/api/<periodo_id>/re-ejecutar", methods=["POST"])
@login_required
def api_re_ejecutar(periodo_id):
    """Re-ejecuta el motor (idempotente si no hay cruces definitivos)."""
    return api_ejecutar(periodo_id)


@bp.route("/api/<periodo_id>/resumen", methods=["GET"])
@login_required
def api_resumen(periodo_id):
    """Devuelve KPIs reales del período desde la BD."""
    periodo = PeriodoConciliacion.query.get_or_404(periodo_id)

    # Conteo por caso
    rows = db.session.execute(
        select(ResultadoConciliacion.caso, func.count(ResultadoConciliacion.id))
        .where(ResultadoConciliacion.periodo_id == periodo_id)
        .group_by(ResultadoConciliacion.caso)
    ).all()

    casos: dict = {c.value: 0 for c in CasoConciliacion}
    total = 0
    for caso_val, cnt in rows:
        casos[caso_val.value] = cnt
        total += cnt

    # Impacto financiero total
    imp = db.session.execute(
        select(
            func.coalesce(func.sum(ResultadoConciliacion.impacto_financiero_l1), 0),
            func.coalesce(func.sum(ResultadoConciliacion.impacto_financiero_l2), 0),
        ).where(ResultadoConciliacion.periodo_id == periodo_id)
    ).one()

    # Saldos vivos
    saldo_provisiones = db.session.execute(
        select(func.coalesce(func.sum(Provision.valor_provisionado_cop), 0))
        .where(Provision.periodo_id == periodo_id,
               Provision.estado == EstadoProvision.PENDIENTE)
    ).scalar()

    contingencias_abiertas = db.session.execute(
        select(func.count(Contingencia.id))
        .where(Contingencia.periodo_id == periodo_id,
               Contingencia.estado == EstadoContingencia.PENDIENTE)
    ).scalar()

    disputas_abiertas = db.session.execute(
        select(func.count(Disputa.id))
        .where(Disputa.periodo_id == periodo_id,
               Disputa.estado == EstadoDisputa.ABIERTA)
    ).scalar()

    return jsonify({
        "ok": True,
        "periodo": f"{periodo.anio}-{periodo.mes:02d}",
        "total": total,
        "casos": casos,
        "impacto_l1": float(imp[0]),
        "impacto_l2": float(imp[1]),
        "saldo_provisiones_cop": float(saldo_provisiones),
        "contingencias_abiertas": contingencias_abiertas,
        "disputas_abiertas": disputas_abiertas,
    })


@bp.route("/api/<periodo_id>/resultados-tc1", methods=["GET"])
@login_required
def api_resultados_tc1(periodo_id):
    """Lista paginada de discrepancias tarifarias del período (resultado de conciliación TC1)."""
    from app.models import RegistroTC1, RegistroFacturacion, RegistroSDL, CargaFuente, TipoFuente, EstadoCarga

    PeriodoConciliacion.query.get_or_404(periodo_id)
    page  = int(request.args.get("page", 1))
    limit = min(int(request.args.get("limit", 50)), 200)
    or_filter = request.args.get("or_id") or None

    # Reutiliza la lógica del motor para obtener los datos (sin persistir)
    try:
        resumen = ejecutar_conciliacion_tarifa(periodo_id, current_user.id, or_id_filter=or_filter)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 422

    detalle = resumen.get("detalle", [])
    total   = len(detalle)
    items   = detalle[(page - 1) * limit: page * limit]

    return jsonify({"ok": True, "total": total, "page": page, "items": items,
                    "sin_tc1": resumen.get("sin_tc1", 0)})


@bp.route("/api/<periodo_id>/resultados", methods=["GET"])
@login_required
def api_resultados(periodo_id):
    """Lista paginada de resultados del período."""
    PeriodoConciliacion.query.get_or_404(periodo_id)
    page  = int(request.args.get("page", 1))
    limit = min(int(request.args.get("limit", 50)), 200)

    q = (
        select(ResultadoConciliacion)
        .where(ResultadoConciliacion.periodo_id == periodo_id)
        .order_by(ResultadoConciliacion.codigo_frontera)
    )

    caso_filter = request.args.get("caso")
    if caso_filter:
        q = q.where(ResultadoConciliacion.caso == CasoConciliacion(caso_filter))

    or_filter = request.args.get("or_id")
    if or_filter:
        q = q.where(ResultadoConciliacion.or_id == or_filter)

    total_q = db.session.execute(
        select(func.count()).select_from(q.subquery())
    ).scalar()

    resultados = db.session.execute(
        q.offset((page - 1) * limit).limit(limit)
    ).scalars().all()

    return jsonify({
        "ok": True,
        "total": total_q,
        "page": page,
        "items": [
            {
                "id": r.id,
                "codigo_frontera": r.codigo_frontera,
                "nombre_usuario": r.nombre_usuario,
                "operador_red": r.operador_red,
                "e_fac": float(r.e_fac) if r.e_fac is not None else None,
                "e_xm":  float(r.e_xm)  if r.e_xm  is not None else None,
                "e_sdl": float(r.e_sdl) if r.e_sdl  is not None else None,
                "delta_l1": float(r.delta_l1) if r.delta_l1 is not None else None,
                "delta_l2": float(r.delta_l2) if r.delta_l2 is not None else None,
                "caso": r.caso.value,
                "resultado_l1": r.resultado_l1.value if r.resultado_l1 else None,
                "resultado_l2": r.resultado_l2.value if r.resultado_l2 else None,
                "impacto_l1": float(r.impacto_financiero_l1) if r.impacto_financiero_l1 else None,
                "impacto_l2": float(r.impacto_financiero_l2) if r.impacto_financiero_l2 else None,
                "alerta_manual": r.requiere_alerta_manual,
                "observaciones": r.observaciones,
            }
            for r in resultados
        ],
    })

