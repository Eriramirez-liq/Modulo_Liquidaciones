"""
Modelos SQLAlchemy — port del schema.prisma de Prisma a SQLAlchemy
Proyecto: App Conciliación SDLs — BIA Energy
"""
from __future__ import annotations

import enum
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from cuid2 import cuid_wrapper

db = SQLAlchemy()

# Generador de IDs únicos (equivalente a cuid() de Prisma)
_cuid_gen = cuid_wrapper()


def _cuid() -> str:
    """Genera un ID único tipo CUID, similar a cuid() de Prisma."""
    return _cuid_gen()


# ─── Enums ────────────────────────────────────────────────────────────────────

class Rol(str, enum.Enum):
    ANALISTA      = "ANALISTA"
    ADMINISTRADOR = "ADMINISTRADOR"


class TipoFuente(str, enum.Enum):
    FACTURACION = "FACTURACION"
    XM          = "XM"
    SDL         = "SDL"
    BALANCE     = "BALANCE"
    TC1         = "TC1"
    COT         = "COT"


class EstadoCarga(str, enum.Enum):
    PENDIENTE   = "PENDIENTE"
    PROCESANDO  = "PROCESANDO"
    COMPLETADA  = "COMPLETADA"
    ERROR       = "ERROR"


class EstadoPeriodo(str, enum.Enum):
    ABIERTO    = "ABIERTO"
    EN_PROCESO = "EN_PROCESO"
    CERRADO    = "CERRADO"
    ANULADO    = "ANULADO"


class CasoConciliacion(str, enum.Enum):
    A1         = "A1"
    B1         = "B1"
    B2         = "B2"
    C1         = "C1"
    C2         = "C2"
    D1         = "D1"
    D2         = "D2"
    D3         = "D3"
    D4         = "D4"
    INCOMPLETA = "INCOMPLETA"
    ERROR      = "ERROR"


class ResultadoLinea(str, enum.Enum):
    SIN_DIFERENCIA      = "SIN_DIFERENCIA"
    CONTINGENCIA_L1     = "CONTINGENCIA_L1"
    PROVISION_L1        = "PROVISION_L1"
    PROVISION_L2        = "PROVISION_L2"
    DISPUTA_L2          = "DISPUTA_L2"
    PROVISION_COMBINADA = "PROVISION_COMBINADA"
    ALERTA_MANUAL       = "ALERTA_MANUAL"
    INCOMPLETA          = "INCOMPLETA"


class TipoProvision(str, enum.Enum):
    L1        = "L1"
    D3        = "D3"
    COMBINADA = "COMBINADA"


class EstadoProvision(str, enum.Enum):
    PENDIENTE       = "PENDIENTE"
    CRUZADO_PARCIAL = "CRUZADO_PARCIAL"
    CRUZADO_TOTAL   = "CRUZADO_TOTAL"


class EstadoContingencia(str, enum.Enum):
    PENDIENTE = "PENDIENTE"
    COBRADO   = "COBRADO"
    CERRADO   = "CERRADO"


class ResultadoContingencia(str, enum.Enum):
    PENDIENTE       = "PENDIENTE"
    PERDIDA_REPORTE = "PERDIDA_REPORTE"
    GANANCIA_REAL   = "GANANCIA_REAL"
    PERDIDA_REAL    = "PERDIDA_REAL"


class TipoResultadoCruce(str, enum.Enum):
    INGRESO = "INGRESO"
    COSTO   = "COSTO"
    EXACTO  = "EXACTO"


class EstadoDisputa(str, enum.Enum):
    ABIERTA           = "ABIERTA"
    EN_GESTION        = "EN_GESTION"
    RESUELTA          = "RESUELTA"
    CERRADA_SIN_AJUSTE = "CERRADA_SIN_AJUSTE"


class AccionAuditoria(str, enum.Enum):
    LOGIN                 = "LOGIN"
    LOGOUT                = "LOGOUT"
    CARGAR_FUENTE         = "CARGAR_FUENTE"
    REEMPLAZAR_FUENTE     = "REEMPLAZAR_FUENTE"
    EJECUTAR_CONCILIACION = "EJECUTAR_CONCILIACION"
    CREAR_PROVISION       = "CREAR_PROVISION"
    ACTUALIZAR_PROVISION  = "ACTUALIZAR_PROVISION"
    CREAR_CONTINGENCIA    = "CREAR_CONTINGENCIA"
    ACTUALIZAR_CONTINGENCIA = "ACTUALIZAR_CONTINGENCIA"
    REGISTRAR_CRUCE       = "REGISTRAR_CRUCE"
    CREAR_DISPUTA         = "CREAR_DISPUTA"
    ACTUALIZAR_DISPUTA    = "ACTUALIZAR_DISPUTA"
    EXPORTAR_REPORTE      = "EXPORTAR_REPORTE"
    CAMBIAR_CONFIGURACION = "CAMBIAR_CONFIGURACION"
    CREAR_USUARIO         = "CREAR_USUARIO"
    ACTUALIZAR_USUARIO    = "ACTUALIZAR_USUARIO"


# ─── Modelos ──────────────────────────────────────────────────────────────────

class User(db.Model, UserMixin):
    """Usuario del sistema (analista o administrador)."""
    __tablename__ = "users"

    id         = db.Column(db.String(25), primary_key=True, default=_cuid)
    nombre     = db.Column(db.String(255), nullable=False)
    email      = db.Column(db.String(255), unique=True, nullable=False)
    password   = db.Column(db.String(255), nullable=False)
    rol        = db.Column(db.Enum(Rol), nullable=False, default=Rol.ANALISTA)
    activo     = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column("updatedAt", db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relaciones
    periodos_creados      = db.relationship("PeriodoConciliacion", foreign_keys="PeriodoConciliacion.creado_por_id", back_populates="creado_por")
    periodos_cerrados     = db.relationship("PeriodoConciliacion", foreign_keys="PeriodoConciliacion.cerrado_por_id", back_populates="cerrado_por")
    cargas                = db.relationship("CargaFuente", back_populates="cargado_por")
    conciliaciones        = db.relationship("ResultadoConciliacion", back_populates="conciliado_por")
    provisiones_creadas   = db.relationship("Provision", foreign_keys="Provision.creado_por_id", back_populates="creado_por")
    contingencias_creadas = db.relationship("Contingencia", foreign_keys="Contingencia.creado_por_id", back_populates="creado_por")
    cruces_registrados    = db.relationship("CruceBalance", back_populates="registrado_por")
    disputas_abiertas     = db.relationship("Disputa", foreign_keys="Disputa.abierta_por_id", back_populates="abierta_por")
    disputas_cerradas     = db.relationship("Disputa", foreign_keys="Disputa.cerrada_por_id", back_populates="cerrada_por")
    log_auditoria         = db.relationship("LogAuditoria", back_populates="usuario")

    def get_id(self) -> str:  # Flask-Login
        return self.id

    def __repr__(self) -> str:
        return f"<User {self.email} [{self.rol.value}]>"


class PeriodoConciliacion(db.Model):
    __tablename__ = "periodos_conciliacion"

    id             = db.Column(db.String(25), primary_key=True, default=_cuid)
    anio           = db.Column(db.Integer, nullable=False)
    mes            = db.Column(db.Integer, nullable=False)  # 1-12
    estado         = db.Column(db.Enum(EstadoPeriodo), nullable=False, default=EstadoPeriodo.ABIERTO)
    fecha_cierre   = db.Column(db.DateTime, nullable=True)
    cerrado_por_id = db.Column(db.String(25), db.ForeignKey("users.id"), nullable=True)
    creado_por_id  = db.Column(db.String(25), db.ForeignKey("users.id"), nullable=False)
    created_at     = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at     = db.Column("updatedAt", db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    cerrado_por  = db.relationship("User", foreign_keys=[cerrado_por_id], back_populates="periodos_cerrados")
    creado_por   = db.relationship("User", foreign_keys=[creado_por_id], back_populates="periodos_creados")
    cargas       = db.relationship("CargaFuente", back_populates="periodo")
    resultados   = db.relationship("ResultadoConciliacion", back_populates="periodo")
    provisiones  = db.relationship("Provision", back_populates="periodo")
    contingencias = db.relationship("Contingencia", back_populates="periodo")
    disputas     = db.relationship("Disputa", back_populates="periodo")

    __table_args__ = (db.UniqueConstraint("anio", "mes", name="uq_periodo_anio_mes"),)

    def __repr__(self) -> str:
        return f"<Periodo {self.anio}-{self.mes:02d} [{self.estado.value}]>"


class ConfiguracionOR(db.Model):
    """Configuración de Operador de Red."""
    __tablename__ = "configuracion_or"

    id                 = db.Column(db.String(25), primary_key=True, default=_cuid)
    codigo             = db.Column(db.String(50), unique=True, nullable=False)
    nombre             = db.Column(db.String(255), nullable=False)
    nit                = db.Column(db.String(50), nullable=True)
    email_contacto     = db.Column(db.String(255), nullable=True)
    telefono_contacto  = db.Column(db.String(50), nullable=True)
    activo             = db.Column(db.Boolean, nullable=False, default=True)
    mapeo_sdl_json     = db.Column(db.JSON, nullable=True)
    mapeo_balance_json = db.Column(db.JSON, nullable=True)
    created_at         = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at         = db.Column("updatedAt", db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    cargas            = db.relationship("CargaFuente", back_populates="operador_red")
    registros_sdl     = db.relationship("RegistroSDL", back_populates="operador_red")
    registros_balance = db.relationship("RegistroBalance", back_populates="operador_red")
    resultados        = db.relationship("ResultadoConciliacion", back_populates="or_obj")
    provisiones       = db.relationship("Provision", back_populates="operador_red")
    contingencias     = db.relationship("Contingencia", back_populates="operador_red")
    disputas          = db.relationship("Disputa", back_populates="operador_red")

    def __repr__(self) -> str:
        return f"<OR {self.codigo}>"


class CargaFuente(db.Model):
    __tablename__ = "cargas_fuente"

    id                      = db.Column(db.String(25), primary_key=True, default=_cuid)
    periodo_id              = db.Column(db.String(25), db.ForeignKey("periodos_conciliacion.id"), nullable=False)
    tipo_fuente             = db.Column(db.Enum(TipoFuente), nullable=False)
    or_id                   = db.Column(db.String(25), db.ForeignKey("configuracion_or.id"), nullable=True)
    nombre_archivo          = db.Column(db.String(500), nullable=False)
    estado                  = db.Column(db.Enum(EstadoCarga), nullable=False, default=EstadoCarga.PENDIENTE)
    total_registros         = db.Column(db.Integer, nullable=True)
    registros_procesados    = db.Column(db.Integer, nullable=True)
    registros_error         = db.Column(db.Integer, nullable=True)
    mensaje_error           = db.Column(db.Text, nullable=True)
    justificacion_reemplazo = db.Column(db.Text, nullable=True)
    reemplaza_id            = db.Column(db.String(25), db.ForeignKey("cargas_fuente.id"), nullable=True)
    cargado_por_id          = db.Column(db.String(25), db.ForeignKey("users.id"), nullable=False)
    created_at              = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at              = db.Column("updatedAt", db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    periodo              = db.relationship("PeriodoConciliacion", back_populates="cargas")
    operador_red         = db.relationship("ConfiguracionOR", back_populates="cargas")
    cargado_por          = db.relationship("User", back_populates="cargas")
    reemplaza            = db.relationship("CargaFuente", remote_side="CargaFuente.id", foreign_keys=[reemplaza_id])
    registros_facturacion = db.relationship("RegistroFacturacion", back_populates="carga")
    registros_xm         = db.relationship("RegistroXM", back_populates="carga")
    registros_sdl        = db.relationship("RegistroSDL", back_populates="carga")
    registros_tc1        = db.relationship("RegistroTC1", back_populates="carga")
    registros_balance    = db.relationship("RegistroBalance", back_populates="carga")
    registros_cot        = db.relationship("RegistroCOT", back_populates="carga")

    __table_args__ = (
        db.Index("idx_carga_periodo_tipo", "periodo_id", "tipo_fuente"),
    )


class RegistroFacturacion(db.Model):
    __tablename__ = "registros_facturacion"

    id               = db.Column(db.String(25), primary_key=True, default=_cuid)
    carga_id         = db.Column(db.String(25), db.ForeignKey("cargas_fuente.id"), nullable=False)
    periodo_id       = db.Column(db.String(25), nullable=False)
    codigo_frontera  = db.Column(db.String(100), nullable=False)
    nombre_usuario   = db.Column(db.String(255), nullable=False)
    operador_red     = db.Column(db.String(100), nullable=False)
    energia_kwh      = db.Column(db.Numeric(18, 6), nullable=False)
    g_bia            = db.Column(db.Numeric(18, 6), nullable=False)
    t_bia            = db.Column(db.Numeric(18, 6), nullable=False)
    d_bia            = db.Column(db.Numeric(18, 6), nullable=False)
    pr_bia           = db.Column(db.Numeric(18, 6), nullable=False)
    r_bia            = db.Column(db.Numeric(18, 6), nullable=False)
    c_bia            = db.Column(db.Numeric(18, 6), nullable=False)
    tarifa_total_bia = db.Column(db.Numeric(18, 6), nullable=False)
    created_at       = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)

    carga = db.relationship("CargaFuente", back_populates="registros_facturacion")

    __table_args__ = (
        db.UniqueConstraint("carga_id", "codigo_frontera", name="uq_fac_carga_frontera"),
        db.Index("idx_fac_periodo_frontera", "periodo_id", "codigo_frontera"),
    )


class RegistroXM(db.Model):
    __tablename__ = "registros_xm"

    id              = db.Column(db.String(25), primary_key=True, default=_cuid)
    carga_id        = db.Column(db.String(25), db.ForeignKey("cargas_fuente.id"), nullable=False)
    periodo_id      = db.Column(db.String(25), nullable=False)
    codigo_frontera = db.Column(db.String(100), nullable=False)
    nombre_frontera = db.Column(db.String(255), nullable=True)
    energia_xm_kwh  = db.Column(db.Numeric(18, 6), nullable=False)
    created_at      = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)

    carga = db.relationship("CargaFuente", back_populates="registros_xm")

    __table_args__ = (
        db.UniqueConstraint("carga_id", "codigo_frontera", name="uq_xm_carga_frontera"),
        db.Index("idx_xm_periodo_frontera", "periodo_id", "codigo_frontera"),
    )


class RegistroSDL(db.Model):
    __tablename__ = "registros_sdl"

    id                = db.Column(db.String(25), primary_key=True, default=_cuid)
    carga_id          = db.Column(db.String(25), db.ForeignKey("cargas_fuente.id"), nullable=False)
    periodo_id        = db.Column(db.String(25), nullable=False)
    or_id             = db.Column(db.String(25), db.ForeignKey("configuracion_or.id"), nullable=False)
    codigo_frontera   = db.Column(db.String(100), nullable=False)
    nombre_frontera   = db.Column(db.String(255), nullable=True)
    periodo_sdl       = db.Column(db.String(7), nullable=False)  # AAAA-MM
    energia_sdl_kwh              = db.Column(db.Numeric(18, 6), nullable=False)
    valor_sdl_cop                = db.Column(db.Numeric(18, 2), nullable=False)
    tarifa_sdl                   = db.Column(db.Numeric(18, 6), nullable=False)
    nivel_tension                = db.Column(db.String(50), nullable=True)
    propiedad_activos            = db.Column(db.String(100), nullable=True)
    energia_reactiva_ind_pen     = db.Column(db.Numeric(18, 6), nullable=True)  # kWh
    energia_reactiva_cap_pen     = db.Column(db.Numeric(18, 6), nullable=True)  # kWh
    valor_reactiva_cop           = db.Column(db.Numeric(18, 2), nullable=True)
    tarifa_reactiva              = db.Column(db.Numeric(18, 6), nullable=True)
    factor_m                     = db.Column(db.Numeric(10, 4), nullable=True)
    es_duplicado                 = db.Column(db.Boolean, nullable=False, default=False)
    created_at        = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)

    carga        = db.relationship("CargaFuente", back_populates="registros_sdl")
    operador_red = db.relationship("ConfiguracionOR", back_populates="registros_sdl")

    __table_args__ = (
        # Sin unique constraint: se permiten duplicados de frontera (marcados con es_duplicado=True)
        db.Index("idx_sdl_periodo_frontera", "periodo_id", "codigo_frontera"),
        db.Index("idx_sdl_or", "or_id"),
    )


class RegistroTC1(db.Model):
    """Datos de configuración técnica de conexión por frontera (archivo TC1 de XM/SUI)."""
    __tablename__ = "registros_tc1"

    id                      = db.Column(db.String(25), primary_key=True, default=_cuid)
    carga_id                = db.Column(db.String(25), db.ForeignKey("cargas_fuente.id"), nullable=False)
    periodo_id              = db.Column(db.String(25), nullable=False)
    codigo_frontera         = db.Column(db.String(100), nullable=False)
    niu                     = db.Column(db.String(50), nullable=True)
    nivel_tension           = db.Column(db.String(10), nullable=True)   # 1, 2, 3, 4
    nivel_tension_primario  = db.Column(db.String(10), nullable=True)
    pct_propiedad_activo    = db.Column(db.String(10), nullable=True)   # 0, 100, o parcial
    tipo_conexion           = db.Column(db.String(10), nullable=True)
    conexion_red            = db.Column(db.String(10), nullable=True)
    id_comercializador      = db.Column(db.String(20), nullable=True)
    created_at              = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)

    carga = db.relationship("CargaFuente", back_populates="registros_tc1")

    __table_args__ = (
        db.Index("idx_tc1_periodo_frontera", "periodo_id", "codigo_frontera"),
        db.Index("idx_tc1_carga", "carga_id"),
    )


class RegistroBalance(db.Model):
    __tablename__ = "registros_balance"

    id                  = db.Column(db.String(25), primary_key=True, default=_cuid)
    carga_id            = db.Column(db.String(25), db.ForeignKey("cargas_fuente.id"), nullable=False)
    or_id               = db.Column(db.String(25), db.ForeignKey("configuracion_or.id"), nullable=False)
    codigo_frontera     = db.Column(db.String(100), nullable=False)
    periodo_ajuste      = db.Column(db.String(7), nullable=False)  # AAAA-MM
    energia_balance_kwh = db.Column(db.Numeric(18, 6), nullable=False)
    valor_balance_cop   = db.Column(db.Numeric(18, 2), nullable=False)
    tarifa_balance      = db.Column(db.Numeric(18, 6), nullable=False)
    periodo_tarifa      = db.Column(db.String(7), nullable=False)  # AAAA-MM
    created_at          = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)

    carga        = db.relationship("CargaFuente", back_populates="registros_balance")
    operador_red = db.relationship("ConfiguracionOR", back_populates="registros_balance")
    cruces       = db.relationship("CruceBalance", back_populates="registro_balance")

    __table_args__ = (
        db.Index("idx_balance_carga", "carga_id"),
        db.Index("idx_balance_or_periodo", "or_id", "periodo_ajuste"),
        db.Index("idx_balance_frontera", "codigo_frontera"),
    )


class RegistroCOT(db.Model):
    """Cargo por Otros Trámites — archivo complementario al SDL enviado por el OR."""
    __tablename__ = "registros_cot"

    id              = db.Column(db.String(25), primary_key=True, default=_cuid)
    carga_id        = db.Column(db.String(25), db.ForeignKey("cargas_fuente.id"), nullable=False)
    periodo_id      = db.Column(db.String(25), nullable=False)
    or_id           = db.Column(db.String(25), db.ForeignKey("configuracion_or.id"), nullable=True)
    codigo_frontera = db.Column(db.String(100), nullable=False)
    nombre_frontera = db.Column(db.String(255), nullable=True)
    periodo_cot     = db.Column(db.String(7), nullable=True)   # AAAA-MM
    valor_cot_cop   = db.Column(db.Numeric(18, 2), nullable=True)
    tarifa_cot      = db.Column(db.Numeric(18, 6), nullable=True)
    created_at      = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)

    carga = db.relationship("CargaFuente", back_populates="registros_cot")

    __table_args__ = (
        db.Index("idx_cot_periodo_frontera", "periodo_id", "codigo_frontera"),
        db.Index("idx_cot_or", "or_id"),
    )


class ResultadoConciliacion(db.Model):
    __tablename__ = "resultados_conciliacion"

    id                    = db.Column(db.String(25), primary_key=True, default=_cuid)
    periodo_id            = db.Column(db.String(25), db.ForeignKey("periodos_conciliacion.id"), nullable=False)
    codigo_frontera       = db.Column(db.String(100), nullable=False)
    nombre_usuario        = db.Column(db.String(255), nullable=True)
    operador_red          = db.Column(db.String(100), nullable=True)
    or_id                 = db.Column(db.String(25), db.ForeignKey("configuracion_or.id"), nullable=True)
    e_fac                 = db.Column(db.Numeric(18, 6), nullable=True)
    e_xm                  = db.Column(db.Numeric(18, 6), nullable=True)
    e_sdl                 = db.Column(db.Numeric(18, 6), nullable=True)
    delta_l1              = db.Column(db.Numeric(18, 6), nullable=True)
    delta_l2              = db.Column(db.Numeric(18, 6), nullable=True)
    caso                  = db.Column(db.Enum(CasoConciliacion), nullable=False)
    resultado_l1          = db.Column(db.Enum(ResultadoLinea), nullable=True)
    resultado_l2          = db.Column(db.Enum(ResultadoLinea), nullable=True)
    impacto_financiero_l1 = db.Column(db.Numeric(18, 2), nullable=True)
    impacto_financiero_l2 = db.Column(db.Numeric(18, 2), nullable=True)
    requiere_alerta_manual = db.Column(db.Boolean, nullable=False, default=False)
    observaciones         = db.Column(db.Text, nullable=True)
    conciliado_por_id     = db.Column(db.String(25), db.ForeignKey("users.id"), nullable=True)
    conciliado_at         = db.Column(db.DateTime, nullable=True)
    created_at            = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at            = db.Column("updatedAt", db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    periodo        = db.relationship("PeriodoConciliacion", back_populates="resultados")
    or_obj         = db.relationship("ConfiguracionOR", back_populates="resultados")
    conciliado_por = db.relationship("User", back_populates="conciliaciones")
    provisiones    = db.relationship("Provision", back_populates="resultado")
    contingencias  = db.relationship("Contingencia", back_populates="resultado")
    disputas       = db.relationship("Disputa", back_populates="resultado")

    __table_args__ = (
        db.UniqueConstraint("periodo_id", "codigo_frontera", name="uq_resultado_periodo_frontera"),
        db.Index("idx_resultado_periodo_caso", "periodo_id", "caso"),
        db.Index("idx_resultado_or", "or_id"),
    )


class Provision(db.Model):
    __tablename__ = "provisiones"

    id                     = db.Column(db.String(25), primary_key=True, default=_cuid)
    resultado_id           = db.Column(db.String(25), db.ForeignKey("resultados_conciliacion.id"), nullable=False)
    periodo_id             = db.Column(db.String(25), db.ForeignKey("periodos_conciliacion.id"), nullable=False)
    codigo_frontera        = db.Column(db.String(100), nullable=False)
    or_id                  = db.Column(db.String(25), db.ForeignKey("configuracion_or.id"), nullable=True)
    tipo                   = db.Column(db.Enum(TipoProvision), nullable=False)
    energia_kwh            = db.Column(db.Numeric(18, 6), nullable=False)
    valor_provisionado_cop = db.Column(db.Numeric(18, 2), nullable=False)
    componentes_json       = db.Column(db.JSON, nullable=True)
    estado                 = db.Column(db.Enum(EstadoProvision), nullable=False, default=EstadoProvision.PENDIENTE)
    fecha_cierre           = db.Column(db.DateTime, nullable=True)
    creado_por_id          = db.Column(db.String(25), db.ForeignKey("users.id"), nullable=False)
    created_at             = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at             = db.Column("updatedAt", db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    resultado    = db.relationship("ResultadoConciliacion", back_populates="provisiones")
    periodo      = db.relationship("PeriodoConciliacion", back_populates="provisiones")
    operador_red = db.relationship("ConfiguracionOR", back_populates="provisiones")
    creado_por   = db.relationship("User", foreign_keys=[creado_por_id], back_populates="provisiones_creadas")
    cruces       = db.relationship("CruceBalance", back_populates="provision")

    __table_args__ = (
        db.Index("idx_provision_periodo_estado", "periodo_id", "estado"),
        db.Index("idx_provision_or", "or_id"),
    )


class Contingencia(db.Model):
    __tablename__ = "contingencias"

    id                        = db.Column(db.String(25), primary_key=True, default=_cuid)
    resultado_id              = db.Column(db.String(25), db.ForeignKey("resultados_conciliacion.id"), nullable=False)
    periodo_id                = db.Column(db.String(25), db.ForeignKey("periodos_conciliacion.id"), nullable=False)
    codigo_frontera           = db.Column(db.String(100), nullable=False)
    or_id                     = db.Column(db.String(25), db.ForeignKey("configuracion_or.id"), nullable=True)
    energia_kwh               = db.Column(db.Numeric(18, 6), nullable=False)
    costo_calculado_cop       = db.Column(db.Numeric(18, 2), nullable=True)
    refacturacion_cliente_cop = db.Column(db.Numeric(18, 2), nullable=True)
    costo_neto_cop            = db.Column(db.Numeric(18, 2), nullable=True)
    estado                    = db.Column(db.Enum(EstadoContingencia), nullable=False, default=EstadoContingencia.PENDIENTE)
    resultado_tipo            = db.Column(db.Enum(ResultadoContingencia), nullable=False, default=ResultadoContingencia.PENDIENTE)
    descripcion               = db.Column(db.Text, nullable=True)
    fecha_cobro               = db.Column(db.DateTime, nullable=True)
    fecha_cierre              = db.Column(db.DateTime, nullable=True)
    creado_por_id             = db.Column(db.String(25), db.ForeignKey("users.id"), nullable=False)
    created_at                = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at                = db.Column("updatedAt", db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    resultado    = db.relationship("ResultadoConciliacion", back_populates="contingencias")
    periodo      = db.relationship("PeriodoConciliacion", back_populates="contingencias")
    operador_red = db.relationship("ConfiguracionOR", back_populates="contingencias")
    creado_por   = db.relationship("User", foreign_keys=[creado_por_id], back_populates="contingencias_creadas")
    cruces       = db.relationship("CruceBalance", back_populates="contingencia")

    __table_args__ = (
        db.Index("idx_contingencia_periodo_estado", "periodo_id", "estado"),
        db.Index("idx_contingencia_or", "or_id"),
    )


class CruceBalance(db.Model):
    __tablename__ = "cruces_balance"

    id                  = db.Column(db.String(25), primary_key=True, default=_cuid)
    registro_balance_id = db.Column(db.String(25), db.ForeignKey("registros_balance.id"), nullable=False)
    codigo_frontera     = db.Column(db.String(100), nullable=False)
    provision_id        = db.Column(db.String(25), db.ForeignKey("provisiones.id"), nullable=True)
    contingencia_id     = db.Column(db.String(25), db.ForeignKey("contingencias.id"), nullable=True)
    energia_cruzada_kwh = db.Column(db.Numeric(18, 6), nullable=False)
    valor_cruzado_cop   = db.Column(db.Numeric(18, 2), nullable=False)
    resultado_neto_cop  = db.Column(db.Numeric(18, 2), nullable=False)
    tipo_resultado      = db.Column(db.Enum(TipoResultadoCruce), nullable=False)
    fecha_cruce         = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    registrado_por_id   = db.Column(db.String(25), db.ForeignKey("users.id"), nullable=False)
    created_at          = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)

    registro_balance = db.relationship("RegistroBalance", back_populates="cruces")
    provision        = db.relationship("Provision", back_populates="cruces")
    contingencia     = db.relationship("Contingencia", back_populates="cruces")
    registrado_por   = db.relationship("User", back_populates="cruces_registrados")

    __table_args__ = (
        db.Index("idx_cruce_balance", "registro_balance_id"),
        db.Index("idx_cruce_provision", "provision_id"),
        db.Index("idx_cruce_contingencia", "contingencia_id"),
    )


class Disputa(db.Model):
    __tablename__ = "disputas"

    id                 = db.Column(db.String(25), primary_key=True, default=_cuid)
    resultado_id       = db.Column(db.String(25), db.ForeignKey("resultados_conciliacion.id"), nullable=False)
    periodo_id         = db.Column(db.String(25), db.ForeignKey("periodos_conciliacion.id"), nullable=False)
    codigo_frontera    = db.Column(db.String(100), nullable=False)
    or_id              = db.Column(db.String(25), db.ForeignKey("configuracion_or.id"), nullable=False)
    energia_exceso_kwh = db.Column(db.Numeric(18, 6), nullable=False)
    valor_disputa_cop  = db.Column(db.Numeric(18, 2), nullable=False)
    estado             = db.Column(db.Enum(EstadoDisputa), nullable=False, default=EstadoDisputa.ABIERTA)
    descripcion        = db.Column(db.Text, nullable=True)
    resolucion         = db.Column(db.Text, nullable=True)
    abierta_por_id     = db.Column(db.String(25), db.ForeignKey("users.id"), nullable=False)
    cerrada_por_id     = db.Column(db.String(25), db.ForeignKey("users.id"), nullable=True)
    cerrada_at         = db.Column(db.DateTime, nullable=True)
    created_at         = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at         = db.Column("updatedAt", db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    resultado    = db.relationship("ResultadoConciliacion", back_populates="disputas")
    periodo      = db.relationship("PeriodoConciliacion", back_populates="disputas")
    operador_red = db.relationship("ConfiguracionOR", back_populates="disputas")
    abierta_por  = db.relationship("User", foreign_keys=[abierta_por_id], back_populates="disputas_abiertas")
    cerrada_por  = db.relationship("User", foreign_keys=[cerrada_por_id], back_populates="disputas_cerradas")

    __table_args__ = (
        db.Index("idx_disputa_periodo_estado", "periodo_id", "estado"),
        db.Index("idx_disputa_or", "or_id"),
    )


class LogAuditoria(db.Model):
    __tablename__ = "log_auditoria"

    id         = db.Column(db.String(25), primary_key=True, default=_cuid)
    usuario_id = db.Column(db.String(25), db.ForeignKey("users.id"), nullable=False)
    accion     = db.Column(db.Enum(AccionAuditoria), nullable=False)
    entidad    = db.Column(db.String(100), nullable=False)
    entidad_id = db.Column(db.String(100), nullable=False)
    detalle    = db.Column(db.JSON, nullable=True)
    ip         = db.Column(db.String(50), nullable=True)
    created_at = db.Column("createdAt", db.DateTime, nullable=False, default=datetime.utcnow)

    usuario = db.relationship("User", back_populates="log_auditoria")

    __table_args__ = (
        db.Index("idx_log_entidad", "entidad", "entidad_id"),
        db.Index("idx_log_usuario", "usuario_id"),
        db.Index("idx_log_created", "createdAt"),
    )
