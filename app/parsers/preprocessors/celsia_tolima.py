"""
Pre-procesador SDL para CELSIA TOLIMA.

Transformaciones aplicadas antes del mapeo estándar de columnas:

1. Propiedad activos:
   - Fuente: columna "Propiedad Activo"
   - "100% USUARIO" o "N/A" → "Usuario"
   - "100% OPERADOR"        → "OR"
   - "50% OPERADOR"         → "Compartido"

2. Tarifa activa y reactiva vienen directamente del archivo (definidas en mapeo).
3. Periodo no viene en el archivo; se toma del formulario de carga.
"""
from __future__ import annotations
import pandas as pd

_COL_PROPIEDAD = "Propiedad Activo"


def preprocesar(buffer: bytes, df: pd.DataFrame, mapeo: dict) -> tuple[pd.DataFrame, dict]:
    df    = df.copy()
    mapeo = {**mapeo, "columnas": dict(mapeo.get("columnas", {}))}
    cols  = mapeo["columnas"]

    _aplicar_propiedad(df, cols)

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


def _aplicar_propiedad(df: pd.DataFrame, cols: dict) -> None:
    """
    100% USUARIO / N/A → Usuario
    100% OPERADOR      → OR
    50% OPERADOR       → Compartido
    """
    col = _find_col(df, _COL_PROPIEDAD)
    if not col:
        return

    def _mapear(x: str) -> str | None:
        v = str(x).strip().upper()
        if v in ("N/A", "") or "USUARIO" in v:
            return "Usuario"
        if "OPERADOR" in v and "50%" in v:
            return "Compartido"
        if "OPERADOR" in v:
            return "OR"
        return str(x).strip() or None

    df["__PROPIEDAD__"] = df[col].apply(_mapear)
    cols["propiedad_activos"] = "__PROPIEDAD__"
