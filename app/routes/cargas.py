"""
Cargas de fuentes — wizard de 3 pasos (Configurar → Cargar archivo → Confirmar).
Port del WizardCarga de React a servidor Flask + JS vanilla.
"""
from __future__ import annotations
from typing import Optional

import json
import io
from datetime import datetime
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, flash
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename

from ..models import (
    db, CargaFuente, PeriodoConciliacion,
    ConfiguracionOR, TipoFuente, EstadoCarga,
    RegistroFacturacion, RegistroXM, RegistroSDL, RegistroTC1, RegistroBalance,
    AccionAuditoria, LogAuditoria,
)
from ..parsers import parsear_archivo

bp = Blueprint("cargas", __name__, url_prefix="/cargas")

ALLOWED_EXTENSIONS = {"xlsx", "xls", "csv"}


def _ext_permitida(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# ── Historial de cargas ────────────────────────────────────────────────────────

@bp.route("/")
@login_required
def index():
    cargas = (
        CargaFuente.query
        .order_by(CargaFuente.created_at.desc())
        .limit(50)
        .all()
    )
    return render_template("cargas/index.html", cargas=cargas)


# ── Wizard: Paso 1 y 2 (render) ───────────────────────────────────────────────

@bp.route("/nueva")
@login_required
def nueva():
    operadores = ConfiguracionOR.query.filter_by(activo=True).order_by(ConfiguracionOR.codigo).all()
    anio_actual = datetime.now().year
    return render_template("cargas/nueva.html", operadores=operadores, anio_actual=anio_actual)


# ── API: preview del archivo ───────────────────────────────────────────────────

@bp.route("/api/preview", methods=["POST"])
@login_required
def api_preview():
    """Recibe el archivo y los metadatos, parsea y devuelve preview JSON."""
    archivo = request.files.get("archivo")
    if not archivo or not archivo.filename:
        return jsonify({"error": "No se adjuntó ningún archivo."}), 400
    if not _ext_permitida(archivo.filename):
        return jsonify({"error": "Extensión no permitida. Use .xlsx, .xls o .csv"}), 400

    tipo_fuente = request.form.get("tipo_fuente", "")
    anio  = int(request.form.get("anio", 0))
    mes   = int(request.form.get("mes", 0))
    or_id = request.form.get("or_id") or None

    if not tipo_fuente or not anio or not mes:
        return jsonify({"error": "Faltan parámetros (tipo_fuente, anio, mes)."}), 400

    # Verificar si ya existe una carga para este período/fuente/OR
    periodo = PeriodoConciliacion.query.filter_by(anio=anio, mes=mes).first()
    existe_previa = False
    carga_previa_id = None

    if periodo:
        q = CargaFuente.query.filter_by(
            periodo_id=periodo.id,
            tipo_fuente=TipoFuente(tipo_fuente),
            estado=EstadoCarga.COMPLETADA,
        )
        if or_id:
            q = q.filter_by(or_id=or_id)
        carga_previa = q.first()
        if carga_previa:
            existe_previa = True
            carga_previa_id = carga_previa.id

    # Leer el archivo en memoria
    buffer = archivo.read()

    # Obtener mapeo SDL/BALANCE si aplica
    mapeo = None
    if or_id and tipo_fuente in ("SDL", "BALANCE"):
        or_config = db.session.get(ConfiguracionOR, or_id)
        if or_config:
            key = "mapeo_sdl_json" if tipo_fuente == "SDL" else "mapeo_balance_json"
            mapeo = getattr(or_config, key)

    # Parsear
    try:
        result = parsear_archivo(
            buffer=buffer,
            tipo_fuente=tipo_fuente,
            periodo=f"{anio}-{mes:02d}",
            periodo_id=periodo.id if periodo else None,
            or_id=or_id,
            anio=anio,
            mes=mes,
            mapeo=mapeo,
        )
    except Exception as exc:
        return jsonify({"error": f"Error al parsear el archivo: {exc}"}), 500

    return jsonify({
        "preview":         result["filas"][:20],
        "total":           len(result["filas"]),
        "alertas":         result["alertas"],
        "erroresCriticos": result["errores_criticos"],
        "existeCargaPrevia": existe_previa,
        "cargaPreviaId":    carga_previa_id,
    })


# ── API: confirmar carga ────────────────────────────────────────────────────────

@bp.route("/api/confirmar", methods=["POST"])
@login_required
def api_confirmar():
    """Guarda definitivamente los registros en la BD."""
    body = request.get_json(force=True) or {}

    anio        = int(body.get("anio", 0))
    mes         = int(body.get("mes", 0))
    tipo_fuente = body.get("tipo_fuente", "")
    or_id       = body.get("or_id") or None
    nombre_arch = body.get("nombre_archivo", "archivo")
    filas       = body.get("filas", [])
    justificacion = body.get("justificacion") or None
    reemplaza_id  = body.get("reemplaza_id") or None

    if not filas:
        return jsonify({"error": "No hay filas para guardar."}), 400

    # Crear o encontrar período
    periodo = PeriodoConciliacion.query.filter_by(anio=anio, mes=mes).first()
    if not periodo:
        periodo = PeriodoConciliacion(
            anio=anio,
            mes=mes,
            creado_por_id=current_user.id,
        )
        db.session.add(periodo)
        db.session.flush()

    # Crear registro de carga
    carga = CargaFuente(
        periodo_id=periodo.id,
        tipo_fuente=TipoFuente(tipo_fuente),
        or_id=or_id,
        nombre_archivo=nombre_arch,
        estado=EstadoCarga.PROCESANDO,
        total_registros=len(filas),
        justificacion_reemplazo=justificacion,
        reemplaza_id=reemplaza_id,
        cargado_por_id=current_user.id,
    )
    db.session.add(carga)
    db.session.flush()

    try:
        _guardar_registros(carga, periodo, tipo_fuente, or_id, filas)
        carga.estado             = EstadoCarga.COMPLETADA
        carga.registros_procesados = len(filas)
        carga.registros_error      = 0

        # Auditoría
        log = LogAuditoria(
            usuario_id=current_user.id,
            accion=AccionAuditoria.CARGAR_FUENTE if not reemplaza_id else AccionAuditoria.REEMPLAZAR_FUENTE,
            entidad="cargas_fuente",
            entidad_id=carga.id,
            detalle={"tipo_fuente": tipo_fuente, "total": len(filas)},
            ip=request.remote_addr,
        )
        db.session.add(log)
        db.session.commit()

    except Exception as exc:
        db.session.rollback()
        carga.estado        = EstadoCarga.ERROR
        carga.mensaje_error = str(exc)
        db.session.commit()
        return jsonify({"error": f"Error al guardar: {exc}"}), 500

    return jsonify({"ok": True, "carga_id": carga.id})


def _guardar_registros(
    carga: CargaFuente,
    periodo: PeriodoConciliacion,
    tipo_fuente: str,
    or_id: Optional[str],
    filas: list[dict],
) -> None:
    """Inserta los registros en la tabla correspondiente."""
    if tipo_fuente == "FACTURACION":
        for f in filas:
            db.session.add(RegistroFacturacion(
                carga_id=carga.id,
                periodo_id=periodo.id,
                codigo_frontera=f["codigo_frontera"],
                nombre_usuario=f["nombre_usuario"],
                operador_red=f["operador_red"],
                energia_kwh=f["energia_kwh"],
                g_bia=f["g_bia"],
                t_bia=f["t_bia"],
                d_bia=f["d_bia"],
                pr_bia=f["pr_bia"],
                r_bia=f["r_bia"],
                c_bia=f["c_bia"],
                tarifa_total_bia=f["tarifa_total_bia"],
            ))

    elif tipo_fuente == "XM":
        for f in filas:
            db.session.add(RegistroXM(
                carga_id=carga.id,
                periodo_id=periodo.id,
                codigo_frontera=f["codigo_frontera"],
                nombre_frontera=f.get("nombre_frontera"),
                energia_xm_kwh=f["energia_xm_kwh"],
            ))

    elif tipo_fuente == "SDL":
        for f in filas:
            db.session.add(RegistroSDL(
                carga_id=carga.id,
                periodo_id=periodo.id,
                or_id=or_id,
                codigo_frontera=f["codigo_frontera"],
                nombre_frontera=f.get("nombre_frontera"),
                periodo_sdl=f["periodo_sdl"],
                energia_sdl_kwh=f["energia_sdl_kwh"],
                valor_sdl_cop=f["valor_sdl_cop"],
                tarifa_sdl=f["tarifa_sdl"],
                nivel_tension=f.get("nivel_tension"),
                propiedad_activos=f.get("propiedad_activos"),
                es_duplicado=f.get("es_duplicado", False),
            ))

    elif tipo_fuente == "TC1":
        for f in filas:
            db.session.add(RegistroTC1(
                carga_id=carga.id,
                periodo_id=periodo.id,
                codigo_frontera=f["codigo_frontera"],
                niu=f.get("niu"),
                nivel_tension=f.get("nivel_tension"),
                nivel_tension_primario=f.get("nivel_tension_primario"),
                pct_propiedad_activo=f.get("pct_propiedad_activo"),
                tipo_conexion=f.get("tipo_conexion"),
                conexion_red=f.get("conexion_red"),
                id_comercializador=f.get("id_comercializador"),
            ))

    elif tipo_fuente == "BALANCE":
        for f in filas:
            db.session.add(RegistroBalance(
                carga_id=carga.id,
                or_id=or_id,
                codigo_frontera=f["codigo_frontera"],
                periodo_ajuste=f["periodo_ajuste"],
                energia_balance_kwh=f["energia_balance_kwh"],
                valor_balance_cop=f["valor_balance_cop"],
                tarifa_balance=f["tarifa_balance"],
                periodo_tarifa=f["periodo_tarifa"],
            ))


# ── API: estado de período ────────────────────────────────────────────────────

@bp.route("/api/estado-periodo")
@login_required
def api_estado_periodo():
    anio = int(request.args.get("anio", 0))
    mes  = int(request.args.get("mes", 0))
    if not anio or not mes:
        return jsonify({}), 400

    periodo = PeriodoConciliacion.query.filter_by(anio=anio, mes=mes).first()
    if not periodo:
        return jsonify({"existe": False})

    cargas = CargaFuente.query.filter_by(
        periodo_id=periodo.id,
        estado=EstadoCarga.COMPLETADA,
    ).all()

    fuentes_cargadas = {c.tipo_fuente.value for c in cargas}
    return jsonify({
        "existe":          True,
        "estado":          periodo.estado.value,
        "fuentes_cargadas": list(fuentes_cargadas),
    })
