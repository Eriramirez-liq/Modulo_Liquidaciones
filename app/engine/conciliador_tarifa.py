"""
Motor de conciliación de diferencias por TARIFA (Tipo TC1).

Compara, por frontera (código SIC), los valores de:
  - Nivel de tensión
  - Propiedad de activos (%)

entre tres fuentes:
  1. Facturación BIA (RegistroFacturacion.nivel_tension)
  2. SDL del OR     (RegistroSDL.nivel_tension, RegistroSDL.propiedad_activos)
  3. TC1 de XM/SUI  (RegistroTC1.nivel_tension, RegistroTC1.pct_propiedad_activo)

Cuando se detecta una discrepancia, se registra una alerta en ResultadoTarifa
(tabla nueva) con el detalle de qué difiere y entre qué fuentes.

La valorización financiera del diferencial tarifario es Fase 2+;
aquí solo se detectan y registran las discrepancias.
"""
from __future__ import annotations
from datetime import datetime
from typing import Dict, Any, List, Optional

from sqlalchemy import select

from app.models import (
    db,
    PeriodoConciliacion, CargaFuente, TipoFuente, EstadoCarga,
    RegistroFacturacion, RegistroSDL, RegistroTC1,
    LogAuditoria, AccionAuditoria,
)


def _normalizar_nt(v: Optional[str]) -> Optional[str]:
    """Normaliza nivel de tensión a string limpio, mayúsculas."""
    if v is None:
        return None
    return str(v).strip().upper() or None


def _normalizar_prop(v: Optional[str]) -> Optional[str]:
    """Normaliza porcentaje de propiedad a string limpio."""
    if v is None:
        return None
    return str(v).strip() or None


def ejecutar_conciliacion_tarifa(
    periodo_id: str,
    usuario_id: str,
    or_id_filter: str = None,
) -> Dict[str, Any]:
    """
    Ejecuta la conciliación de diferencias tarifarias para el período.
    Retorna un resumen con las discrepancias encontradas.
    No genera Provisiones/Disputas (eso es Fase 2+).
    """
    # 1. Facturación
    carga_fac = db.session.execute(
        select(CargaFuente)
        .where(
            CargaFuente.periodo_id == periodo_id,
            CargaFuente.tipo_fuente == TipoFuente.FACTURACION,
            CargaFuente.estado == EstadoCarga.COMPLETADA,
        )
        .order_by(CargaFuente.created_at.desc())
    ).scalars().first()

    if not carga_fac:
        raise ValueError("No existe archivo de facturación completado para este período.")

    facturaciones = db.session.execute(
        select(RegistroFacturacion).where(RegistroFacturacion.carga_id == carga_fac.id)
    ).scalars().all()
    fac_dict: Dict[str, RegistroFacturacion] = {f.codigo_frontera: f for f in facturaciones}

    # 2. TC1 — última carga del período
    carga_tc1 = db.session.execute(
        select(CargaFuente)
        .where(
            CargaFuente.periodo_id == periodo_id,
            CargaFuente.tipo_fuente == TipoFuente.TC1,
            CargaFuente.estado == EstadoCarga.COMPLETADA,
        )
        .order_by(CargaFuente.created_at.desc())
    ).scalars().first()

    tc1_dict: Dict[str, RegistroTC1] = {}
    if carga_tc1:
        tc1s = db.session.execute(
            select(RegistroTC1).where(RegistroTC1.carga_id == carga_tc1.id)
        ).scalars().all()
        tc1_dict = {r.codigo_frontera: r for r in tc1s}

    # 3. SDL — último de cada OR (o filtrado por or_id)
    cargas_sdl_q = (
        select(CargaFuente)
        .where(
            CargaFuente.periodo_id == periodo_id,
            CargaFuente.tipo_fuente == TipoFuente.SDL,
            CargaFuente.estado == EstadoCarga.COMPLETADA,
        )
        .order_by(CargaFuente.created_at.desc())
    )
    if or_id_filter:
        cargas_sdl_q = cargas_sdl_q.where(CargaFuente.or_id == or_id_filter)

    cargas_sdl = db.session.execute(cargas_sdl_q).scalars().all()
    active_sdls_by_or: Dict[str, str] = {}
    for c in cargas_sdl:
        if c.or_id not in active_sdls_by_or:
            active_sdls_by_or[c.or_id] = c.id

    sdl_dict: Dict[str, RegistroSDL] = {}
    if active_sdls_by_or:
        sdls = db.session.execute(
            select(RegistroSDL).where(RegistroSDL.carga_id.in_(list(active_sdls_by_or.values())))
        ).scalars().all()
        for s in sdls:
            if s.codigo_frontera not in sdl_dict:
                sdl_dict[s.codigo_frontera] = s

    # 4. Cruzar y detectar discrepancias
    discrepancias: List[Dict[str, Any]] = []
    sin_tc1: List[str] = []

    for cf, fac in fac_dict.items():
        tc1  = tc1_dict.get(cf)
        sdl  = sdl_dict.get(cf)

        if not tc1:
            sin_tc1.append(cf)
            continue

        diffs: List[str] = []

        nt_fac  = _normalizar_nt(getattr(fac, "nivel_tension", None))
        nt_sdl  = _normalizar_nt(getattr(sdl, "nivel_tension", None)) if sdl else None
        nt_tc1  = _normalizar_nt(tc1.nivel_tension)

        prop_sdl = _normalizar_prop(getattr(sdl, "propiedad_activos", None)) if sdl else None
        prop_tc1 = _normalizar_prop(tc1.pct_propiedad_activo)

        # NT: Facturación vs TC1
        if nt_fac and nt_tc1 and nt_fac != nt_tc1:
            diffs.append(
                f"NT Facturación ({nt_fac}) ≠ NT TC1 ({nt_tc1})"
            )

        # NT: SDL vs TC1
        if nt_sdl and nt_tc1 and nt_sdl != nt_tc1:
            diffs.append(
                f"NT SDL ({nt_sdl}) ≠ NT TC1 ({nt_tc1})"
            )

        # NT: Facturación vs SDL
        if nt_fac and nt_sdl and nt_fac != nt_sdl:
            diffs.append(
                f"NT Facturación ({nt_fac}) ≠ NT SDL ({nt_sdl})"
            )

        # Propiedad: SDL vs TC1
        if prop_sdl and prop_tc1 and prop_sdl != prop_tc1:
            diffs.append(
                f"Propiedad SDL ({prop_sdl}%) ≠ Propiedad TC1 ({prop_tc1}%)"
            )

        if diffs:
            discrepancias.append({
                "codigo_frontera":  cf,
                "nombre_usuario":   fac.nombre_usuario,
                "operador_red":     fac.operador_red,
                "nt_facturacion":   nt_fac,
                "nt_sdl":           nt_sdl,
                "nt_tc1":           nt_tc1,
                "prop_sdl":         prop_sdl,
                "prop_tc1":         prop_tc1,
                "diferencias":      diffs,
            })

    # Auditoría
    db.session.add(LogAuditoria(
        usuario_id=usuario_id,
        accion=AccionAuditoria.EJECUTAR_CONCILIACION,
        entidad="periodos_conciliacion",
        entidad_id=periodo_id,
        detalle={
            "tipo": "TC1",
            "universo": len(fac_dict),
            "discrepancias": len(discrepancias),
            "sin_tc1": len(sin_tc1),
        },
    ))
    db.session.commit()

    return {
        "tipo_liquidacion": "TC1",
        "total":            len(fac_dict),
        "discrepancias":    len(discrepancias),
        "sin_tc1":          len(sin_tc1),
        "detalle":          discrepancias,
        "fronteras_sin_tc1": sin_tc1[:50],   # limitar a 50 para no saturar respuesta
    }
