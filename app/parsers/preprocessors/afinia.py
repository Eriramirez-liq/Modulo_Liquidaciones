"""
Pre-procesador SDL para AFINIA.

Transformaciones aplicadas antes del mapeo estándar de columnas:

1. Periodo:
   - Fuente: columna "LIQ_FECHA_INICIO" en hoja "CONSOLIDADO PEAJES"
   - Formato original: dd/m/aaaa  →  salida: AAAA-MM
   - Se toma el primer valor no vacío y se aplica a todas las filas.

2. Valor activa (valor_cop):
   - Suma de "PEAJES REGIONALES NO REGULADOS OTRO" +
             "PEAJES REGIONALES REGULADOS OTROS"
   - Se crea la columna calculada "__VALOR_ACTIVA__" en el df principal.

3. Propiedad activos:
   - Fuente: columna "PROPIEDAD_ACTIVOS" en hoja "CONSOLIDADO PEAJES",
     cruzada por código SIC con la hoja principal.
   - Codificación: 0 → "OR"  |  1 o 101 → "Usuario"

4. Tarifa reactiva:
   - "PEN. REACTIVA IND ($) - M APLICADA FINAL" / "ENERGIA REACTIVA PEAJES" / "M"
   - Se crea la columna calculada "__TARIFA_REACTIVA__".
"""
from __future__ import annotations
import io
import pandas as pd

_HOJA_CONSOLIDADO  = "CONSOLIDADO PEAJES"
_COL_FECHA         = "LIQ_FECHA_INICIO"
_COL_PROP_CONS     = "PROPIEDAD_ACTIVOS"
_COL_REG           = "PEAJES REGIONALES REGULADOS OTROS"
# El archivo usa "OTRO" (sin 'S' al final); _find_col usa búsqueda bidireccional
_COL_NOREG         = "PEAJES REGIONALES NO REGULADOS OTRO"
_COL_TAR_REAC_NUM  = "PEN. REACTIVA IND ($) - M APLICADA FINAL"
_COL_TAR_REAC_DEN  = "ENERGIA REACTIVA PEAJES"
_COL_FACTOR_M      = "M"


def preprocesar(buffer: bytes, df: pd.DataFrame, mapeo: dict) -> tuple[pd.DataFrame, dict]:
    """
    Punto de entrada del preprocesador AFINIA.
    Retorna (df_modificado, mapeo_actualizado).
    """
    df   = df.copy()
    mapeo = {**mapeo, "columnas": dict(mapeo.get("columnas", {}))}
    cols = mapeo["columnas"]

    # Leer hoja complementaria
    try:
        df_cons = pd.read_excel(
            io.BytesIO(buffer),
            sheet_name=_HOJA_CONSOLIDADO,
            dtype=str,
            keep_default_na=False,
        )
    except Exception:
        # Sin hoja CONSOLIDADO PEAJES: continuar sin periodo ni propiedad lookup
        df_cons = None

    if df_cons is not None:
        _aplicar_periodo(df, cols, df_cons)
        _aplicar_propiedad(df, cols, df_cons)

    _aplicar_valor_activa(df, cols)
    _aplicar_tarifa_reactiva(df, cols)

    return df, mapeo


# ── Helpers ────────────────────────────────────────────────────────────────────

def _find_col(df: pd.DataFrame, nombre: str) -> str | None:
    """
    Búsqueda de columna: exacta primero (case-insensitive + strip),
    luego bidireccional por contiene para tolerar nombres truncados o con variantes.
    """
    idx = {c.strip().upper(): c for c in df.columns}
    nombre_up = nombre.strip().upper()
    # 1. Coincidencia exacta
    if nombre_up in idx:
        return idx[nombre_up]
    # 2. El nombre de columna está contenido en el término buscado (ej. "OTRO" en "OTROS")
    for key, col in idx.items():
        if key in nombre_up:
            return col
    # 3. El término buscado está contenido en el nombre de columna
    for key, col in idx.items():
        if nombre_up in key:
            return col
    return None


def _fecha_a_periodo(s: str) -> str | None:
    """
    Convierte dd/m/aaaa  o  dd/mm/aaaa  o  yyyy-mm-dd  →  AAAA-MM.
    Retorna None si no puede parsear.
    """
    s = s.strip()
    if not s or s.lower() in ("nan", "none", ""):
        return None
    # Intento rápido por split
    for sep in ("/", "-"):
        parts = s.split(sep)
        if len(parts) == 3:
            a, b, c = parts[0].strip(), parts[1].strip(), parts[2].strip()
            # dd/mm/aaaa  → año en posición 2
            if len(c) == 4:
                try:
                    return f"{c}-{int(b):02d}"
                except ValueError:
                    pass
            # aaaa-mm-dd  → año en posición 0
            if len(a) == 4:
                try:
                    return f"{a}-{int(b):02d}"
                except ValueError:
                    pass
    # Fallback con datetime
    from datetime import datetime
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m")
        except ValueError:
            continue
    return None


def _aplicar_periodo(df: pd.DataFrame, cols: dict, df_cons: pd.DataFrame) -> None:
    """Agrega columna __PERIODO__ al df principal y actualiza cols."""
    col = _find_col(df_cons, _COL_FECHA)
    if not col:
        return
    for v in df_cons[col]:
        periodo = _fecha_a_periodo(str(v))
        if periodo:
            df["__PERIODO__"] = periodo
            cols["periodo"] = "__PERIODO__"
            return


def _aplicar_propiedad(df: pd.DataFrame, cols: dict, df_cons: pd.DataFrame) -> None:
    """
    Lookup: SIC en hoja principal → PROPIEDAD_ACTIVOS en CONSOLIDADO PEAJES.
    Mapea 0 → "OR", 1 → "Usuario".
    """
    col_sic_principal = cols.get("codigo_frontera", "SIC")
    if col_sic_principal not in df.columns:
        return

    col_sic_cons  = _find_col(df_cons, "SIC")
    col_prop_cons = _find_col(df_cons, _COL_PROP_CONS) or _find_col(df_cons, "PROPIEDAD")
    if not col_sic_cons or not col_prop_cons:
        return

    prop_map: dict[str, str | None] = {}
    for sic, prop in zip(df_cons[col_sic_cons], df_cons[col_prop_cons]):
        k = str(sic).strip()
        v = str(prop).strip()
        if v in ("0", "0.0"):
            prop_map[k] = "OR"
        elif v in ("1", "1.0", "101", "101.0"):
            prop_map[k] = "Usuario"
        else:
            prop_map[k] = v if v and v.lower() not in ("nan", "none", "") else None

    df["__PROPIEDAD__"] = df[col_sic_principal].apply(
        lambda x: prop_map.get(str(x).strip())
    )
    cols["propiedad_activos"] = "__PROPIEDAD__"


def _aplicar_valor_activa(df: pd.DataFrame, cols: dict) -> None:
    """
    Valor activa = PEAJES REGIONALES REGULADOS OTROS
                 + PEAJES REGIONALES NO REGULADOS OTROS
    """
    col_reg   = _find_col(df, _COL_REG)
    col_noreg = _find_col(df, _COL_NOREG)
    if not col_reg or not col_noreg:
        return

    df["__VALOR_ACTIVA__"] = (
        pd.to_numeric(df[col_noreg], errors="coerce").fillna(0)
        + pd.to_numeric(df[col_reg],   errors="coerce").fillna(0)
    )
    cols["valor_cop"] = "__VALOR_ACTIVA__"


def _aplicar_tarifa_reactiva(df: pd.DataFrame, cols: dict) -> None:
    """Tarifa reactiva = 'PEN. REACTIVA IND ($) - M APLICADA FINAL' / ENERGIA REACTIVA PEAJES / M"""
    col_num = _find_col(df, _COL_TAR_REAC_NUM)
    col_den = _find_col(df, _COL_TAR_REAC_DEN)
    col_m   = _find_col(df, _COL_FACTOR_M)
    if not col_num or not col_den or not col_m:
        return

    num = pd.to_numeric(df[col_num], errors="coerce")
    den = pd.to_numeric(df[col_den], errors="coerce")
    m   = pd.to_numeric(df[col_m],   errors="coerce")

    df["__TARIFA_REACTIVA__"] = num / den.replace(0, float("nan")) / m.replace(0, float("nan"))
    cols["tarifa_reactiva"] = "__TARIFA_REACTIVA__"
