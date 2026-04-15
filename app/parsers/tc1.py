"""
Parser TC1 — Reporte de Conexiones de Red (XM/SUI).
Captura nivel de tensión, propiedad de activos y datos de conexión por frontera.
El identificador es CODIGO FRONTERA COMERCIAL (= código SIC).
"""
from __future__ import annotations
from typing import Optional, Any
import io
import pandas as pd


# Columnas y sus aliases posibles
COLUMNAS_FRONTERA  = ["CODIGO FRONTERA COMERCIAL", "CODIGO_FRONTERA", "SIC", "FRONTERA"]
COLUMNAS_NIU       = ["NIU"]
COLUMNAS_NIVEL_T   = ["NIVEL DE TENSION", "NIVEL_TENSION", "NT"]
COLUMNAS_NIVEL_T_P = ["NIVEL DE TENSION PRIMARIO", "NT_PRIMARIO"]
COLUMNAS_PROPIEDAD = ["PORCENTAJE PROPIEDAD DEL ACTIVO", "PROPIEDAD", "PROPIETARIO"]
COLUMNAS_TIPO_CON  = ["TIPO DE CONEXION", "TIPO_CONEXION"]
COLUMNAS_CONEXION  = ["CONEXION DE RED", "CONEXION_RED"]
COLUMNAS_ID_COMERC = ["ID COMERCIALIZADOR", "ID_COMERCIALIZADOR"]


def _resolve_col(headers: list[str], candidates: list[str]) -> Optional[str]:
    upper = [h.strip().upper() for h in headers]
    for c in candidates:
        c_up = c.strip().upper()
        try:
            return headers[upper.index(c_up)]
        except ValueError:
            continue
    # Fallback: contiene
    for c in candidates:
        c_up = c.strip().upper()
        for i, h in enumerate(upper):
            if c_up in h:
                return headers[i]
    return None


def _to_str(v: Any) -> Optional[str]:
    s = str(v or "").strip()
    return s if s else None


def _to_int(v: Any) -> Optional[int]:
    try:
        return int(str(v).strip())
    except (ValueError, TypeError):
        return None


def parsear_tc1(buffer: bytes) -> dict:
    """
    Parsea el archivo TC1 de XM/SUI.
    Retorna: { filas, alertas, errores_criticos }
    Cada fila contiene los datos de configuración técnica de la frontera.
    """
    alertas: list[dict] = []
    errores_criticos: list[dict] = []
    filas: list[dict] = []

    try:
        df = pd.read_excel(io.BytesIO(buffer), dtype=str, keep_default_na=False)
    except Exception as e:
        errores_criticos.append({"nivel": "error", "mensaje": f"No se pudo leer el archivo: {e}"})
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    if df.empty:
        errores_criticos.append({"nivel": "error", "mensaje": "El archivo está vacío o no tiene datos."})
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    headers = list(df.columns)

    col_frontera  = _resolve_col(headers, COLUMNAS_FRONTERA)
    col_niu       = _resolve_col(headers, COLUMNAS_NIU)
    col_nivel_t   = _resolve_col(headers, COLUMNAS_NIVEL_T)
    col_nivel_t_p = _resolve_col(headers, COLUMNAS_NIVEL_T_P)
    col_propiedad = _resolve_col(headers, COLUMNAS_PROPIEDAD)
    col_tipo_con  = _resolve_col(headers, COLUMNAS_TIPO_CON)
    col_conexion  = _resolve_col(headers, COLUMNAS_CONEXION)
    col_id_comerc = _resolve_col(headers, COLUMNAS_ID_COMERC)

    if not col_frontera:
        errores_criticos.append({
            "nivel": "error",
            "mensaje": f"Columna código de frontera no encontrada. Buscado: {', '.join(COLUMNAS_FRONTERA)}",
        })
    if not col_nivel_t:
        errores_criticos.append({
            "nivel": "error",
            "mensaje": f"Columna nivel de tensión no encontrada. Buscado: {', '.join(COLUMNAS_NIVEL_T)}",
        })
    if errores_criticos:
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    fronteras_vistas: set[str] = set()

    for i, row in df.iterrows():
        fila_num = int(i) + 2

        codigo_frontera = _to_str(row.get(col_frontera))  # type: ignore[arg-type]
        if not codigo_frontera:
            continue

        if codigo_frontera in fronteras_vistas:
            alertas.append({
                "nivel": "advertencia", "fila": fila_num, "campo": "codigo_frontera",
                "mensaje": f"Frontera duplicada en TC1: {codigo_frontera}",
            })
        fronteras_vistas.add(codigo_frontera)

        nivel_tension    = _to_str(row.get(col_nivel_t))    if col_nivel_t   else None  # type: ignore[arg-type]
        nivel_tension_p  = _to_str(row.get(col_nivel_t_p))  if col_nivel_t_p else None  # type: ignore[arg-type]
        pct_propiedad    = _to_str(row.get(col_propiedad))   if col_propiedad else None  # type: ignore[arg-type]
        tipo_conexion    = _to_str(row.get(col_tipo_con))    if col_tipo_con  else None  # type: ignore[arg-type]
        conexion_red     = _to_str(row.get(col_conexion))    if col_conexion  else None  # type: ignore[arg-type]
        id_comercializador = _to_str(row.get(col_id_comerc)) if col_id_comerc else None  # type: ignore[arg-type]
        niu              = _to_str(row.get(col_niu))          if col_niu       else None  # type: ignore[arg-type]

        filas.append({
            "codigo_frontera":       codigo_frontera,
            "niu":                   niu,
            "nivel_tension":         nivel_tension,
            "nivel_tension_primario": nivel_tension_p,
            "pct_propiedad_activo":  pct_propiedad,
            "tipo_conexion":         tipo_conexion,
            "conexion_red":          conexion_red,
            "id_comercializador":    id_comercializador,
        })

    return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}
