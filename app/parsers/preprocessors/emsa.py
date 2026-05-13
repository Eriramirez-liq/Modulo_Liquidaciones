# -*- coding: utf-8 -*-
"""
Pre-procesador SDL para EMSA (3 archivos: Activa, Capacitiva, Inductiva).

Activa     -> CODIGO, kWhR, ANO, MES, Nivel
Capacitiva -> CODIGO, SumaCapacitiva, Cobro
Inductiva  -> CODIGO, TotalInduc, M, COSTO_DISTRIBUCION, Cobro

valor_reactiva_cop = Cobro(cap) + Cobro(ind)
valor_cop          = energia x tarifa_activa (pendiente modulo Tarifas -> 0)
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

    buf_cap = mapeo.pop("_buf_cap", None)
    buf_ind = mapeo.pop("_buf_ind", None)

    print(f"[EMSA] buf_cap={buf_cap is not None}  buf_ind={buf_ind is not None}", flush=True)
    print(f"[EMSA] Activa cols: {list(df.columns)}", flush=True)

    col_codigo = _find_col(df, "CODIGO")
    if not col_codigo:
        print("[EMSA] ERROR: columna CODIGO no encontrada en Activa", flush=True)
        return df, mapeo

    cols["codigo_frontera"] = col_codigo

    # ── Energia activa ──────────────────────────────────────────────────────
    col_kwh = _find_col(df, "kWhR")
    if col_kwh:
        cols["energia_kwh"] = col_kwh

    # ── Valor activa = 0 (pendiente Tarifas: energia x tarifa_activa) ───────
    df["__VALOR_COP__"] = 0.0
    cols["valor_cop"] = "__VALOR_COP__"

    # ── Periodo desde ANO + MES ─────────────────────────────────────────────
    col_ano = _find_col(df, "ANO")
    col_mes = _find_col(df, "MES")
    if col_ano and col_mes:
        def _periodo(row):
            try:
                a = int(float(str(row[col_ano]).strip()))
                m = int(float(str(row[col_mes]).strip()))
                return f"{a}-{m:02d}"
            except (ValueError, TypeError):
                return ""
        df["__PERIODO__"] = df.apply(_periodo, axis=1)
        cols["periodo"] = "__PERIODO__"

    cobro_cap_col = None
    cobro_ind_col = None

    # ── Merge Capacitiva ────────────────────────────────────────────────────
    if buf_cap:
        df_cap = _read_extra(buf_cap)
        df_cap.columns = [str(c).strip() for c in df_cap.columns]
        print(f"[EMSA] Capacitiva cols: {list(df_cap.columns)}", flush=True)

        cck        = _find_col(df_cap, "CODIGO")
        c_suma_cap = _find_col(df_cap, "SumaCapacitiva")
        c_cobro_c  = _find_col(df_cap, "Cobro")
        print(f"[EMSA] Capacitiva -> CODIGO={cck!r}  SumaCapacitiva={c_suma_cap!r}  Cobro={c_cobro_c!r}", flush=True)

        if cck:
            rename_c: dict = {cck: col_codigo}
            if c_suma_cap:
                rename_c[c_suma_cap] = "__REAC_CAP__"
            if c_cobro_c:
                rename_c[c_cobro_c] = "__COBRO_CAP__"
                cobro_cap_col = "__COBRO_CAP__"

            df = df.merge(
                df_cap[list(rename_c)].rename(columns=rename_c),
                on=col_codigo, how="left",
            )
            if c_suma_cap:
                cols["energia_reactiva_cap_pen"] = "__REAC_CAP__"
        else:
            print("[EMSA] Capacitiva merge OMITIDO (sin columna CODIGO)", flush=True)
    else:
        print("[EMSA] buf_cap es None, sin merge Capacitiva", flush=True)

    # ── Merge Inductiva ─────────────────────────────────────────────────────
    if buf_ind:
        df_ind = _read_extra(buf_ind)
        df_ind.columns = [str(c).strip() for c in df_ind.columns]
        print(f"[EMSA] Inductiva cols: {list(df_ind.columns)}", flush=True)

        cik       = _find_col(df_ind, "CODIGO")
        c_nivel   = _find_col(df_ind, "Nivel")
        c_total   = _find_col(df_ind, "TotalInduc")
        c_m       = _find_col(df_ind, "M")
        c_costo   = _find_col(df_ind, "COSTO_DISTRIBUCION")
        c_cobro_i = _find_col(df_ind, "Cobro")
        print(f"[EMSA] Inductiva -> CODIGO={cik!r}  Nivel={c_nivel!r}  TotalInduc={c_total!r}  M={c_m!r}  COSTO={c_costo!r}  Cobro={c_cobro_i!r}", flush=True)

        if cik:
            rename_i: dict = {cik: col_codigo}
            if c_nivel:   rename_i[c_nivel]   = "__NIVEL__"
            if c_total:   rename_i[c_total]   = "__REAC_IND__"
            if c_m:       rename_i[c_m]       = "__FACTOR_M__"
            if c_costo:   rename_i[c_costo]   = "__TARIFA_REAC__"
            if c_cobro_i:
                rename_i[c_cobro_i] = "__COBRO_IND__"
                cobro_ind_col = "__COBRO_IND__"

            df = df.merge(
                df_ind[list(rename_i)].rename(columns=rename_i),
                on=col_codigo, how="left",
            )
            if c_nivel:
                df["__NIVEL__"] = df["__NIVEL__"].apply(
                    lambda x: str(x).strip()
                    if str(x).strip() not in ("", "nan", "None") else "1"
                )
                cols["nivel_tension"] = "__NIVEL__"
            if c_total: cols["energia_reactiva_ind_pen"] = "__REAC_IND__"
            if c_m:     cols["factor_m"]                 = "__FACTOR_M__"
            if c_costo: cols["tarifa_reactiva"]          = "__TARIFA_REAC__"
        else:
            print("[EMSA] Inductiva merge OMITIDO (sin columna CODIGO)", flush=True)
    else:
        print("[EMSA] buf_ind es None, sin merge Inductiva", flush=True)

    # ── Valor reactiva = Cobro_cap + Cobro_ind ──────────────────────────────
    if cobro_cap_col or cobro_ind_col:
        v_cap = pd.to_numeric(df[cobro_cap_col], errors="coerce").fillna(0) \
                if cobro_cap_col and cobro_cap_col in df.columns else 0
        v_ind = pd.to_numeric(df[cobro_ind_col], errors="coerce").fillna(0) \
                if cobro_ind_col and cobro_ind_col in df.columns else 0
        df["__VALOR_REAC__"] = v_cap + v_ind
        cols["valor_reactiva_cop"] = "__VALOR_REAC__"

    # ── Tarifa activa y propiedad de activos (modulo Tarifas SDL) ────────────
    # Logica: (nivel_tension + tarifa_reactiva) → lookup → (tarifa_activa, propiedad_activos)
    # valor_cop = energia_kwh × tarifa_activa
    # Mientras el modulo no exista: tarifa_activa=None, propiedad_activos=None, valor_cop=0
    try:
        from ..tarifas_sdl import consultar_tarifa as _consultar_tarifa

        _niv_col = "__NIVEL__"       if "__NIVEL__"       in df.columns else None
        _tr_col  = "__TARIFA_REAC__" if "__TARIFA_REAC__" in df.columns else None
        _per_ref = (
            df["__PERIODO__"].dropna().iloc[0]
            if "__PERIODO__" in df.columns and not df["__PERIODO__"].dropna().empty
            else ""
        )

        _cache: dict = {}
        if _niv_col and _tr_col:
            for _, _r in df[[_niv_col, _tr_col]].drop_duplicates().iterrows():
                _key = (str(_r[_niv_col]), str(_r[_tr_col]))
                _cache[_key] = _consultar_tarifa(
                    "EMSA", _per_ref, _key[0], _safe_float(_key[1])
                )
            df["__TARIFA_ACT__"] = df.apply(
                lambda r: _cache.get((str(r[_niv_col]), str(r[_tr_col])), (None, None))[0],
                axis=1,
            )
            df["__PROP__"] = df.apply(
                lambda r: _cache.get((str(r[_niv_col]), str(r[_tr_col])), (None, None))[1],
                axis=1,
            )
        else:
            df["__TARIFA_ACT__"] = None
            df["__PROP__"] = None

        # Si Tarifas devuelve tarifa_activa, recalcular valor_cop = energia × tarifa_activa
        if col_kwh and pd.to_numeric(df["__TARIFA_ACT__"], errors="coerce").notna().any():
            energia = pd.to_numeric(df[col_kwh], errors="coerce")
            tarifa  = pd.to_numeric(df["__TARIFA_ACT__"], errors="coerce")
            df["__VALOR_COP__"] = energia * tarifa
            cols["tarifa_sdl"] = "__TARIFA_ACT__"

        cols["propiedad_activos"] = "__PROP__"

    except Exception as _e:
        print(f"[EMSA] Tarifas lookup omitido: {_e}", flush=True)

    print(f"[EMSA] cols mapeadas: {[k for k,v in cols.items() if v]}", flush=True)
    return df, mapeo


# ── Helpers ─────────────────────────────────────────────────────────────────

def _read_extra(buf: bytes) -> pd.DataFrame:
    try:
        return pd.read_excel(io.BytesIO(buf), dtype=str, keep_default_na=False)
    except Exception as e:
        print(f"[EMSA] ERROR leyendo archivo extra: {e}", flush=True)
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
