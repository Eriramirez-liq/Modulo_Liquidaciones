# app/parsers/__init__.py
"""
Paquete de parsers de archivos para las 4 fuentes de conciliación.
Port de /lib/parsers/*.ts de TypeScript a Python.
"""
from typing import Optional
from .facturacion import parsear_facturacion
from .xm          import parsear_xm
from .sdl         import parsear_sdl
from .balance     import parsear_balance
from .tc1         import parsear_tc1


def parsear_archivo(
    buffer: bytes,
    tipo_fuente: str,
    periodo: str,
    periodo_id: Optional[str],
    or_id: Optional[str],
    anio: int,
    mes: int,
    mapeo: Optional[dict] = None,
) -> dict:
    """
    Dispatcher principal. Enruta al parser correcto según tipo_fuente.
    Retorna: { "filas": list[dict], "alertas": list[dict], "errores_criticos": list[dict] }
    """
    if tipo_fuente == "FACTURACION":
        return parsear_facturacion(buffer, periodo)
    elif tipo_fuente == "XM":
        return parsear_xm(buffer, periodo_id, anio, mes)
    elif tipo_fuente == "SDL":
        return parsear_sdl(buffer, mapeo, or_id, periodo_id, anio, mes)
    elif tipo_fuente == "BALANCE":
        return parsear_balance(buffer, mapeo)
    elif tipo_fuente == "TC1":
        return parsear_tc1(buffer)
    else:
        raise ValueError(f"Tipo de fuente desconocido: {tipo_fuente}")
