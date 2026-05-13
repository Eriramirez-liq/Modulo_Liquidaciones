# -*- coding: utf-8 -*-
"""
Pre-procesador SDL para EBSA.

El archivo tiene formato VERTICAL: cada frontera aparece en múltiples filas,
una por tipo de energía (ACTIVA / REACTIVA). La columna "ENERGIA" indica el tipo
y la columna "PERIODO" indica el subtipo reactivo (Monomia OC, Reactiva Capacit…).

Transformaciones:
1. Pivoteo: de formato vertical a una fila por frontera (base = filas ACTIVA).
2. Periodo: construido de las columnas "AÑO" + "MES" → "AAAA-MM".
3. Energía reactiva Ind (kWh): KW-H donde ENERGIA=REACTIVA y PERIODO~"Monomia OC".
4. Energía reactiva Cap (kWh): KW-H donde ENERGIA=REACTIVA y PERIODO~"Capacit".
5. Valor reactiva (COP): suma de VALOR para todas las filas REACTIVA por frontera.
6. Factor M: VALOR M de las filas REACTIVA (Monomia OC), primer valor por frontera.
7. Tarifa reactiva: VALOR / KW-H para filas REACTIVA (suma/suma por frontera).
8. Propiedad activos: basada en columna NT de las filas ACTIVA:
   - NT 2 o 3 → "Usuario"
   - NT 1     → pendiente módulo Tarifas (queda None por ahora)
"""
from __future__ import annotations
import unicodedata
import pandas as pd


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").strip().upper()


def preprocesar(buffer: bytes, df: pd.DataFrame, mapeo: dict) -> tuple[pd.DataFrame, dict]:
    df    = df.copy()
    mapeo = {**mapeo, "columnas": dict(mapeo.get("columnas", {}))}
    cols  = mapeo["columnas"]

    df.columns = [str(c).strip() for c in df.columns]

    col_sic     = _find_col(df, "CODIGO SIC")
    col_eng     = _find_col(df, "ENERGIA")
    col_kwh     = _find_col(df, "KW-H")
    col_valor   = _find_col(df, "VALOR")
    col_nt      = _find_col(df, "NT")
    col_anio    = _find_col(df, "AÑO")
    col_mes     = _find_col(df, "MES")
    col_per     = _find_col(df, "PERIODO")
    col_valor_m = _find_col(df, "VALOR M")

    if not col_sic or not col_eng:
        return df, mapeo

    # Normalizar columna ENERGIA
    df["__ENG__"] = df[col_eng].astype(str).str.strip().str.upper()

    df_act  = df[df["__ENG__"] == "ACTIVA"].copy()
    df_reac = df[df["__ENG__"] == "REACTIVA"].copy()

    if df_act.empty:
        return df, mapeo

    # 1. Base: primera fila ACTIVA por frontera
    df_base = df_act.drop_duplicates(subset=[col_sic]).copy()

    # 2. Periodo desde AÑO + MES
    periodo = _construir_periodo(df_act, col_anio, col_mes)
    df_base["__PERIODO__"] = periodo
    cols["periodo"] = "__PERIODO__"

    # 3-7. Datos reactivos por frontera
    if not df_reac.empty:
        # Sub-tipos por columna PERIODO
        if col_per:
            per_upper = df_reac[col_per].astype(str).str.upper()
            df_reac_ind = df_reac[per_upper.str.contains("MONOMIA", na=False)].copy()
            df_reac_cap = df_reac[per_upper.str.contains("CAPACIT", na=False)].copy()
        else:
            df_reac_ind = df_reac.copy()
            df_reac_cap = pd.DataFrame(columns=df_reac.columns)

        # Valor reactiva total (suma VALOR de todas las filas REACTIVA)
        if col_valor:
            val_r = (
                df_reac.groupby(col_sic)[col_valor]
                .apply(lambda x: pd.to_numeric(x, errors="coerce").sum())
                .reset_index(name="__VALOR_REAC__")
            )
            df_base = df_base.merge(val_r, on=col_sic, how="left")
            cols["valor_reactiva_cop"] = "__VALOR_REAC__"

        # Factor M — cascada de fuentes por frontera:
        #   1. REACTIVA con PERIODO~"Monomia" (preferida)
        #   2. Cualquier fila REACTIVA (ej. solo "Reactiva Capacit")
        #   3. Fila ACTIVA (fronteras sin energía reactiva)
        fm_lookup: dict = {}
        if col_valor_m:
            def _first_valid(series: "pd.Series") -> object:
                v = pd.to_numeric(series, errors="coerce").dropna()
                return v.iloc[0] if not v.empty else None

            for src_df in [df_reac_ind, df_reac, df_act]:
                if src_df.empty:
                    continue
                for sic, grp in src_df.groupby(col_sic):
                    if sic not in fm_lookup or pd.isna(pd.to_numeric(fm_lookup[sic], errors="coerce")):
                        val = _first_valid(grp[col_valor_m])
                        if val is not None:
                            fm_lookup[sic] = val

            df_base["__FACTOR_M__"] = df_base[col_sic].map(fm_lookup)
            cols["factor_m"] = "__FACTOR_M__"

        def _div_m(kwh_series: pd.Series, sic_series: pd.Series) -> pd.Series:
            """KW-H / Factor M por frontera."""
            def _calc(row):
                kwh = pd.to_numeric(row[0], errors="coerce")
                m   = pd.to_numeric(fm_lookup.get(row[1], 1), errors="coerce")
                if pd.isna(m) or m == 0:
                    return kwh
                return kwh / m if not pd.isna(kwh) else None
            return pd.Series(list(zip(kwh_series, sic_series))).apply(_calc)

        # Energía reactiva inductiva (KW-H / Factor M, Monomia OC)
        if col_kwh and not df_reac_ind.empty:
            def _kwh_div_m_ind(grp):
                kwh = pd.to_numeric(grp[col_kwh], errors="coerce").sum()
                m   = pd.to_numeric(fm_lookup.get(grp[col_sic].iloc[0], 1), errors="coerce")
                return kwh / m if (not pd.isna(m) and m != 0) else kwh
            kwh_i = (
                df_reac_ind.groupby(col_sic)
                .apply(_kwh_div_m_ind)
                .reset_index(name="__REAC_IND__")
            )
            df_base = df_base.merge(kwh_i, on=col_sic, how="left")
            cols["energia_reactiva_ind_pen"] = "__REAC_IND__"

        # Energía reactiva capacitiva (KW-H / Factor M, Reactiva Capacit)
        if col_kwh and not df_reac_cap.empty:
            def _kwh_div_m_cap(grp):
                kwh = pd.to_numeric(grp[col_kwh], errors="coerce").sum()
                m   = pd.to_numeric(fm_lookup.get(grp[col_sic].iloc[0], 1), errors="coerce")
                return kwh / m if (not pd.isna(m) and m != 0) else kwh
            kwh_c = (
                df_reac_cap.groupby(col_sic)
                .apply(_kwh_div_m_cap)
                .reset_index(name="__REAC_CAP__")
            )
            df_base = df_base.merge(kwh_c, on=col_sic, how="left")
            cols["energia_reactiva_cap_pen"] = "__REAC_CAP__"

        # Tarifa reactiva = Σ VALOR reactiva / Σ KWH reactiva por frontera
        if col_valor and col_kwh and not df_reac.empty:
            def _tar_reac(g: pd.DataFrame) -> float | None:
                v = pd.to_numeric(g[col_valor], errors="coerce").sum()
                k = pd.to_numeric(g[col_kwh],   errors="coerce").sum()
                return float(v / k) if k and k > 0 else None

            tar_r = (
                df_reac.groupby(col_sic)
                .apply(_tar_reac)
                .reset_index(name="__TARIFA_REAC__")
            )
            df_base = df_base.merge(tar_r, on=col_sic, how="left")
            cols["tarifa_reactiva"] = "__TARIFA_REAC__"

    # 8. Propiedad según NT (NT 1 queda pendiente módulo Tarifas)
    if col_nt:
        df_base["__PROPIEDAD__"] = df_base[col_nt].apply(_mapear_propiedad)
        cols["propiedad_activos"] = "__PROPIEDAD__"

    # Quitar filtro_filas si estaba configurado (ya pivotamos)
    mapeo.pop("filtro_filas", None)

    return df_base, mapeo


# ── Helpers ────────────────────────────────────────────────────────────────────

def _find_col(df: pd.DataFrame, nombre: str) -> str | None:
    idx = {_norm(c): c for c in df.columns}
    nombre_up = _norm(nombre)
    if nombre_up in idx:
        return idx[nombre_up]
    for key, col in idx.items():
        if key in nombre_up or nombre_up in key:
            return col
    return None


def _construir_periodo(df: pd.DataFrame, col_anio: str | None, col_mes: str | None) -> str | None:
    """Primera fila con AÑO y MES válidos → 'AAAA-MM'."""
    if not col_anio or not col_mes:
        return None
    for _, row in df.iterrows():
        a = str(row.get(col_anio, "")).strip()
        m = str(row.get(col_mes,  "")).strip()
        if a and m and a.lower() not in ("nan", "none", ""):
            try:
                return f"{int(float(a))}-{int(float(m)):02d}"
            except (ValueError, TypeError):
                pass
    return None


def _mapear_propiedad(nt_val) -> str | None:
    """NT 2/3 → Usuario. NT 1 → None (requiere módulo Tarifas)."""
    v = str(nt_val).strip()
    if v.lower() in ("nan", "none", ""):
        return None
    try:
        nt = int(float(v))
    except (ValueError, TypeError):
        return None
    if nt in (2, 3):
        return "Usuario"
    return None  # NT=1: pendiente módulo Tarifas
