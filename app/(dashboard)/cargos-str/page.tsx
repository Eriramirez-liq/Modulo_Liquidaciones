"use client"
import { useState, useEffect, useMemo, useRef } from "react"
import Link from "next/link"
import { FilaOperador } from "@/components/cargos-str/FilaOperador"
import { BotonCrearOC } from "@/components/cargos-str/BotonCrearOC"
import DetalleEnvioModal from "@/components/cargos-str/DetalleEnvioModal"
import ModalConfirmarLote from "@/components/cargos-str/ModalConfirmarLote"
import Toast from "@/components/cargos-str/Toast"
import type { EstadoEnvioKey, EstadoEnvioUI, DetalleEnvio, LoteEnCursoUI, CargoSeleccionado, CargoParaEnviar } from "@/components/cargos-str/types"
import { crearLoteReal, procesarLoteReal, getLoteReal, getEstadosReal, getLoteActivoReal, cancelarLoteReal, reenviarEnvioReal } from "@/lib/api/netsuite-cargos"
import type { LoteResponse } from "@/lib/api/netsuite-cargos"
import PanelLoteEnCurso from "@/components/cargos-str/PanelLoteEnCurso"
import type { ToastData } from "@/components/cargos-str/Toast"

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

// Vercel Hobby: maxDuration = 60s. Con ~2s por envío real, 25 cargos ≈ 50s
// con margen de seguridad. Si se migra a Pro, subir a 100.
const MAX_ENVIOS_POR_LOTE = 25

// ---------------------------------------------------------------------------
// Tipos locales de la página
// ---------------------------------------------------------------------------

const MES_NOMBRE = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

type Periodo  = { id: string; anio: number; mes: number; estado: string }
type Operador = { id: string; codigo: string; nombre: string }

type Resultado = {
  periodos:        { id: string; facturacion: string; consumo: string }[]
  operadores:      { codigo: string; nombre: string; totales: Record<string, number>; total: number }[]
  totalPorPeriodo: Record<string, number>
  totalGeneral:    number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cop(v: number) {
  return `$ ${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
}

function mesLabel(periodoStr: string): string {
  const [a, m] = periodoStr.split("-")
  const n = parseInt(m ?? "", 10)
  if (!a || isNaN(n) || n < 1 || n > 12) return periodoStr
  return `${MES_NOMBRE[n]} ${a}`
}

function facturacionDe(anio: number, mes: number): { anio: number; mes: number } {
  if (mes === 12) return { anio: anio + 1, mes: 1 }
  return { anio, mes: mes + 1 }
}

function cargoKey(periodoId: string, orCodigo: string): EstadoEnvioKey {
  return `${periodoId}|${orCodigo}`
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function CargosSTRPage() {
  const [periodos, setPeriodos]     = useState<Periodo[]>([])
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [periodoSel, setPeriodoSel] = useState<string[]>([])
  const [orSel, setOrSel]           = useState<string[]>([])
  const [data, setData]             = useState<Resultado | null>(null)
  const [loading, setLoading]       = useState(false)
  const [filtrado, setFiltrado]     = useState(false)

  // -- Estado NetSuite --
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [estadosEnvio, setEstadosEnvio] = useState<Record<EstadoEnvioKey, EstadoEnvioUI>>({})
  const [lastProgressAt, setLastProgressAt] = useState<Date | null>(null)
  // Ref para comparar totales entre ticks del polling sin causar re-renders
  const totalesRef = useRef<{ procesados: number; errores: number; pendientes: number } | null>(null)
  // Ref para guardar el último LoteResponse completo del polling (incluye envíos con todos los campos)
  // Permite al modal de detalle leer campos como montoSnapshotCop/mesConsumo sin fetch adicional
  const ultimoLoteResponseRef = useRef<LoteResponse | null>(null)

  // -- Estado DetalleEnvioModal (FE-3) --
  const [detalleEnvioId, setDetalleEnvioId] = useState<string | null>(null)
  const [detalleEnvio, setDetalleEnvio] = useState<DetalleEnvio | null>(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  // Flag de reenvío en curso (puede tardar ~30s) — deshabilita el botón Reenviar
  const [reenviando, setReenviando] = useState(false)

  // -- Estado ModalConfirmarLote + flujo lote (FE-4) --
  const [loteEnCurso, setLoteEnCurso] = useState<LoteEnCursoUI | null>(null)
  const [panelLoteVisible, setPanelLoteVisible] = useState(true)
  const [modalConfirmarAbierto, setModalConfirmarAbierto] = useState(false)
  const [enviandoLote, setEnviandoLote] = useState(false)
  const [errorLote, setErrorLote] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastData | null>(null)

  // -- Variables derivadas --
  const modoSeleccion   = periodoSel.length === 1
  const periodoUnicoId  = modoSeleccion ? (periodoSel[0] ?? null) : null

  // -- Carga de filtros --
  useEffect(() => {
    fetch("/api/periodos")
      .then(r => r.ok ? r.json() : [])
      .then((ps) => setPeriodos(Array.isArray(ps) ? ps : []))
      .catch(() => setPeriodos([]))

    fetch("/api/operadores?tipo=str")
      .then(r => r.ok ? r.json() : [])
      .then((ors) => setOperadores(Array.isArray(ors) ? ors : []))
      .catch(() => setOperadores([]))
  }, [])

  // -- Helpers FE-5: adaptadores de respuesta del backend a tipos UI --

  function adaptToLoteEnCursoUI(loteResponse: LoteResponse): LoteEnCursoUI {
    return {
      id: loteResponse.loteId,
      estado: loteResponse.estado,
      iniciadoAt: loteResponse.iniciadoAt,
      iniciadoPor: loteResponse.iniciadoPor,
      totales: loteResponse.totales,
      puedeCancelar: true,
    }
  }

  function derivarEstadosEnvioDeLote(
    loteResponse: LoteResponse
  ): Record<EstadoEnvioKey, EstadoEnvioUI> {
    const resultado: Record<EstadoEnvioKey, EstadoEnvioUI> = {}
    for (const envio of loteResponse.envios) {
      const key = cargoKey(envio.periodoId, envio.orCodigo)
      resultado[key] = {
        ultimoEnvioId: envio.id,
        estado: envio.estado,
        numeroOc: envio.numeroOc,
        errorMensaje: envio.errorMensaje,
        loteId: loteResponse.loteId,
        fecha: envio.enviadoAt ?? loteResponse.iniciadoAt,
      }
    }
    return resultado
  }

  // -- useEffect A: Carga de estados al filtrar (cuando NO hay lote en progreso) --
  // TODO FE-6: reemplazar mockGetEstados por fetch a /api/cargos-str/netsuite/estados
  useEffect(() => {
    if (!data || !modoSeleccion || !periodoUnicoId) return
    if (data.operadores.length === 0) return
    // No refrescar estados si hay polling activo — el polling tiene datos más frescos
    if (loteEnCurso?.estado === "EN_PROGRESO") return

    const orCodigos = data.operadores.map(o => o.codigo)
    getEstadosReal([periodoUnicoId], orCodigos)
      .then(estados => setEstadosEnvio(estados as Record<EstadoEnvioKey, EstadoEnvioUI>))
      .catch(console.error)
  }, [data, modoSeleccion, periodoUnicoId, loteEnCurso?.estado])

  // -- useEffect B: Polling del lote en curso --
  useEffect(() => {
    if (!loteEnCurso?.id || loteEnCurso.estado !== "EN_PROGRESO") return

    const loteId = loteEnCurso.id
    let stop = false

    const poll = async () => {
      if (stop) return
      // Pausar polling si la pestaña no está activa (Visibility API)
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return

      try {
        const lote = await getLoteReal(loteId)
        if (stop) return

        // Guardar el LoteResponse completo para que el modal de detalle pueda
        // acceder a campos como montoSnapshotCop, mesConsumo, intentos, etc.
        ultimoLoteResponseRef.current = lote

        // Actualizar loteEnCurso con nuevos totales
        setLoteEnCurso(adaptToLoteEnCursoUI(lote))

        // FE-5.5: detectar progreso real comparando totales contra el tick anterior
        const t = lote.totales
        const prev = totalesRef.current
        const huboProgreso =
          prev === null ||
          t.procesados !== prev.procesados ||
          t.errores !== prev.errores ||
          t.pendientes !== prev.pendientes
        if (huboProgreso) {
          setLastProgressAt(new Date())
          totalesRef.current = { procesados: t.procesados, errores: t.errores, pendientes: t.pendientes }
        }

        // Actualizar estadosEnvio derivando del lote
        const estadosFromLote = derivarEstadosEnvioDeLote(lote)
        setEstadosEnvio(prev => ({ ...prev, ...estadosFromLote }))

        // Si el lote terminó, mostrar toast y dejar que el efecto se desmonte
        if (lote.estado !== "EN_PROGRESO") {
          setToast({
            tipo: lote.totales.errores > 0 ? "warning" : "ok",
            mensaje: `Lote completado: ${lote.totales.procesados} OC creada${lote.totales.procesados !== 1 ? "s" : ""}, ${lote.totales.errores} error${lote.totales.errores !== 1 ? "es" : ""}`,
          })
        }
      } catch (e) {
        console.error("Error en polling de lote:", e)
      }
    }

    poll() // primera llamada inmediata
    const id = setInterval(poll, 2500)
    return () => {
      stop = true
      clearInterval(id)
    }
  // Dependencias: solo id y estado para no reiniciar el interval en cada tick de totales
  }, [loteEnCurso?.id, loteEnCurso?.estado]) // eslint-disable-line react-hooks/exhaustive-deps

  // -- useEffect C: Detección de lote activo al montar --
  useEffect(() => {
    getLoteActivoReal()
      .then(loteResponse => {
        if (loteResponse) {
          // Adaptar LoteResponse → LoteEnCursoUI usando el mismo helper que usa el polling
          const lote = adaptToLoteEnCursoUI(loteResponse)
          setLoteEnCurso(lote)
          setPanelLoteVisible(true)
          // FE-5.5: asumimos el peor caso — el último progreso fue al iniciar el lote
          // (no sabemos cuándo fue el último cambio real entre navegaciones)
          setLastProgressAt(new Date(lote.iniciadoAt))
          totalesRef.current = {
            procesados: lote.totales.procesados,
            errores: lote.totales.errores,
            pendientes: lote.totales.pendientes,
          }
        }
      })
      .catch(console.error)
  }, []) // solo al montar — eslint-disable-line react-hooks/exhaustive-deps

  // Limpiar selección cuando cambia el período filtrado
  useEffect(() => {
    setSeleccion(new Set())
  }, [periodoSel])

  const periodosConConsumo = useMemo(() => {
    return periodos.map(p => {
      const f = facturacionDe(p.anio, p.mes)
      return {
        id:               p.id,
        anio:             p.anio,
        mes:              p.mes,
        consumoLabel:     `${MES_NOMBRE[p.mes]} ${p.anio}`,
        facturacionLabel: `${MES_NOMBRE[f.mes]} ${f.anio}`,
      }
    })
  }, [periodos])

  async function filtrar() {
    setLoading(true)
    setFiltrado(true)
    setSeleccion(new Set())
    setEstadosEnvio({})
    const params = new URLSearchParams()
    if (periodoSel.length > 0) params.set("periodoIds", periodoSel.join(","))
    if (orSel.length      > 0) params.set("orIds",      orSel.join(","))
    const res = await fetch(`/api/cargos-str?${params}`)
    setData(await res.json())
    setLoading(false)
  }

  function togglePeriodo(id: string) {
    setPeriodoSel(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function toggleOR(id: string) {
    setOrSel(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function selectAllPeriodos() { setPeriodoSel(periodos.map(p => p.id)) }
  function clearPeriodos()     { setPeriodoSel([]) }
  function selectAllORs()      { setOrSel(operadores.map(o => o.id)) }
  function clearORs()          { setOrSel([]) }

  // -- Handlers DetalleEnvioModal (FE-3) --

  function handleVerDetalle(envioId: string) {
    // Buscar el estadoEnvio correspondiente al envioId en el mapa actual
    const estadoEnvioEntrada = Object.values(estadosEnvio).find(
      e => e.ultimoEnvioId === envioId
    )

    // No abrir modal para estados sin detalle útil (PENDIENTE/PROCESANDO)
    // Nota: FilaOperador ya filtra el click, pero esta es una segunda línea de defensa
    if (
      !estadoEnvioEntrada ||
      estadoEnvioEntrada.estado === "PENDIENTE" ||
      estadoEnvioEntrada.estado === "PROCESANDO"
    ) {
      return
    }

    setDetalleEnvioId(envioId)
    setCargandoDetalle(true)
    setDetalleEnvio(null)

    // Buscar el EnvioDto completo en el último LoteResponse del polling si está disponible.
    // El ref almacena el último LoteResponse recibido en el polling (incluye el array `envios`
    // con campos que LoteEnCursoUI no expone: montoSnapshotCop, mesConsumo, mesFacturacion, etc.)
    const envioDePolling = ultimoLoteResponseRef.current?.envios.find(
      e => e.id === envioId
    )

    // Construir DetalleEnvio desde los datos reales disponibles en memoria.
    // requestPayloadJson y responsePayloadJson no están expuestos por ningún endpoint
    // todavía (pendiente BE-5) → se dejan en null. El modal los muestra como "No disponible".
    const detalle: DetalleEnvio = {
      id: envioId,
      estado: estadoEnvioEntrada.estado,
      numeroOc: estadoEnvioEntrada.numeroOc ?? null,
      netsuiteInternalId: null,                          // no expuesto por BE-4
      montoSnapshotCop: envioDePolling?.montoSnapshotCop ?? "",
      mesConsumo: envioDePolling?.mesConsumo ?? "",
      mesFacturacion: envioDePolling?.mesFacturacion ?? "",
      enviadoAt: envioDePolling?.enviadoAt ?? null,
      respondidoAt: envioDePolling?.respondidoAt ?? null,
      intentos: envioDePolling?.intentos ?? 1,
      errorCodigo: null,                                 // no expuesto por BE-4
      errorMensaje: estadoEnvioEntrada.errorMensaje ?? null,
      requestPayloadJson: null,                          // no expuesto por BE-4 (pendiente BE-5)
      responsePayloadJson: null,                         // no expuesto por BE-4 (pendiente BE-5)
    }

    // Mostrar inmediatamente — no hay fetch, los datos ya están en memoria
    setDetalleEnvio(detalle)
    setCargandoDetalle(false)
  }

  function handleCerrarDetalle() {
    setDetalleEnvioId(null)
    setDetalleEnvio(null)
    setCargandoDetalle(false)
  }

  async function handleReenviar() {
    // El envioId es el id real del envío (ultimoEnvioId guardado en detalleEnvio.id)
    const envioId = detalleEnvio?.id
    if (!envioId) return

    setReenviando(true)
    try {
      const envioDto = await reenviarEnvioReal(envioId)

      // Actualizar estadosEnvio para la celda correspondiente
      const key = cargoKey(envioDto.periodoId, envioDto.orCodigo)
      setEstadosEnvio(prev => ({
        ...prev,
        [key]: {
          ...prev[key],
          ultimoEnvioId: envioDto.id,
          estado: envioDto.estado,
          numeroOc: envioDto.numeroOc ?? null,
          errorMensaje: envioDto.errorMensaje ?? null,
        } as EstadoEnvioUI,
      }))

      // Refrescar detalleEnvio si el modal sigue abierto
      if (detalleEnvioId !== null) {
        setDetalleEnvio(prev => prev
          ? {
              ...prev,
              estado: envioDto.estado,
              numeroOc: envioDto.numeroOc ?? null,
              errorMensaje: envioDto.errorMensaje ?? null,
              errorCodigo: envioDto.errorCodigo ?? null,
              intentos: envioDto.intentos,
              enviadoAt: envioDto.enviadoAt ?? null,
              respondidoAt: envioDto.respondidoAt ?? null,
            }
          : prev
        )
      }

      // Toast según resultado
      if (envioDto.estado === "PROCESADO") {
        setToast({ tipo: "ok", mensaje: `OC creada: ${envioDto.numeroOc ?? "—"}` })
      } else {
        setToast({
          tipo: "warning",
          mensaje: envioDto.errorMensaje ?? "Reenvío completado con error.",
        })
      }
    } catch (e: unknown) {
      const errObj = e as Record<string, unknown>
      const msg = errObj?.error === "ENVIO_NO_REENVIABLE"
        ? (typeof errObj.message === "string" ? errObj.message : "Este envío no se puede reenviar.")
        : "Error al reenviar. Intentá de nuevo en unos segundos."
      setToast({ tipo: "error", mensaje: msg })
    } finally {
      setReenviando(false)
    }
  }

  // -- Handler: cancelar lote --

  async function handleCancelarLote() {
    if (!loteEnCurso?.id) return
    try {
      await cancelarLoteReal(loteEnCurso.id)
      setLoteEnCurso(prev => prev ? { ...prev, estado: "CANCELADO" } : null)
      // Limpiar tracking de progreso — el lote ya no está activo
      setLastProgressAt(null)
      totalesRef.current = null
      setToast({ tipo: "warning", mensaje: "Lote cancelado." })
      // El polling se detiene solo en el próximo tick (loteEnCurso.estado !== EN_PROGRESO)
    } catch (e: unknown) {
      // throwIfNotOk lanza el JSON del body: { error, message }. No hay campo status.
      const errObj = e as Record<string, unknown>
      const msg = errObj?.error === "LOTE_NO_CANCELABLE"
        ? "No se puede cancelar: hay envíos en proceso. Esperá un momento e intentá de nuevo."
        : "Error al cancelar el lote. Reintentá en unos segundos."
      setToast({ tipo: "error", mensaje: msg })
    }
  }

  // -- Helpers FE-4: lote --

  function getCargosSeleccionados(): CargoSeleccionado[] {
    if (!data || !periodoUnicoId) return []
    return Array.from(seleccion).map(orCodigo => {
      const operador = data.operadores.find(o => o.codigo === orCodigo)
      const periodo = data.periodos.find(p => p.id === periodoUnicoId)
      const montoCop = operador?.totales[periodoUnicoId] ?? 0
      const key = cargoKey(periodoUnicoId, orCodigo)
      const estadoEnvio = estadosEnvio[key]
      return {
        periodoId: periodoUnicoId,
        orCodigo,
        orNombre: operador?.nombre ?? orCodigo,
        mesConsumo: periodo?.consumo ?? "",
        mesFacturacion: periodo?.facturacion ?? "",
        montoCop,
        // Campo extra para el warning del modal (no está en el tipo base)
        tieneErrorPrevio: estadoEnvio?.estado === "ERROR",
      } as CargoSeleccionado & { tieneErrorPrevio: boolean }
    })
  }

  async function handleConfirmarLote() {
    // Validaciones cliente
    if (seleccion.size === 0) {
      setToast({ tipo: "error", mensaje: "No hay cargos seleccionados." })
      setModalConfirmarAbierto(false)
      return
    }
    if (seleccion.size > MAX_ENVIOS_POR_LOTE) {
      setToast({ tipo: "error", mensaje: `Máximo ${MAX_ENVIOS_POR_LOTE} cargos por lote.` })
      return
    }

    // Filtro defensivo: remover los que ya están en PROCESADO
    const cargosSeleccionados = getCargosSeleccionados()
    const elegibles = cargosSeleccionados.filter(c => {
      const key = cargoKey(c.periodoId, c.orCodigo)
      const estado = estadosEnvio[key]
      return estado?.estado !== "PROCESADO"
    })

    if (elegibles.length === 0) {
      setToast({ tipo: "warning", mensaje: "No hay cargos elegibles. Los seleccionados ya tienen OC." })
      setModalConfirmarAbierto(false)
      return
    }

    const cargosParaEnviar: CargoParaEnviar[] = elegibles.map(c => ({
      periodoId: c.periodoId,
      orCodigo: c.orCodigo,
    }))

    setEnviandoLote(true)
    setErrorLote(null)

    try {
      // POST /lote (real)
      const response = await crearLoteReal(cargosParaEnviar)

      // POST /lote/:id/procesar (real — fire-and-forget, 202 Accepted)
      await procesarLoteReal(response.loteId)

      // Actualizar estado local del lote
      setLoteEnCurso({
        id: response.loteId,
        estado: "EN_PROGRESO",
        iniciadoAt: new Date().toISOString(),
        iniciadoPor: { nombre: "Yo" }, // El primer polling real lo reemplaza
        totales: {
          total: response.totalEnvios,
          pendientes: response.totalEnvios,
          procesados: 0,
          errores: 0,
        },
        puedeCancelar: true,
      })
      // FE-5.5: el lote acaba de crearse — el progreso arranca ahora
      setLastProgressAt(new Date())
      totalesRef.current = { procesados: 0, errores: 0, pendientes: response.totalEnvios }

      // Limpiar y cerrar
      setModalConfirmarAbierto(false)
      setSeleccion(new Set())
      setPanelLoteVisible(true) // FE-5: mostrar el panel cuando arranca el lote
      setToast({
        tipo: "ok",
        mensaje: `Lote creado: ${response.totalEnvios} envío${response.totalEnvios !== 1 ? "s" : ""} en proceso.`,
      })
    } catch (err: unknown) {
      // Discriminar errores por campo `error`
      const errObj = err as Record<string, unknown>
      if (errObj?.error === "LOTE_EN_CURSO") {
        const iniciadoPor = (errObj.iniciadoPor as { nombre: string } | undefined)?.nombre ?? "otro usuario"
        setErrorLote(`Hay un lote en curso iniciado por ${iniciadoPor}. Esperá a que termine.`)
      } else if (errObj?.error === "MONTO_CERO") {
        setErrorLote("Algún cargo seleccionado tiene monto cero. Revisá los datos.")
      } else {
        // Mostrar el código/mensaje real del backend para poder diagnosticar.
        const codigo  = typeof errObj?.error === "string" ? errObj.error : null
        const mensaje = typeof errObj?.message === "string" ? errObj.message : null
        setErrorLote(
          codigo || mensaje
            ? `Error al crear el lote${codigo ? ` [${codigo}]` : ""}${mensaje ? `: ${mensaje}` : ""}`
            : "Error al crear el lote. Reintentá en unos segundos.",
        )
      }
    } finally {
      setEnviandoLote(false)
    }
  }

  // -- Helpers de selección --

  function toggleSeleccion(orCodigo: string) {
    if (!modoSeleccion || !periodoUnicoId) return

    const key = cargoKey(periodoUnicoId, orCodigo)
    const estado = estadosEnvio[key]

    // No permitir seleccionar cargos ya en proceso o procesados
    if (
      estado?.estado === "PROCESADO" ||
      estado?.estado === "PROCESANDO" ||
      estado?.estado === "PENDIENTE"
    ) {
      return
    }

    setSeleccion(prev => {
      const next = new Set(prev)
      if (next.has(orCodigo)) {
        next.delete(orCodigo)
      } else {
        if (next.size >= MAX_ENVIOS_POR_LOTE) return prev
        next.add(orCodigo)
      }
      return next
    })
  }

  function toggleSeleccionarTodos() {
    if (!modoSeleccion || !periodoUnicoId || !data) return

    // Elegibles: operadores cuyo estado NO es PROCESADO/PROCESANDO/PENDIENTE
    const elegibles = data.operadores.filter(o => {
      const key = cargoKey(periodoUnicoId, o.codigo)
      const estado = estadosEnvio[key]
      return (
        !estado ||
        estado.estado === "ERROR"
      )
    })

    const todosSeleccionados = elegibles.every(o => seleccion.has(o.codigo))

    if (todosSeleccionados) {
      // Deseleccionar todos los elegibles
      setSeleccion(prev => {
        const next = new Set(prev)
        elegibles.forEach(o => next.delete(o.codigo))
        return next
      })
    } else {
      // Seleccionar todos los elegibles
      setSeleccion(prev => {
        const next = new Set(prev)
        elegibles.forEach(o => next.add(o.codigo))
        return next
      })
    }
  }

  // Estado del checkbox maestro
  function getMaestroState(): { checked: boolean; indeterminate: boolean } {
    if (!data || !modoSeleccion || !periodoUnicoId) {
      return { checked: false, indeterminate: false }
    }
    const elegibles = data.operadores.filter(o => {
      const key = cargoKey(periodoUnicoId, o.codigo)
      const estado = estadosEnvio[key]
      return !estado || estado.estado === "ERROR"
    })
    if (elegibles.length === 0) return { checked: false, indeterminate: false }
    const seleccionadosCount = elegibles.filter(o => seleccion.has(o.codigo)).length
    if (seleccionadosCount === 0) return { checked: false, indeterminate: false }
    if (seleccionadosCount === elegibles.length) return { checked: true, indeterminate: false }
    return { checked: false, indeterminate: true }
  }

  const maestroState = getMaestroState()

  // -- Summaries para los filtros --

  const facturacionSummary = periodoSel.length === 0
    ? "Todos los períodos"
    : periodoSel.length === 1
      ? (periodosConConsumo.find(p => p.id === periodoSel[0])?.facturacionLabel ?? "1 período")
      : `${periodoSel.length} períodos`

  const consumoSummary = periodoSel.length === 0
    ? "Todos los meses"
    : periodoSel.length === 1
      ? (periodosConConsumo.find(p => p.id === periodoSel[0])?.consumoLabel ?? "1 mes")
      : `${periodoSel.length} meses`

  const orSummary = orSel.length === 0
    ? "Todos"
    : orSel.length === 1
      ? (operadores.find(o => o.id === orSel[0])?.nombre ?? "1 OR")
      : `${orSel.length} ORs`

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
            Cargos STR
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
            Cargos calculados a partir de los Insumos STR, totalizados por operador.
          </p>
        </div>
        <Link
          href="/cargos-str/historial"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: "0.82rem", color: "#6b7280", fontWeight: 500,
            textDecoration: "none", padding: "5px 12px",
            border: "1px solid #e5e7eb", borderRadius: 8,
            background: "#fff",
          }}
        >
          Historial de envíos
        </Link>
      </div>

      {/* Panel lote en curso — FE-5 */}
      {loteEnCurso && panelLoteVisible && (
        <PanelLoteEnCurso
          lote={loteEnCurso}
          lastProgressAt={lastProgressAt}
          puedeCancelar={loteEnCurso.estado === "EN_PROGRESO"}
          onCancelar={handleCancelarLote}
          onCerrar={() => setPanelLoteVisible(false)}
          onVerDetalle={() => {}}
        />
      )}

      {/* Filters */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
          <MultiSelect
            label="Período facturación"
            summary={facturacionSummary}
            options={periodosConConsumo.map(p => ({ id: p.id, label: p.facturacionLabel }))}
            selected={periodoSel}
            onToggle={togglePeriodo}
            onSelectAll={selectAllPeriodos}
            onClear={clearPeriodos}
          />
          <MultiSelect
            label="Período consumo"
            summary={consumoSummary}
            options={periodosConConsumo.map(p => ({ id: p.id, label: p.consumoLabel }))}
            selected={periodoSel}
            onToggle={togglePeriodo}
            onSelectAll={selectAllPeriodos}
            onClear={clearPeriodos}
          />
          <MultiSelect
            label="Operador de Red"
            summary={orSummary}
            options={operadores.map(o => ({ id: o.id, label: o.nombre }))}
            selected={orSel}
            onToggle={toggleOR}
            onSelectAll={selectAllORs}
            onClear={clearORs}
          />
          <button
            onClick={filtrar}
            disabled={loading}
            style={{
              background: "#07c5a8", color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 24px", fontSize: "0.875rem", fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
            }}
          >
            Filtrar
          </button>
          {/* BotonCrearOC — aparece siempre que haya datos filtrados */}
          {filtrado && !loading && data && data.operadores.length > 0 && (
            <BotonCrearOC
              cantidad={seleccion.size}
              disabled={!modoSeleccion || seleccion.size === 0 || loteEnCurso?.estado === "EN_PROGRESO"}
              onAbrir={() => setModalConfirmarAbierto(true)}
            />
          )}
        </div>
      </div>

      {/* Results */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {!filtrado ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Selecciona los filtros y pulsa <strong>Filtrar</strong> para ver los cargos.
          </div>
        ) : loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            Cargando…
          </div>
        ) : !data || data.operadores.length === 0 || data.periodos.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>
            No hay cargos STR para los filtros seleccionados.
          </div>
        ) : (
          <ResultsTable
            data={data}
            estadosEnvio={estadosEnvio}
            seleccion={seleccion}
            onToggleSeleccion={toggleSeleccion}
            onClickCeldaConEnvio={handleVerDetalle}
            modoSeleccion={modoSeleccion}
            onToggleSeleccionarTodos={toggleSeleccionarTodos}
            maestroChecked={maestroState.checked}
            maestroIndeterminate={maestroState.indeterminate}
          />
        )}
      </div>

      {/* DetalleEnvioModal — FE-3 */}
      <DetalleEnvioModal
        abierto={detalleEnvioId !== null}
        envio={detalleEnvio}
        cargando={cargandoDetalle || reenviando}
        onCerrar={handleCerrarDetalle}
        onReenviar={detalleEnvio?.estado === "ERROR" && !reenviando ? handleReenviar : undefined}
      />

      {/* ModalConfirmarLote — FE-4 */}
      <ModalConfirmarLote
        abierto={modalConfirmarAbierto}
        cargos={modalConfirmarAbierto ? getCargosSeleccionados() : []}
        enviando={enviandoLote}
        error={errorLote}
        onConfirmar={handleConfirmarLote}
        onCancelar={() => {
          setModalConfirmarAbierto(false)
          setErrorLote(null)
        }}
      />

      {/* Toast — FE-4 */}
      <Toast
        toast={toast}
        onClose={() => setToast(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ResultsTable
// ---------------------------------------------------------------------------

interface ResultsTableProps {
  data: Resultado
  estadosEnvio: Record<EstadoEnvioKey, EstadoEnvioUI>
  seleccion: Set<string>
  onToggleSeleccion: (orCodigo: string) => void
  onClickCeldaConEnvio: (envioId: string) => void
  modoSeleccion: boolean
  onToggleSeleccionarTodos: () => void
  maestroChecked: boolean
  maestroIndeterminate: boolean
}

function ResultsTable({
  data,
  estadosEnvio,
  seleccion,
  onToggleSeleccion,
  onClickCeldaConEnvio,
  modoSeleccion,
  onToggleSeleccionarTodos,
  maestroChecked,
  maestroIndeterminate,
}: ResultsTableProps) {
  const multiplePeriodos = data.periodos.length > 1

  const thTopStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "0.78rem", fontWeight: 700,
    color: "#1e3a8a", textAlign: "left",
    background: "#dbeafe", whiteSpace: "nowrap",
    borderBottom: "1px solid #bfdbfe",
    border: "1px solid #bfdbfe",
  }
  const thSubStyle: React.CSSProperties = {
    padding: "8px 14px", fontSize: "0.78rem", fontWeight: 600,
    color: "#1e3a8a", textAlign: "left",
    background: "#eff6ff", whiteSpace: "nowrap",
    borderBottom: "2px solid #bfdbfe",
    border: "1px solid #bfdbfe",
  }
  const tdStyle: React.CSSProperties = {
    padding: "8px 14px", fontSize: "0.875rem", color: "#374151",
    borderBottom: "1px solid #f3f4f6",
    border: "1px solid #e5e7eb",
  }

  // Transformar periodos al formato que espera FilaOperador
  const periodosParaFila = data.periodos.map(p => ({
    id: p.id,
    mes_facturacion: p.facturacion,
    mes_consumo: p.consumo,
  }))

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          {/* Fila 1: Mes facturación */}
          <tr>
            <th style={thTopStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {modoSeleccion && (
                  <CheckboxMaestro
                    checked={maestroChecked}
                    indeterminate={maestroIndeterminate}
                    onChange={onToggleSeleccionarTodos}
                  />
                )}
                <span>Mes facturación</span>
              </div>
            </th>
            {data.periodos.map(p => (
              <th key={`f-${p.id}`} style={{ ...thTopStyle, textAlign: "center" }}>
                {mesLabel(p.facturacion)}
              </th>
            ))}
            {multiplePeriodos && (
              <th style={{ ...thTopStyle, textAlign: "right" }} rowSpan={2}>
                Total
              </th>
            )}
          </tr>
          {/* Fila 2: Mes consumo */}
          <tr>
            <th style={thSubStyle}>Mes Consumo</th>
            {data.periodos.map(p => (
              <th key={`c-${p.id}`} style={{ ...thSubStyle, textAlign: "center" }}>
                {mesLabel(p.consumo)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.operadores.map(o => (
            <FilaOperador
              key={o.codigo}
              operador={{ codigo: o.codigo, nombre: o.nombre }}
              periodos={periodosParaFila}
              valoresPorPeriodo={o.totales}
              total={o.total}
              estadosEnvio={estadosEnvio}
              seleccionado={seleccion.has(o.codigo)}
              onToggleSeleccion={onToggleSeleccion}
              onClickCeldaConEnvio={onClickCeldaConEnvio}
              modoSeleccion={modoSeleccion}
              mostrarTotal={multiplePeriodos}
            />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{
              ...tdStyle, fontWeight: 700, background: "#f0fdf4",
              color: "#065f46", borderTop: "2px solid #d1fae5", textAlign: "center",
            }}>
              TOTAL
            </td>
            {data.periodos.map(p => (
              <td key={p.id} style={{
                ...tdStyle, textAlign: "right", fontFamily: "monospace",
                fontWeight: 700, background: "#f0fdf4", color: "#065f46",
                borderTop: "2px solid #d1fae5",
              }}>
                {cop(data.totalPorPeriodo[p.id] ?? 0)}
              </td>
            ))}
            {multiplePeriodos && (
              <td style={{
                ...tdStyle, textAlign: "right", fontFamily: "monospace",
                fontWeight: 700, background: "#07c5a8", color: "#fff",
                borderTop: "2px solid #d1fae5",
              }}>
                {cop(data.totalGeneral)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CheckboxMaestro — acepta la prop `indeterminate` que no existe en HTML nativo
// ---------------------------------------------------------------------------

function CheckboxMaestro({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
}) {
  // useRef para aplicar el estado `indeterminate` del DOM directamente
  const ref = (node: HTMLInputElement | null) => {
    if (node) node.indeterminate = indeterminate
  }

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      style={{
        width: 15,
        height: 15,
        accentColor: "#07c5a8",
        cursor: "pointer",
        flexShrink: 0,
      }}
      aria-label="Seleccionar todos los operadores elegibles"
    />
  )
}

// ---------------------------------------------------------------------------
// MultiSelect (sin cambios)
// ---------------------------------------------------------------------------

function MultiSelect({
  label, summary, options, selected, onToggle, onSelectAll, onClear,
}: {
  label: string
  summary: string
  options: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string) => void
  onSelectAll: () => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative", minWidth: 220 }}>
      <label style={{ fontSize: "0.78rem", fontWeight: 500, color: "#374151" }}>{label}</label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          border: "1px solid #d1d5db", borderRadius: 8, padding: "7px 12px",
          fontSize: "0.875rem", background: "#fff", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8, textAlign: "left",
        }}
      >
        <span style={{ color: selected.length === 0 ? "#6b7280" : "#111827" }}>{summary}</span>
        <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>▼</span>
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 10,
            }}
          />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 20,
            minWidth: 260, maxHeight: 320, overflowY: "auto",
          }}>
            <div style={{
              padding: "6px 10px", borderBottom: "1px solid #f3f4f6",
              display: "flex", gap: 12, fontSize: "0.78rem",
            }}>
              <button type="button" onClick={onSelectAll}
                style={{ background: "none", border: "none", color: "#07c5a8", cursor: "pointer", padding: 0 }}>
                Seleccionar todos
              </button>
              <button type="button" onClick={onClear}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: 0 }}>
                Limpiar
              </button>
            </div>
            {options.length === 0 ? (
              <div style={{ padding: "10px 14px", fontSize: "0.8rem", color: "#9ca3af" }}>
                Sin opciones disponibles
              </div>
            ) : options.map(opt => (
              <label key={opt.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 12px", cursor: "pointer", fontSize: "0.875rem",
              }}>
                <input
                  type="checkbox"
                  checked={selected.includes(opt.id)}
                  onChange={() => onToggle(opt.id)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
