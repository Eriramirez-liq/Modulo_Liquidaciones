# -*- coding: utf-8 -*-
"""
Pre-procesador SDL para ENEL (2 archivos: Activa y Reactiva).

Activa    -> CODIGO SIC, CONSUMO ACTIVA, NIVEL TENSION, VALOR SDL ACT, VALOR SDL REAC
             tarifa_sdl = VALOR SDL ACT / CONSUMO ACTIVA
Reactiva  -> CODIGO SIC, PERIODO, FACTOR M,
             EXCESO_REACTIVA_INDUCTIVA, EXCESO_REACTIVA_CAPACITIVA

tarifa_reactiva y propiedad_activos: lookup en modulo Tarifas SDL por
(nivel_tension, tarifa_activa). Retornan None hasta que el modulo exista.
"""
from __future__ import annotations
import io
import unicodedata
import pandas as pd


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").strip().upper()


def preprocesar(buffer: bytes, df: pd.DataFrame, mapeo: dict) -> tuple[pd.DataFrame, dict]:
    df    = df.copy()
    mapeo = {**mapeo, "columnas": dict(mapeo.get("columnas", {}))}
    cols  = mapeo["columnas"]

    df.columns = [str(c).strip() for c in df.columns]

    # Archivo Reactiva llega como _buf_cap (segundo archivo en la UI)
    buf_reac = mapeo.pop("_buf_cap", None)
    mapeo.pop("_buf_ind", None)  # ENEL no usa tercer archivo

    print(f"[ENEL] buf_reac={buf_reac is not None}", flush=True)
    print(f"[ENEL] Activa cols: {list(df.columns)}", flush=True)

    col_codigo = _find_sic_col(df)
    if not col_codigo:
        print("[ENEL] ERROR: columna CODIGO SIC no encontrada en Activa", flush=True)
        return df, mapeo

    cols["codigo_frontera"] = col_codigo

    # ── Activa ──────────────────────────────────────────────────────────────
    col_kwh        = _find_col(df, "CONSUMO ACTIVA")
    col_nt         = _find_col(df, "NIVEL TENSION")
    col_valor_act  = _find_col(df, "VALOR SDL ACT")
    col_valor_reac = _find_col(df, "VALOR SDL REAC")

    if col_kwh:        cols["energia_kwh"]        = col_kwh
    if col_nt:         cols["nivel_tension"]       = col_nt
    if col_valor_act:  cols["valor_cop"]           = col_valor_act
    if col_valor_reac: cols["valor_reactiva_cop"]  = col_valor_reac

    # tarifa_sdl = VALOR SDL ACT / CONSUMO ACTIVA
    if col_valor_act and col_kwh:
        valor = pd.to_numeric(df[col_valor_act], errors="coerce")
        kwh   = pd.to_numeric(df[col_kwh],       errors="coerce").replace(0, float("nan"))
        df["__TARIFA_ACT__"] = valor / kwh
        cols["tarifa_sdl"] = "__TARIFA_ACT__"

    # ── Merge Reactiva ───────────────────────────────────────────────────────
    if buf_reac:
        df_reac = _read_extra(buf_reac)
        df_reac.columns = [str(c).strip() for c in df_reac.columns]
        print(f"[ENEL] Reactiva cols: {list(df_reac.columns)}", flush=True)

        crk       = _find_sic_col(df_reac)
        c_periodo = _find_col(df_reac, "PERIODO")
        c_fm      = _find_col(df_reac, "FACTOR M")
        c_ind     = _find_col(df_reac, "EXCESO_REACTIVA_INDUCTIVA")
        c_cap     = _find_col(df_reac, "EXCESO_REACTIVA_CAPACITIVA")
        print(f"[ENEL] Reactiva -> CODIGO SIC={crk!r}  PERIODO={c_periodo!r}  FACTOR M={c_fm!r}  IND={c_ind!r}  CAP={c_cap!r}", flush=True)

        if crk:
            rename_r: dict = {crk: col_codigo}
            if c_periodo: rename_r[c_periodo] = "__PERIODO__"
            if c_fm:      rename_r[c_fm]      = "__FACTOR_M__"
            if c_ind:     rename_r[c_ind]      = "__REAC_IND__"
            if c_cap:     rename_r[c_cap]      = "__REAC_CAP__"

            df = df.merge(
                df_reac[list(rename_r)].rename(columns=rename_r),
                on=col_codigo, how="left",
            )
            if c_periodo: cols["periodo"]                  = "__PERIODO__"
            if c_fm:      cols["factor_m"]                 = "__FACTOR_M__"
            if c_ind:     cols["energia_reactiva_ind_pen"] = "__REAC_IND__"
            if c_cap:     cols["energia_reactiva_cap_pen"] = "__REAC_CAP__"
        else:
            print("[ENEL] Reactiva merge OMITIDO (sin columna SIC/Frt en archivo reactiva)", flush=True)
    else:
        print("[ENEL] buf_reac es None, sin merge Reactiva", flush=True)

    # ── Tarifa reactiva y propiedad de activos (modulo Tarifas SDL) ──────────
    # Logica: (nivel_tension + tarifa_activa) → lookup → (tarifa_reactiva, propiedad_activos)
    # Mientras el modulo no exista: tarifa_reactiva=None, propiedad_activos=None
    try:
        from ..tarifas_sdl import consultar_por_activa as _consultar

        _niv_col = col_nt
        _ta_col  = "__TARIFA_ACT__" if "__TARIFA_ACT__" in df.columns else None
        _per_ref = (
            df["__PERIODO__"].dropna().iloc[0]
            if "__PERIODO__" in df.columns and not df["__PERIODO__"].dropna().empty
            else ""
        )

        if _niv_col and _ta_col:
            _cache: dict = {}
            for _, _r in df[[_niv_col, _ta_col]].drop_duplicates().iterrows():
                _key = (str(_r[_niv_col]), str(_r[_ta_col]))
                _cache[_key] = _consultar("ENEL", _per_ref, _key[0], _safe_float(_key[1]))

            df["__TARIFA_REAC__"] = df.apply(
                lambda r: _cache.get((str(r[_niv_col]), str(r[_ta_col])), (None, None))[0],
                axis=1,
            )
            df["__PROP__"] = df.apply(
                lambda r: _cache.get((str(r[_niv_col]), str(r[_ta_col])), (None, None))[1],
                axis=1,
            )
            cols["tarifa_reactiva"]   = "__TARIFA_REAC__"
            cols["propiedad_activos"] = "__PROP__"

    except Exception as _e:
        print(f"[ENEL] Tarifas lookup omitido: {_e}", flush=True)

    print(f"[ENEL] cols mapeadas: {[k for k,v in cols.items() if v]}", flush=True)
    return df, mapeo


# ── Helpers ──────────────────────────────────────────────────────────────────

def _read_extra(buf: bytes) -> pd.DataFrame:
    try:
        return pd.read_excel(io.BytesIO(buf), dtype=str, keep_default_na=False)
    except Exception as e:
        print(f"[ENEL] ERROR leyendo archivo extra: {e}", flush=True)
        return pd.DataFrame()


def _safe_float(val) -> "float | None":
    try:
        return float(str(val).strip())
    except (ValueError, TypeError):
        return None


def _find_col(df: pd.DataFrame, nombre: str) -> "str | None":
    idx = {_norm(c): c for c in df.columns}
    nombre_up = _norm(nombre)
    if nombre_up in idx:
        return idx[nombre_up]
    for key, col in idx.items():
        if key in nombre_up or nombre_up in key:
            return col
    return None


def _find_sic_col(df: pd.DataFrame) -> "str | None":
    """Localiza la columna de codigo frontera tolerando tipografias (ej. CODICO vs CODIGO).
    Estrategia 1: columna cuyo nombre contiene 'SIC'.
    Estrategia 2 (fallback): columna cuyos valores empiezan con 'Frt'.
    """
    for col in df.columns:
        if "SIC" in _norm(col):
            return col
    for col in df.columns:
        sample = df[col].dropna().head(5)
        if not sample.empty and sample.apply(lambda v: str(v).strip().startswith("Frt")).all():
            return col
    return None
