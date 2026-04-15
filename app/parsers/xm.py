"""
Parser de Reporte XM — port de /lib/parsers/xm.ts
"""
from __future__ import annotations
from typing import Optional
import io
from typing import Any
import pandas as pd

COLUMNAS_FRONTERA = ["CODIGO_FRONTERA", "COD_FRONTERA", "FRONTERA", "SIC_CODE", "SIC"]
COLUMNAS_NOMBRE   = ["NOMBRE_FRONTERA", "NOMBRE", "NOMBRE_FRONT"]
COLUMNAS_PERIODO  = ["PERIODO", "MES", "PERIODO_MES"]
COLUMNAS_ENERGIA  = ["ENERGIA_XM_KWH", "ENERGIA_KWH", "ENERGIA", "KWH", "ENERGIA_XM", "AJUSTADO"]


def _resolve_col(headers: list[str], candidates: list[str]) -> Optional[str]:
    upper = [h.strip().upper() for h in headers]
    for c in candidates:
        try:
            return headers[upper.index(c.upper())]
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
    try:
        return pd.read_excel(io.BytesIO(buffer), dtype=str, keep_default_na=False)
    except Exception:
        return pd.read_csv(io.BytesIO(buffer), dtype=str, keep_default_na=False)


def parsear_xm(
    buffer: bytes,
    periodo_id: Optional[str],
    anio: int,
    mes: int,
) -> dict:
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
    col_frontera = _resolve_col(headers, COLUMNAS_FRONTERA)
    col_nombre   = _resolve_col(headers, COLUMNAS_NOMBRE)
    col_periodo  = _resolve_col(headers, COLUMNAS_PERIODO)
    col_energia  = _resolve_col(headers, COLUMNAS_ENERGIA)

    if not col_frontera:
        errores_criticos.append({"nivel": "error", "mensaje": f"Columna codigo_frontera no encontrada. Buscado: {', '.join(COLUMNAS_FRONTERA)}"})
    if not col_energia:
        errores_criticos.append({"nivel": "error", "mensaje": f"Columna energia_xm_kwh no encontrada. Buscado: {', '.join(COLUMNAS_ENERGIA)}"})
    if errores_criticos:
        return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}

    # Obtener fronteras de facturación del período (para alerta cross-fuente)
    fronteras_fac: set[str] = set()
    if periodo_id:
        try:
            from ..models import db, RegistroFacturacion
            registros = db.session.query(RegistroFacturacion.codigo_frontera).filter_by(periodo_id=periodo_id).all()
            fronteras_fac = {r.codigo_frontera for r in registros}
        except Exception:
            pass  # Si no hay BD disponible, omitir validación cross-fuente

    fronteras_vistas: set[str] = set()
    periodo_default = f"{anio}-{mes:02d}"

    for i, row in df.iterrows():
        fila_num = int(i) + 2

        codigo_frontera = str(row.get(col_frontera, "") or "").strip()  # type: ignore[arg-type]
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

        energia = _to_number(row.get(col_energia))  # type: ignore[arg-type]
        if energia is None:
            errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": "energia_xm_kwh", "mensaje": "Valor no numérico"})
            continue
        if energia < 0:
            errores_criticos.append({"nivel": "error", "fila": fila_num, "campo": "energia_xm_kwh", "mensaje": "Energía negativa no permitida"})
            continue

        if fronteras_fac and codigo_frontera not in fronteras_fac:
            alertas.append({
                "nivel": "advertencia", "fila": fila_num, "campo": "codigo_frontera",
                "mensaje": f"Frontera {codigo_frontera} no está en Facturación BIA del período {anio}-{mes:02d}",
            })

        periodo = (
            str(row.get(col_periodo, "") or "").strip() if col_periodo else ""
        ) or periodo_default

        nombre_frontera = str(row.get(col_nombre, "") or "").strip() if col_nombre else None

        filas.append({
            "codigo_frontera": codigo_frontera,
            "nombre_frontera": nombre_frontera or None,
            "periodo":         periodo,
            "energia_xm_kwh":  energia,
        })

    return {"filas": filas, "alertas": alertas, "errores_criticos": errores_criticos}
