"""
Calculadora de impactos financieros.
Lógica puramente matemática usando strict Decimal para evitar pérdida de precisión financiera.
Componente C de Comercialización se excluye siempre de las provisiones.
"""
from decimal import Decimal

def calc_provision_l1(delta_kwh: Decimal, g: Decimal, t: Decimal, d: Decimal, pr: Decimal, r: Decimal) -> Decimal:
    """B2 — Provisión L1 (C excluido)"""
    return abs(delta_kwh) * (g + t + d + pr + r)

def calc_disputa_c1(e_xm: Decimal, e_sdl: Decimal, tarifa_sdl: Decimal) -> Decimal:
    """C1 — Disputa OR cobra menos"""
    return (e_xm - e_sdl) * tarifa_sdl

def calc_disputa_c2(e_sdl: Decimal, e_xm: Decimal, tarifa_sdl: Decimal) -> Decimal:
    """C2 — Disputa OR excede techo"""
    return (e_sdl - e_xm) * tarifa_sdl

def calc_provision_d2(e_fac: Decimal, e_sdl: Decimal, g: Decimal, t: Decimal, d: Decimal, pr: Decimal, r: Decimal) -> Decimal:
    """D2 — Provisión combinada (C excluido)"""
    return abs(e_fac - e_sdl) * (g + t + d + pr + r)

def calc_provision_d3(e_fac: Decimal, e_xm: Decimal, g: Decimal, t: Decimal, d_bia: Decimal, tarifa_sdl: Decimal, pr: Decimal, r: Decimal) -> Decimal:
    """D3 — Provisión D3 con tarifa neta"""
    if tarifa_sdl > d_bia:
        raise ValueError("tarifa_sdl > d_bia — error en SDL")
    # (G+T+(D–tarifa_sdl)+PR+R)_bia
    return abs(e_fac - e_xm) * (g + t + (d_bia - tarifa_sdl) + pr + r)
