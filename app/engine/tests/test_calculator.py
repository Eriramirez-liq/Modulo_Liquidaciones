import pytest
from decimal import Decimal
from app.engine.calculator import (
    calc_provision_l1, calc_disputa_c1, calc_disputa_c2,
    calc_provision_d2, calc_provision_d3
)

D = Decimal

def test_calc_provision_l1():
    # Excluye C_bia siempre
    res = calc_provision_l1(D('150'), D('10'), D('20'), D('30'), D('40'), D('50'))
    assert res == D('150') * D('150')  # 150 * 150 = 22500
    
def test_calc_disputa_c1():
    res = calc_disputa_c1(D('500'), D('300'), D('100.5'))
    assert res == D('200') * D('100.5')

def test_calc_disputa_c2():
    res = calc_disputa_c2(D('700'), D('500'), D('100.5'))
    assert res == D('200') * D('100.5')
    
def test_calc_provision_d3_success():
    # d_bia = 50, tarifa_sdl = 40 (valido porque tarifa_sdl <= d_bia)
    res = calc_provision_d3(D('600'), D('400'), D('10'), D('20'), D('50'), D('40'), D('10'), D('10'))
    # delta = 200 * (10+20 + (50-40) + 10+10) = 200 * (60)
    assert res == D('12000')

def test_calc_provision_d3_error():
    # tarifa_sdl > d_bia
    with pytest.raises(ValueError, match="tarifa_sdl > d_bia"):
        calc_provision_d3(D('600'), D('400'), D('10'), D('20'), D('50'), D('60'), D('10'), D('10'))
