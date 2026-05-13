# -*- coding: utf-8 -*-
"""
Pre-procesador SDL para ESSA.

Transformaciones:
1. Factor M: columna cuyo nombre sigue el patrón "M ENE", "M FEB", "M MAR"…
   (el mes cambia cada período; se detecta automáticamente).
2. Propiedad activos:
   - NT 2 o 3       → "Usuario"
   - NT 1 + PROP=1  → "Usuario"
   - NT 1 + PROP=2  → "OR"
3. Valor reactiva (COP): PEAJE INDUCTIVA + PEAJE CAPACITIVA
"""
from __future__ import annotations
import re
import unicodedata
import pandas as pd


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").strip().upper()


# Patrón: "M " seguido de 2-4 letras (ENE, FEB, MAR, ABR, MAY, JUN, JUL, AGO, SEP, OCT, NOV, DIC)
_RE_FACTOR_M = re.compile(r"^M\s+[A-Z]{2,4}$")


def preprocesar(buffer: bytes, df: pd.DataFrame, mapeo: dict) -> tuple[pd.DataFrame, dict]:
    df    = df.copy()
    mapeo = {**mapeo, "columnas": dict(mapeo.get("columnas", {}))}
    cols  = mapeo["columnas"]

    df.columns = [str(c).strip() for c in df.columns]

    col_nt      = _find_col(df, "NIVEL TENSION")
    col_prop    = _find_col(df, "PROPIEDAD")
    col_ind     = _find_col(df, "PEAJE INDUCTIVA")
    col_cap     = _find_col(df, "PEAJE CAPACITIVA")
    col_m       = _find_factor_m(df)

    # 1. Factor M: detectado dinámicamente
    if col_m:
        cols["factor_m"] = col_m

    # 2. Propiedad: NT 2/3 → Usuario; NT 1 → usar columna PROPIEDAD
    if col_nt:
        def _propiedad(row) -> "str | None":
            nt = _parse_int(row[col_nt])
            if nt in (2, 3):
                return "Usuario"
            if nt == 1 and col_prop:
                p = _parse_int(row[col_prop])
                if p == 1:
                    return "Usuario"
                if p == 2:
                    return "OR"
            return None
        df["__PROPIEDAD__"] = df.apply(_propiedad, axis=1)
        cols["propiedad_activos"] = "__PROPIEDAD__"

    # 3. Valor reactiva = PEAJE INDUCTIVA + PEAJE CAPACITIVA
    if col_ind or col_cap:
        ind = pd.to_numeric(df[col_ind], errors="coerce").fillna(0) if col_ind else 0
        cap = pd.to_numeric(df[col_cap], errors="coerce").fillna(0) if col_cap else 0
        df["__VALOR_REAC__"] = ind + cap
        cols["valor_reactiva_cop"] = "__VALOR_REAC__"

    return df, mapeo


# ── Helpers ────────────────────────────────────────────────────────────────────

def _find_col(df: pd.DataFrame, nombre: str) -> "str | None":
    idx = {_norm(c): c for c in df.columns}
    nombre_up = _norm(nombre)
    if nombre_up in idx:
        return idx[nombre_up]
    for key, col in idx.items():
        if key in nombre_up or nombre_up in key:
            return col
    return None


def _find_factor_m(df: pd.DataFrame) -> "str | None":
    """Busca la columna Factor M dinámica: 'M ENE', 'M FEB', 'M MAR', etc."""
    for col in df.columns:
        if _RE_FACTOR_M.match(_norm(col)):
            return col
    return None


def _parse_int(val) -> "int | None":
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return None
