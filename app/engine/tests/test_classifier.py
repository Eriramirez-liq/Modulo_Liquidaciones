import pytest
from decimal import Decimal
from app.models import CasoConciliacion
from app.engine.classifier import classify_frontera

# Helper para decimales
D = Decimal

def test_caso_a1_exact():
    # E_fac = E_xm = E_sdl exactamente
    assert classify_frontera(D('500'), D('500'), D('500')) == CasoConciliacion.A1

def test_caso_a1_within_threshold():
    # Diferencia < 100 kWh
    assert classify_frontera(D('500'), D('550'), D('599.9')) == CasoConciliacion.A1

def test_caso_b1():
    # E_fac < E_xm = E_sdl
    # E_fac debe ser menor por 100 o más
    assert classify_frontera(D('400'), D('550'), D('550')) == CasoConciliacion.B1

def test_caso_b2():
    # E_fac > E_xm = E_sdl
    assert classify_frontera(D('600'), D('450'), D('450')) == CasoConciliacion.B2

def test_caso_c1():
    # E_fac = E_xm > E_sdl
    # XM y FAC iguales, SDL menor
    assert classify_frontera(D('500'), D('500'), D('350')) == CasoConciliacion.C1

def test_caso_c2():
    # E_fac = E_xm < E_sdl
    assert classify_frontera(D('500'), D('500'), D('650')) == CasoConciliacion.C2

def test_caso_d1():
    # E_fac < E_sdl < E_xm
    # 300 < 450 < 600
    assert classify_frontera(D('300'), D('600'), D('450')) == CasoConciliacion.D1

def test_caso_d2():
    # E_sdl < E_xm < E_fac
    # 300 < 450 < 600
    assert classify_frontera(D('600'), D('450'), D('300')) == CasoConciliacion.D2

def test_caso_d3():
    # E_xm < E_fac = E_sdl
    assert classify_frontera(D('600'), D('450'), D('600')) == CasoConciliacion.D3

def test_caso_imposible_error():
    # E_fac < E_xm y E_sdl > E_xm
    # E_fac=300 < E_xm=500 y E_sdl=650 > E_xm=500
    assert classify_frontera(D('300'), D('500'), D('650')) == CasoConciliacion.ERROR

def test_caso_d4_all_different():
    # Ningun patron anterior
    # Ejemplo: E_fac > E_sdl > E_xm 
    # (No es D2, porque D2 es E_sdl < E_xm < E_fac)
    # E_fac=800, E_sdl=600, E_xm=300
    assert classify_frontera(D('800'), D('300'), D('600')) == CasoConciliacion.D4
