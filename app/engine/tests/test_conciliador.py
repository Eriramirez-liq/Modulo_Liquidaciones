import pytest
from unittest.mock import patch, MagicMock
from decimal import Decimal
from datetime import datetime

from app.engine.conciliador import ejecutar_conciliacion
from app.models import CasoConciliacion, TipoProvision, EstadoProvision, EstadoDisputa, EstadoContingencia

D = Decimal

@patch("app.engine.conciliador.db")
def test_ejecutar_conciliacion_flujo_basico(mock_db):
    # Mock data structure
    # 1. Facturacion
    fac_mock = MagicMock()
    fac_mock.codigo_frontera = "FRONT-001"
    fac_mock.nombre_usuario = "Empresa A"
    fac_mock.operador_red = "ENEL"
    fac_mock.energia_kwh = D('500')
    fac_mock.g_bia = D('10')
    fac_mock.t_bia = D('10')
    fac_mock.d_bia = D('10')
    fac_mock.pr_bia = D('10')
    fac_mock.r_bia = D('10')

    # 2. XM
    xm_mock = MagicMock()
    xm_mock.codigo_frontera = "FRONT-001"
    xm_mock.energia_xm_kwh = D('500')

    # 3. SDL
    sdl_mock = MagicMock()
    sdl_mock.codigo_frontera = "FRONT-001"
    sdl_mock.energia_sdl_kwh = D('500')
    sdl_mock.tarifa_sdl = D('8')
    sdl_mock.or_id = "cuid_enel_123"

    # Configure session execute mocks to return scalars().all()
    # Execute is called 7 times: 
    # 1. Facturacion, 2. XM, 3. SDL
    # 4, 5, 6, 7: Deletes

    mock_result_fac = MagicMock()
    mock_result_fac.scalars().all.return_value = [fac_mock]

    mock_result_xm = MagicMock()
    mock_result_xm.scalars().all.return_value = [xm_mock]

    mock_result_sdl = MagicMock()
    mock_result_sdl.scalars().all.return_value = [sdl_mock]
    
    # We will just return these in order for the first 3 queries, then empty lists for deletes
    mock_db.session.execute.side_effect = [
        mock_result_fac, 
        mock_result_xm, 
        mock_result_sdl,
        MagicMock(), MagicMock(), MagicMock(), MagicMock()
    ]

    resumen = ejecutar_conciliacion("periodo_1", "user_1")

    assert resumen["total"] == 1
    assert resumen["procesadas"] == 1
    assert resumen["casos"][CasoConciliacion.A1.value] == 1
    
    # Assert session methods were called to save data
    assert mock_db.session.add_all.call_count == 4
    mock_db.session.commit.assert_called_once()


@patch("app.engine.conciliador.db")
def test_ejecutar_conciliacion_incompleta(mock_db):
    # Only Facturacion, missing XM and SDL
    fac_mock = MagicMock()
    fac_mock.codigo_frontera = "FRONT-MISS"
    fac_mock.energia_kwh = D('500')

    mock_result_fac = MagicMock()
    mock_result_fac.scalars().all.return_value = [fac_mock]

    mock_result_empty = MagicMock()
    mock_result_empty.scalars().all.return_value = []

    mock_db.session.execute.side_effect = [
        mock_result_fac, 
        mock_result_empty, # XM
        mock_result_empty, # SDL
        MagicMock(), MagicMock(), MagicMock(), MagicMock()
    ]

    resumen = ejecutar_conciliacion("periodo_1", "user_1")

    assert resumen["casos"][CasoConciliacion.INCOMPLETA.value] == 1


@patch("app.engine.conciliador.db")
def test_ejecutar_conciliacion_provision_d3(mock_db):
    # D3 case: E_xm < E_fac = E_sdl
    fac_mock = MagicMock()
    fac_mock.codigo_frontera = "FRONT-D3"
    fac_mock.energia_kwh = D('600')
    fac_mock.g_bia = D('10')
    fac_mock.t_bia = D('10')
    fac_mock.d_bia = D('10')
    fac_mock.pr_bia = D('10')
    fac_mock.r_bia = D('10')

    xm_mock = MagicMock()
    xm_mock.codigo_frontera = "FRONT-D3"
    xm_mock.energia_xm_kwh = D('400')

    sdl_mock = MagicMock()
    sdl_mock.codigo_frontera = "FRONT-D3"
    sdl_mock.energia_sdl_kwh = D('600')
    sdl_mock.tarifa_sdl = D('5')

    mock_result_fac = MagicMock()
    mock_result_fac.scalars().all.return_value = [fac_mock]
    mock_result_xm = MagicMock()
    mock_result_xm.scalars().all.return_value = [xm_mock]
    mock_result_sdl = MagicMock()
    mock_result_sdl.scalars().all.return_value = [sdl_mock]

    mock_db.session.execute.side_effect = [
        mock_result_fac, mock_result_xm, mock_result_sdl,
        MagicMock(), MagicMock(), MagicMock(), MagicMock()
    ]

    resumen = ejecutar_conciliacion("p_1", "u_1")
    assert resumen["casos"][CasoConciliacion.D3.value] == 1
