"""
Orquestador del Motor de Conciliación.
"""
from decimal import Decimal
from datetime import datetime
from typing import Dict, Any, List

from sqlalchemy import select

from app.models import (
    db, RegistroFacturacion, RegistroXM, RegistroSDL,
    ResultadoConciliacion, CasoConciliacion, ResultadoLinea,
    Provision, TipoProvision, EstadoProvision,
    Contingencia, EstadoContingencia, ResultadoContingencia,
    Disputa, EstadoDisputa,
    CruceBalance,
    PeriodoConciliacion, CargaFuente, TipoFuente, EstadoCarga,
    LogAuditoria, AccionAuditoria,
)
from app.engine.classifier import classify_frontera
from app.engine.calculator import (
    calc_provision_l1, calc_disputa_c1, calc_disputa_c2,
    calc_provision_d2, calc_provision_d3
)

# Mapeo de caso → (resultado_l1, resultado_l2)
_CASO_RESULTADO = {
    CasoConciliacion.A1:        (ResultadoLinea.SIN_DIFERENCIA,  ResultadoLinea.SIN_DIFERENCIA),
    CasoConciliacion.B1:        (ResultadoLinea.CONTINGENCIA_L1, ResultadoLinea.SIN_DIFERENCIA),
    CasoConciliacion.B2:        (ResultadoLinea.PROVISION_L1,    ResultadoLinea.SIN_DIFERENCIA),
    CasoConciliacion.C1:        (ResultadoLinea.SIN_DIFERENCIA,  ResultadoLinea.DISPUTA_L2),
    CasoConciliacion.C2:        (ResultadoLinea.SIN_DIFERENCIA,  ResultadoLinea.DISPUTA_L2),
    CasoConciliacion.D1:        (ResultadoLinea.CONTINGENCIA_L1, ResultadoLinea.DISPUTA_L2),
    CasoConciliacion.D2:        (ResultadoLinea.PROVISION_COMBINADA, ResultadoLinea.SIN_DIFERENCIA),
    CasoConciliacion.D3:        (ResultadoLinea.PROVISION_L1,    ResultadoLinea.SIN_DIFERENCIA),
    CasoConciliacion.D4:        (ResultadoLinea.ALERTA_MANUAL,   ResultadoLinea.ALERTA_MANUAL),
    CasoConciliacion.INCOMPLETA:(ResultadoLinea.INCOMPLETA,      ResultadoLinea.INCOMPLETA),
    CasoConciliacion.ERROR:     (None, None),
}


def ejecutar_conciliacion(
    periodo_id: str,
    usuario_id: str,
    or_id_filter: str = None,       # Si se provee, solo concilia fronteras de ese OR
    tipo_liquidacion: str = None,    # Etiqueta de tipo (SDL, TC1, COT, BALANCE) — se almacena en resumen
) -> Dict[str, Any]:
    """
    Ejecuta el motor de conciliación de forma síncrona para el periodo dado.
    """
    # 1. Obtener la carga activa de Facturación
    carga_fac = db.session.execute(
        select(CargaFuente)
        .where(
            CargaFuente.periodo_id == periodo_id,
            CargaFuente.tipo_fuente == TipoFuente.FACTURACION,
            CargaFuente.estado == EstadoCarga.COMPLETADA
        )
        .order_by(CargaFuente.created_at.desc())
    ).scalars().first()

    if not carga_fac:
        raise ValueError("No existe archivo de facturación completado para este período.")

    facturaciones = db.session.execute(
        select(RegistroFacturacion).where(RegistroFacturacion.carga_id == carga_fac.id)
    ).scalars().all()

    # 2. Obtener XM de la carga activa
    carga_xm = db.session.execute(
        select(CargaFuente)
        .where(
            CargaFuente.periodo_id == periodo_id,
            CargaFuente.tipo_fuente == TipoFuente.XM,
            CargaFuente.estado == EstadoCarga.COMPLETADA
        )
        .order_by(CargaFuente.created_at.desc())
    ).scalars().first()

    xms = []
    if carga_xm:
        xms = db.session.execute(
            select(RegistroXM).where(RegistroXM.carga_id == carga_xm.id)
        ).scalars().all()
    xm_dict = {xm.codigo_frontera: xm for xm in xms}

    # 3. Obtener SDL: podemos tener múltiples operadores, elegir el último válido de cada uno
    cargas_sdl_q = (
        select(CargaFuente)
        .where(
            CargaFuente.periodo_id == periodo_id,
            CargaFuente.tipo_fuente == TipoFuente.SDL,
            CargaFuente.estado == EstadoCarga.COMPLETADA
        )
        .order_by(CargaFuente.created_at.desc())
    )
    if or_id_filter:
        cargas_sdl_q = cargas_sdl_q.where(CargaFuente.or_id == or_id_filter)

    cargas_sdl = db.session.execute(cargas_sdl_q).scalars().all()

    active_sdls_by_or = {}
    for c in cargas_sdl:
        if c.or_id not in active_sdls_by_or:
            active_sdls_by_or[c.or_id] = c.id

    sdl_ids = list(active_sdls_by_or.values())
    sdls = []
    if sdl_ids:
        sdls = db.session.execute(
            select(RegistroSDL).where(RegistroSDL.carga_id.in_(sdl_ids))
        ).scalars().all()

    # sdl_dict: ultima ocurrencia por frontera (en caso de duplicados, el primero encontrado es el que manda)
    sdl_dict: Dict[str, Any] = {}
    sdl_duplicados: List[str] = []
    for sdl in sdls:
        if sdl.codigo_frontera in sdl_dict:
            sdl_duplicados.append(sdl.codigo_frontera)
        else:
            sdl_dict[sdl.codigo_frontera] = sdl

    # Filtrar facturaciones por OR si se especificó
    if or_id_filter:
        facturaciones = [f for f in facturaciones if f.codigo_frontera in sdl_dict]

    # Detectar fronteras SDL que no están en Facturación
    fronteras_fac = {f.codigo_frontera for f in facturaciones}
    sdl_sin_facturacion = [cf for cf in sdl_dict if cf not in fronteras_fac]

    # Estadísticas para el resumen
    resumen: Dict[str, Any] = {
        "total": len(facturaciones),
        "procesadas": 0,
        "errores": 0,
        "casos": {},
        "alertas_sdl": [],
        "tipo_liquidacion": tipo_liquidacion,
    }
    for caso in CasoConciliacion:
        resumen["casos"][caso.value] = 0

    # Agregar alertas SDL al resumen
    for cf in sdl_duplicados:
        resumen["alertas_sdl"].append({
            "tipo": "DUPLICADO_SDL",
            "codigo_frontera": cf,
            "mensaje": f"Frontera {cf} tiene registros duplicados en el SDL cargado.",
        })
    for cf in sdl_sin_facturacion:
        resumen["alertas_sdl"].append({
            "tipo": "SDL_SIN_FACTURACION",
            "codigo_frontera": cf,
            "mensaje": f"Frontera {cf} existe en SDL pero no en el archivo de Facturación.",
        })

    nuevos_resultados = []
    nuevas_provisiones = []
    nuevas_contingencias = []
    nuevas_disputas = []

    for fac in facturaciones:
        xm = xm_dict.get(fac.codigo_frontera)
        sdl = sdl_dict.get(fac.codigo_frontera)

        if not xm or not sdl:
            # INCOMPLETA
            res = ResultadoConciliacion(
                periodo_id=periodo_id,
                codigo_frontera=fac.codigo_frontera,
                nombre_usuario=fac.nombre_usuario,
                operador_red=fac.operador_red,
                or_id=sdl.or_id if sdl else None,
                e_fac=fac.energia_kwh,
                e_xm=xm.energia_xm_kwh if xm else None,
                e_sdl=sdl.energia_sdl_kwh if sdl else None,
                caso=CasoConciliacion.INCOMPLETA,
                requiere_alerta_manual=True,
                observaciones="Falta reporte XM o SDL para esta frontera.",
                conciliado_por_id=usuario_id,
                conciliado_at=datetime.utcnow()
            )
            nuevos_resultados.append(res)
            resumen["casos"][CasoConciliacion.INCOMPLETA.value] += 1
            resumen["procesadas"] += 1
            continue

        e_fac = fac.energia_kwh
        e_xm = xm.energia_xm_kwh
        e_sdl = sdl.energia_sdl_kwh
        tarifa_sdl = sdl.tarifa_sdl

        # Obtener caso
        caso = classify_frontera(e_fac, e_xm, e_sdl, threshold=Decimal("100.0"))

        r_l1, r_l2 = _CASO_RESULTADO.get(caso, (None, None))
        res = ResultadoConciliacion(
            periodo_id=periodo_id,
            codigo_frontera=fac.codigo_frontera,
            nombre_usuario=fac.nombre_usuario,
            operador_red=fac.operador_red,
            or_id=sdl.or_id,
            e_fac=e_fac,
            e_xm=e_xm,
            e_sdl=e_sdl,
            delta_l1=e_xm - e_fac,
            delta_l2=e_sdl - e_xm,
            caso=caso,
            resultado_l1=r_l1,
            resultado_l2=r_l2,
            requiere_alerta_manual=False,
            conciliado_por_id=usuario_id,
            conciliado_at=datetime.utcnow()
        )

        impacto_l1 = Decimal("0.0")
        impacto_l2 = Decimal("0.0")

        # Reglas financieras
        if caso == CasoConciliacion.B1 or caso == CasoConciliacion.D1:
            # Contingencia
            # D1 -> contingencia y alerta y disputa.
            # B1 -> solo contingencia
            delta = abs(e_fac - e_xm) if caso == CasoConciliacion.B1 else abs(e_fac - e_sdl)
            cont = Contingencia(
                resultado=res,
                periodo_id=periodo_id,
                codigo_frontera=fac.codigo_frontera,
                or_id=sdl.or_id,
                energia_kwh=delta,
                estado=EstadoContingencia.PENDIENTE,
                resultado_tipo=ResultadoContingencia.PENDIENTE,
                descripcion=f"Contingencia L1 generada (Caso {caso.value})",
                creado_por_id=usuario_id
            )
            nuevas_contingencias.append(cont)
            if caso == CasoConciliacion.D1:
                res.requiere_alerta_manual = True

        if caso == CasoConciliacion.B2:
            # Provision L1
            delta = abs(e_fac - e_xm)
            valor_prov = calc_provision_l1(delta, fac.g_bia, fac.t_bia, fac.d_bia, fac.pr_bia, fac.r_bia)
            impacto_l1 = valor_prov
            prov = Provision(
                resultado=res,
                periodo_id=periodo_id,
                codigo_frontera=fac.codigo_frontera,
                or_id=sdl.or_id,
                tipo=TipoProvision.L1,
                energia_kwh=delta,
                valor_provisionado_cop=valor_prov,
                estado=EstadoProvision.PENDIENTE,
                creado_por_id=usuario_id
            )
            nuevas_provisiones.append(prov)

        if caso == CasoConciliacion.C1 or caso == CasoConciliacion.C2 or caso == CasoConciliacion.D1:
            # Disputas
            if caso == CasoConciliacion.C1:
                val = calc_disputa_c1(e_xm, e_sdl, tarifa_sdl)
                delta = e_xm - e_sdl
                desc = "OR cobra menos que XM"
            elif caso == CasoConciliacion.C2:
                val = calc_disputa_c2(e_sdl, e_xm, tarifa_sdl)
                delta = e_sdl - e_xm
                desc = "OR excede techo XM"
            else:  # D1
                val = (e_xm - e_sdl) * tarifa_sdl if e_xm > e_sdl else (e_sdl - e_xm) * tarifa_sdl
                delta = abs(e_xm - e_sdl)
                desc = "Disputa D1"

            impacto_l2 = val
            disp = Disputa(
                resultado=res,
                periodo_id=periodo_id,
                codigo_frontera=fac.codigo_frontera,
                or_id=sdl.or_id,
                energia_exceso_kwh=delta,
                valor_disputa_cop=val,
                estado=EstadoDisputa.ABIERTA,
                descripcion=f"{desc} (Caso {caso.value})",
                abierta_por_id=usuario_id
            )
            nuevas_disputas.append(disp)

        if caso == CasoConciliacion.D2:
            delta = abs(e_fac - e_sdl)
            valor_prov = calc_provision_d2(e_fac, e_sdl, fac.g_bia, fac.t_bia, fac.d_bia, fac.pr_bia, fac.r_bia)
            impacto_l1 = valor_prov
            prov = Provision(
                resultado=res,
                periodo_id=periodo_id,
                codigo_frontera=fac.codigo_frontera,
                or_id=sdl.or_id,
                tipo=TipoProvision.COMBINADA,
                energia_kwh=delta,
                valor_provisionado_cop=valor_prov,
                estado=EstadoProvision.PENDIENTE,
                creado_por_id=usuario_id
            )
            nuevas_provisiones.append(prov)
            res.requiere_alerta_manual = True

        if caso == CasoConciliacion.D3:
            try:
                valor_prov = calc_provision_d3(e_fac, e_xm, fac.g_bia, fac.t_bia, fac.d_bia, tarifa_sdl, fac.pr_bia, fac.r_bia)
                delta = abs(e_fac - e_xm)
                impacto_l1 = valor_prov
                prov = Provision(
                    resultado=res,
                    periodo_id=periodo_id,
                    codigo_frontera=fac.codigo_frontera,
                    or_id=sdl.or_id,
                    tipo=TipoProvision.D3,
                    energia_kwh=delta,
                    valor_provisionado_cop=valor_prov,
                    estado=EstadoProvision.PENDIENTE,
                    creado_por_id=usuario_id
                )
                nuevas_provisiones.append(prov)
            except ValueError as e:
                res.caso = CasoConciliacion.ERROR
                res.resultado_l1 = None
                res.resultado_l2 = None
                res.requiere_alerta_manual = True
                res.observaciones = str(e)
                resumen["errores"] += 1

        if caso in (CasoConciliacion.D4, CasoConciliacion.ERROR):
            res.requiere_alerta_manual = True

        if caso == CasoConciliacion.ERROR and not res.observaciones:
            res.observaciones = "IMPOSIBLE: E_fac < E_xm y E_sdl > E_xm"
            resumen["errores"] += 1

        res.impacto_financiero_l1 = impacto_l1
        res.impacto_financiero_l2 = impacto_l2

        nuevos_resultados.append(res)
        resumen["casos"][res.caso.value] += 1
        resumen["procesadas"] += 1

    # Protección: no re-ejecutar si hay provisiones ya cruzadas (definitivas e irreversibles)
    cruzadas = db.session.execute(
        select(Provision).where(
            Provision.periodo_id == periodo_id,
            Provision.estado == EstadoProvision.CRUZADO_TOTAL,
        )
    ).scalars().first()
    if cruzadas:
        raise ValueError(
            "El período tiene provisiones ya cruzadas con balance. "
            "No se puede re-ejecutar sin anular los cruces previos."
        )

    # Limpiar resultados anteriores (solo PENDIENTE — no hay cruzadas en este punto)
    # Orden: primero hijos (CruceBalance → Disputa/Contingencia/Provision), luego padre
    db.session.execute(CruceBalance.__table__.delete().where(
        CruceBalance.provision_id.in_(
            select(Provision.id).where(Provision.periodo_id == periodo_id)
        )
    ))
    db.session.execute(CruceBalance.__table__.delete().where(
        CruceBalance.contingencia_id.in_(
            select(Contingencia.id).where(Contingencia.periodo_id == periodo_id)
        )
    ))
    db.session.execute(Disputa.__table__.delete().where(Disputa.periodo_id == periodo_id))
    db.session.execute(Contingencia.__table__.delete().where(Contingencia.periodo_id == periodo_id))
    db.session.execute(Provision.__table__.delete().where(Provision.periodo_id == periodo_id))
    db.session.execute(ResultadoConciliacion.__table__.delete().where(
        ResultadoConciliacion.periodo_id == periodo_id
    ))

    # Guardar en base de datos
    db.session.add_all(nuevos_resultados)
    db.session.add_all(nuevas_provisiones)
    db.session.add_all(nuevas_contingencias)
    db.session.add_all(nuevas_disputas)

    # Auditoría
    db.session.add(LogAuditoria(
        usuario_id=usuario_id,
        accion=AccionAuditoria.EJECUTAR_CONCILIACION,
        entidad="periodos_conciliacion",
        entidad_id=periodo_id,
        detalle={
            "total": resumen["total"],
            "procesadas": resumen["procesadas"],
            "errores": resumen["errores"],
        },
    ))

    db.session.commit()

    return resumen
