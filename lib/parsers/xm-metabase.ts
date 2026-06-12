import type { FilaXM, ResultadoParser } from "@/lib/parsers/types"

/**
 * Mapea las filas que devuelve la card de Metabase "aenc-xm-final" (76099) al
 * shape FilaXM. El dato de energia es la columna "total aenc_div_perdidas".
 *
 * La card ya viene filtrada por fecha (mes de consumo) y version=TxF, asi que
 * el periodo se asigna desde el wizard (no se deriva de la fila).
 */

function normalizarCol(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function construirFindCol(columnas: string[]) {
  const variantes = columnas.map(c => ({ orig: c, norm: normalizarCol(c) }))
  return (...candidatos: string[]): string | null => {
    for (const cand of candidatos) {
      const key = normalizarCol(cand)
      if (!key) continue
      const exacto = variantes.find(v => v.norm === key)
      if (exacto) return exacto.orig
      const parcial = variantes.find(v => v.norm.includes(key))
      if (parcial) return parcial.orig
    }
    return null
  }
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return isNaN(v) ? null : v
  const s = String(v).replace(/[^0-9.,\-]/g, "").trim()
  if (!s) return null
  const n = parseFloat(s.replace(/,/g, ""))
  return isNaN(n) ? null : n
}

export function mapearFilasXMMetabase(
  rows: Record<string, unknown>[],
  columnas: string[],
  periodo: string,   // "AAAA-MM"
): ResultadoParser<FilaXM> {
  const alertas: string[]         = []
  const erroresCriticos: string[] = []
  const filas: FilaXM[]           = []

  if (rows.length === 0) return { filas, alertas, erroresCriticos }

  const findCol = construirFindCol(columnas)
  const colSic    = findCol("sic", "codigo_sic", "codigosic", "codigo_frontera", "frontera")
  // Dato de energia: "total aenc_div_perdidas".
  const colEnergia = findCol(
    "total aenc_div_perdidas", "total_aenc_div_perdidas", "totalaencdivperdidas",
    "aenc_div_perdidas", "aencdivperdidas",
  )
  const colNombre = findCol("nombre", "nombre_frontera", "frontera_nombre")
  // Agente comercial que IMPORTA: solo nos quedamos con las filas de BIA (BIAC).
  // La card trae varias filas por frontera (una por combinacion de agentes);
  // sin este filtro se sumarian todas y el total quedaria inflado.
  const colImporta = findCol(
    "importing_commercial_agent_code", "importing_commercial_agent", "importing_agent_code",
    "agente_comercial_que_importa", "agente comercial que importa", "agente_importa",
  )

  const faltantes: string[] = []
  if (!colSic)     faltantes.push("codigo_sic")
  if (!colEnergia) faltantes.push("total aenc_div_perdidas")
  if (faltantes.length > 0) {
    erroresCriticos.push(
      `Columnas requeridas no encontradas en Metabase: ${faltantes.join(", ")}. ` +
      `Columnas disponibles: [${columnas.join(", ")}]`,
    )
    return { filas, alertas, erroresCriticos }
  }

  // Agregar por SIC. La card trae varias filas por frontera (una por
  // combinacion de agente comercial); nos quedamos solo con las del agente
  // que importa = BIAC y sumamos por frontera.
  let omitidasNoBiac = 0
  const porSic = new Map<string, { nombre: string | null; total: number }>()
  for (const r of rows) {
    if (colImporta) {
      const importa = String(r[colImporta] ?? "").trim().toUpperCase()
      if (importa !== "BIAC") { omitidasNoBiac++; continue }
    }
    const sic = String(r[colSic!] ?? "").trim()
    if (!sic) continue
    const energia = toNum(r[colEnergia!]) ?? 0
    const nombre = colNombre ? (String(r[colNombre] ?? "").trim() || null) : null
    const prev = porSic.get(sic)
    if (prev) {
      prev.total += energia
      if (!prev.nombre && nombre) prev.nombre = nombre
    } else {
      porSic.set(sic, { nombre, total: energia })
    }
  }

  if (colImporta) {
    alertas.push(
      `Filtro agente que importa = BIAC: ${omitidasNoBiac} filas omitidas (otros agentes).`,
    )
  } else {
    alertas.push(
      "No se encontro la columna del agente que importa (importing_commercial_agent_code); " +
      "no se pudo filtrar por BIAC — verifica que el total por frontera sea correcto.",
    )
  }

  for (const [sic, v] of porSic.entries()) {
    filas.push({ SIC: sic, Nombre: v.nombre, Periodo: periodo, "Activa XM": v.total })
  }

  return { filas, alertas, erroresCriticos }
}
