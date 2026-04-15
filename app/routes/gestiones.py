"""
M3 — Gestión de Provisiones, Contingencias y Disputas.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from flask import Blueprint, render_template, request, jsonify
from flask_login import login_required, current_user
from sqlalchemy import select, func

from app.models import (
    db,
    PeriodoConciliacion,
    ConfiguracionOR,
    RegistroBalance,
    Provision, EstadoProvision, TipoProvision,
    Contingencia, EstadoContingencia, ResultadoContingencia,
    CruceBalance, TipoResultadoCruce,
    Disputa, EstadoDisputa,
    LogAuditoria, AccionAuditoria,
)

bp = Blueprint("gestiones", __name__, url_prefix="/gestiones")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _dias_desde(dt: datetime) -> int:
    return (datetime.utcnow() - dt).days


def _provision_to_dict(p: Provision) -> dict:
    dias = _dias_desde(p.created_at)
    periodo = p.periodo
    return {
        "id":                    p.id,
        "periodo_id":            p.periodo_id,
        "periodo_label":         f"{periodo.anio}-{periodo.mes:02d}" if periodo else p.periodo_id,
        "codigo_frontera":       p.codigo_frontera,
        "or_id":                 p.or_id,
        "or_nombre":             p.operador_red.nombre if p.operador_red else None,
        "tipo":                  p.tipo.value,
        "energia_kwh":           float(p.energia_kwh),
        "valor_provisionado_cop": float(p.valor_provisionado_cop),
        "estado":                p.estado.value,
        "dias_abierta":          dias,
        "alerta_vencimiento":    dias > 90 and p.estado == EstadoProvision.PENDIENTE,
        "fecha_cierre":          p.fecha_cierre.isoformat() if p.fecha_cierre else None,
        "created_at":            p.created_at.isoformat(),
    }


def _contingencia_to_dict(c: Contingencia) -> dict:
    dias = _dias_desde(c.created_at)
    periodo = c.periodo
    return {
        "id":                        c.id,
        "periodo_id":                c.periodo_id,
        "periodo_label":             f"{periodo.anio}-{periodo.mes:02d}" if periodo else c.periodo_id,
        "codigo_frontera":           c.codigo_frontera,
        "or_id":                     c.or_id,
        "or_nombre":                 c.operador_red.nombre if c.operador_red else None,
        "energia_kwh":               float(c.energia_kwh),
        "costo_calculado_cop":       float(c.costo_calculado_cop) if c.costo_calculado_cop else None,
        "refacturacion_cliente_cop": float(c.refacturacion_cliente_cop) if c.refacturacion_cliente_cop else None,
        "costo_neto_cop":            float(c.costo_neto_cop) if c.costo_neto_cop else None,
        "estado":                    c.estado.value,
        "resultado_tipo":            c.resultado_tipo.value,
        "descripcion":               c.descripcion,
        "dias_abierta":              dias,
        "alerta_vencimiento":        dias > 90 and c.estado == EstadoContingencia.PENDIENTE,
        "fecha_cobro":               c.fecha_cobro.isoformat() if c.fecha_cobro else None,
        "fecha_cierre":              c.fecha_cierre.isoformat() if c.fecha_cierre else None,
        "created_at":                c.created_at.isoformat(),
    }


def _disputa_to_dict(d: Disputa) -> dict:
    dias = _dias_desde(d.created_at)
    periodo = d.periodo
    return {
        "id":                  d.id,
        "periodo_id":          d.periodo_id,
        "periodo_label":       f"{periodo.anio}-{periodo.mes:02d}" if periodo else d.periodo_id,
        "codigo_frontera":     d.codigo_frontera,
        "or_id":               d.or_id,
        "or_nombre":           d.operador_red.nombre if d.operador_red else None,
        "energia_exceso_kwh":  float(d.energia_exceso_kwh),
        "valor_disputa_cop":   float(d.valor_disputa_cop),
        "estado":              d.estado.value,
        "descripcion":         d.descripcion,
        "resolucion":          d.resolucion,
        "dias_abierta":        dias,
        "alerta_vencimiento":  dias > 30 and d.estado == EstadoDisputa.ABIERTA,
        "cerrada_at":          d.cerrada_at.isoformat() if d.cerrada_at else None,
        "created_at":          d.created_at.isoformat(),
    }


# ── Página principal (3 pestañas) ─────────────────────────────────────────────

@bp.route("/")
@login_required
def index():
    periodos = PeriodoConciliacion.query.order_by(
        PeriodoConciliacion.anio.desc(),
        PeriodoConciliacion.mes.desc(),
    ).all()
    operadores = ConfiguracionOR.query.filter_by(activo=True).order_by(ConfiguracionOR.codigo).all()
    return render_template("gestiones/index.html", periodos=periodos, operadores=operadores)


# ══════════════════════════════════════════════════════════════════════════════
# PROVISIONES
# ══════════════════════════════════════════════════════════════════════════════

@bp.route("/api/provisiones")
@login_required
def api_provisiones():
    """Lista paginada de provisiones con filtros opcionales."""
    page  = max(1, request.args.get("page", 1, type=int))
    limit = min(request.args.get("limit", 100, type=int), 200)

    q = select(Provision)

    periodo_id = request.args.get("periodo_id")
    or_id      = request.args.get("or_id")
    estado     = request.args.get("estado")
    antig_min  = request.args.get("antiguedad_min", type=int)

    if periodo_id:
        q = q.where(Provision.periodo_id == periodo_id)
    if or_id:
        q = q.where(Provision.or_id == or_id)
    if estado:
        q = q.where(Provision.estado == EstadoProvision(estado))
    if antig_min:
        corte = datetime.utcnow() - timedelta(days=antig_min)
        q = q.where(Provision.created_at <= corte)

    total = db.session.execute(select(func.count()).select_from(q.subquery())).scalar() or 0
    q = q.order_by(Provision.created_at.desc()).offset((page - 1) * limit).limit(limit)
    items = db.session.execute(q).scalars().all()
    return jsonify({
        "ok": True,
        "total": total,
        "page": page,
        "pages": max(1, -(-total // limit)),  # ceiling division
        "items": [_provision_to_dict(p) for p in items],
    })


@bp.route("/api/provisiones/saldos")
@login_required
def api_provisiones_saldos():
    """Panel de saldos agregados por OR."""
    # Total provisionado pendiente agrupado por OR
    rows = db.session.execute(
        select(
            Provision.or_id,
            func.count(Provision.id).label("cantidad"),
            func.coalesce(func.sum(Provision.valor_provisionado_cop), 0).label("total_cop"),
            func.coalesce(func.sum(Provision.energia_kwh), 0).label("total_kwh"),
        )
        .where(Provision.estado == EstadoProvision.PENDIENTE)
        .group_by(Provision.or_id)
    ).all()

    saldos_or = []
    for r in rows:
        or_obj = db.session.get(ConfiguracionOR, r.or_id) if r.or_id else None
        saldos_or.append({
            "or_id":     r.or_id,
            "or_nombre": or_obj.nombre if or_obj else "Sin OR",
            "cantidad":  r.cantidad,
            "total_cop": float(r.total_cop),
            "total_kwh": float(r.total_kwh),
        })

    # Provisiones por antigüedad
    ahora = datetime.utcnow()
    def _contar_rango(dias_desde: int, dias_hasta: int | None) -> int:
        q = select(func.count(Provision.id)).where(
            Provision.estado == EstadoProvision.PENDIENTE,
            Provision.created_at <= ahora - timedelta(days=dias_desde),
        )
        if dias_hasta is not None:
            q = q.where(Provision.created_at > ahora - timedelta(days=dias_hasta))
        return db.session.execute(q).scalar() or 0

    por_antiguedad = {
        "0_30":  _contar_rango(0, 30),
        "31_60": _contar_rango(31, 60),
        "61_90": _contar_rango(61, 90),
        "mas_90": _contar_rango(91, None),
    }

    # Total exposición contingencias
    exp_cont = db.session.execute(
        select(func.count(Contingencia.id))
        .where(Contingencia.estado == EstadoContingencia.PENDIENTE)
    ).scalar() or 0

    # Total en disputa
    disp_cop = db.session.execute(
        select(func.coalesce(func.sum(Disputa.valor_disputa_cop), 0))
        .where(Disputa.estado == EstadoDisputa.ABIERTA)
    ).scalar() or 0

    return jsonify({
        "ok": True,
        "saldos_por_or": saldos_or,
        "por_antiguedad": por_antiguedad,
        "contingencias_pendientes": exp_cont,
        "disputas_valor_cop": float(disp_cop),
    })


@bp.route("/api/provisiones/<provision_id>/cruzar-balance", methods=["POST"])
@login_required
def api_cruzar_balance(provision_id: str):
    """
    Cruce definitivo e irreversible de una provisión con un registro de balance.
    resultado_neto = valor_provisionado - valor_balance_cop
    """
    provision = db.session.get(Provision, provision_id)
    if not provision:
        return jsonify({"ok": False, "error": "Provisión no encontrada."}), 404

    if provision.estado == EstadoProvision.CRUZADO_TOTAL:
        return jsonify({"ok": False, "error": "Esta provisión ya fue cruzada definitivamente."}), 422

    body       = request.get_json(force=True) or {}
    balance_id = body.get("balance_id")
    observaciones = body.get("observaciones", "")

    if not balance_id:
        return jsonify({"ok": False, "error": "Falta balance_id."}), 400

    balance = db.session.get(RegistroBalance, balance_id)
    if not balance:
        return jsonify({"ok": False, "error": "Registro de balance no encontrado."}), 404

    valor_balance = balance.valor_balance_cop
    resultado_neto = provision.valor_provisionado_cop - valor_balance

    if resultado_neto > 0:
        tipo_resultado = TipoResultadoCruce.INGRESO
    elif resultado_neto < 0:
        tipo_resultado = TipoResultadoCruce.COSTO
    else:
        tipo_resultado = TipoResultadoCruce.EXACTO

    cruce = CruceBalance(
        registro_balance_id=balance.id,
        codigo_frontera=provision.codigo_frontera,
        provision_id=provision.id,
        energia_cruzada_kwh=balance.energia_balance_kwh,
        valor_cruzado_cop=valor_balance,
        resultado_neto_cop=resultado_neto,
        tipo_resultado=tipo_resultado,
        fecha_cruce=datetime.utcnow(),
        registrado_por_id=current_user.id,
    )
    provision.estado       = EstadoProvision.CRUZADO_TOTAL
    provision.fecha_cierre = datetime.utcnow()

    db.session.add(cruce)
    db.session.add(LogAuditoria(
        usuario_id=current_user.id,
        accion=AccionAuditoria.REGISTRAR_CRUCE,
        entidad="provisiones",
        entidad_id=provision.id,
        detalle={
            "balance_id": balance_id,
            "valor_provisionado": float(provision.valor_provisionado_cop),
            "valor_balance": float(valor_balance),
            "resultado_neto": float(resultado_neto),
            "tipo_resultado": tipo_resultado.value,
            "observaciones": observaciones,
        },
        ip=request.remote_addr,
    ))
    db.session.commit()

    return jsonify({
        "ok": True,
        "resultado_neto_cop": float(resultado_neto),
        "tipo_resultado": tipo_resultado.value,
    })


# ══════════════════════════════════════════════════════════════════════════════
# CONTINGENCIAS
# ══════════════════════════════════════════════════════════════════════════════

@bp.route("/api/contingencias")
@login_required
def api_contingencias():
    """Lista paginada de contingencias con filtros opcionales."""
    page  = max(1, request.args.get("page", 1, type=int))
    limit = min(request.args.get("limit", 100, type=int), 200)

    q = select(Contingencia)

    periodo_id = request.args.get("periodo_id")
    or_id      = request.args.get("or_id")
    estado     = request.args.get("estado")

    if periodo_id:
        q = q.where(Contingencia.periodo_id == periodo_id)
    if or_id:
        q = q.where(Contingencia.or_id == or_id)
    if estado:
        q = q.where(Contingencia.estado == EstadoContingencia(estado))

    total = db.session.execute(select(func.count()).select_from(q.subquery())).scalar() or 0
    q = q.order_by(Contingencia.created_at.desc()).offset((page - 1) * limit).limit(limit)
    items = db.session.execute(q).scalars().all()
    return jsonify({
        "ok": True,
        "total": total,
        "page": page,
        "pages": max(1, -(-total // limit)),
        "items": [_contingencia_to_dict(c) for c in items],
    })


@bp.route("/api/contingencias/<contingencia_id>/registrar-cobro", methods=["POST"])
@login_required
def api_registrar_cobro(contingencia_id: str):
    """Registra el cobro del OR: costo = energia_kwh * tarifa_balance."""
    cont = db.session.get(Contingencia, contingencia_id)
    if not cont:
        return jsonify({"ok": False, "error": "Contingencia no encontrada."}), 404
    if cont.estado != EstadoContingencia.PENDIENTE:
        return jsonify({"ok": False, "error": "Solo se puede registrar cobro en contingencias PENDIENTE."}), 422

    body       = request.get_json(force=True) or {}
    balance_id = body.get("balance_id")
    if not balance_id:
        return jsonify({"ok": False, "error": "Falta balance_id."}), 400

    balance = db.session.get(RegistroBalance, balance_id)
    if not balance:
        return jsonify({"ok": False, "error": "Registro de balance no encontrado."}), 404

    costo = cont.energia_kwh * balance.tarifa_balance
    cont.costo_calculado_cop = costo
    cont.estado              = EstadoContingencia.COBRADO
    cont.fecha_cobro         = datetime.utcnow()

    cruce = CruceBalance(
        registro_balance_id=balance.id,
        codigo_frontera=cont.codigo_frontera,
        contingencia_id=cont.id,
        energia_cruzada_kwh=cont.energia_kwh,
        valor_cruzado_cop=costo,
        resultado_neto_cop=-costo,   # costo para BIA
        tipo_resultado=TipoResultadoCruce.COSTO,
        fecha_cruce=datetime.utcnow(),
        registrado_por_id=current_user.id,
    )
    db.session.add(cruce)
    db.session.add(LogAuditoria(
        usuario_id=current_user.id,
        accion=AccionAuditoria.ACTUALIZAR_CONTINGENCIA,
        entidad="contingencias",
        entidad_id=cont.id,
        detalle={"accion": "registrar_cobro", "costo_cop": float(costo), "balance_id": balance_id},
        ip=request.remote_addr,
    ))
    db.session.commit()
    return jsonify({"ok": True, "costo_calculado_cop": float(costo)})


@bp.route("/api/contingencias/<contingencia_id>/registrar-refacturacion", methods=["POST"])
@login_required
def api_registrar_refacturacion(contingencia_id: str):
    """Registra refacturación al cliente y calcula costo neto."""
    cont = db.session.get(Contingencia, contingencia_id)
    if not cont:
        return jsonify({"ok": False, "error": "Contingencia no encontrada."}), 404
    if cont.estado != EstadoContingencia.COBRADO:
        return jsonify({"ok": False, "error": "Primero debe registrarse el cobro del OR."}), 422

    body   = request.get_json(force=True) or {}
    monto  = body.get("monto_cop")
    if monto is None:
        return jsonify({"ok": False, "error": "Falta monto_cop."}), 400

    monto_dec = Decimal(str(monto))
    costo_neto = (cont.costo_calculado_cop or Decimal("0")) - monto_dec

    cont.refacturacion_cliente_cop = monto_dec
    cont.costo_neto_cop            = costo_neto
    cont.resultado_tipo = (
        ResultadoContingencia.GANANCIA_REAL if costo_neto < 0
        else ResultadoContingencia.PERDIDA_REAL
    )
    cont.estado       = EstadoContingencia.CERRADO
    cont.fecha_cierre = datetime.utcnow()

    db.session.add(LogAuditoria(
        usuario_id=current_user.id,
        accion=AccionAuditoria.ACTUALIZAR_CONTINGENCIA,
        entidad="contingencias",
        entidad_id=cont.id,
        detalle={
            "accion": "registrar_refacturacion",
            "monto_cop": float(monto_dec),
            "costo_neto_cop": float(costo_neto),
            "resultado": cont.resultado_tipo.value,
        },
        ip=request.remote_addr,
    ))
    db.session.commit()
    return jsonify({
        "ok": True,
        "costo_neto_cop": float(costo_neto),
        "resultado": cont.resultado_tipo.value,
    })


@bp.route("/api/contingencias/<contingencia_id>/cerrar-sin-refacturacion", methods=["POST"])
@login_required
def api_cerrar_sin_refacturacion(contingencia_id: str):
    """Cierra la contingencia como PérdidaPorDiferenciaDeReporte."""
    cont = db.session.get(Contingencia, contingencia_id)
    if not cont:
        return jsonify({"ok": False, "error": "Contingencia no encontrada."}), 404
    if cont.estado == EstadoContingencia.CERRADO:
        return jsonify({"ok": False, "error": "Ya está cerrada."}), 422

    cont.resultado_tipo = ResultadoContingencia.PERDIDA_REPORTE
    cont.estado         = EstadoContingencia.CERRADO
    cont.fecha_cierre   = datetime.utcnow()
    cont.costo_neto_cop = cont.costo_calculado_cop  # toda la contingencia es pérdida

    db.session.add(LogAuditoria(
        usuario_id=current_user.id,
        accion=AccionAuditoria.ACTUALIZAR_CONTINGENCIA,
        entidad="contingencias",
        entidad_id=cont.id,
        detalle={"accion": "cerrar_sin_refacturacion"},
        ip=request.remote_addr,
    ))
    db.session.commit()
    return jsonify({"ok": True, "resultado": cont.resultado_tipo.value})


# ══════════════════════════════════════════════════════════════════════════════
# DISPUTAS
# ══════════════════════════════════════════════════════════════════════════════

@bp.route("/api/disputas")
@login_required
def api_disputas():
    """Lista paginada de disputas con filtros opcionales."""
    page  = max(1, request.args.get("page", 1, type=int))
    limit = min(request.args.get("limit", 100, type=int), 200)

    q = select(Disputa)

    periodo_id = request.args.get("periodo_id")
    or_id      = request.args.get("or_id")
    estado     = request.args.get("estado")

    if periodo_id:
        q = q.where(Disputa.periodo_id == periodo_id)
    if or_id:
        q = q.where(Disputa.or_id == or_id)
    if estado:
        q = q.where(Disputa.estado == EstadoDisputa(estado))

    total = db.session.execute(select(func.count()).select_from(q.subquery())).scalar() or 0
    q = q.order_by(Disputa.created_at.desc()).offset((page - 1) * limit).limit(limit)
    items = db.session.execute(q).scalars().all()
    return jsonify({
        "ok": True,
        "total": total,
        "page": page,
        "pages": max(1, -(-total // limit)),
        "items": [_disputa_to_dict(d) for d in items],
    })


@bp.route("/api/disputas/<disputa_id>/observaciones", methods=["PATCH"])
@login_required
def api_disputa_observaciones(disputa_id: str):
    """Actualiza las observaciones de una disputa."""
    disp = db.session.get(Disputa, disputa_id)
    if not disp:
        return jsonify({"ok": False, "error": "Disputa no encontrada."}), 404

    body = request.get_json(force=True) or {}
    obs  = body.get("observaciones", "").strip()

    if not obs:
        return jsonify({"ok": False, "error": "Falta el campo observaciones."}), 400

    disp.observaciones = obs
    db.session.add(LogAuditoria(
        usuario_id=current_user.id,
        accion=AccionAuditoria.ACTUALIZAR_DISPUTA,
        entidad="disputas",
        entidad_id=disp.id,
        detalle={"accion": "actualizar_observaciones"},
        ip=request.remote_addr,
    ))
    db.session.commit()
    return jsonify({"ok": True})


@bp.route("/api/disputas/<disputa_id>/gestionar", methods=["POST"])
@login_required
def api_disputa_gestionar(disputa_id: str):
    """Cambia el estado de una disputa (EN_GESTION, CERRADA_SIN_AJUSTE)."""
    disp = db.session.get(Disputa, disputa_id)
    if not disp:
        return jsonify({"ok": False, "error": "Disputa no encontrada."}), 404

    body           = request.get_json(force=True) or {}
    nuevo_estado   = body.get("estado")
    resolucion     = body.get("resolucion", "").strip()

    estados_validos = {EstadoDisputa.EN_GESTION.value, EstadoDisputa.CERRADA_SIN_AJUSTE.value}
    if nuevo_estado not in estados_validos:
        return jsonify({"ok": False, "error": f"Estado debe ser uno de {estados_validos}."}), 400

    disp.estado = EstadoDisputa(nuevo_estado)
    if resolucion:
        disp.resolucion = resolucion
    if nuevo_estado == EstadoDisputa.CERRADA_SIN_AJUSTE.value:
        disp.cerrada_por_id = current_user.id
        disp.cerrada_at     = datetime.utcnow()

    db.session.add(LogAuditoria(
        usuario_id=current_user.id,
        accion=AccionAuditoria.ACTUALIZAR_DISPUTA,
        entidad="disputas",
        entidad_id=disp.id,
        detalle={"accion": "cambiar_estado", "nuevo_estado": nuevo_estado},
        ip=request.remote_addr,
    ))
    db.session.commit()
    return jsonify({"ok": True, "estado": disp.estado.value})
