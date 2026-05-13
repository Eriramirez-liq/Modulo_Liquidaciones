"""

Punto de entrada de la aplicación Flask — App Conciliación SDLs

Uso: python run.py

"""

import os

from dotenv import load_dotenv



load_dotenv()



from app import create_app

from app.models import db, User, Rol, ConfiguracionOR



app = create_app()





def _init_db():

    """Crea las tablas y un usuario admin por defecto si no existen."""

    with app.app_context():

        db.create_all()



        if not User.query.first():

            import bcrypt

            password = os.getenv("DEV_PASSWORD", "bia2024")

            hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

            admin = User(

                nombre="Usuario Desarrollo",

                email=os.getenv("DEV_EMAIL", "dev@bia.local"),

                password=hashed,

                rol=Rol.ADMINISTRADOR,

                activo=True,

            )

            db.session.add(admin)

            db.session.commit()

            print(f"   Usuario admin creado: {admin.email} / {password}")

        else:

            user = User.query.first()

            print(f"   Usuario existente: {user.email}")



        _seed_operadores()





def _seed_operadores():

    """Inserta los operadores de red con mapeo SDL pre-configurado si no existen."""



    def _sdl(hoja, fila, tipo, sep, codigo_frontera, energia_kwh, valor_cop,

             periodo=None, nivel_tension=None, propiedad_activos=None,

             energia_reactiva_ind_pen=None, energia_reactiva_cap_pen=None,

             valor_reactiva_cop=None, tarifa_reactiva=None, tarifa_sdl=None,

             factor_m=None, codigo_frontera_split=None):

        return {

            "tipo_archivo": tipo, "hoja": hoja, "fila_inicio": fila, "separador_csv": sep,

            "columnas": {

                "codigo_frontera":          codigo_frontera,

                "energia_kwh":              energia_kwh,

                "valor_cop":                valor_cop,

                "periodo":                  periodo,

                "nivel_tension":            nivel_tension,

                "propiedad_activos":        propiedad_activos,

                "energia_reactiva_ind_pen": energia_reactiva_ind_pen,

                "energia_reactiva_cap_pen": energia_reactiva_cap_pen,

                "valor_reactiva_cop":       valor_reactiva_cop,

                "tarifa_reactiva":          tarifa_reactiva,

                "tarifa_sdl":               tarifa_sdl,

                "factor_m":                 factor_m,

            },

            "codigo_frontera_split": codigo_frontera_split,

        }



    operadores = [

        {

            "codigo": "AFINIA", "nombre": "Afinia",

            # Fila 1 encabezado, datos desde fila 2

            "mapeo_sdl": _sdl(0, 2, "xlsx", ",",

                codigo_frontera="SIC",

                energia_kwh="CONSUMO",

                valor_cop="PEAJES REGIONALES REGULADOS OTROS",

                nivel_tension="NIVEL TENSION",

                propiedad_activos="PROPIEDAD",

                energia_reactiva_ind_pen="ENERGIA REACTIVA PEAJES",

                valor_reactiva_cop="PEN. ENERGIA REACTIVA PEAJES",

                factor_m="M",

            ),

        },

        {

            "codigo": "AIRE", "nombre": "Aire",

            # Fila 1-2 encabezados/metadatos, datos desde fila 3

            # Periodo no viene en el archivo; se toma del formulario de carga

            # Valor reactiva = PENALIZACIONREACTIVA$ + REACTIVACAPACITIVA$ (preprocessor)

            "mapeo_sdl": _sdl(0, 3, "xls", ",",

                codigo_frontera="CODIGOSIC",

                energia_kwh="CONSUMOTOTAL",

                valor_cop="TRANSPORTEREGIONAL",

                nivel_tension="NT",

                propiedad_activos="PROPIETARIO_ACTIVO",

                energia_reactiva_ind_pen="PENALIZACIONREACTIVA",

                energia_reactiva_cap_pen="REACTIVACAPACITIVA",

                factor_m="FactorM",

            ),

        },

        {
            "codigo": "EEP_CARTAGO", "nombre": "EEP Cartago",
            # Fila 1 encabezados agrupados, fila 2 encabezados reales, datos desde fila 3
            # propiedad_activos, valor_reactiva_cop: calculados por preprocesador
            "mapeo_sdl": _sdl(0, 3, "xlsx", ",",
                codigo_frontera="SIC",
                energia_kwh="Energía Activa ",
                valor_cop="Valor $ Activa",
                nivel_tension="Nivel Tension",
                energia_reactiva_ind_pen="Energía Reactiva Inductiva",
                energia_reactiva_cap_pen="Energía Reactiva Capacitiva",
                factor_m="Factor M",
                tarifa_sdl="Tarifa Activa",
                tarifa_reactiva="Tarifa Reactiva",
            ),
        },

        {

            "codigo": "CEDENAR", "nombre": "Cedenar",

            # Fila 1 encabezado, datos desde fila 2

            # valor_cop = VALOR TARIFA ACTIVA ($) × Activa (preprocessor)

            # valor_reactiva_cop = Penalizada × VALOR TARIFA REACTIVA ($) (preprocessor)

            # propiedad_activos: TARIFA I → 300/301=Usuario, 324=Compartido, 312=OR (preprocessor)

            "mapeo_sdl": _sdl(0, 2, "xlsx", ",",

                codigo_frontera="CODIGO SIC",

                energia_kwh="Activa",

                valor_cop=None,

                nivel_tension="NIVEL DE TENSIÓN",

                energia_reactiva_ind_pen="Penalizada",

                tarifa_reactiva="VALOR TARIFA REACTIVA ($)",

                tarifa_sdl="VALOR TARIFA ACTIVA ($)",

            ),

        },

        {

            "codigo": "CELSIA_TOLIMA", "nombre": "Celsia Tolima",

            # CSV sep=; fila 1 encabezado

            # propiedad_activos: 100% USUARIO/N/A=Usuario, 100% OPERADOR=OR, 50% OPERADOR=Compartido (preprocessor)

            # tarifa_sdl y tarifa_reactiva vienen directamente del archivo

            "mapeo_sdl": _sdl(0, 2, "csv", ";",

                codigo_frontera="Código SIC",

                energia_kwh="Activa KWh",

                valor_cop="$Peaje Activa",

                nivel_tension="Nivel Tensión",

                energia_reactiva_ind_pen="Reactiva Inductiva Penalizada kVAr",

                energia_reactiva_cap_pen="Reactiva Capacitiva Penal kVAr",

                valor_reactiva_cop="$Peaje Reactiva",

                tarifa_reactiva="Tarifa Reactiva $/kVAr",

                tarifa_sdl="Tarifa Activa $/KWh",

                factor_m="Factor M",

            ),

        },

        {

            "codigo": "CELSIA_VALLE", "nombre": "Celsia Valle",

            # Mismo formato y lógica que Celsia Tolima (CSV sep=;, Latin-1)

            # propiedad_activos: 100% USUARIO/N/A=Usuario, 100% OPERADOR=OR, 50% OPERADOR=Compartido (preprocessor)

            "mapeo_sdl": _sdl(0, 2, "csv", ";",

                codigo_frontera="Código SIC",

                energia_kwh="Activa KWh",

                valor_cop="$Peaje Activa",

                nivel_tension="Nivel Tensión",

                energia_reactiva_ind_pen="Reactiva Inductiva Penalizada kVAr",

                energia_reactiva_cap_pen="Reactiva Capacitiva Penal kVAr",

                valor_reactiva_cop="$Peaje Reactiva",

                tarifa_reactiva="Tarifa Reactiva $/kVAr",

                tarifa_sdl="Tarifa Activa $/KWh",

                factor_m="Factor M",

            ),

        },

        {

            "codigo": "CENS", "nombre": "Cens",

            # Fila 1 encabezado, datos desde fila 2

            # valor_cop = 0 (CENS no cobra activa) -- preprocessor

            # nivel_tension: primer numero de NT_PRO (1_100 -> 1) -- preprocessor

            # propiedad_activos: desde NT_PRO (1_100=OR, 1_50=Compartido, 1_0/2_100=Usuario) -- preprocessor

            # valor_reactiva_cop: Valor R_Inductiva + Valor R_Capacitiva -- preprocessor

            "mapeo_sdl": _sdl(0, 2, "xlsx", ",",

                codigo_frontera="Código SIC",

                energia_kwh="Activa",

                valor_cop="Valor Activa",

                nivel_tension=None,

                energia_reactiva_ind_pen="R_Inductiva",

                energia_reactiva_cap_pen="R_Capacitiva",

                valor_reactiva_cop=None,

                tarifa_reactiva="Tarifa Reactiva",

                tarifa_sdl="Tarifa Activa",

                factor_m="Factor M",

            ),

        },

        {

            "codigo": "CEO", "nombre": "CEO",

            # Fila 1 encabezado, datos desde fila 2

            # propiedad_activos: 100% OPERADOR=OR, 100% USUARIO=Usuario (preprocessor)

            # tarifa_sdl y tarifa_reactiva vienen directamente del archivo

            "mapeo_sdl": _sdl(0, 3, "xlsx", ",",

                codigo_frontera="Código SIC",

                energia_kwh="Activa KWh",

                valor_cop="$ Peaje Activa",

                periodo="Periodo",

                nivel_tension="Nivel Tensión",

                energia_reactiva_ind_pen="Reactiva Inductiva Penal kVAr",

                valor_reactiva_cop="$ Peaje Reactiva",

                tarifa_reactiva="Tarifa Reactiva $/kVAr",

                tarifa_sdl="Tarifa Activa $/KWh",

                factor_m="Factor_m",

            ),

        },

        {

            "codigo": "CETSA", "nombre": "Cetsa",

            # Mismo formato y logica que Celsia Tolima/Valle (CSV sep=;, Latin-1)

            # propiedad_activos: 100% USUARIO/N/A=Usuario, 100% OPERADOR=OR, 50% OPERADOR=Compartido (preprocessor)

            "mapeo_sdl": _sdl(0, 2, "csv", ";",

                codigo_frontera="Código SIC",

                energia_kwh="Activa KWh",

                valor_cop="$Peaje Activa",

                nivel_tension="Nivel Tensión",

                energia_reactiva_ind_pen="Reactiva Inductiva Penalizada kVAr",

                energia_reactiva_cap_pen="Reactiva Capacitiva Penal kVAr",

                valor_reactiva_cop="$Peaje Reactiva",

                tarifa_reactiva="Tarifa Reactiva $/kVAr",

                tarifa_sdl="Tarifa Activa $/KWh",

                factor_m="Factor M",

            ),

        },

        {

            "codigo": "CHEC", "nombre": "Chec",

            # Fila 1 encabezado, datos desde fila 2

            # codigo_frontera: todo antes del "-" (ej. Frt18771-INCOCO_NO.8 -> Frt18771)

            # propiedad_activos: PORCENTAJE CDI (0%=Usuario, 50%=Compartido, 100%=OR) -- preprocessor

            "mapeo_sdl": _sdl(0, 2, "xlsx", ",",

                codigo_frontera="FRONTERA",

                energia_kwh="ENERGIA ACTIVA",

                valor_cop="LIQUIDACION ACTIVA",

                nivel_tension="NIVEL TENSION",

                energia_reactiva_ind_pen="ENERGIA REACTIVA",

                valor_reactiva_cop="LIQUIDACION REACTIVA",

                tarifa_reactiva="CARGO REACTIVO",

                tarifa_sdl="CARGO ACTIVO",

                factor_m="FACTOR M",

                codigo_frontera_split="-",

            ),

        },

        {

            "codigo": "EBSA", "nombre": "EBSA",

            # Archivo VERTICAL: filas ACTIVA + REACTIVA por frontera

            # El preprocessor pivota a una fila por frontera

            # propiedad: NT 2/3=Usuario, NT 1=pendiente modulo Tarifas

            "mapeo_sdl": _sdl(0, 2, "xlsx", ",",

                codigo_frontera="CODIGO SIC",

                energia_kwh="KW-H",

                valor_cop="VALOR",

                nivel_tension="NT",

            ),

        },

        {
            "codigo": "EDEQ", "nombre": "Edeq",
            "mapeo_sdl": _sdl(0, 2, "xlsx", ",",
                codigo_frontera="CODIGO SIC",
                energia_kwh="Energía Activa",
                valor_cop="Valor Activa",
                energia_reactiva_ind_pen="Energía Reactiva Inductiva Penalizada",
                energia_reactiva_cap_pen="Energía Reactiva Capacitiva Penalizada",
                factor_m="Factor M (Energia Reactiva )",
                # nivel_tension, propiedad_activos, valor_reactiva_cop, tarifa_reactiva: calculados por preprocesador
            ),
        },
        {
            "codigo": "EEP_PEREIRA", "nombre": "EEP Pereira",
            # Mismo formato que EEP_CARTAGO
            "mapeo_sdl": _sdl(0, 3, "xlsx", ",",
                codigo_frontera="SIC",
                energia_kwh="Energía Activa ",
                valor_cop="Valor $ Activa",
                nivel_tension="Nivel Tension",
                energia_reactiva_ind_pen="Energía Reactiva Inductiva",
                energia_reactiva_cap_pen="Energía Reactiva Capacitiva",
                factor_m="Factor M",
                tarifa_sdl="Tarifa Activa",
                tarifa_reactiva="Tarifa Reactiva",
            ),
        },

        {

            "codigo": "ELECTROHUILA", "nombre": "Electrohuila",

            "mapeo_sdl": None,  # configurar cuando llegue el archivo de formato

        },

        {

            "codigo": "EMCALI", "nombre": "Emcali",

            # Fila 1 encabezado, datos desde fila 2

            "mapeo_sdl": _sdl(0, 2, "xlsx", ",",

                codigo_frontera="codigo_sic",

                energia_kwh="activa",

                valor_cop="valor_peaje_activa",

                nivel_tension="nt",

                propiedad_activos="propiedad_activo",

                energia_reactiva_ind_pen="reactva_inductiva_penal",

                energia_reactiva_cap_pen="reactiva_capacitiva_penalizada",

                valor_reactiva_cop="valor_peaje_reactiva",

                factor_m="factor_m",

            ),

        },

        {
            "codigo": "EMSA", "nombre": "Emsa",
            # 3 archivos: Activa (principal), Capacitiva, Inductiva → fusionados por CODIGO
            # valor_cop, tarifa_sdl, propiedad_activos: pendiente módulo Tarifas
            "mapeo_sdl": {**_sdl(0, 2, "xlsx", ",",
                codigo_frontera="CODIGO",
                energia_kwh="kWhR",
                valor_cop=None,
                # nivel, reactivas, factor_m, tarifa_reactiva: calculados por preprocesador
            ), "multi_archivos": True},
        },

        {

            "codigo": "ENEL", "nombre": "Enel",

            # 2 archivos: Activa (principal) + Reactiva (via archivo_cap)
            # tarifa_sdl=VALOR/CONSUMO, tarifa_reactiva+propiedad: pendiente modulo Tarifas

            "mapeo_sdl": {**_sdl(0, 2, "xlsx", ",",

                codigo_frontera="CODIGO SIC",

                energia_kwh="CONSUMO ACTIVA",

                valor_cop="VALOR SDL ACT",

                nivel_tension="NIVEL TENSION",

                valor_reactiva_cop="VALOR SDL REAC",

                # periodo, factor_m, reactivas, tarifa_sdl, tarifa_reactiva, propiedad: preprocesador

            ), "multi_archivos": True},

        },

        {

            "codigo": "ENERCA", "nombre": "Enerca",

            # Filas 1-3 título/metadatos, fila 4 encabezado, datos desde fila 5

            "mapeo_sdl": _sdl(0, 5, "xlsx", ",",

                codigo_frontera="CODIGO SIC",

                energia_kwh="CONSUMO ACTIVA LIQUIDADO",

                valor_cop="BALANCE SIC LIQUIDADO",

                nivel_tension="NT",

                propiedad_activos="PROPIEDAD DE ACTIVO",

                energia_reactiva_ind_pen="EXCESO REACTIVA",

                energia_reactiva_cap_pen="EXCESO CAPACITIVA",

                valor_reactiva_cop="REACTIVA EN EXCESO LIQUIDADO",

                factor_m="FACTOR M",

            ),

        },

        {

            "codigo": "EPM", "nombre": "EPM",

            # Filas 1-12 metadatos, fila 13 encabezado, datos desde fila 14

            # Nombres de columna con saltos de línea tal como los lee openpyxl

            "mapeo_sdl": _sdl(0, 14, "xlsx", ",",

                codigo_frontera="C\u00f3digo SIC",

                energia_kwh="ENERG\u00cdA \nActiva SDL \n(KW)",

                valor_cop="INGRESO \nActiva SDL\n($)",

                nivel_tension="Nivel de Tensi\u00f3n",

            ),

        },

        {
            "codigo": "ESSA", "nombre": "ESSA",
            # Filas 1-3 metadatos, fila 4 encabezado, datos desde fila 5
            # factor_m detectado dinámicamente (M ENE/M FEB…), propiedad y valor_reactiva por preprocesador
            "mapeo_sdl": _sdl(0, 5, "xlsx", ",",
                codigo_frontera="CODIGO SIC",
                energia_kwh="DEFINITIVO",
                valor_cop="PEAJE ACTIVA",
                nivel_tension="NIVEL TENSION",
                energia_reactiva_ind_pen="REACTIVA PENALIZADA",
                energia_reactiva_cap_pen="CAPACITIVA PENALIZADA",
                tarifa_sdl="TARIFA ACTIVA",
                tarifa_reactiva="TARIFA REACTIVA",
                # factor_m, propiedad_activos, valor_reactiva_cop: calculados por preprocesador
            ),
        },

        {
            "codigo": "RUITOQUE", "nombre": "Ruitoque",
            # Filas 1-5 metadatos, fila 6 encabezado, datos desde fila 7
            # propiedad_activos, valor_reactiva_cop: calculados por preprocesador
            "mapeo_sdl": _sdl(0, 7, "xlsx", ",",
                codigo_frontera="Código SIC",
                energia_kwh="Activa",
                valor_cop="Valor Activa",
                nivel_tension="NT",
                energia_reactiva_ind_pen="R_Inductiva Penalizada",
                energia_reactiva_cap_pen="R_Capacitiva Penalizada",
                factor_m="Factor M",
                tarifa_sdl="Tarifa Activa",
                tarifa_reactiva="Tarifa Reactiva",
            ),
        },

    ]



    creados = 0

    actualizados = 0

    for op in operadores:

        existing = ConfiguracionOR.query.filter_by(codigo=op["codigo"]).first()

        if not existing:

            db.session.add(ConfiguracionOR(

                codigo=op["codigo"],

                nombre=op["nombre"],

                activo=True,

                mapeo_sdl_json=op.get("mapeo_sdl"),

            ))

            creados += 1

        elif op.get("mapeo_sdl") and existing.mapeo_sdl_json is None:

            existing.mapeo_sdl_json = op["mapeo_sdl"]

            actualizados += 1



    if creados or actualizados:

        db.session.commit()

        if creados:

            print(f"   Operadores de red creados: {creados}")

        if actualizados:

            print(f"   Mapeos SDL actualizados: {actualizados}")

    else:

        print(f"   Operadores de red: ya existían ({len(operadores)} registros)")





if __name__ == "__main__":

    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"

    port  = int(os.getenv("PORT", 5000))



    _init_db()



    print("\nBIA Energy - Conciliacion SDL")

    print(f"   Servidor corriendo en: http://localhost:{port}")

    print(f"   Modo debug: {debug}\n")

    app.run(host="0.0.0.0", port=port, debug=debug)

