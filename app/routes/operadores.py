"""
Módulo de Operadores de Red — gestión de ConfiguracionOR y formatos de cargue.
Endpoints:
  GET  /operadores/                    → página principal
  GET  /operadores/api/list            → lista con estadísticas
  GET  /operadores/api/<id>            → detalle de un OR
  POST /operadores/api/crear           → crear OR  (ADMIN)
  PUT  /operadores/api/<id>            → editar info general (ADMIN)
  PUT  /operadores/api/<id>/formato    → guardar formato SDL/BALANCE (ADMIN)
  POST /operadores/api/<id>/toggle     → activar/desactivar (ADMIN)
"""
from __future__ import annotations

import json
from datetime import datetime

from flask import Blueprint, render_template, request, jsonify, abort
from flask_login import login_required, current_user
from sqlalchemy import select, func

from app.models import (
    db,
    ConfiguracionOR,
    CargaFuente, TipoFuente, EstadoCarga,
    ResultadoConciliacion,
    LogAuditoria, AccionAuditoria,
)

bp = Blueprint("operadores", __name__, url_prefix="/operadores")

# ── Defaults de referencia (espejo de los parsers) ────────────────────────────

FORMATO_SDL_DEFAULT = {
    "tipo_archivo": "xlsx",
    "hoja": 0,
    "fila_inicio": 2,
    "separador_csv": ",",
    "columnas": {
        "codigo_frontera":          "CODIGO_FRONTERA",
        "energia_kwh":              "ENERGIA_KWH",
        "valor_cop":                "VALOR_COP",
        "periodo":                  "PERIODO",
        "nivel_tension":            "NIVEL_TENSION",
        "propiedad_activos":        "PROPIEDAD_ACTIVOS",
        "energia_reactiva_ind_pen": "ENERGIA_REACTIVA_IND_PEN",
        "energia_reactiva_cap_pen": "ENERGIA_REACTIVA_CAP_PEN",
        "valor_reactiva_cop":       "VALOR_REACTIVA_COP",
        "factor_m":                 "FACTOR_M",
    },
}

FORMATO_BALANCE_DEFAULT = {
    "tipo_archivo": "xlsx",
    "hoja": 0,
    "fila_inicio": 2,
    "separador_csv": ",",
    "columnas": {
        "codigo_frontera": "CODIGO_FRONTERA",
        "energia_kwh":     "ENERGIA_KWH",
        "valor_cop":       "VALOR_COP",
        "periodo_ajuste":  "PERIODO_AJUSTE",
        "periodo_tarifa":  "PERIODO_TARIFA",
    },
}


def _es_admin() -> bool:
    return current_user.rol.value == "ADMINISTRADOR"


def _or_to_dict(or_obj: ConfiguracionOR, con_stats: bool = False) -> dict:
    d = {
        "id":              or_obj.id,
        "codigo":          or_obj.codigo,
        "activo":          or_obj.activo,
        "tiene_sdl":       or_obj.mapeo_sdl_json is not None,
        "tiene_balance":   or_obj.mapeo_balance_json is not None,
        "formato_sdl":     or_obj.mapeo_sdl_json or FORMATO_SDL_DEFAULT,
        "formato_balance": or_obj.mapeo_balance_json or FORMATO_BALANCE_DEFAULT,
        "created_at":      or_obj.created_at.strftime("%Y-%m-%d"),
    }
    if con_stats:
        d.update(_stats_or(or_obj.id))
    return d


def _stats_or(or_id: str) -> dict:
    """Estadísticas rápidas: última carga, fronteras en el período más reciente."""
    ultima_carga = db.session.execute(
        select(CargaFuente.created_at, CargaFuente.tipo_fuente)
        .where(
            CargaFuente.or_id == or_id,
            CargaFuente.estado == EstadoCarga.COMPLETADA,
        )
        .order_by(CargaFuente.created_at.desc())
        .limit(1)
    ).first()

    ultimo_resultado = db.session.execute(
        select(func.count(ResultadoConciliacion.id))
        .where(ResultadoConciliacion.or_id == or_id)
    ).scalar() or 0

    return {
        "ultima_carga_fecha": ultima_carga[0].strftime("%Y-%m-%d") if ultima_carga else None,
        "ultima_carga_tipo":  ultima_carga[1].value if ultima_carga else None,
        "fronteras_total":    ultimo_resultado,
    }


# ── Página principal ──────────────────────────────────────────────────────────

@bp.route("/")
@login_required
def index():
    return render_template("operadores/index.html", es_admin=_es_admin())


# ── API: Lista ────────────────────────────────────────────────────────────────

@bp.route("/api/list")
@login_required
def api_list():
    solo_activos = request.args.get("activos") == "1"
    q = select(ConfiguracionOR).order_by(ConfiguracionOR.codigo)
    if solo_activos:
        q = q.where(ConfiguracionOR.activo == True)  # noqa: E712

    items = db.session.execute(q).scalars().all()
    return jsonify({
        "ok": True,
        "items": [_or_to_dict(o, con_stats=True) for o in items],
    })


# ── API: Detalle ──────────────────────────────────────────────────────────────

@bp.route("/api/<or_id>")
@login_required
def api_detalle(or_id: str):
    or_obj = db.session.get(ConfiguracionOR, or_id)
    if not or_obj:
        return jsonify({"ok": False, "error": "OR no encontrado"}), 404
    return jsonify({"ok": True, "or": _or_to_dict(or_obj, con_stats=True)})


# ── API: Crear ────────────────────────────────────────────────────────────────

@bp.route("/api/crear", methods=["POST"])
@login_required
def api_crear():
    if not _es_admin():
        abort(403)

    body   = request.get_json(force=True) or {}
    codigo = (body.get("codigo") or "").strip().upper()

    if not codigo:
        return jsonify({"ok": False, "error": "El código del OR es obligatorio."}), 400

    if db.session.execute(
        select(ConfiguracionOR).where(ConfiguracionOR.codigo == codigo)
    ).scalar_one_or_none():
        return jsonify({"ok": False, "error": f"Ya existe un OR con código «{codigo}»."}), 409

    or_obj = ConfiguracionOR(
        codigo=codigo,
        nombre=codigo,
        activo=True,
    )
    db.session.add(or_obj)
    db.session.add(LogAuditoria(
        usuario_id=current_user.id,
        accion=AccionAuditoria.CAMBIAR_CONFIGURACION,
        entidad="configuracion_or",
        entidad_id=or_obj.id,
        detalle={"accion": "crear", "codigo": codigo},
        ip=request.remote_addr,
    ))
    db.session.commit()
    return jsonify({"ok": True, "or": _or_to_dict(or_obj)}), 201


# ── API: Editar info general ──────────────────────────────────────────────────

@bp.route("/api/<or_id>", methods=["PUT"])
@login_required
def api_editar(or_id: str):
    if not _es_admin():
        abort(403)

    or_obj = db.session.get(ConfiguracionOR, or_id)
    if not or_obj:
        return jsonify({"ok": False, "error": "OR no encontrado"}), 404

    return jsonify({"ok": True, "or": _or_to_dict(or_obj)})


# ── API: Guardar formato de cargue ────────────────────────────────────────────

@bp.route("/api/<or_id>/formato", methods=["PUT"])
@login_required
def api_formato(or_id: str):
    if not _es_admin():
        abort(403)

    or_obj = db.session.get(ConfiguracionOR, or_id)
    if not or_obj:
        return jsonify({"ok": False, "error": "OR no encontrado"}), 404

    body         = request.get_json(force=True) or {}
    tipo_formato = body.get("tipo")  # "SDL" | "BALANCE"

    if tipo_formato not in ("SDL", "BALANCE"):
        return jsonify({"ok": False, "error": "tipo debe ser SDL o BALANCE."}), 400

    # Construir el objeto de mapeo desde los campos del body
    tipo_archivo = body.get("tipo_archivo", "xlsx")
    try:
        hoja        = int(body.get("hoja", 0))
        fila_inicio = int(body.get("fila_inicio", 2))
    except (ValueError, TypeError):
        return jsonify({"ok": False, "error": "hoja y fila_inicio deben ser enteros."}), 400

    mapeo: dict = {
        "tipo_archivo": tipo_archivo,
        "hoja":         hoja,
        "fila_inicio":  fila_inicio,
        "separador_csv": body.get("separador_csv", ","),
    }

    cols_raw = body.get("columnas", {})

    if tipo_formato == "SDL":
        required_cols = ["codigo_frontera", "energia_kwh", "valor_cop"]
        for c in required_cols:
            v = (cols_raw.get(c) or "").strip()
            if not v:
                return jsonify({"ok": False, "error": f"Columna SDL requerida: {c}"}), 400
        mapeo["columnas"] = {
            "codigo_frontera":          (cols_raw.get("codigo_frontera") or "").strip(),
            "energia_kwh":              (cols_raw.get("energia_kwh") or "").strip(),
            "valor_cop":                (cols_raw.get("valor_cop") or "").strip(),
            "periodo":                  (cols_raw.get("periodo") or "").strip() or None,
            "nivel_tension":            (cols_raw.get("nivel_tension") or "").strip() or None,
            "propiedad_activos":        (cols_raw.get("propiedad_activos") or "").strip() or None,
            "energia_reactiva_ind_pen": (cols_raw.get("energia_reactiva_ind_pen") or "").strip() or None,
            "energia_reactiva_cap_pen": (cols_raw.get("energia_reactiva_cap_pen") or "").strip() or None,
            "valor_reactiva_cop":       (cols_raw.get("valor_reactiva_cop") or "").strip() or None,
            "factor_m":                 (cols_raw.get("factor_m") or "").strip() or None,
        }
        or_obj.mapeo_sdl_json = mapeo

    else:  # BALANCE
        required_cols = ["codigo_frontera", "energia_kwh", "valor_cop",
                         "periodo_ajuste", "periodo_tarifa"]
        for c in required_cols:
            v = (cols_raw.get(c) or "").strip()
            if not v:
                return jsonify({"ok": False, "error": f"Columna BALANCE requerida: {c}"}), 400
        mapeo["columnas"] = {
            "codigo_frontera": (cols_raw.get("codigo_frontera") or "").strip(),
            "energia_kwh":     (cols_raw.get("energia_kwh") or "").strip(),
            "valor_cop":       (cols_raw.get("valor_cop") or "").strip(),
            "periodo_ajuste":  (cols_raw.get("periodo_ajuste") or "").strip(),
            "periodo_tarifa":  (cols_raw.get("periodo_tarifa") or "").strip(),
        }
        or_obj.mapeo_balance_json = mapeo

    db.session.add(LogAuditoria(
        usuario_id=current_user.id,
        accion=AccionAuditoria.CAMBIAR_CONFIGURACION,
        entidad="configuracion_or",
        entidad_id=or_id,
        detalle={"accion": f"formato_{tipo_formato.lower()}", "tipo_archivo": tipo_archivo},
        ip=request.remote_addr,
    ))
    db.session.commit()
    return jsonify({"ok": True, "formato": mapeo})


# ── API: Toggle activo ────────────────────────────────────────────────────────

@bp.route("/api/<or_id>/toggle", methods=["POST"])
@login_required
def api_toggle(or_id: str):
    if not _es_admin():
        abort(403)

    or_obj = db.session.get(ConfiguracionOR, or_id)
    if not or_obj:
        return jsonify({"ok": False, "error": "OR no encontrado"}), 404

    or_obj.activo = not or_obj.activo
    db.session.add(LogAuditoria(
        usuario_id=current_user.id,
        accion=AccionAuditoria.CAMBIAR_CONFIGURACION,
        entidad="configuracion_or",
        entidad_id=or_id,
        detalle={"accion": "toggle_activo", "nuevo_estado": or_obj.activo},
        ip=request.remote_addr,
    ))
    db.session.commit()
    return jsonify({"ok": True, "activo": or_obj.activo})
