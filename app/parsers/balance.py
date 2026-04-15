"""
Parser Balance de Energía — port de /lib/parsers/balance.ts
"""
from __future__ import annotations
from typing import Optional
import io
from typing import Any
import pandas as pd

MAPEO_BALANCE_DEFAULT = {
    "tipo_archivo": "xlsx",
    "hoja":         0,
    "fila_inicio":  2,
    "columnas": {
        "codigo_frontera": "CODIGO_FRONTERA",
        "energia_kwh":     "ENERGIA_KWH",
        "valor_cop":       "VALOR_COP",
        "periodo_ajuste":  "PERIODO_AJUSTE",
        "periodo_tarifa":  "PERIODO_TARIFA",
    },
}


def _resolve_col(headers: list[str], nombre: str) -> Optional[str]:
    upper = [h.strip().upper() for h in headers]
    try:
        return headers[upper.index(nombre.strip().upper())]
    except ValueError:
        pass
    for i, h in enumerate(upper):
        if nombre.strip().upper() in h:
            return headers[i]
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
    hoja = mapeo.get("hoja", 0)
    skip = max(0, mapeo.get("fila_inicio", 2) - 2)
    tipo = mapeo.get("tipo_archivo", "xlsx")

    if tipo == "csv":
        sep = mapeo.get("separador_csv", ",")
        return pd.read_csv(
            io.BytesIO(buffer), dtype=str, keep_default_na=False,
            sep=sep, skiprows=skip if skip > 0 else None,
        )
    return pd.read_excel(
        io.BytesIO(buffer), dtype=str, keep_default_na=False,
        sheet_name=hoja, skiprows=skip if skip > 0 else None,
    )


def parsear_balance(buffer: bytes, mapeo: Optional[dict]) -> dict:
    m = mapeo or MAPEO_BALANCE_DEFAULT
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

    headers = list(df.columns)
    cols    = m.get("columnas", {})

    col_frontera   = _resolve_col(headers, cols.get("codigo_frontera", "CODIGO_FRONTERA"))
    col_energia    = _resolve_col(headers, cols.get("energia_kwh",     "ENERGIA_KWH"))
    col_valor      = _resolve_col(headers, cols.get("valor_cop",       "VALOR_COP"))
    col_periodo_aj = _resolve_col(headers, cols.get("periodo_ajuste",  "PERIODO_AJUSTE"))
    col_periodo_tar= _resolve_col(headers, cols.get("periodo_tarifa",  "PERIODO_TARIFA"))

    faltantes: list[str] = []
    if not col_frontera:   faltantes.append(f"codigo_frontera → \"{cols.get('codigo_frontera')}\"")
    if not col_energia:    faltantes.append(f"energia_kwh → \"{cols.get('energia_kwh')}\"")
    if not col_valor:      faltantes.append(f"valor_cop → \"{cols.get('valor_cop')}\"")
    if not col_periodo_aj: faltantes.append(f"periodo_ajuste → \"{cols.get('periodo_ajuste')}\"")
    if not col_periodo_tar:faltantes.append(f"periodo_tarifa → \"{cols.get('periodo_tarifa')}\"")

    if faltantes:
        errores_criticos.append({"nivel": "error", "mensaje": f"Columnas no encontradas: {' | '.join(faltantes)}"})
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    dup_check: set[str] = set()

    for i, row in df.iterrows():
        fila_num = int(i) + 2

        codigo_frontera  = str(row.get(col_frontera,    "") or "").strip()  # type: ignore[arg-type]
        periodo_ajuste   = str(row.get(col_periodo_aj,  "") or "").strip()  # type: ignore[arg-type]
        periodo_tarifa   = str(row.get(col_periodo_tar, "") or "").strip()  # type: ignore[arg-type]

        if not codigo_frontera:
            continue

        dup_key = f"{codigo_frontera}|{periodo_ajuste}"
        if dup_key in dup_check:
            errores_criticos.append({
                "nivel": "error", "fila": fila_num, "campo": "codigo_frontera",
                "mensaje": f"Combinación duplicada: frontera {codigo_frontera} / periodo_ajuste {periodo_ajuste}",
            })
            continue
        dup_check.add(dup_key)

        energia = _to_number(row.get(col_energia))  # type: ignore[arg-type]
        valor   = _to_number(row.get(col_valor))    # type: ignore[arg-type]

        if energia is None:
            errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": "energia_kwh", "mensaje": "Valor no numérico"}); continue
        if energia < 0:
            errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": "energia_kwh", "mensaje": "Energía negativa no permitida"}); continue
        if valor is None:
            errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": "valor_cop", "mensaje": "Valor no numérico"}); continue
        # valor_balance_cop puede ser negativo (abono)

        tarifa_balance = abs(valor) / energia if energia > 0 else 0.0

        filas.append({
            "codigo_frontera":     codigo_frontera,
            "periodo_ajuste":      periodo_ajuste,
            "energia_balance_kwh": energia,
            "valor_balance_cop":   valor,
            "tarifa_balance":      tarifa_balance,
            "periodo_tarifa":      periodo_tarifa,
        })

    return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}
