"""
Parser SDL — soporta mapeo configurable por OR con pre-procesadores específicos.

Flujo:
  1. Cargar DataFrame desde la hoja principal (según mapeo)
  2. Aplicar preprocesador del OR si existe (homologación, cálculos, lookups)
  3. Resolver columnas y construir filas normalizadas
"""
from __future__ import annotations
from typing import Optional, Any
import io
import unicodedata
import pandas as pd

MAPEO_SDL_DEFAULT = {
    "tipo_archivo": "xlsx",
    "hoja":         0,
    "fila_inicio":  2,
    "columnas": {
        "codigo_frontera": "CODIGO_FRONTERA",
        "energia_kwh":     "ENERGIA_KWH",
        "valor_cop":       "VALOR_COP",
        "periodo":         "PERIODO",
    },
}


def _norm(s: str) -> str:
    """Strip accents and normalize to ASCII upper for tolerant column matching."""
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").strip().upper()


def _resolve_col(headers: list, nombre: str) -> Optional[str]:
    upper = [_norm(h) for h in headers]
    nombre_up = _norm(nombre)
    try:
        return headers[upper.index(nombre_up)]
    except ValueError:
        pass
    # Fallback tolerante: contiene
    for i, h in enumerate(upper):
        if nombre_up in h:
            return headers[i]
    return None


def _resolve_col_multi(headers: list[str], candidates: list[str]) -> Optional[str]:
    """Prueba múltiples candidatos en orden; devuelve el primero que resuelva."""
    for nombre in candidates:
        col = _resolve_col(headers, nombre)
        if col:
            return col
    return None


def _to_number(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        n = float(v)
        return None if pd.isna(n) else n
    except (ValueError, TypeError):
        return None


def _leer_df(buffer: bytes, mapeo: dict) -> pd.DataFrame:
    hoja  = mapeo.get("hoja", 0)
    skip  = max(0, mapeo.get("fila_inicio", 2) - 2)  # pandas ya salta el header
    tipo  = mapeo.get("tipo_archivo", "xlsx")

    if tipo == "csv":
        sep = mapeo.get("separador_csv", ",")
        encoding = mapeo.get("encoding")
        _encodings = [encoding] if encoding else ["utf-8", "latin-1", "cp1252"]
        df = None
        last_err = None
        for enc in _encodings:
            try:
                df = pd.read_csv(
                    io.BytesIO(buffer), dtype=str, keep_default_na=False,
                    sep=sep, skiprows=skip if skip > 0 else None,
                    encoding=enc,
                )
                break
            except (UnicodeDecodeError, Exception) as e:
                last_err = e
        if df is None:
            raise last_err
    else:
        df = pd.read_excel(
            io.BytesIO(buffer), dtype=str, keep_default_na=False,
            sheet_name=hoja, skiprows=skip if skip > 0 else None,
        )
    return df


def parsear_sdl(
    buffer: bytes,
    mapeo: Optional[dict],
    or_id: Optional[str],
    periodo_id: Optional[str],
    anio: int,
    mes: int,
) -> dict:
    m = mapeo or MAPEO_SDL_DEFAULT
    alertas: list[dict] = []
    errores_criticos: list[dict] = []
    filas: list[dict] = []

    try:
        df = _leer_df(buffer, m)
    except Exception as e:
        errores_criticos.append({"nivel": "error", "mensaje": f"No se pudo leer el archivo: {e}"})
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    if df.empty:
        errores_criticos.append({"nivel": "error", "mensaje": "El archivo está vacío o no tiene datos."})
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    # ── Resolver código OR (el or_id es un CUID; el preprocesador usa el código) ─
    or_codigo = ""
    if or_id:
        try:
            from ..models import db, ConfiguracionOR
            or_config = db.session.get(ConfiguracionOR, or_id)
            or_codigo = or_config.codigo if or_config else ""
        except Exception:
            pass

    # ── Pre-procesamiento específico del OR ───────────────────────────────────
    if or_codigo:
        from .preprocessors import preprocesar
        try:
            df, m = preprocesar(buffer, df, m, or_codigo)
        except Exception as exc:
            alertas.append({
                "nivel": "advertencia",
                "mensaje": f"Preprocesador OR {or_codigo} falló ({exc}); se continúa con datos crudos.",
            })

    df.columns = [str(c) for c in df.columns]  # normalizar headers numéricos a string
    headers = list(df.columns)
    cols    = m.get("columnas", {})

    # ── Resolución de columnas ────────────────────────────────────────────────
    col_frontera  = _resolve_col(headers, cols.get("codigo_frontera", "CODIGO_FRONTERA"))
    col_energia   = _resolve_col(headers, cols.get("energia_kwh",     "ENERGIA_KWH"))
    col_valor     = _resolve_col(headers, cols.get("valor_cop",       "VALOR_COP")) if cols.get("valor_cop") else None
    # valor_cop_alt: coalesce cuando valor_cop está vacío en la fila
    col_valor_alt = _resolve_col(headers, cols["valor_cop_alt"]) if cols.get("valor_cop_alt") else None
    # valor_cop_producto: calcular valor = col_a × col_b
    valor_producto = cols.get("valor_cop_producto")
    col_prod_a = _resolve_col(headers, valor_producto["col_a"]) if valor_producto else None
    col_prod_b = _resolve_col(headers, valor_producto["col_b"]) if valor_producto else None
    col_periodo   = _resolve_col(headers, cols.get("periodo", "PERIODO")) if cols.get("periodo") else None
    col_nombre    = _resolve_col(headers, "NOMBRE_FRONTERA")  # opcional
    col_tension   = _resolve_col(headers, cols["nivel_tension"]) if cols.get("nivel_tension") else \
                    _resolve_col_multi(headers, ["NIVEL TENSION", "NIVEL DE TENSION", "NIVEL DE TENSIÓN",
                                                 "NIVEL TENSIÓN", "NT", "NT_PRO", "NIVEL_TENSION"])
    col_propiedad = _resolve_col(headers, cols["propiedad_activos"]) if cols.get("propiedad_activos") else \
                    _resolve_col_multi(headers, ["PROPIEDAD", "PROPIEDAD ACTIVO", "PROPIETARIO_ACTIVO",
                                                 "propiedad_activo", "PROPIEDAD_ACTIVOS"])
    col_reac_ind   = _resolve_col(headers, cols["energia_reactiva_ind_pen"]) if cols.get("energia_reactiva_ind_pen") else None
    col_reac_cap   = _resolve_col(headers, cols["energia_reactiva_cap_pen"]) if cols.get("energia_reactiva_cap_pen") else None
    col_val_reac   = _resolve_col(headers, cols["valor_reactiva_cop"])       if cols.get("valor_reactiva_cop")       else None
    col_tar_reac   = _resolve_col(headers, cols["tarifa_reactiva"])          if cols.get("tarifa_reactiva")          else None
    col_tar_sdl    = _resolve_col(headers, cols["tarifa_sdl"])               if cols.get("tarifa_sdl")               else None
    col_factor_m   = _resolve_col(headers, cols["factor_m"])                 if cols.get("factor_m")                 else None

    _cols_disp = ", ".join(f'"{c}"' for c in headers[:20])
    if not col_frontera:
        errores_criticos.append({"nivel": "error", "mensaje": f"Columna codigo_frontera no encontrada: \"{cols.get('codigo_frontera')}\". Columnas disponibles: [{_cols_disp}]"})
    if not col_energia:
        errores_criticos.append({"nivel": "error", "mensaje": f"Columna energia_kwh no encontrada: \"{cols.get('energia_kwh')}\". Columnas disponibles: [{_cols_disp}]"})
    if not col_valor and not col_valor_alt and not valor_producto:
        errores_criticos.append({"nivel": "error", "mensaje": f"Columna valor_cop no encontrada: \"{cols.get('valor_cop')}\". Columnas disponibles: [{_cols_disp}]"})
    if errores_criticos:
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    # OR por frontera en Fuente 1 (para validación cross-fuente)
    or_por_frontera: dict[str, str] = {}
    if periodo_id and or_id:
        try:
            from ..models import db, RegistroFacturacion
            registros = db.session.query(
                RegistroFacturacion.codigo_frontera,
                RegistroFacturacion.operador_red,
            ).filter_by(periodo_id=periodo_id).all()
            or_por_frontera = {r.codigo_frontera: r.operador_red for r in registros}
        except Exception:
            pass

    # Filtro de filas opcional (ej. EBSA solo quiere filas ACTIVA)
    filtro = m.get("filtro_filas")  # {"columna": "ENERGIA", "valor": "ACTIVA"}
    if filtro:
        col_filtro = _resolve_col(headers, filtro["columna"])
        val_filtro = str(filtro["valor"]).strip().upper()
        if col_filtro:
            df = df[df[col_filtro].astype(str).str.strip().str.upper() == val_filtro]

    # Split del código de frontera opcional (ej. CHEC: "Frt18771-INCOCO_NO.8" → "Frt18771")
    split_char = m.get("codigo_frontera_split")

    fronteras_vistas: set[str] = set()
    periodo_default = f"{anio}-{mes:02d}"

    for i, row in df.iterrows():
        fila_num = int(i) + 2

        codigo_frontera = str(row.get(col_frontera, "") or "").strip()  # type: ignore[arg-type]
        if not codigo_frontera:
            continue
        if split_char and split_char in codigo_frontera:
            codigo_frontera = codigo_frontera.split(split_char)[0].strip()

        es_duplicado = codigo_frontera in fronteras_vistas
        if es_duplicado:
            alertas.append({
                "nivel": "advertencia", "fila": fila_num, "campo": "codigo_frontera",
                "mensaje": f"Frontera duplicada en el archivo: {codigo_frontera}. "
                           "Se carga el registro pero generará alerta en la conciliación.",
            })
        fronteras_vistas.add(codigo_frontera)

        energia = _to_number(row.get(col_energia))  # type: ignore[arg-type]
        if col_valor:
            valor = _to_number(row.get(col_valor))  # type: ignore[arg-type]
        elif col_prod_a and col_prod_b:
            a = _to_number(row.get(col_prod_a))     # type: ignore[arg-type]
            b = _to_number(row.get(col_prod_b))     # type: ignore[arg-type]
            valor = a * b if (a is not None and b is not None) else None
        else:
            valor = None
        if valor is None and col_valor_alt is not None:
            valor = _to_number(row.get(col_valor_alt))  # type: ignore[arg-type]

        if energia is None:
            errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": "energia_kwh", "mensaje": "Valor no numérico"}); continue
        if energia < 0:
            errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": "energia_kwh", "mensaje": "Energía negativa"}); continue
        if valor is None:
            errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": "valor_cop", "mensaje": "Valor no numérico"}); continue
        if valor < 0:
            errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": "valor_cop", "mensaje": "Valor COP negativo"}); continue

        if col_tar_sdl:
            tarifa_sdl = _to_number(row.get(col_tar_sdl)) or 0.0  # type: ignore[arg-type]
        else:
            tarifa_sdl = valor / energia if energia > 0 else 0.0

        # Verificar OR vs Fuente 1
        or_fuente1 = or_por_frontera.get(codigo_frontera)
        if or_fuente1 and or_fuente1 != or_codigo:
            alertas.append({
                "nivel": "advertencia", "fila": fila_num, "campo": "codigo_frontera",
                "mensaje": f"Frontera {codigo_frontera}: OR en SDL ({or_codigo}) difiere del OR en Facturación ({or_fuente1})",
            })

        periodo_sdl = (
            str(row.get(col_periodo, "") or "").strip() if col_periodo else ""  # type: ignore[arg-type]
        ) or periodo_default
        nombre_frontera   = str(row.get(col_nombre,    "") or "").strip() if col_nombre    else None  # type: ignore[arg-type]
        nivel_tension     = str(row.get(col_tension,   "") or "").strip() if col_tension   else None  # type: ignore[arg-type]
        propiedad_activos = str(row.get(col_propiedad, "") or "").strip() if col_propiedad else None  # type: ignore[arg-type]

        reac_ind  = _to_number(row.get(col_reac_ind))  if col_reac_ind  else None  # type: ignore[arg-type]
        reac_cap  = _to_number(row.get(col_reac_cap))  if col_reac_cap  else None  # type: ignore[arg-type]
        val_reac  = _to_number(row.get(col_val_reac))  if col_val_reac  else None  # type: ignore[arg-type]
        tar_reac  = _to_number(row.get(col_tar_reac))  if col_tar_reac  else None  # type: ignore[arg-type]
        factor_m  = _to_number(row.get(col_factor_m))  if col_factor_m  else None  # type: ignore[arg-type]

        filas.append({
            "codigo_frontera":          codigo_frontera,
            "nombre_frontera":          nombre_frontera or None,
            "periodo_sdl":              periodo_sdl,
            "energia_sdl_kwh":          energia,
            "valor_sdl_cop":            valor,
            "tarifa_sdl":               tarifa_sdl,
            "nivel_tension":            nivel_tension or None,
            "propiedad_activos":        propiedad_activos or None,
            "energia_reactiva_ind_pen": reac_ind,
            "energia_reactiva_cap_pen": reac_cap,
            "valor_reactiva_cop":       val_reac,
            "tarifa_reactiva":          tar_reac,
            "factor_m":                 factor_m,
            "es_duplicado":             es_duplicado,
        })

    return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}
