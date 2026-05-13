"""
Pre-procesadores SDL por Operador de Red.

Cada OR puede tener lógica específica de homologación/cálculo que se aplica
ANTES del mapeo de columnas estándar. El preprocesador recibe el buffer
completo del archivo (para leer hojas adicionales) y el DataFrame ya cargado
de la hoja principal. Devuelve (df, mapeo) listos para el mapeo estándar.
"""
from __future__ import annotations
import pandas as pd

from .afinia        import preprocesar as _afinia
from .aire          import preprocesar as _aire
from .enel          import preprocesar as _enel
from .cedenar       import preprocesar as _cedenar
from .celsia_tolima import preprocesar as _celsia_tolima
from .cens          import preprocesar as _cens
from .ceo           import preprocesar as _ceo
from .chec          import preprocesar as _chec
from .ebsa          import preprocesar as _ebsa
from .edeq          import preprocesar as _edeq
from .eep_cartago   import preprocesar as _eep_cartago
from .emsa          import preprocesar as _emsa
from .essa          import preprocesar as _essa
from .ruitoque      import preprocesar as _ruitoque


_REGISTRY: dict[str, object] = {
    "AFINIA":        _afinia,
    "AIRE":          _aire,
    "CEDENAR":       _cedenar,
    "CELSIA_TOLIMA": _celsia_tolima,
    "CELSIA_VALLE":  _celsia_tolima,  # mismo formato y lógica que Celsia Tolima
    "CETSA":         _celsia_tolima,  # mismo formato y lógica que Celsia Tolima
    "CENS":          _cens,
    "CEO":           _ceo,
    "CHEC":          _chec,
    "EBSA":          _ebsa,
    "EDEQ":          _edeq,
    "ENEL":          _enel,
    "EEP_CARTAGO":   _eep_cartago,
    "EEP_PEREIRA":   _eep_cartago,  # mismo formato
    "EMSA":          _emsa,
    "ESSA":          _essa,
    "RUITOQUE":      _ruitoque,
}


def preprocesar(
    buffer: bytes,
    df: pd.DataFrame,
    mapeo: dict,
    or_id: str | None,
) -> tuple[pd.DataFrame, dict]:
    """
    Dispatcher principal. Aplica el preprocesador del OR si existe.
    Siempre retorna (df, mapeo) — nunca lanza excepción propia.
    """
    if not or_id:
        return df, mapeo

    fn = _REGISTRY.get(or_id.upper())
    if fn is None:
        return df, mapeo

    return fn(buffer, df, mapeo)  # type: ignore[operator]
