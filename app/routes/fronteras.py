"""Fronteras — placeholder."""
from flask import Blueprint, render_template
from flask_login import login_required

bp = Blueprint("fronteras", __name__, url_prefix="/fronteras")


@bp.route("/")
@login_required
def index():
    return render_template("fronteras/index.html")
