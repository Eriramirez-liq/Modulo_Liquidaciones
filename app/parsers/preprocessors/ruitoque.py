# -*- coding: utf-8 -*-
"""
Pre-procesador SDL para RUITOQUE.

Transformaciones:
1. Propiedad activos desde NT:
   - NT 2 o 3 → "Usuario"
   - NT 1      → None (pendiente módulo Tarifas)
2. Valor reactiva (COP): Valor R_Inductiva + Valor R_Capacitiva
"""
from __future__ import annotations
import unicodedata
import pandas as pd


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").strip().upper()


def preprocesar(buffer: bytes, df: pd.DataFrame, mapeo: dict) -> tuple[pd.DataFrame, dict]:
    df    = df.copy()
    mapeo = {**mapeo, "columnas": dict(mapeo.get("columnas", {}))}
    cols  = mapeo["columnas"]

    df.columns = [str(c).strip() for c in df.columns]

    col_nt      = _find_col(df, "NT")
    col_val_ind = _find_col(df, "Valor R_Inductiva")
    col_val_cap = _find_col(df, "Valor R_Capacitiva")

    # 1. Propiedad: NT 2/3 → Usuario, NT 1 → None (pendiente Tarifas)
    if col_nt:
        df["__PROPIEDAD__"] = df[col_nt].apply(_mapear_propiedad)
        cols["propiedad_activos"] = "__PROPIEDAD__"

    # 2. Valor reactiva = Ind + Cap
    if col_val_ind or col_val_cap:
        ind = pd.to_numeric(df[col_val_ind], errors="coerce").fillna(0) if col_val_ind else 0
        cap = pd.to_numeric(df[col_val_cap], errors="coerce").fillna(0) if col_val_cap else 0
        df["__VALOR_REAC__"] = ind + cap
        cols["valor_reactiva_cop"] = "__VALOR_REAC__"

    return df, mapeo


# ── Helpers ────────────────────────────────────────────────────────────────────

def _find_col(df: pd.DataFrame, nombre: str) -> str | None:
    idx = {_norm(c): c for c in df.columns}
    nombre_up = _norm(nombre)
    if nombre_up in idx:
        return idx[nombre_up]
    for key, col in idx.items():
        if key in nombre_up or nombre_up in key:
            return col
    return None


def _mapear_propiedad(nt_val) -> "str | None":
    """NT 2/3 → Usuario. NT 1 → None (pendiente módulo Tarifas)."""
    try:
        n = int(float(str(nt_val).strip()))
        return "Usuario" if n in (2, 3) else None
    except (ValueError, TypeError):
        return None
