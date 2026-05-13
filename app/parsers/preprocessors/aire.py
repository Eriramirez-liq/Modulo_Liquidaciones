"""
Pre-procesador SDL para AIRE.

Transformaciones aplicadas antes del mapeo estándar de columnas:

1. Valor reactiva (COP):
   - Suma de "PENALIZACIONREACTIVA$" + "REACTIVACAPACITIVA$"
   - Se crea la columna calculada "__VALOR_REACTIVA__" en el df principal.

2. Tarifa reactiva:
   - PENALIZACIONREACTIVA$ / PENALIZACIONREACTIVA / FactorM
   - Se crea la columna calculada "__TARIFA_REACTIVA__".

3. Nivel de tensión:
   - Fuente: columna "NT"
   - Extrae solo el número: "N3" → "3", "N2" → "2", etc.

4. Propiedad activos:
   - Fuente: columna "PROPIETARIO_ACTIVO"
   - "Operador de Red" → "OR"  |  "Usuario" → "Usuario"

5. Periodo:
   - El archivo AIRE no trae periodo; se usa el valor ingresado al cargar
     (anio/mes del formulario), que el parser SDL asigna como periodo_default.
"""
from __future__ import annotations
import pandas as pd

_COL_REACT_PEN = "PENALIZACIONREACTIVA$"
_COL_REACT_CAP = "REACTIVACAPACITIVA$"
_COL_PROPIEDAD = "PROPIETARIO_ACTIVO"
_COL_NT        = "NT"


def preprocesar(buffer: bytes, df: pd.DataFrame, mapeo: dict) -> tuple[pd.DataFrame, dict]:
    df    = df.copy()
    mapeo = {**mapeo, "columnas": dict(mapeo.get("columnas", {}))}
    cols  = mapeo["columnas"]

    _aplicar_valor_reactiva(df, cols)
    _aplicar_tarifa_reactiva(df, cols)
    _aplicar_propiedad(df, cols)
    _aplicar_nivel_tension(df, cols)

    return df, mapeo


# ── Helpers ────────────────────────────────────────────────────────────────────

def _find_col(df: pd.DataFrame, nombre: str) -> str | None:
    idx = {c.strip().upper(): c for c in df.columns}
    nombre_up = nombre.strip().upper()
    if nombre_up in idx:
        return idx[nombre_up]
    for key, col in idx.items():
        if key in nombre_up or nombre_up in key:
            return col
    return None


def _aplicar_valor_reactiva(df: pd.DataFrame, cols: dict) -> None:
    """Valor reactiva COP = PENALIZACIONREACTIVA$ + REACTIVACAPACITIVA$"""
    col_pen = _find_col(df, _COL_REACT_PEN)
    col_cap = _find_col(df, _COL_REACT_CAP)
    if not col_pen or not col_cap:
        return

    df["__VALOR_REACTIVA__"] = (
        pd.to_numeric(df[col_pen], errors="coerce").fillna(0)
        + pd.to_numeric(df[col_cap], errors="coerce").fillna(0)
    )
    cols["valor_reactiva_cop"] = "__VALOR_REACTIVA__"


def _aplicar_tarifa_reactiva(df: pd.DataFrame, cols: dict) -> None:
    """Tarifa reactiva = PENALIZACIONREACTIVA$ / PENALIZACIONREACTIVA / FactorM"""
    idx = {c.strip().upper(): c for c in df.columns}
    col_cop = idx.get("PENALIZACIONREACTIVA$")
    col_kwh = idx.get("PENALIZACIONREACTIVA")
    col_m   = _find_col(df, "FactorM")
    if not col_cop or not col_kwh or not col_m:
        return

    cop = pd.to_numeric(df[col_cop], errors="coerce")
    kwh = pd.to_numeric(df[col_kwh], errors="coerce")
    m   = pd.to_numeric(df[col_m],   errors="coerce")

    df["__TARIFA_REACTIVA__"] = cop / kwh.replace(0, float("nan")) / m.replace(0, float("nan"))
    cols["tarifa_reactiva"] = "__TARIFA_REACTIVA__"


def _aplicar_nivel_tension(df: pd.DataFrame, cols: dict) -> None:
    """N3 → '3', N2 → '2', etc. Extrae solo los dígitos del valor."""
    col = _find_col(df, _COL_NT)
    if not col:
        return

    df["__NT__"] = df[col].apply(
        lambda x: "".join(filter(str.isdigit, str(x).strip())) or None
    )
    cols["nivel_tension"] = "__NT__"


def _aplicar_propiedad(df: pd.DataFrame, cols: dict) -> None:
    """Operador de Red → OR  |  Usuario → Usuario"""
    col = _find_col(df, _COL_PROPIEDAD)
    if not col:
        return

    _MAP = {"OPERADOR DE RED": "OR", "USUARIO": "Usuario"}

    df["__PROPIEDAD__"] = df[col].apply(
        lambda x: _MAP.get(str(x).strip().upper(), str(x).strip() or None)
    )
    cols["propiedad_activos"] = "__PROPIEDAD__"
