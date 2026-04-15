"""Administración — solo ADMINISTRADOR."""
from flask import Blueprint, render_template, abort
from flask_login import login_required, current_user

bp = Blueprint("administracion", __name__, url_prefix="/administracion")


@bp.route("/")
@login_required
def index():
    if current_user.rol.value != "ADMINISTRADOR":
        abort(403)
    return render_template("administracion/index.html")
