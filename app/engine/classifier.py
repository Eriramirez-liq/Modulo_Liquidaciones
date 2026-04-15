"""
Clasificador de Fronteras.
Función pura para determinar el Caso (A1...D4, ERROR) según reglas del PRD.
"""
from decimal import Decimal
from app.models import CasoConciliacion

def classify_frontera(
    e_fac: Decimal, 
    e_xm: Decimal, 
    e_sdl: Decimal,
    threshold: Decimal = Decimal('100.0')
) -> CasoConciliacion:
    """
    Identifica el caso de conciliación entre las 3 lecturas de energía 
    bajo las reglas de 'Línea 1' (XM vs FAC) y 'Línea 2' (SDL vs XM).
    El criterio de igualdad evalúa diferencia absoluta menor estricto al threshold. (según feedback del usuario: > -100 y < 100 kWh -> "iguales")
    """
    
    def is_eq(a: Decimal, b: Decimal) -> bool:
        return abs(a - b) < threshold
        
    def is_lt(a: Decimal, b: Decimal) -> bool:
        return a <= (b - threshold)
        
    def is_gt(a: Decimal, b: Decimal) -> bool:
        return a >= (b + threshold)

    # 1. Chequeo de imposibles o bloqueantes
    # E_fac < E_xm y E_sdl > E_xm
    if is_lt(e_fac, e_xm) and is_gt(e_sdl, e_xm):
        return CasoConciliacion.ERROR

    eq_fac_xm = is_eq(e_fac, e_xm)
    eq_xm_sdl = is_eq(e_xm, e_sdl)
    eq_fac_sdl = is_eq(e_fac, e_sdl)

    # Caso A1: E_fac = E_xm = E_sdl
    if eq_fac_xm and eq_xm_sdl:
        return CasoConciliacion.A1
        
    # Caso B1: E_fac < E_xm = E_sdl
    if is_lt(e_fac, e_xm) and eq_xm_sdl:
        return CasoConciliacion.B1
        
    # Caso B2: E_fac > E_xm = E_sdl
    if is_gt(e_fac, e_xm) and eq_xm_sdl:
        return CasoConciliacion.B2
        
    # Caso C1: E_fac = E_xm > E_sdl  (OR cobra menos)
    if eq_fac_xm and is_gt(e_xm, e_sdl):
        return CasoConciliacion.C1
        
    # Caso C2: E_fac = E_xm < E_sdl  (OR excade techo XM)
    if eq_fac_xm and is_lt(e_xm, e_sdl):
        return CasoConciliacion.C2
        
    # Caso D1: E_fac < E_sdl < E_xm
    if is_lt(e_fac, e_sdl) and is_lt(e_sdl, e_xm):
        return CasoConciliacion.D1
        
    # Caso D2: E_sdl < E_xm < E_fac
    if is_lt(e_sdl, e_xm) and is_lt(e_xm, e_fac):
        return CasoConciliacion.D2
        
    # Caso D3: E_xm < E_fac = E_sdl
    if is_lt(e_xm, e_fac) and eq_fac_sdl:
        return CasoConciliacion.D3
        
    # Caso D4: Cualquier otro patrón con los tres valores distintos 
    # y sin coincidir en las distribuciones anteriores
    return CasoConciliacion.D4
