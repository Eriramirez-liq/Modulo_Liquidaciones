# -*- coding: utf-8 -*-
"""
Modulo Tarifas SDL — stub pendiente de implementacion.

Cuando la tabla TarifaSDL exista en la BD, implementar el cuerpo de
consultar_tarifa() descomentando el bloque marcado con TODO.

Logica esperada:
  Entrada : or_codigo, periodo ("YYYY-MM"), nivel_tension ("1"/"2"/"3"),
            tarifa_reactiva (valor numerico de referencia para identificar
            el tipo de tarifa y la propiedad de activos asociada)
  Salida  : (tarifa_activa, propiedad_activos)
              tarifa_activa    -> float | None  (COP/kWh)
              propiedad_activos -> "Usuario" | "OR" | None

Tabla esperada en BD (modelo TarifaSDL):
  or_codigo          VARCHAR    FK -> configuracion_or.codigo
  periodo            VARCHAR    "YYYY-MM"
  nivel_tension      VARCHAR    "1", "2", "3"
  propiedad_activos  VARCHAR    "Usuario", "OR"
  tarifa_activa      NUMERIC    COP/kWh
  tarifa_reactiva    NUMERIC    COP/kVarh  (clave de busqueda para EMSA y otros OR)
"""
from __future__ import annotations
from typing import Optional


def consultar_tarifa(
    or_codigo: str,
    periodo: str,
    nivel_tension: str,
    tarifa_reactiva: Optional[float] = None,
) -> tuple[Optional[float], Optional[str]]:
    """
    Retorna (tarifa_activa, propiedad_activos) para un OR y periodo dados.

    Mientras el modulo de Tarifas no este construido retorna (None, None)
    y el preprocesador deja valor_cop=0 y propiedad_activos=None.
    """
    # TODO: activar cuando exista el modelo TarifaSDL
    #
    # from ..models import db, TarifaSDL
    # try:
    #     q = TarifaSDL.query.filter_by(
    #         or_codigo=or_codigo,
    #         periodo=periodo,
    #         nivel_tension=str(nivel_tension),
    #     )
    #     if tarifa_reactiva is not None:
    #         # Identificar propiedad por la tarifa reactiva del archivo
    #         # (cada combinacion nivel+propiedad tiene una tarifa reactiva distinta)
    #         tol = max(abs(tarifa_reactiva) * 0.001, 0.01)
    #         q = q.filter(
    #             TarifaSDL.tarifa_reactiva.between(tarifa_reactiva - tol, tarifa_reactiva + tol)
    #         )
    #     reg = q.first()
    #     if reg:
    #         return reg.tarifa_activa, reg.propiedad_activos
    # except Exception:
    #     pass
    return None, None


def consultar_por_activa(
    or_codigo: str,
    periodo: str,
    nivel_tension: str,
    tarifa_activa: Optional[float] = None,
) -> tuple[Optional[float], Optional[str]]:
    """
    Consulta tarifa_reactiva y propiedad_activos dado un OR con tarifa_activa conocida.

    Usada por ORs como ENEL donde la tarifa activa se calcula en el archivo
    (VALOR SDL ACT / CONSUMO ACTIVA) y de ahi se infieren los demas datos.

    Logica:
      - Buscar por (OR, periodo, nivel_tension, tarifa_activa)
      - Retornar (tarifa_reactiva, propiedad_activos)

    Pendiente: implementar cuando exista el modelo TarifaSDL en la BD.
    """
    # TODO: implementar cuando exista TarifaSDL
    #
    # from ..models import db, TarifaSDL
    # try:
    #     tol = max(abs(tarifa_activa) * 0.001, 0.01) if tarifa_activa else 0.01
    #     reg = TarifaSDL.query.filter_by(
    #         or_codigo=or_codigo,
    #         periodo=periodo,
    #         nivel_tension=str(nivel_tension),
    #     ).filter(
    #         TarifaSDL.tarifa_activa.between(tarifa_activa - tol, tarifa_activa + tol)
    #     ).first()
    #     if reg:
    #         return reg.tarifa_reactiva, reg.propiedad_activos
    # except Exception:
    #     pass
    return None, None
