# -*- coding: utf-8 -*-
"""
Pre-procesador SDL para EDEQ.

Transformaciones:
1. Nivel de tensión: extrae solo el número de "Nivel X de la Frontera" → "1", "2"…
2. Propiedad activos:
   - "100% EDEQ"    → "OR"
   - "100% USUARIO" → "Usuario"
   - "N/A" + nivel 2 o 3 → "Usuario"
3. Valor reactiva (COP): Valor Reactiva Inductiva Penalizada + Valor Reactiva Capacitiva Penalizada
4. Tarifa reactiva: Valor Reactiva Inductiva Penalizada / Energía Reactiva Inductiva Penalizada / Factor M
"""
from __future__ import annotations
import re
import unicodedata
import pandas as pd


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").strip().upper()


def preprocesar(buffer: bytes, df: pd.DataFrame, mapeo: dict) -> tuple[pd.DataFrame, dict]:
    df    = df.copy()
    mapeo = {**mapeo, "columnas": dict(mapeo.get("columnas", {}))}
    cols  = mapeo["columnas"]

    df.columns = [str(c).strip() for c in df.columns]

    col_nivel   = _find_col(df, "Nivel de Tensión  de la Frontera")
    col_prop    = _find_col(df, "Propiedad")
    col_val_ind = _find_col(df, "Valor Reactiva Inductiva Penalizada")
    col_val_cap = _find_col(df, "Valor Reactiva Capacitiva Penalizada")
    col_kwh_ind = _find_col(df, "Energía Reactiva Inductiva Penalizada")
    col_factor  = _find_col(df, "Factor M (Energia Reactiva )")

    # 1. Nivel de tensión → solo el número
    if col_nivel:
        df["__NIVEL__"] = df[col_nivel].apply(_extraer_nivel)
        cols["nivel_tension"] = "__NIVEL__"

    # 2. Propiedad activos (usa nivel ya calculado para el caso N/A)
    if col_prop:
        nivel_col = "__NIVEL__" if col_nivel else None
        df["__PROPIEDAD__"] = df.apply(
            lambda row: _mapear_propiedad(row[col_prop], row[nivel_col] if nivel_col else None),
            axis=1,
        )
        cols["propiedad_activos"] = "__PROPIEDAD__"

    # 3. Valor reactiva = Ind + Cap
    if col_val_ind or col_val_cap:
        ind = pd.to_numeric(df[col_val_ind], errors="coerce").fillna(0) if col_val_ind else 0
        cap = pd.to_numeric(df[col_val_cap], errors="coerce").fillna(0) if col_val_cap else 0
        df["__VALOR_REAC__"] = ind + cap
        cols["valor_reactiva_cop"] = "__VALOR_REAC__"

    # 4. Tarifa reactiva = Valor Ind / KWH Ind / Factor M
    if col_val_ind and col_kwh_ind and col_factor:
        def _tar(row) -> "float | None":
            v = pd.to_numeric(row[col_val_ind], errors="coerce")
            k = pd.to_numeric(row[col_kwh_ind], errors="coerce")
            m = pd.to_numeric(row[col_factor],  errors="coerce")
            if pd.isna(v) or pd.isna(k) or k == 0:
                return None
            t = v / k
            if not pd.isna(m) and m != 0:
                t = t / m
            return float(t)
        df["__TARIFA_REAC__"] = df.apply(_tar, axis=1)
        cols["tarifa_reactiva"] = "__TARIFA_REAC__"

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


def _extraer_nivel(x) -> "str | None":
    """'Nivel 1' → '1',  'Nivel 2' → '2', etc."""
    m = re.search(r"\d+", str(x).strip())
    return m.group(0) if m else (str(x).strip() or None)


def _mapear_propiedad(prop_val, nivel_val) -> "str | None":
    v = str(prop_val).strip().upper()
    if "EDEQ" in v:
        return "OR"
    if "USUARIO" in v:
        return "Usuario"
    if "N/A" in v or v == "N/A":
        try:
            if int(str(nivel_val).strip()) in (2, 3):
                return "Usuario"
        except (ValueError, TypeError):
            pass
        return None
    return str(prop_val).strip() or None
