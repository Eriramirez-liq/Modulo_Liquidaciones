"""
Autenticación — Flask-Login con bcrypt (equivalente a NextAuth + bcryptjs)
"""
from typing import Optional
from flask import Blueprint, render_template, redirect, url_for, request, flash
from flask_login import login_user, logout_user, login_required, current_user
import bcrypt

from ..models import db, User, AccionAuditoria, LogAuditoria

bp = Blueprint("auth", __name__)


def _log(usuario_id: str, accion: AccionAuditoria, ip: Optional[str] = None) -> None:
    """Escribe una entrada en el log de auditoría."""
    entrada = LogAuditoria(
        usuario_id=usuario_id,
        accion=accion,
        entidad="users",
        entidad_id=usuario_id,
        ip=ip,
    )
    db.session.add(entrada)
    db.session.commit()


@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("dashboard.index"))

    if request.method == "POST":
        email    = (request.form.get("email") or "").strip().lower()
        password = request.form.get("password") or ""

        if not email or not password:
            flash("Ingresa tu correo y contraseña.", "error")
            return render_template("auth/login.html")

        user = User.query.filter_by(email=email).first()

        if not user or not user.activo:
            flash("Correo o contraseña incorrectos.", "error")
            return render_template("auth/login.html")

        password_valida = bcrypt.checkpw(
            password.encode("utf-8"),
            user.password.encode("utf-8"),
        )

        if not password_valida:
            flash("Correo o contraseña incorrectos.", "error")
            return render_template("auth/login.html")

        login_user(user, remember=False)
        _log(user.id, AccionAuditoria.LOGIN, ip=request.remote_addr)

        next_page = request.args.get("next")
        return redirect(next_page or url_for("dashboard.index"))

    return render_template("auth/login.html")


@bp.route("/logout")
@login_required
def logout():
    _log(current_user.id, AccionAuditoria.LOGOUT, ip=request.remote_addr)
    logout_user()
    return redirect(url_for("auth.login"))
