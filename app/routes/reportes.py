"""Reportes — placeholder."""
from flask import Blueprint, render_template
from flask_login import login_required

bp = Blueprint("reportes", __name__, url_prefix="/reportes")


@bp.route("/")
@login_required
def index():
    return render_template("reportes/index.html")
