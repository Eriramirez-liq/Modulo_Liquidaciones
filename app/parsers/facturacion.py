"""
Parser de Facturación BIA — port de /lib/parsers/facturacion.ts
Lee archivos Excel/CSV con los datos de facturación del período.
"""
from __future__ import annotations
from typing import Optional
import io
from typing import Any
import openpyxl
import pandas as pd

# Columnas requeridas y sus aliases posibles
COLUMNAS: dict[str, list[str]] = {
    "codigo_frontera":  ["CODIGO_FRONTERA", "COD_FRONTERA", "FRONTERA", "SIC", "SIC_CODE"],
    "nombre_usuario":   ["NOMBRE_USUARIO", "NOMBRE", "USUARIO"],
    "operador_red":     ["OPERADOR_RED", "OR", "OPERADOR", "LAST_OPERATOR"],
    "periodo":          ["PERIODO", "MES", "PERIODO_MES"],
    "energia_kwh":      ["ENERGIA_KWH", "ENERGIA", "KWH", "ENERGIA_FACTURADA_KWH", "ACTIVA"],
    "g_bia":            ["G_BIA", "G"],
    "t_bia":            ["T_BIA", "T"],
    "d_bia":            ["D_BIA", "D"],
    "pr_bia":           ["PR_BIA", "PR"],
    "r_bia":            ["R_BIA", "R"],
    "c_bia":            ["C_BIA", "C"],
    "tarifa_total_bia": ["TARIFA_TOTAL_BIA", "TARIFA_TOTAL", "TARIFA"],
}

# Columnas opcionales (si no existen no generan error, se almacena None)
COLUMNAS_OPCIONALES: dict[str, list[str]] = {
    "nivel_tension": ["NIVEL DE TENSION", "NIVEL TENSION", "NIVEL DE TENSIÓN", "NIVEL TENSIÓN", "NT"],
    "niu":           ["NIU"],
}


def _resolve_col(headers: list[str], candidates: list[str]) -> Optional[str]:
    upper = [h.strip().upper() for h in headers]
    for c in candidates:
        try:
            idx = upper.index(c.upper())
            return headers[idx]
        except ValueError:
            continue
    return None


def _to_number(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        n = float(v)
        return None if pd.isna(n) else n
    except (ValueError, TypeError):
        return None


def _leer_df(buffer: bytes) -> pd.DataFrame:
    """Lee un buffer (xlsx o csv) y devuelve un DataFrame."""
    try:
        return pd.read_excel(io.BytesIO(buffer), dtype=str, keep_default_na=False)
    except Exception:
        return pd.read_csv(io.BytesIO(buffer), dtype=str, keep_default_na=False)


def parsear_facturacion(buffer: bytes, periodo: str) -> dict:
    """
    Parsea el archivo de facturación BIA.
    Retorna: { filas, alertas, errores_criticos }
    """
    alertas: list[dict] = []
    errores_criticos: list[dict] = []
    filas: list[dict] = []

    try:
        df = _leer_df(buffer)
    except Exception as e:
        errores_criticos.append({"nivel": "error", "mensaje": f"No se pudo leer el archivo: {e}"})
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    if df.empty:
        errores_criticos.append({"nivel": "error", "mensaje": "El archivo está vacío o no tiene datos."})
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    headers = list(df.columns)

    # Resolver columnas requeridas
    col_map: dict[str, str] = {}
    for campo, candidatos in COLUMNAS.items():
        col = _resolve_col(headers, candidatos)
        if not col:
            errores_criticos.append({
                "nivel": "error",
                "campo": campo,
                "mensaje": f"Columna requerida no encontrada. Se buscó: {', '.join(candidatos)}",
            })
        else:
            col_map[campo] = col

    if errores_criticos:
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    # Resolver columnas opcionales (no generan error si no existen)
    col_opt: dict[str, Optional[str]] = {}
    for campo, candidatos in COLUMNAS_OPCIONALES.items():
        col_opt[campo] = _resolve_col(headers, candidatos)

    fronteras_vistas: set[str] = set()

    for i, row in df.iterrows():
        fila_num = int(i) + 2  # +2 por encabezado

        codigo_frontera = str(row.get(col_map["codigo_frontera"], "") or "").strip()
        if not codigo_frontera:
            errores_criticos.append({"nivel": "error", "fila": fila_num, "mensaje": "codigo_frontera vacío"})
            continue

        if codigo_frontera in fronteras_vistas:
            errores_criticos.append({
                "nivel": "error", "fila": fila_num, "campo": "codigo_frontera",
                "mensaje": f"Frontera duplicada en el archivo: {codigo_frontera}",
            })
            continue
        fronteras_vistas.add(codigo_frontera)

        # Valores numéricos
        nums = {
            "energia_kwh":      _to_number(row.get(col_map["energia_kwh"])),
            "g_bia":            _to_number(row.get(col_map["g_bia"])),
            "t_bia":            _to_number(row.get(col_map["t_bia"])),
            "d_bia":            _to_number(row.get(col_map["d_bia"])),
            "pr_bia":           _to_number(row.get(col_map["pr_bia"])),
            "r_bia":            _to_number(row.get(col_map["r_bia"])),
            "c_bia":            _to_number(row.get(col_map["c_bia"])),
            "tarifa_total_bia": _to_number(row.get(col_map["tarifa_total_bia"])),
        }

        fila_con_error = False
        for campo, valor in nums.items():
            if valor is None:
                errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": campo, "mensaje": "Valor no numérico"})
                fila_con_error = True
            elif valor < 0:
                errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": campo, "mensaje": "Valor negativo no permitido"})
                fila_con_error = True
        if fila_con_error:
            continue

        # Validar suma tarifaria: G+T+D+PR+R+C debe ≈ tarifa_total
        suma = nums["g_bia"] + nums["t_bia"] + nums["d_bia"] + nums["pr_bia"] + nums["r_bia"] + nums["c_bia"]  # type: ignore[operator]
        if abs(nums["tarifa_total_bia"] - suma) > 0.01:  # type: ignore[operator]
            errores_criticos.append({
                "nivel": "error", "fila": fila_num, "campo": "tarifa_total_bia",
                "mensaje": (
                    f"tarifa_total_bia ({nums['tarifa_total_bia']:.6f}) difiere de "
                    f"G+T+D+PR+R+C ({suma:.6f}) en más de 0.01"
                ),
            })
            continue

        operador_red = str(row.get(col_map["operador_red"], "") or "").strip()

        # Columnas opcionales
        nivel_tension = str(row.get(col_opt["nivel_tension"], "") or "").strip() if col_opt.get("nivel_tension") else None  # type: ignore[arg-type]
        niu = str(row.get(col_opt["niu"], "") or "").strip() if col_opt.get("niu") else None  # type: ignore[arg-type]

        filas.append({
            "codigo_frontera":  codigo_frontera,
            "nombre_usuario":   str(row.get(col_map["nombre_usuario"], "") or "").strip(),
            "operador_red":     operador_red,
            "periodo":          str(row.get(col_map["periodo"], "") or periodo).strip(),
            "energia_kwh":      nums["energia_kwh"],
            "g_bia":            nums["g_bia"],
            "t_bia":            nums["t_bia"],
            "d_bia":            nums["d_bia"],
            "pr_bia":           nums["pr_bia"],
            "r_bia":            nums["r_bia"],
            "c_bia":            nums["c_bia"],
            "tarifa_total_bia": nums["tarifa_total_bia"],
            "nivel_tension":    nivel_tension or None,
            "niu":              niu or None,
        })

    return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}
