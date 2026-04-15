"""
Factory de la aplicación Flask — App Conciliación SDLs
"""
import os
from flask import Flask
from flask_login import LoginManager
from .models import db, User

# En serverless (Vercel) cada request es un proceso nuevo — NullPool evita
# conexiones "huérfanas" y es compatible con pgBouncer de Supabase.
_SERVERLESS = bool(os.getenv("VERCEL"))


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")

    # ── Configuración ──────────────────────────────────────────────────────────
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-me")
    app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv("DATABASE_URL", "")
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    if _SERVERLESS:
        from sqlalchemy.pool import NullPool
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
            "pool_pre_ping": True,
            "poolclass": NullPool,
        }
    else:
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
            "pool_pre_ping": True,
            "pool_recycle": 300,
        }
    app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024  # 32 MB para uploads

    # ── Base de datos ──────────────────────────────────────────────────────────
    db.init_app(app)

    # ── Flask-Login ────────────────────────────────────────────────────────────
    login_manager = LoginManager(app)
    login_manager.login_view = "auth.login"  # type: ignore[assignment]
    login_manager.login_message = "Por favor inicia sesión para continuar."
    login_manager.login_message_category = "info"

    @login_manager.user_loader
    def load_user(user_id: str):
        return db.session.get(User, user_id)

    # ── Blueprints ─────────────────────────────────────────────────────────────
    from .routes.auth           import bp as auth_bp
    from .routes.dashboard      import bp as dashboard_bp
    from .routes.cargas         import bp as cargas_bp
    from .routes.conciliaciones import bp as conciliaciones_bp
    from .routes.gestiones      import bp as gestiones_bp
    from .routes.fronteras      import bp as fronteras_bp
    from .routes.reportes       import bp as reportes_bp
    from .routes.administracion import bp as administracion_bp
    from .routes.operadores     import bp as operadores_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(cargas_bp)
    app.register_blueprint(conciliaciones_bp)
    app.register_blueprint(gestiones_bp)
    app.register_blueprint(fronteras_bp)
    app.register_blueprint(reportes_bp)
    app.register_blueprint(administracion_bp)
    app.register_blueprint(operadores_bp)

    return app
