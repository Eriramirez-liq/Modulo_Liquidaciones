"""
Pre-procesador SDL para CEDENAR.

Transformaciones aplicadas antes del mapeo estándar de columnas:

1. Valor activa (COP): "VALOR TARIFA ACTIVA ($)" × "Activa"
   - Se crea la columna calculada "__VALOR_ACTIVA__".

2. Valor reactiva (COP): "Penalizada" × "VALOR TARIFA REACTIVA ($)"
   - Se crea la columna calculada "__VALOR_REACTIVA__".

3. Propiedad activos:
   - Fuente: columna "TARIFA I"
   - 300 o 301 → "Usuario"  |  324 → "Compartido"  |  312 → "OR"

4. Tarifa activa: viene directamente de "VALOR TARIFA ACTIVA ($)" (no se divide valor/consumo).
5. Tarifa reactiva: viene directamente de "VALOR TARIFA REACTIVA ($)" (definida en mapeo).
6. Periodo: no viene en el archivo; se toma del formulario de carga.
"""
from __future__ import annotations
import pandas as pd

_COL_TAR_ACT  = "VALOR TARIFA ACTIVA ($)"
_COL_TAR_REAC = "VALOR TARIFA REACTIVA ($)"
_COL_ACTIVA   = "Activa"
_COL_PENAL    = "Penalizada"
_COL_TARIFA_I = "TARIFA I"


def preprocesar(buffer: bytes, df: pd.DataFrame, mapeo: dict) -> tuple[pd.DataFrame, dict]:
    df    = df.copy()
    mapeo = {**mapeo, "columnas": dict(mapeo.get("columnas", {}))}
    cols  = mapeo["columnas"]

    _aplicar_valor_activa(df, cols)
    _aplicar_valor_reactiva(df, cols)
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


def _aplicar_valor_activa(df: pd.DataFrame, cols: dict) -> None:
    """Valor activa COP = VALOR TARIFA ACTIVA ($) × Activa"""
    col_tar = _find_col(df, _COL_TAR_ACT)
    col_kwh = _find_col(df, _COL_ACTIVA)
    if not col_tar or not col_kwh:
        return

    df["__VALOR_ACTIVA__"] = (
        pd.to_numeric(df[col_tar], errors="coerce").fillna(0)
        * pd.to_numeric(df[col_kwh], errors="coerce").fillna(0)
    )
    cols["valor_cop"] = "__VALOR_ACTIVA__"


def _aplicar_valor_reactiva(df: pd.DataFrame, cols: dict) -> None:
    """Valor reactiva COP = Penalizada × VALOR TARIFA REACTIVA ($)"""
    col_penal = _find_col(df, _COL_PENAL)
    col_tar   = _find_col(df, _COL_TAR_REAC)
    if not col_penal or not col_tar:
        return

    df["__VALOR_REACTIVA__"] = (
        pd.to_numeric(df[col_penal], errors="coerce").fillna(0)
        * pd.to_numeric(df[col_tar],  errors="coerce").fillna(0)
    )
    cols["valor_reactiva_cop"] = "__VALOR_REACTIVA__"


def _aplicar_propiedad(df: pd.DataFrame, cols: dict) -> None:
    """TARIFA I: 300/301 → Usuario  |  324 → Compartido  |  312 → OR"""
    col = _find_col(df, _COL_TARIFA_I)
    if not col:
        return

    _MAP = {"300": "Usuario", "301": "Usuario", "324": "Compartido", "312": "OR"}

    df["__PROPIEDAD__"] = df[col].apply(
        lambda x: _MAP.get(str(x).strip().split(".")[0])
    )
    cols["propiedad_activos"] = "__PROPIEDAD__"
