# -*- coding: utf-8 -*-
"""
Pre-procesador SDL para CENS.

Transformaciones aplicadas antes del mapeo estándar de columnas:

1. Valor activa (COP): columna "Valor Activa" del archivo (mapeo directo).

2. Nivel de tensión:
   - Fuente: columna "NT_PRO"
   - Extrae el primer número antes del "_": "1_100" → "1", "2_100" → "2".

3. Propiedad activos:
   - Fuente: columna "NT_PRO"
   - "1_100" → "OR"
   - "1_50"  → "Compartido"
   - "1_0"   → "Usuario"
   - "2_100" → "Usuario"

4. Valor reactiva (COP): Valor R_Inductiva + Valor R_Capacitiva.

5. Tarifa activa y reactiva vienen directamente del archivo (definidas en mapeo).
6. Periodo no viene en el archivo; se toma del formulario de carga.
"""
from __future__ import annotations
import pandas as pd

_COL_NT_PRO      = "NT_PRO"
_COL_VAL_REAC_I  = "Valor R_Inductiva"
_COL_VAL_REAC_C  = "Valor R_Capacitiva"

_PROPIEDAD_MAP = {
    "1_100": "OR",
    "1_50":  "Compartido",
    "1_0":   "Usuario",
    "1-0":   "Usuario",
    "2_100": "Usuario",
    "2_0":   "Usuario",
}


def preprocesar(buffer: bytes, df: pd.DataFrame, mapeo: dict) -> tuple[pd.DataFrame, dict]:
    df    = df.copy()
    mapeo = {**mapeo, "columnas": dict(mapeo.get("columnas", {}))}
    cols  = mapeo["columnas"]

    _aplicar_nivel_tension(df, cols)
    _aplicar_propiedad(df, cols)
    _aplicar_valor_reactiva(df, cols)

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


def _aplicar_nivel_tension(df: pd.DataFrame, cols: dict) -> None:
    """NT_PRO: toma el primer número antes del '_'. Ej: '1_100' → '1'."""
    col = _find_col(df, _COL_NT_PRO)
    if not col:
        return

    df["__NT__"] = df[col].apply(
        lambda x: str(x).strip().split("_")[0].split("-")[0] or None
    )
    cols["nivel_tension"] = "__NT__"


def _aplicar_propiedad(df: pd.DataFrame, cols: dict) -> None:
    """NT_PRO → 1_100=OR, 1_50=Compartido, 1_0/1-0/2_100=Usuario."""
    col = _find_col(df, _COL_NT_PRO)
    if not col:
        return

    df["__PROPIEDAD__"] = df[col].apply(
        lambda x: _PROPIEDAD_MAP.get(str(x).strip())
    )
    cols["propiedad_activos"] = "__PROPIEDAD__"


def _aplicar_valor_reactiva(df: pd.DataFrame, cols: dict) -> None:
    """Valor reactiva COP = Valor R_Inductiva + Valor R_Capacitiva."""
    col_ind = _find_col(df, _COL_VAL_REAC_I)
    col_cap = _find_col(df, _COL_VAL_REAC_C)
    if not col_ind or not col_cap:
        return

    df["__VALOR_REACTIVA__"] = (
        pd.to_numeric(df[col_ind], errors="coerce").fillna(0)
        + pd.to_numeric(df[col_cap], errors="coerce").fillna(0)
    )
    cols["valor_reactiva_cop"] = "__VALOR_REACTIVA__"
