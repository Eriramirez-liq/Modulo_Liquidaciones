# Plan de Desarrollo Frontend — Integración Cargos STR + Oracle NetSuite

> **Modo:** Implementacion UI + Documentacion
> **Fecha:** 2026-05-20 (actualizado 2026-05-20 con correcciones de lógica de selección)
> **Alcance:** `app/(dashboard)/cargos-str/page.tsx` + carpeta nueva `components/cargos-str/`
> **Input:** `mejoras/netsuite-integration-plan.md` (Arquitecto de Soluciones)
> **Autor:** Frontend Specialist

---

## ⚠️ ADDENDUM 2026-05-20 — Corrección de lógica de selección

**El cliente clarificó la lógica de selección antes de arrancar el desarrollo. Estos puntos sobreescriben las decisiones anteriores del documento en lo que respecta a selección, validación de duplicados y UI multi-período. El resto del plan (componentes, polling, máquina de estados, modales) sigue aplicando.**

### Reglas de negocio actualizadas

1. **Una OC por (OR, mes de facturación)**: cuando un cargo `(periodoId, orId)` tiene un envío en estado `PROCESADO`, NO se puede crear una OC nueva para ese mismo par. El sistema debe rechazar la inclusión de ese cargo en cualquier lote nuevo. Solo los cargos en estado `ERROR` o sin envío previo son elegibles.

2. **El lote sigue al lote de Insumos STR**: cuando se cargan los archivos en el módulo Insumos STR para un período, se generan ~23 registros (uno por operador). Ese conjunto se trata como un lote lógico: el usuario lo visualiza completo en Cargos STR y, en condiciones normales, los 23 se envían juntos a NetSuite en el mismo mes de carga.

3. **Selección por fila, no por celda**: el checkbox vive en la columna del operador (extremo izquierdo de cada fila), no en cada celda de monto. Razón: la celda representa el dato monetario de ese OR en ese mes; el envío a NetSuite es del OR completo del período filtrado, no de un valor numérico individual.

4. **"Crear OC" requiere un solo período de facturación filtrado**: la operación de creación de OC solo es válida cuando hay UN período de facturación seleccionado en el filtro. Con múltiples períodos seleccionados, los checkboxes y el botón "Crear OC" quedan deshabilitados — la vista pasa a modo solo-lectura para auditoría histórica.

5. **Modo multi-período = visualización**: cuando el usuario filtra varios meses para revisar histórico:
   - Cada celda muestra el color de su estado (amarillo/verde/rojo)
   - Al pasar el mouse sobre el monto, aparece tooltip con el **número de OC** (si está procesado) o el error (si falló)
   - El layout visual sigue siendo limpio: período facturación, período consumo, operador, monto. Nada más visible — el estado vive en el color y el OC en el tooltip.

6. **Procesamiento secuencial uno por uno**: cuando se confirma el envío, el sistema procesa los registros del lote de manera secuencial — registro 1 espera a respuesta de NetSuite → marca PROCESADO o ERROR → continúa con registro 2 → etc. La UI refleja el avance en tiempo real vía polling.

7. **Botón "Crear OC"** (no "Generar OC"): el botón aparece al lado del botón Filtrar y muestra el contador de filas seleccionadas. Disabled cuando: (a) hay 0 ó múltiples períodos de facturación seleccionados, (b) cantidad de seleccionados = 0, o (c) hay un lote en curso.

### Cambios concretos al plan original

| Sección del plan | Estado |
|---|---|
| §1.1 `CeldaCargo` — checkbox dentro de la celda | ❌ **OBSOLETO**. Reemplazado por §1.6 `FilaOperador` (ver más abajo). Las celdas pasan a ser `CeldaMonto` (presentacional pura, sin checkbox, solo badge + tooltip). |
| §1.2 `BotonGenerarOC` | ✅ Sigue válido pero **renombrar** a `BotonCrearOC` con `label = "Crear OC"`. Habilitación: requiere `periodoSel.length === 1` además de los criterios originales. |
| §6 Diseño de tabla — 5 estados de celda con checkbox | ❌ **OBSOLETO**. La celda solo muestra monto + color de fondo + tooltip. El checkbox se mueve a la columna del operador. Ver §6-bis abajo. |
| Selección masiva — checkbox en header de columna | ❌ **OBSOLETO** (la columna ya no tiene selección). |
| **Nuevo** | "Seleccionar todos" aparece como checkbox maestro en el header de la columna **Operador**, no en cada celda numérica. |
| Validación pre-envío | **NUEVO**: cliente debe filtrar de la selección cualquier fila cuyo estado actual sea PROCESADO antes de habilitar el envío. El backend tiene la validación dura, pero el front evita pedir un POST que sabe que va a fallar. |

### §1.6 NUEVO COMPONENTE — `FilaOperador.tsx`

**Path:** `components/cargos-str/FilaOperador.tsx`

Renderiza una fila completa de la tabla (nombre del operador + N celdas de monto + total opcional). Contiene el checkbox de selección a la izquierda del nombre.

```tsx
interface FilaOperadorProps {
  // Identidad
  orId: string
  orCodigo: string
  orNombre: string

  // Datos por período visible
  periodos: { id: string; facturacion: string; consumo: string }[]
  totalesPorPeriodo: Record<string, number>  // monto por periodoId
  totalFila: number                          // suma de todos los períodos visibles

  // Estado de envío por (periodoId, orId) — para colorear cada celda
  estadosPorPeriodo: Record<string, EstadoEnvio | null>

  // Selección (solo aplica cuando hay 1 solo período filtrado)
  seleccionable: boolean      // false si multi-período O si la única fila/celda ya está PROCESADA
  seleccionado: boolean
  onToggleSeleccion: (orId: string) => void

  // Visualización
  mostrarColumnaTotal: boolean   // true cuando hay >1 período
  onClickCeldaConEnvio: (envioId: string) => void  // abre DetalleEnvioModal
}
```

**Estado interno:** ninguno.

**Regla de habilitación del checkbox:**
- `seleccionable === false` → checkbox disabled (multi-período o ya procesado)
- `seleccionable === true` → checkbox enabled
- Si la fila tiene estado `PROCESADO` en el período filtrado, `seleccionable` debe ser false desde el padre

**Click en una celda con `estadoEnvio !== null`** → emite `onClickCeldaConEnvio(envioId)` para que el padre abra `DetalleEnvioModal`. Esto reemplaza el comportamiento que antes tenía `CeldaCargo`.

### §1.7 NUEVO COMPONENTE — `CeldaMonto.tsx` (reemplaza `CeldaCargo`)

**Path:** `components/cargos-str/CeldaMonto.tsx`

Presentacional puro. Solo se ocupa del aspecto monetario + color de estado + tooltip.

```tsx
interface CeldaMontoProps {
  monto: number
  estadoEnvio: EstadoEnvio | null   // null = sin envío previo
  onClick?: () => void              // disparado solo si estadoEnvio !== null
}
```

**Reglas visuales:**
- `estadoEnvio === null` → fondo blanco/transparente, cursor default
- `estadoEnvio.estado === "PENDIENTE"` o `"PROCESANDO"` → fondo amarillo (`#fff7ed`), texto `#b45309`, cursor pointer, tooltip = "En proceso..."
- `estadoEnvio.estado === "PROCESADO"` → fondo verde (`#f0fdf4`), texto `#15803d`, cursor pointer, tooltip = `OC: ${numeroOc}`
- `estadoEnvio.estado === "ERROR"` → fondo rojo (`#fef2f2`), texto `#b91c1c`, cursor pointer, tooltip = primeros 80 chars del error

**Tooltip:** atributo `title=""` nativo en el `<td>` — sin componente custom. Razón: cumple el requisito ("paso el mouse sobre el monto y veo el número de OC") con cero código extra y compatibilidad universal.

### §6-bis Diseño visual de la tabla (corregido)

```
┌──────────────────────────────────────────────────────────────────┐
│  [Filtros: Facturación] [Consumo] [Operador]   [Filtrar]         │
│                                              [Crear OC (3)] ◀──── Solo activo si periodoSel.length === 1
├──────────────────────────────────────────────────────────────────┤
│ ☑ Operador       │ Mes facturación │ Mar 2026 │ Total            │   ← row 1 header
│                  │ Mes Consumo     │ Feb 2026 │                  │   ← row 2 header
├─────────────────────────────────────────────────────────────────┤
│ ☐ AFINIA         │                 │ $1.2M    │ —                │
│ ☑ AIRE           │                 │ $0.9M    │ —                │
│ ☐ BAJO PUTUMAYO  │                 │  $1.1M   │ —                │   ← celda verde con OC en tooltip
│ ☐ CEDENAR        │                 │ $1.5M    │ —                │   ← celda roja con error en tooltip
│ ...              │                 │          │                  │
│ TOTAL            │                 │$1,325,910│ —                │
└─────────────────────────────────────────────────────────────────┘

Cuando periodoSel.length > 1 (modo histórico, sin selección):
┌──────────────────────────────────────────────────────────────────┐
│  [Filtros con 2+ periodos] [Filtrar]   [Crear OC]  ← disabled    │
├──────────────────────────────────────────────────────────────────┤
│ Operador         │ Mar 2026 │ Abr 2026 │ Total                   │
│                  │ Feb 2026 │ Mar 2026 │                         │
├──────────────────┼──────────┼──────────┼─────────────────────────┤
│ AFINIA           │ $1.2M ✓  │ $1.3M ●  │ $2.5M                   │
│ AIRE             │ $0.9M ✓  │ $0.8M ✗  │ $1.7M                   │
│ ...              │          │          │                          │
└──────────────────────────────────────────────────────────────────┘
   ↑ Sin columna de checkboxes — vista solo-lectura
   ↑ Color de fondo en cada celda según estado
   ↑ Tooltip on hover muestra OC o error
```

### Validaciones del cliente antes de enviar

Antes de hacer POST a `/api/cargos-str/netsuite/lote`, el front filtra/valida:
1. **`periodoSel.length === 1`** — si no, botón "Crear OC" está disabled (no debería llegar acá)
2. **Para cada `orId` seleccionado**: revisar `estadosPorPeriodo[periodoId][orId]`. Si el estado es `PROCESADO`, removerlo silenciosamente de la selección y mostrar warning toast "X cargos ya tenían OC y fueron omitidos"
3. **Selección final no vacía** — si todos los seleccionados estaban procesados, cancelar el envío con mensaje "No hay cargos elegibles. Verifica que no estén ya procesados."

### Implicancia para el backend (notificar al Arquitecto)

El plan del Arquitecto en §B.2 endpoint `POST /api/cargos-str/netsuite/lote` ya tiene un error `400 SIN_DATOS`. Hay que **agregar** un nuevo error:

- `422 CARGO_YA_PROCESADO` — al menos uno de los `(periodoId, orId)` ya tiene un envío en estado `PROCESADO` para ese mismo período. Body: `{ error, conflictos: [{periodoId, orId, numeroOc, loteId}] }`.

Esto debe validarse dentro de la transacción del `crearLote`, después del advisory lock, para evitar TOCTOU.

---

## Resumen ejecutivo

La UI requiere cinco componentes nuevos y modificaciones quirurgicas a la pagina existente. El cambio mas significativo es convertir cada celda de la tabla pivot de un `<td>` simple a un componente interactivo con tres capas: estado de envio (badge), capacidad de seleccion (checkbox) y acceso al detalle (click). Todo el estado del lote se maneja localmente en `page.tsx` con `useState` — no se justifica un Context para este modulo de alcance acotado. El polling usa `setInterval` raw con cleanup en `useEffect` — no se introduce TanStack Query porque el repo no lo tiene y el beneficio no justifica la dependencia para un solo endpoint que se polea.

> ⚠️ **Nota**: el resumen ejecutivo arriba refleja la versión original con selección por celda. Las reglas válidas para arrancar el desarrollo son las del **ADDENDUM 2026-05-20** al inicio del documento. En particular: la "tabla pivot con celda interactiva" se convierte en "tabla con fila interactiva + celdas presentacionales".

---

## 1. Inventario de componentes a crear

Todos van en la carpeta `components/cargos-str/`. Esta carpeta no existe hoy — crearla es parte de PR FE-1.

### 1.1 `CeldaCargo.tsx`

**Path:** `components/cargos-str/CeldaCargo.tsx`

Es el corazon visual. Reemplaza el `<td>` crudo de `ResultsTable` por un componente que muestra monto + badge de estado + checkbox de seleccion.

```tsx
// Props interface
interface EstadoEnvio {
  ultimoEnvioId: string
  estado: "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR"
  numeroOc: string | null
  errorMensaje: string | null
  loteId: string
  fecha: string
}

interface CeldaCargoProps {
  // Identidad del cargo
  periodoId: string
  orId: string

  // Dato economico
  monto: number  // ya calculado por el padre desde data.operadores[x].totales[periodoId]

  // Estado de envio (null = nunca enviado)
  estadoEnvio: EstadoEnvio | null

  // Seleccion
  seleccionado: boolean
  onToggleSeleccion: (periodoId: string, orId: string) => void

  // Navegacion al detalle
  onVerDetalle: (envioId: string) => void
}
```

**Estado interno:** ninguno. Es un componente presentacional puro. Toda la logica de seleccion y navegacion sube al padre.

**Eventos que emite:**
- `onToggleSeleccion(periodoId, orId)` — cuando el usuario hace click en el checkbox
- `onVerDetalle(envioId)` — cuando hace click en una celda con badge activo

**Dependencias:** ninguna (no usa otros componentes — styles inline completos).

**Regla de habilitacion del checkbox:**
- Sin envio previo: habilitado
- Estado `PROCESADO`: deshabilitado (no se puede re-seleccionar, el cargo ya tiene OC)
- Estado `PROCESANDO` o `PENDIENTE`: deshabilitado (ya esta en un lote activo)
- Estado `ERROR`: habilitado con advertencia visual (borde amarillo en la celda)

---

### 1.2 `BotonGenerarOC.tsx`

**Path:** `components/cargos-str/BotonGenerarOC.tsx`

Boton en la barra de filtros que muestra el contador de cargos seleccionados y abre el modal de confirmacion.

```tsx
interface BotonGenerarOCProps {
  cantidadSeleccionados: number   // size del Set de seleccion
  disabled: boolean               // true si hay lote en curso o si cantidadSeleccionados === 0
  onAbrir: () => void             // abre ModalConfirmarLote
}
```

**Estado interno:** ninguno.

**Eventos que emite:** `onAbrir()`.

**Dependencias:** ninguna.

**Nota de diseño:** el contador se anima cuando cambia (transition CSS en `transform: scale()`). No usar librerías de animacion — solo CSS transition.

---

### 1.3 `ModalConfirmarLote.tsx`

**Path:** `components/cargos-str/ModalConfirmarLote.tsx`

Modal centrado que muestra la lista de cargos seleccionados antes de confirmar el envio.

```tsx
interface CargoParaEnviar {
  periodoId: string
  orId: string
  orNombre: string
  mesConsumo: string        // "AAAA-MM"
  mesFact: string           // "AAAA-MM"
  monto: number             // calculado en page.tsx desde data
  tieneErrorPrevio: boolean // advierte si el cargo tiene un envio fallido anterior
}

interface ModalConfirmarLoteProps {
  abierto: boolean
  cargos: CargoParaEnviar[]
  onCerrar: () => void
  onConfirmar: () => Promise<void>  // llama al API, retorna promesa
}
```

**Estado interno:**
```tsx
const [estadoBoton, setEstadoBoton] = useState<"idle" | "loading" | "error">("idle")
const [mensajeError, setMensajeError] = useState<string | null>(null)
```

**Eventos que emite:** `onCerrar()` y `onConfirmar()` (con estados internos de loading/error).

**Dependencias:** ninguna.

**Regla de la lista larga:** si `cargos.length > 8`, el `<div>` de la lista tiene `maxHeight: 320px, overflowY: "auto"`. No se virtualiza — 500 cargos es el limite maximo del backend y a 32px por fila = 16KB de DOM, aceptable. La virtualizacion agrega complejidad innecesaria para este caso.

---

### 1.4 `PanelLoteEnCurso.tsx`

**Path:** `components/cargos-str/PanelLoteEnCurso.tsx`

Banner sticky que aparece mientras hay un lote `EN_PROGRESO`. Muestra progreso en tiempo real.

```tsx
interface TotalesLote {
  total: number
  pendientes: number
  procesados: number
  errores: number
}

interface PanelLoteEnCursoProps {
  loteId: string
  estado: "EN_PROGRESO" | "COMPLETADO" | "CANCELADO"
  iniciadoPor: string     // nombre del usuario
  iniciadoAt: string      // ISO timestamp
  totales: TotalesLote
  puedeCancel: boolean    // true si el usuario actual es quien inicio el lote o es ADMINISTRADOR
  onVerDetalleLote: () => void   // abre vista de detalle del lote completo
  onCancelar: () => Promise<void>
  onCerrar: () => void           // oculta el panel (el lote sigue corriendo)
}
```

**Estado interno:**
```tsx
const [confirmandoCancelar, setConfirmandoCancelar] = useState(false)
const [cancelando, setCancelando] = useState(false)
```

**Eventos que emite:** `onVerDetalleLote()`, `onCancelar()`, `onCerrar()`.

**Dependencias:** ninguna.

**Nota sobre "cerrar":** cerrar el panel solo lo oculta visualmente — el lote sigue en curso. Si el usuario navega a otra pagina y vuelve, el panel reaparece porque `page.tsx` recarga el estado del lote al montar. Ver seccion 7 para la decision de persistencia entre navegaciones.

---

### 1.5 `DetalleEnvioModal.tsx`

**Path:** `components/cargos-str/DetalleEnvioModal.tsx`

Modal que muestra el detalle completo de un envio individual. Drawer lateral en desktop, modal centrado en mobile.

```tsx
interface DetalleEnvio {
  id: string
  orNombre: string
  mesConsumo: string
  mesFact: string
  montoSnapshotCop: string    // string para precision, formatear en UI
  estado: "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR"
  intentos: number
  numeroOc: string | null
  netsuiteInternalId: string | null
  errorMensaje: string | null
  errorCodigo: string | null
  enviadoAt: string | null
  respondidoAt: string | null
  respuestaOkJson: Record<string, unknown> | null
  errorPayloadJson: Record<string, unknown> | null
}

interface DetalleEnvioModalProps {
  abierto: boolean
  envio: DetalleEnvio | null
  onCerrar: () => void
  onReenviar: (envioId: string) => Promise<void>  // solo disponible si estado === "ERROR"
}
```

**Estado interno:**
```tsx
const [reenviando, setRenviando] = useState(false)
const [errorReenvio, setErrorReenvio] = useState<string | null>(null)
const [confirmandoReenvio, setConfirmandoReenvio] = useState(false)
const [jsonOkExpandido, setJsonOkExpandido] = useState(false)
const [jsonErrorExpandido, setJsonErrorExpandido] = useState(false)
```

**Eventos que emite:** `onCerrar()`, `onReenviar(envioId)`.

**Dependencias:** ninguna.

---

## 2. Modificaciones a `page.tsx`

### 2.1 Tipos nuevos

Agregar al inicio del archivo, antes del componente:

```tsx
// -- Tipos NetSuite --

type EstadoEnvioKey = `${string}|${string}`  // `${periodoId}|${orId}`

interface EstadoEnvioUI {
  ultimoEnvioId: string
  estado: "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR"
  numeroOc: string | null
  errorMensaje: string | null
  loteId: string
  fecha: string
}

interface LoteEnCursoUI {
  id: string
  estado: "EN_PROGRESO" | "COMPLETADO" | "CANCELADO"
  iniciadoPor: string
  iniciadoAt: string
  totales: { total: number; pendientes: number; procesados: number; errores: number }
}

type CargoSeleccionado = { periodoId: string; orId: string }
```

### 2.2 State nuevo en `CargosSTRPage`

```tsx
// -- Estado NetSuite --
const [estadosEnvio, setEstadosEnvio] = useState<Record<EstadoEnvioKey, EstadoEnvioUI>>({})
const [seleccion, setSeleccion] = useState<Set<EstadoEnvioKey>>(new Set())
const [loteEnCurso, setLoteEnCurso] = useState<LoteEnCursoUI | null>(null)
const [panelLoteVisible, setPanelLoteVisible] = useState(true)
const [modalConfirmarAbierto, setModalConfirmarAbierto] = useState(false)
const [detalleEnvioId, setDetalleEnvioId] = useState<string | null>(null)
const [detalleEnvio, setDetalleEnvio] = useState<DetalleEnvio | null>(null)
const [cargandoDetalle, setCargandoDetalle] = useState(false)
```

### 2.3 `useEffect` nuevos

**A) Carga inicial de estados de envio cuando hay datos filtrados:**

```tsx
useEffect(() => {
  if (!data || data.periodos.length === 0 || data.operadores.length === 0) return

  const periodoIds = data.periodos.map(p => p.id).join(",")
  const orIds = [...new Set(data.operadores.map(o => o.codigo))].join(",")
  // Nota: usar o.id en vez de o.codigo si el endpoint acepta IDs — confirmar con backend

  fetch(`/api/cargos-str/netsuite/estados?periodoIds=${periodoIds}&orIds=${orIds}`)
    .then(r => r.ok ? r.json() : {})
    .then(estados => setEstadosEnvio(estados))
    .catch(() => {}) // silencioso — los badges simplemente no se muestran
}, [data])
```

**B) Polling del lote en curso:**

```tsx
useEffect(() => {
  if (!loteEnCurso || loteEnCurso.estado !== "EN_PROGRESO") return

  const intervalo = setInterval(async () => {
    try {
      const res = await fetch(`/api/cargos-str/netsuite/lote/${loteEnCurso.id}`)
      if (!res.ok) return
      const loteActualizado = await res.json()

      setLoteEnCurso({
        id: loteActualizado.id,
        estado: loteActualizado.estado,
        iniciadoPor: loteActualizado.iniciadoPor.nombre,
        iniciadoAt: loteActualizado.iniciadoAt,
        totales: loteActualizado.totales,
      })

      // Actualizar badges con los envios del lote
      setEstadosEnvio(prev => {
        const next = { ...prev }
        for (const envio of loteActualizado.envios) {
          const key: EstadoEnvioKey = `${envio.periodoId}|${envio.orId}`
          next[key] = {
            ultimoEnvioId: envio.id,
            estado: envio.estado,
            numeroOc: envio.numeroOc,
            errorMensaje: envio.errorMensaje,
            loteId: loteActualizado.id,
            fecha: envio.enviadoAt ?? loteActualizado.iniciadoAt,
          }
        }
        return next
      })

      // Cuando completa: limpiar seleccion, mostrar resumen
      if (loteActualizado.estado !== "EN_PROGRESO") {
        clearInterval(intervalo)
        setSeleccion(new Set())
        // Toast de completado — ver seccion 5
      }
    } catch {
      // Error de red: no matar el polling, el proximo tick lo reintenta
    }
  }, 2500)

  return () => clearInterval(intervalo)  // cleanup al desmontar o cuando loteEnCurso cambia
}, [loteEnCurso?.id, loteEnCurso?.estado])
```

**Importante sobre la dependencia del effect:** la dependencia es `[loteEnCurso?.id, loteEnCurso?.estado]` — no `[loteEnCurso]`. Si usaramos el objeto completo, cada actualizacion de `totales` (que ocurre dentro del propio polling) re-iniciaria el intervalo, creando un loop. Con solo `id` y `estado`, el efecto solo se re-registra cuando cambia el lote o cuando transiciona a COMPLETADO/CANCELADO.

**C) Deteccion de lote en curso al montar la pagina:**

```tsx
useEffect(() => {
  // Al montar, verificar si hay un lote activo (por si el usuario navego y volvio)
  fetch("/api/cargos-str/netsuite/lote/activo")  // endpoint sugerido al backend: GET ultimo lote EN_PROGRESO
    .then(r => r.ok ? r.json() : null)
    .then(lote => {
      if (lote) {
        setLoteEnCurso({
          id: lote.id,
          estado: lote.estado,
          iniciadoPor: lote.iniciadoPor.nombre,
          iniciadoAt: lote.iniciadoAt,
          totales: lote.totales,
        })
        setPanelLoteVisible(true)
      }
    })
    .catch(() => {})
}, [])
```

**Nota para el backend:** este effect requiere un endpoint adicional `GET /api/cargos-str/netsuite/lote/activo` que no esta en el plan del Arquitecto. Es trivial: retorna el ultimo lote `EN_PROGRESO` del tenant (sin filtro de usuario — cualquier lote activo bloquea). Si no se implementa, el panel de lote en curso solo aparece para la sesion que lo inicio (aceptable para Fase 1 con mock).

### 2.4 Helpers nuevos

```tsx
// Clave unica para el mapa de estados y el Set de seleccion
function cargoKey(periodoId: string, orId: string): EstadoEnvioKey {
  return `${periodoId}|${orId}`
}

// Toggle de seleccion con validaciones
function toggleSeleccion(periodoId: string, orId: string) {
  const key = cargoKey(periodoId, orId)
  const estado = estadosEnvio[key]

  // No permitir seleccionar cargos en estado terminal o activo
  if (estado?.estado === "PROCESADO" || estado?.estado === "PROCESANDO" || estado?.estado === "PENDIENTE") {
    return
  }

  setSeleccion(prev => {
    const next = new Set(prev)
    if (next.has(key)) {
      next.delete(key)
    } else {
      if (next.size >= MAX_ENVIOS_POR_LOTE) {
        // Mostrar aviso — ver seccion 12
        return prev
      }
      next.add(key)
    }
    return next
  })
}

const MAX_ENVIOS_POR_LOTE = 100  // alinear con el backend

// Construir lista de cargos para el modal de confirmacion
function getCargosSeleccionados(): CargoParaEnviar[] {
  if (!data) return []
  return Array.from(seleccion).map(key => {
    const [periodoId, orId] = key.split("|") as [string, string]
    const periodo = data.periodos.find(p => p.id === periodoId)
    const operador = data.operadores.find(o => o.codigo === orId)
    const monto = operador?.totales[periodoId] ?? 0
    const estadoEnvio = estadosEnvio[key]
    return {
      periodoId,
      orId,
      orNombre: operador?.nombre ?? orId,
      mesConsumo: periodo?.consumo ?? "",
      mesFact: periodo?.facturacion ?? "",
      monto,
      tieneErrorPrevio: estadoEnvio?.estado === "ERROR",
    }
  })
}

// Crear lote + disparar procesamiento
async function handleConfirmarLote() {
  const cargos = getCargosSeleccionados().map(c => ({
    periodoId: c.periodoId,
    orId: c.orId,
  }))

  const resLote = await fetch("/api/cargos-str/netsuite/lote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cargos }),
  })

  if (!resLote.ok) {
    const err = await resLote.json()
    // Manejo segun el codigo de error — ver seccion 5
    throw new Error(err.error ?? "Error al crear el lote")
  }

  const lote = await resLote.json()

  // Disparar procesamiento (fire-and-forget desde el front)
  await fetch(`/api/cargos-str/netsuite/lote/${lote.loteId}/procesar`, {
    method: "POST",
  })
  // No esperamos la respuesta del procesamiento — arranca el polling

  setLoteEnCurso({
    id: lote.loteId,
    estado: "EN_PROGRESO",
    iniciadoPor: "Yo",  // sera reemplazado por el primer polling
    iniciadoAt: new Date().toISOString(),
    totales: { total: lote.totalEnvios, pendientes: lote.totalEnvios, procesados: 0, errores: 0 },
  })
  setPanelLoteVisible(true)
  setModalConfirmarAbierto(false)
  setSeleccion(new Set())
}

// Abrir detalle de un envio
async function handleVerDetalle(envioId: string) {
  setDetalleEnvioId(envioId)
  setCargandoDetalle(true)

  const res = await fetch(`/api/cargos-str/netsuite/lote/${loteEnCurso?.id ?? "?"}`)
  // Alternativa mas directa: el backend podria exponer GET /api/cargos-str/netsuite/envio/:id
  // Por ahora se extrae del lote completo
  const lote = await res.json()
  const envio = lote.envios.find((e: { id: string }) => e.id === envioId) ?? null
  setDetalleEnvio(envio)
  setCargandoDetalle(false)
}
```

### 2.5 Modificacion del bloque de filtros (donde va `BotonGenerarOC`)

En el JSX del bloque de filtros, despues del boton Filtrar:

```tsx
{/* BotonGenerarOC — aparece siempre que haya datos filtrados */}
{filtrado && !loading && data && data.operadores.length > 0 && (
  <BotonGenerarOC
    cantidadSeleccionados={seleccion.size}
    disabled={seleccion.size === 0 || loteEnCurso?.estado === "EN_PROGRESO"}
    onAbrir={() => setModalConfirmarAbierto(true)}
  />
)}
```

### 2.6 Integracion de `PanelLoteEnCurso` (sticky, arriba de la tabla)

```tsx
{/* Panel lote en curso — sticky debajo de los filtros */}
{loteEnCurso && panelLoteVisible && (
  <PanelLoteEnCurso
    loteId={loteEnCurso.id}
    estado={loteEnCurso.estado}
    iniciadoPor={loteEnCurso.iniciadoPor}
    iniciadoAt={loteEnCurso.iniciadoAt}
    totales={loteEnCurso.totales}
    puedeCancel={true}  // TODO: comparar con session.user.id o rol
    onVerDetalleLote={() => { /* navegar a /cargos-str/lotes/${loteEnCurso.id} en Fase 3 */ }}
    onCancelar={handleCancelarLote}
    onCerrar={() => setPanelLoteVisible(false)}
  />
)}
```

### 2.7 Modificacion de `ResultsTable`

`ResultsTable` necesita recibir los props de NetSuite:

```tsx
interface ResultsTableProps {
  data: Resultado
  estadosEnvio: Record<EstadoEnvioKey, EstadoEnvioUI>
  seleccion: Set<EstadoEnvioKey>
  onToggleSeleccion: (periodoId: string, orId: string) => void
  onVerDetalle: (envioId: string) => void
}
```

En el cuerpo de la tabla, reemplazar el `<td>` de datos por `<CeldaCargo />`:

```tsx
// Antes:
<td key={p.id} style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>
  {cop(o.totales[p.id] ?? 0)}
</td>

// Despues:
<CeldaCargo
  key={p.id}
  periodoId={p.id}
  orId={o.codigo}  // confirmar: ¿el backend usa codigo o id en /estados?
  monto={o.totales[p.id] ?? 0}
  estadoEnvio={estadosEnvio[cargoKey(p.id, o.codigo)] ?? null}
  seleccionado={seleccion.has(cargoKey(p.id, o.codigo))}
  onToggleSeleccion={onToggleSeleccion}
  onVerDetalle={onVerDetalle}
/>
```

**Importante:** la primera columna (nombre del operador) deberia tener tambien un "checkbox de fila" para seleccionar todos los periodos de ese OR — ver seccion 6 para la decision.

---

## 3. Estado global y data flow

### Decision: `useState` local vs Context

**Recomendacion: `useState` local en `page.tsx`, sin Context.**

Justificacion:
- Solo hay una pagina consumiendo este estado (`cargos-str/page.tsx`).
- Los cinco componentes nuevos son hijos directos de la pagina — prop drilling de 1 nivel.
- Un Context para "el lote en curso" seria justificable si el `PanelLoteEnCurso` necesitara vivir en el layout del dashboard (para persistir entre navegaciones). En Fase 1, el panel vive dentro de la pagina. Si en Fase 3 se mueve al layout, ese es el momento de crear un `LoteNetsuiteContext`.

### Sincronizacion seleccion vs polling

El polling actualiza `estadosEnvio` (el mapa de estados por celda). La seleccion es un `Set<EstadoEnvioKey>`. Estos son estados independientes — no hay conflicto directo.

**Caso borde:** el usuario marca un cargo para seleccionar mientras el polling actualiza ese mismo cargo a `PROCESANDO` (porque alguien mas inicio un lote). El resultado seria tener ese cargo en `seleccion` pero con estado `PROCESANDO` en `estadosEnvio`. Resolucion:

1. `CeldaCargo` deshabilita el checkbox cuando `estadoEnvio.estado` es `PROCESANDO` o `PENDIENTE` — el usuario no puede agregar nuevos cargos en ese estado.
2. Antes de confirmar el lote, `ModalConfirmarLote` muestra advertencias para cargos con `tieneErrorPrevio === true`.
3. En `handleConfirmarLote`, el backend valida y retorna `409 LOTE_EN_CURSO` si hay conflicto — el frontend lo muestra como error en el modal.

**Caso borde de la carrera (race):** el usuario esta marcando cargos mientras llega una respuesta de polling que cambia `estadosEnvio`. React 18 batchea los setState de event handlers y los de efectos asincronos por separado, por lo que no habra renders inconsistentes. La unica ventana de inconsistencia es la que dura 2.5 segundos entre polls — aceptable para este caso de uso.

### Prevencion de memory leaks en el polling

El `useEffect` del polling retorna el cleanup `() => clearInterval(intervalo)`. Esto se ejecuta:
1. Cuando el componente se desmonta (el usuario navega a otra pagina).
2. Cuando `loteEnCurso?.id` o `loteEnCurso?.estado` cambia (al completarse el lote).

Con esto, el intervalo nunca queda corriendo suelto.

---

## 4. Polling strategy

### Frecuencia

**2500ms (2.5 segundos).** Justificacion:
- El mock-client tiene delay de 200-800ms por envio, y el backend los procesa secuencialmente. Para 23 envios, el lote completo dura ~10-18 segundos. Polling cada 2.5s da ~4-7 updates visibles — suficiente para que la barra de progreso se mueva notoriamente.
- Con la API real, NetSuite probablemente tarde 1-3 segundos por envio. Mismo razonamiento.
- 2.5s no satura el backend con requests innecesarios.

### Cuando arrancarlo

El polling arranca cuando `loteEnCurso` pasa de `null` a un objeto con `estado: "EN_PROGRESO"`. Esto ocurre en `handleConfirmarLote` despues del POST exitoso a `/procesar`.

### Cuando pararlo

El `useEffect` del polling tiene `loteEnCurso?.estado` en sus dependencias. Cuando el polling recibe `estado !== "EN_PROGRESO"` (es decir, `COMPLETADO` o `CANCELADO`), setea `loteEnCurso` con el nuevo estado, lo que hace que React desmonte el efecto (cleanup) y no lo vuelva a montar porque la condicion de guarda `if (!loteEnCurso || loteEnCurso.estado !== "EN_PROGRESO") return` falla.

### Thundering herd con multiples pestanas

El Advisory Lock en el backend (seccion B.6 del plan del Arquitecto) garantiza que solo puede haber un lote `EN_PROGRESO` a la vez. Si el usuario tiene dos pestanas, ambas estaran polineando el mismo lote. Las dos haran `GET /lote/:id` cada 2.5s, pero los requests son idempotentes y de lectura — no hay problema de doble escritura. A lo sumo habra 2x el numero de requests GET, lo que es completamente aceptable.

Para mitigar, se puede verificar si la pestana esta en foco con `document.visibilityState`:

```tsx
// Dentro del setInterval:
if (document.visibilityState === "hidden") return  // pausar polling si pestaña no tiene foco
```

**Recomendacion: implementar este guard desde el primer dia.** Es una linea y ahorra requests en background.

### Por que `setInterval` raw y no TanStack Query/SWR

El repo no tiene TanStack Query ni SWR. Introducir cualquiera de los dos solo para este caso seria ~30KB+ de dependencia para funcionalidad que `setInterval` + `useEffect` resuelven en 20 lineas.

Si en el futuro el repo adopta TanStack Query para otros modulos, migrar el polling de aqui a `useQuery` con `refetchInterval` es trivial. Por ahora: dependencia cero.

---

## 5. Manejo de errores en la UI

### 5.1 `409 LOTE_EN_CURSO`

El backend retorna:
```json
{
  "error": "LOTE_EN_CURSO",
  "loteEnCursoId": "...",
  "iniciadoAt": "2026-05-20T12:34:00Z",
  "iniciadoPor": "Erika Ramirez"
}
```

**Comportamiento UI:** el error se muestra dentro de `ModalConfirmarLote` (no cierra el modal):

```
┌────────────────────────────────────────┐
│ No se puede crear el lote              │
│                                        │
│ Hay un lote en curso iniciado por      │
│ Erika Ramirez el 20 may 2026 a las     │
│ 12:34. Espera a que termine antes de   │
│ iniciar uno nuevo.                     │
│                                        │
│ [Ver lote activo]         [Cerrar]     │
└────────────────────────────────────────┘
```

El boton "Ver lote activo" setea `loteEnCurso` con el ID recibido e inicia el polling de ese lote. Luego cierra el modal.

### 5.2 `400 SIN_DATOS`

El backend retorna que algun `(periodoId, orId)` no tiene `registros_str`. Esto no deberia ocurrir si la UI solo muestra celdas con monto > 0, pero puede pasar por condicion de carrera (datos borrados entre el filtro y el envio).

**Comportamiento UI:** error en el modal, con lista de cargos sin datos:

```
Error al crear el lote:
Los siguientes cargos no tienen datos registrados:
• AFINIA — Enero 2026
• AIRE — Febrero 2026
Deseleccionalos y vuelve a intentar.
```

### 5.3 `422 MONTO_CERO`

El Arquitecto define que esto no deberia ser posible si la UI filtra correctamente (una celda con monto 0 no deberia ser seleccionable). Como segunda linea de defensa:

**Validacion cliente-side:** en `toggleSeleccion`, agregar:
```tsx
if (monto === 0) return  // no permitir seleccionar cargos con monto cero
```

Adicionalmente, `CeldaCargo` muestra celdas con monto 0 con opacity 0.4 y cursor `not-allowed`.

Si aun asi llega un 422 del backend (race condition), se muestra en el modal:
```
Error: Uno o mas cargos seleccionados tienen monto $0. 
Esto puede ocurrir si los datos fueron actualizados recientemente.
Pulsa Filtrar para refrescar y vuelve a intentarlo.
```

### 5.4 `500` y errores de red

**Toast de error** que aparece en la esquina inferior derecha por 5 segundos, con boton "Reintentar":

```tsx
// Toast minimalista sin libreria externa
// Implementar como estado en page.tsx:
const [toast, setToast] = useState<{ mensaje: string; tipo: "error" | "exito"; onReintentar?: () => void } | null>(null)

useEffect(() => {
  if (!toast) return
  const timer = setTimeout(() => setToast(null), 5000)
  return () => clearTimeout(timer)
}, [toast])
```

El toast se renderiza en un `<div>` con `position: fixed; bottom: 24px; right: 24px; zIndex: 100`.

### 5.5 Validaciones cliente antes de llamar al backend

Antes de abrir `ModalConfirmarLote`:
1. `seleccion.size === 0` → el boton esta deshabilitado, no se llega aqui.
2. `seleccion.size > MAX_ENVIOS_POR_LOTE` → aviso en el modal: "Maxima cantidad de cargos por lote: 100. Deselecciona algunos."
3. Algun cargo tiene `monto === 0` → se filtra en `toggleSeleccion` pero re-validar en `getCargosSeleccionados`.

Antes de confirmar (dentro del modal, al click en "Confirmar envio"):
1. Si hay cargos con `tieneErrorPrevio === true`, mostrar aviso amarillo: "X cargos tienen un envio fallido previo. Al confirmar, se creara un nuevo intento."

---

## 6. Diseño de la tabla con badges y checkboxes

### Layout de una celda — los 5 estados

Cada `<td>` del cuerpo de la tabla se convierte en un contenedor flex con dos zonas:

```
┌─────────────────────────────────┐
│  [badge]          $1.234.567   │
│  [checkbox]                    │  ← zona izquierda: controles
│                  (monto alineado derecha)
└─────────────────────────────────┘
```

Pseudo-JSX del layout interno de `CeldaCargo`:

```tsx
<td
  style={{
    padding: "6px 10px 6px 8px",
    borderBottom: "1px solid #f3f4f6",
    minWidth: 130,
    position: "relative",
    // Color de borde izquierdo segun estado
    borderLeft: esError ? "3px solid #ef4444" : esProcesado ? "3px solid #07c5a8" : "none",
    cursor: tieneEnvio ? "pointer" : "default",
    background: seleccionado ? "#f0fdf4" : "transparent",
  }}
  onClick={tieneEnvio ? () => onVerDetalle(estadoEnvio!.ultimoEnvioId) : undefined}
>
  <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
    {/* Zona izquierda: checkbox + badge */}
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <input
        type="checkbox"
        checked={seleccionado}
        disabled={!puedeSeleccionar}
        onChange={e => { e.stopPropagation(); onToggleSeleccion(periodoId, orId) }}
        onClick={e => e.stopPropagation()}
        style={{ width: 14, height: 14, accentColor: "#07c5a8", cursor: puedeSeleccionar ? "pointer" : "not-allowed" }}
        aria-label={`Seleccionar cargo ${orNombre} ${mesFact}`}
      />
      {estadoEnvio && <BadgeCelda estado={estadoEnvio.estado} />}
    </div>

    {/* Zona derecha: monto */}
    <span
      style={{
        fontFamily: "monospace",
        fontSize: "0.875rem",
        color: monto === 0 ? "#9ca3af" : "#374151",
        opacity: monto === 0 ? 0.6 : 1,
      }}
      title={tooltipTexto}  // native title attribute — aceptable para tooltips simples
    >
      {cop(monto)}
    </span>
  </div>
</td>
```

### BadgeCelda — componente inline dentro de `CeldaCargo`

Un componente funcional pequeño definido en el mismo archivo:

```tsx
function BadgeCelda({ estado }: { estado: "PENDIENTE" | "PROCESANDO" | "PROCESADO" | "ERROR" }) {
  const config = {
    PENDIENTE:   { simbolo: "●", color: "#b45309", bg: "#fff7ed", title: "Pendiente de envio" },
    PROCESANDO:  { simbolo: "●", color: "#b45309", bg: "#fff7ed", title: "Enviando..." },
    PROCESADO:   { simbolo: "✓", color: "#15803d", bg: "#f0fdf4", title: "Procesado con OC" },
    ERROR:       { simbolo: "✗", color: "#b91c1c", bg: "#fef2f2", title: "Error en el envio" },
  }[estado]

  return (
    <span
      title={config.title}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 18, height: 18, borderRadius: "50%",
        background: config.bg, color: config.color,
        fontSize: "0.65rem", fontWeight: 700,
        flexShrink: 0,
      }}
      aria-label={config.title}
    >
      {config.simbolo}
    </span>
  )
}
```

### Bocetos ASCII de los 5 estados

```
1. Sin envio previo (monto normal):
   ┌──────────────────────────┐
   │  ☐           $1.234.567 │
   └──────────────────────────┘

2. Sin envio + checkbox marcado (fondo verde claro):
   ┌══════════════════════════╗
   │  ☑           $1.234.567 ║  bg: #f0fdf4
   └══════════════════════════╝

3. Con envio PENDIENTE o PROCESANDO (borde izq amarillo):
   ┃ ☐ ● (amarillo) $1.234.567
   ┃ checkbox deshabilitado

4. Con envio PROCESADO (borde izq teal, checkbox deshabilitado):
   ┃ ☐ ✓ (verde)    $1.234.567   ← click abre DetalleEnvioModal
   ┃ cursor: pointer

5. Con envio ERROR (borde izq rojo):
   ┃ ☑ ✗ (rojo)     $1.234.567   ← checkbox habilitado + click abre modal
   ┃ borde: #ef4444
```

### Tooltip

**Usar `title` attribute nativo.** Justificacion: los tooltips nativos son accesibles por defecto (screen readers los leen), no requieren JavaScript extra, y para informacion auxiliar (OC number, mensaje de error corto) son suficientes. Un tooltip custom solo vale la pena si el contenido es HTML o si necesita delay/animacion — no es el caso aqui.

Contenido del tooltip segun estado:
- Sin envio: `"Sin envio previo"`
- PENDIENTE/PROCESANDO: `"Envio en progreso..."`
- PROCESADO: `"OC: OC-2026-00123 | Enviado el 20 may 2026"`
- ERROR: `"Error: <primeros 80 chars del errorMensaje>"`

### Click handlers

- **Click en checkbox:** `onChange` / `onClick` con `stopPropagation()` para no propagar al `<td>`.
- **Click en `<td>`:** solo activo si `tieneEnvio === true`. Abre `DetalleEnvioModal`.
- **Click en celda sin envio:** no hace nada (el click en el checkbox ya maneja la seleccion).

### Seleccion masiva (checkboxes de fila y columna)

**Recomendacion: checkbox de fila solamente (en la primera columna, al lado del nombre del operador).**

- **Checkbox de fila** selecciona todos los periodos visibles de ese operador que sean seleccionables (excluyendo los PROCESADOS y PROCESANDO).
- **No implementar checkbox de columna** (encabezado de periodo) en Fase 1. Razon: la seleccion por columna es menos intuitiva en este dominio (un usuario quiere enviar todos los cargos de AFINIA, no todos los cargos de Febrero). Puede agregarse en Fase 2 si el usuario lo pide.
- **"Seleccionar todos"** como link debajo del boton "Generar OC": `[Seleccionar todos los elegibles]` que hace `setSeleccion(new Set(todosLosCargosSinEnvioOConError))`.

### Contador en `BotonGenerarOC`

```tsx
// Estructura del boton
<button ...>
  Generar OC
  {cantidadSeleccionados > 0 && (
    <span
      key={cantidadSeleccionados}  // key cambia → React re-anima el elemento
      style={{
        background: "#fff",
        color: "#07c5a8",
        borderRadius: "50%",
        width: 22, height: 22,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.75rem", fontWeight: 700,
        marginLeft: 8,
        // Animacion de "pop" al cambiar el numero
        animation: "badge-pop 0.2s ease-out",
      }}
    >
      {cantidadSeleccionados}
    </span>
  )}
</button>
```

Agregar en `globals.css` (o en un `<style>` tag en la pagina):
```css
@keyframes badge-pop {
  0%   { transform: scale(0.8); opacity: 0.5; }
  60%  { transform: scale(1.15); }
  100% { transform: scale(1); opacity: 1; }
}
```

---

## 7. PanelLoteEnCurso — diseño detallado

### Posicion sticky

```tsx
<div style={{
  position: "sticky",
  top: 0,          // sticky dentro del scroll de <main> del layout
  zIndex: 40,      // por debajo del MultiSelect (zIndex: 20 dropdown) pero sobre la tabla
  // Alternativa: si la pagina no hace scroll interno, usar position: "relative" y dejar que fluya
  marginBottom: 12,
}}>
  {/* contenido del panel */}
</div>
```

El layout del dashboard tiene `<main className="flex-1 overflow-y-auto bg-muted/20 p-6">`. El sticky funciona dentro de ese scroll container. El `top: 0` hace que el panel se pegue al tope del area de contenido, no al tope del viewport.

**z-index map del modulo:**
- `z-index: 10` — backdrop del MultiSelect
- `z-index: 20` — dropdown del MultiSelect
- `z-index: 40` — PanelLoteEnCurso sticky
- `z-index: 50` — modales (ModalConfirmarLote, DetalleEnvioModal)
- `z-index: 100` — toast

### Layout del panel

```
┌───────────────────────────────────────────────────────────────────┐
│ background: #fffbeb | border: 1px solid #fde68a | borderRadius: 8 │
│ padding: 12px 16px                                                 │
│                                                                    │
│  ● Lote en curso — iniciado por Erika R. el 20 may a las 12:34   │
│                                                                    │
│  ████████████░░░░░░░░░  8 / 23                     [Ver detalle]  │
│                                         [Cancelar lote]  [×]      │
│  ✓ 6 procesados   ✗ 2 errores   ⋯ 15 pendientes                  │
└───────────────────────────────────────────────────────────────────┘
```

**Barra de progreso:**
```tsx
const porcentaje = totales.total > 0
  ? Math.round(((totales.procesados + totales.errores) / totales.total) * 100)
  : 0

<div style={{
  height: 8, borderRadius: 4,
  background: "#fde68a",
  overflow: "hidden",
  flex: 1,
}}>
  <div style={{
    height: "100%",
    width: `${porcentaje}%`,
    background: "#b45309",
    transition: "width 0.4s ease",  // animacion suave al avanzar
    borderRadius: 4,
  }}/>
</div>
<span style={{ fontSize: "0.8rem", color: "#92400e", marginLeft: 8, whiteSpace: "nowrap" }}>
  {totales.procesados + totales.errores} / {totales.total}
</span>
```

### Animacion de entrada/salida

```css
/* En globals.css o <style> */
@keyframes panel-slide-in {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

Aplicar `animation: "panel-slide-in 0.25s ease-out"` cuando `panelLoteVisible` pasa de false a true.

Para la salida, como React desmonta el elemento inmediatamente al setear `panelLoteVisible(false)`, la animacion de salida requiere un pequeño delay. Solucion simple: un `useState` de "saliendo" que aplica una clase de salida durante 200ms antes de desmontarse. No vale la pena para Fase 1 — implementar la salida sin animacion y agregar en Fase 6 (pulido).

### Que pasa cuando el usuario cierra el panel

Al presionar `[×]`, `setPanelLoteVisible(false)`. El lote sigue corriendo — el polling continua. Si el usuario navega a otra pagina y vuelve, el `useEffect` de montaje detecta el lote activo y setea `panelLoteVisible(true)` de nuevo.

**Decision sobre persistencia entre navegaciones:** el panel NO vive en el layout del dashboard en Fase 1. Vive dentro de `cargos-str/page.tsx`. Esto significa que si el usuario va a "/cargas" mientras el lote corre, no vera el panel. Para Fase 3, si se quiere notificacion global, se crea un `LoteNetsuiteContext` en el layout y se mueve el panel al `DashboardLayout`.

El costo de esta decision es bajo: los lotes duran pocos minutos y el usuario naturalmente va a querer ver el progreso en la misma pagina donde lo inicio.

---

## 8. ModalConfirmarLote — flujo de confirmacion

### Layout

```
┌─────────────────────────────────────────────────────┐
│  Confirmar envio a NetSuite              [×]         │
│─────────────────────────────────────────────────────│
│  Se enviaran N cargos a Oracle NetSuite como         │
│  Ordenes de Compra. Esta accion no se puede         │
│  deshacer.                                          │
│                                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │ Operador     Consumo    Facturacion   Monto    │ │
│  │─────────────────────────────────────────────── │ │
│  │ AFINIA       Ene 2026   Feb 2026   $1.234.567 │ │
│  │ AIRE         Feb 2026   Mar 2026   $  891.234 │ │
│  │ ...          ...        ...        ...        │ │
│  │  [scroll interno si > 8 filas]                │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  [Si hay errores previos: aviso amarillo aqui]      │
│                                                     │
│  Total a enviar:                     $2.125.801    │
│─────────────────────────────────────────────────────│
│  [Cancelar]                   [Confirmar envio →]  │
│                   (loading: spinner + "Enviando...")│
└─────────────────────────────────────────────────────┘
```

**Scroll interno de la lista:**
```tsx
<div style={{
  maxHeight: 280,  // ~8 filas de 35px
  overflowY: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
}}>
  <table style={{ width: "100%", borderCollapse: "collapse" }}>
    ...
  </table>
</div>
```

Con 100 cargos (maximo del backend) y ~35px por fila = 3500px de contenido en un scroll de 280px — el usuario puede scrollear. No se virtualiza: el DOM de 100 `<tr>` es trivial (~50KB de HTML).

### Suma total

```tsx
const totalCop = cargos.reduce((sum, c) => sum + c.monto, 0)
```

Se muestra con `cop(totalCop)` y en negrita.

### Aviso de errores previos

```tsx
{cargos.some(c => c.tieneErrorPrevio) && (
  <div style={{
    background: "#fff7ed", border: "1px solid #fde68a",
    borderRadius: 6, padding: "8px 12px",
    fontSize: "0.8rem", color: "#92400e",
  }}>
    {cargos.filter(c => c.tieneErrorPrevio).length} cargo(s) tienen un envio fallido previo.
    Al confirmar, se creara un nuevo lote con un nuevo intento.
  </div>
)}
```

### Boton Confirmar con estados

```tsx
<button
  onClick={handleConfirmar}
  disabled={estadoBoton === "loading"}
  style={{
    background: estadoBoton === "error" ? "#fef2f2" : "#07c5a8",
    color: estadoBoton === "error" ? "#b91c1c" : "#fff",
    border: estadoBoton === "error" ? "1px solid #fca5a5" : "none",
    ...
  }}
>
  {estadoBoton === "idle"    && "Confirmar envio →"}
  {estadoBoton === "loading" && "Enviando..."}
  {estadoBoton === "error"   && "Error — Reintentar"}
</button>
```

---

## 9. DetalleEnvioModal — modal lateral

### Decision: drawer vs modal centrado

**Recomendacion: modal centrado con ancho fijo (580px max-width).**

Justificacion:
- Un drawer lateral (slide desde la derecha) requiere logica de posicionamiento relativa al viewport, manejo del scroll del body, y en mobile puede colapsar sobre el sidebar. Complejidad extra sin beneficio claro.
- El contenido del detalle (OC, payload JSON, botones) cabe bien en un modal centrado de ~580px.
- En mobile (< 640px), el modal ocupa el 95% del ancho del viewport automaticamente.
- Si en Fase 3 se decide cambiar a drawer, es un cambio de estilos solamente — la logica de props no cambia.

### Layout caso PROCESADO (exito)

```
┌────────────────────────────────────────────────────┐
│  Detalle de envio                         [×]      │
│────────────────────────────────────────────────────│
│  ✓ PROCESADO                                       │
│                                                    │
│  Operador:      AFINIA                             │
│  Consumo:       Enero 2026                         │
│  Facturacion:   Febrero 2026                       │
│  Monto enviado: $1.234.567                         │
│  Enviado el:    20 may 2026 a las 12:34:56         │
│  Respondido el: 20 may 2026 a las 12:34:58         │
│  Intentos:      1                                  │
│                                                    │
│  Orden de Compra: OC-2026-00123                    │
│  NetSuite ID:     12345678                         │
│                                                    │
│  ▶ [Payload enviado]  (collapsible)                │
│  ▶ [Respuesta de NetSuite]  (collapsible)          │
└────────────────────────────────────────────────────┘
```

### Layout caso ERROR

```
┌────────────────────────────────────────────────────┐
│  Detalle de envio                         [×]      │
│────────────────────────────────────────────────────│
│  ✗ ERROR                                           │
│                                                    │
│  Operador:      AFINIA                             │
│  Consumo:       Enero 2026                         │
│  Facturacion:   Febrero 2026                       │
│  Monto enviado: $1.234.567                         │
│  Enviado el:    20 may 2026 a las 12:34:56         │
│  Intentos:      2                                  │
│                                                    │
│  Codigo de error:  MOCK_FAIL                       │
│  Mensaje:          Mocked failure for testing      │
│                                                    │
│  ▶ [Payload enviado]  (collapsible)                │
│  ▶ [Request + Response completos]  (collapsible)   │
│                                                    │
│  [Reenviar este cargo]                             │
└────────────────────────────────────────────────────┘
```

### JSON collapsible

Usar `<details>` / `<summary>` HTML nativo:

```tsx
<details style={{ marginTop: 8 }}>
  <summary style={{
    cursor: "pointer",
    fontSize: "0.78rem",
    color: "#6b7280",
    userSelect: "none",
    listStyle: "none",
    display: "flex",
    alignItems: "center",
    gap: 4,
  }}>
    <span style={{ fontSize: "0.7rem" }}>▶</span>
    Payload enviado
  </summary>
  <pre style={{
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 4,
    padding: "8px 10px",
    fontSize: "0.72rem",
    overflowX: "auto",
    marginTop: 4,
    maxHeight: 200,
    overflowY: "auto",
  }}>
    {JSON.stringify(envio.errorPayloadJson ?? envio.respuestaOkJson, null, 2)}
  </pre>
</details>
```

**Por que `<details>` nativo:** sin JS extra, accesible (keyboard toggle con Enter/Space), y el estado abierto/cerrado se maneja por el browser. Solo se necesita `useState` si queremos controlar el estado desde fuera (p.ej. "abrir todos"). Para este caso, el estado local del `<details>` es suficiente.

### Boton "Reenviar este cargo"

```tsx
{envio.estado === "ERROR" && (
  <>
    {!confirmandoReenvio ? (
      <button
        onClick={() => setConfirmandoReenvio(true)}
        style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: 6, padding: "8px 16px" }}
      >
        Reenviar este cargo
      </button>
    ) : (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: "0.8rem", color: "#374151" }}>
          Confirmar reenvio de {envio.orNombre} — {mesLabel(envio.mesFact)}
        </span>
        <button onClick={handleReenviar} disabled={reenviando} style={{ background: "#b91c1c", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px" }}>
          {reenviando ? "Reenviando..." : "Confirmar"}
        </button>
        <button onClick={() => setConfirmandoReenvio(false)} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer" }}>
          Cancelar
        </button>
      </div>
    )}
  </>
)}
```

**Flujo completo del reenvio:**
1. Click "Reenviar" → confirmacion inline (sin abrir otro modal).
2. Click "Confirmar" → `setRenviando(true)` → POST `/envio/:id/reenviar`.
3. Si ok: cerrar modal, actualizar `estadosEnvio` con el nuevo estado (deberia ser `PROCESANDO` temporalmente), el polling tomara el relevo.
4. Si error: `setErrorReenvio(mensaje)`, mostrar debajo del boton.

---

## 10. Plan de implementacion incremental

### PR FE-0 — Prerequisito de coordinacion (no UI)

**No es un PR de frontend.** Es la validacion de que los endpoints del backend esten disponibles con datos mock antes de arrancar FE-2. Coordinacion con backend:
- Confirmar que `GET /api/cargos-str/netsuite/estados` retorna la estructura documentada.
- Confirmar que `or_id` en los endpoints usa el mismo identificador que `o.codigo` o `o.id` en el pivot. **Esta es la duda mas critica antes de arrancar** — si el pivot usa `codigo` y el backend usa `id`, los keys del mapa de estados no van a matchear.

**No se puede arrancar FE-2 sin esta confirmacion.**

---

### PR FE-1 — Skeleton de componentes y tipos TypeScript

**Entrega:**
- Carpeta `components/cargos-str/` con los 5 archivos creados.
- Cada archivo tiene: types exportados, la funcion del componente con props tipadas y un `return null` (o un `<div>Placeholder</div>`).
- Tipos `EstadoEnvioUI`, `LoteEnCursoUI`, `CargoSeleccionado` en `components/cargos-str/types.ts`.
- Mock data en `_dev/mocks/netsuite.ts` con ejemplos de todos los estados.

**Prerequisitos de backend:** ninguno.

**Como testearlo:** `npm run build` pasa sin errores de tipos.

**DoD:**
- `tsc --noEmit` sin errores.
- Cada componente es importable desde `page.tsx`.
- Mock data cubre los 5 estados de celda y los 3 estados de lote.

**Estimacion:** 0.5 dias.

---

### PR FE-2 — Tabla con checkboxes y seleccion

**Entrega:**
- `CeldaCargo.tsx` implementado completamente (los 5 estados visuales).
- `BotonGenerarOC.tsx` implementado.
- `page.tsx` modificado: nuevos state de seleccion, `toggleSeleccion`, integracion de `CeldaCargo` en `ResultsTable`, integracion de `BotonGenerarOC` en la barra de filtros.
- Checkpoint de fila (selector de OR completo).
- Seleccion masiva "todos los elegibles".

**Prerequisitos de backend:** datos mock hardcodeados en `page.tsx` para simular `estadosEnvio`. Ejemplo:
```tsx
// _dev: datos mock para FE-2
const MOCK_ESTADOS: Record<EstadoEnvioKey, EstadoEnvioUI> = {
  "periodo-x|OR-AFINIA": { ultimoEnvioId: "e1", estado: "PROCESADO", numeroOc: "OC-2026-00123", ... },
  "periodo-x|OR-AIRE":   { ultimoEnvioId: "e2", estado: "ERROR", errorMensaje: "Timeout", ... },
}
```

**Como testearlo sin backend:** reemplazar `estadosEnvio` con `MOCK_ESTADOS` y verificar que los 5 estados de celda se renderizan correctamente.

**DoD:**
- Los 5 estados de celda se distinguen visualmente.
- Click en checkbox alterna la seleccion.
- Celdas PROCESADAS/PROCESANDO tienen checkbox deshabilitado.
- El contador de `BotonGenerarOC` refleja `seleccion.size`.
- La tabla no pierde su alineacion existente.
- Funciona en mobile (320px de ancho minimo).

**Estimacion:** 1.5 dias.

---

### PR FE-3 — Badges, tooltips y DetalleEnvioModal

**Entrega:**
- `BadgeCelda` integrado en `CeldaCargo`.
- Tooltips con contenido dinamico segun estado.
- `DetalleEnvioModal.tsx` completo con ambos layouts (exito/error).
- Click en celda con envio previo abre el modal con datos mock.
- Seccion de JSON collapsible.
- Boton "Reenviar" con confirmacion inline (sin llamada real al API).

**Prerequisitos de backend:** datos mock para el modal (`_dev/mocks/netsuite.ts` con payload de ejemplo).

**DoD:**
- Click en celda con badge abre el modal.
- Modal muestra layout correcto segun estado (verde vs rojo).
- JSON collapsible funciona con teclado (Enter en `<summary>`).
- Focus se mueve al modal al abrirse (`autoFocus` en el boton de cierre).
- Modal se cierra con Escape.

**Estimacion:** 1 dia.

---

### PR FE-4 — ModalConfirmarLote y flujo de creacion de lote

**Entrega:**
- `ModalConfirmarLote.tsx` completo.
- `handleConfirmarLote` en `page.tsx` con llamadas reales a `POST /lote` y `POST /procesar`.
- Manejo de errores: `409 LOTE_EN_CURSO`, `400 SIN_DATOS`, `422 MONTO_CERO`, `500`.
- Toast component (inline en `page.tsx` o en `components/cargos-str/Toast.tsx`).
- Validaciones cliente side (monto 0, maximo de cargos).

**Prerequisitos de backend:** `POST /api/cargos-str/netsuite/lote` y `POST /api/cargos-str/netsuite/lote/:id/procesar` disponibles (aunque sea con mock client de NetSuite activado con `NETSUITE_MODE=mock`).

**Como testearlo:** crear un lote con 2-3 cargos, verificar que el backend retorna 201 con el `loteId`, y que el 202 del procesamiento llega correctamente.

**DoD:**
- El flujo completo de creacion funciona con el backend mock.
- Todos los casos de error muestran el mensaje correcto.
- El boton "Confirmar" tiene los 3 estados (idle/loading/error).
- La suma total coincide con la suma de los montos seleccionados.

**Estimacion:** 1.5 dias.

---

### PR FE-5 — PanelLoteEnCurso y polling

**Entrega:**
- `PanelLoteEnCurso.tsx` completo con barra de progreso animada.
- `useEffect` de polling en `page.tsx`.
- `useEffect` de carga inicial del lote activo.
- Integracion del panel en el JSX de `page.tsx`.
- Actualizacion de badges en tiempo real durante el polling.
- Toast de completado cuando `estado` pasa a `COMPLETADO`.
- Boton "Cancelar lote" con confirmacion y llamada a `POST /cancelar`.

**Prerequisitos de backend:** `GET /api/cargos-str/netsuite/lote/:id` disponible. El endpoint `GET /lote/activo` (sugerido en seccion 2.3) tambien necesario para la carga inicial.

**Como testearlo:** con el mock activo (90% exito, 10% error, delay 200-800ms), crear un lote de 10-15 cargos y observar que la barra progresa, los badges cambian, y el toast aparece al completar.

**DoD:**
- La barra de progreso avanza con cada poll.
- Los badges de la tabla se actualizan sin hacer refetch del pivot principal.
- Cerrar el panel con [x] no detiene el polling.
- Navegar y volver detecta el lote activo (si el endpoint `GET /lote/activo` esta disponible).
- El cleanup de setInterval funciona: abrir DevTools > Performance y verificar que no hay setInterval activo despues de navegar fuera.
- El guard `document.visibilityState === "hidden"` esta implementado.

**Estimacion:** 1.5 dias.

---

### PR FE-6 — Integracion real con APIs (cuando esten disponibles)

**Entrega:**
- Remover todos los datos mock hardcodeados.
- Activar el `useEffect` de carga de `estadosEnvio` con el endpoint real `GET /estados`.
- Activar `handleVerDetalle` con el endpoint real de detalle de envio.
- Activar el reenvio real con `POST /envio/:id/reenviar`.
- Ajustar los keys del mapa de estados segun lo que retorne el backend (confirmar `periodoId|orId` vs `periodoId|codigo`).
- Testing end-to-end con el mock de NetSuite en el ambiente de preview de Vercel.

**Prerequisitos de backend:** todos los 6 endpoints operativos.

**Estimacion:** 1 dia (principalmente integracion y ajuste de tipos).

---

### PR FE-7 — Pulido, animaciones y accesibilidad

**Entrega:**
- Animacion de entrada/salida del `PanelLoteEnCurso`.
- Animacion de la barra de progreso al completarse (burst verde).
- Focus management correcto en todos los modales.
- Navegacion por teclado testeada: Tab, Enter, Escape en todos los flujos.
- ARIA labels auditados.
- Test de contraste de colores (ver seccion 11).
- Responsive auditado en 320px, 768px, 1280px.

**Estimacion:** 1 dia.

---

**Resumen de estimaciones:**

| PR | Descripcion | Dias | Bloquea |
|----|-------------|------|---------|
| FE-1 | Skeleton + tipos | 0.5 | nada |
| FE-2 | Tabla + checkboxes + seleccion | 1.5 | FE-3, FE-4 |
| FE-3 | Badges + tooltips + DetalleModal | 1 | FE-5 |
| FE-4 | ModalConfirmar + creacion lote | 1.5 | FE-5 |
| FE-5 | Panel + polling | 1.5 | FE-6 |
| FE-6 | Integracion real | 1 | APIs listas |
| FE-7 | Pulido + a11y | 1 | — |
| **Total** | | **8 dias** | |

---

## 11. Accesibilidad y UX

### Keyboard navigation

**Tab order en la tabla:**
Cada `CeldaCargo` tiene un `<input type="checkbox">` que es naturalmente focusable con Tab. El orden de Tab sigue el orden del DOM (izquierda a derecha, fila por fila), lo que es intuitivo.

Para optimizar: agregar `tabIndex={-1}` al `<td>` y dejar solo el checkbox como elemento focusable dentro de la celda.

**Atajos sugeridos (Fase 7):**
- `Space` sobre checkbox: toggle (ya comportamiento nativo).
- `Escape`: cerrar cualquier modal abierto.
- `Enter` sobre `BotonGenerarOC` cuando tiene foco: abrir modal de confirmacion (ya comportamiento nativo de `<button>`).

### ARIA labels

```tsx
// CeldaCargo
<input
  aria-label={`Seleccionar cargo de ${orNombre} para ${mesLabel(mesFact)}`}
  aria-checked={seleccionado}
/>

// BadgeCelda
<span
  role="status"
  aria-label={
    estado === "PROCESADO" ? `Cargo procesado. Orden de compra: ${numeroOc}` :
    estado === "ERROR"     ? `Error en el envio: ${errorMensaje?.slice(0, 80)}` :
    estado === "PROCESANDO"? "Envio en progreso" :
    "Pendiente de envio"
  }
>

// PanelLoteEnCurso
<div role="status" aria-live="polite" aria-label="Progreso del lote en curso">
  {/* actualiza el status en el arbol de accesibilidad cuando cambian los totales */}
</div>

// BotonGenerarOC
<button aria-label={`Generar ordenes de compra para ${cantidadSeleccionados} cargos seleccionados`}>

// DetalleEnvioModal / ModalConfirmarLote
<div role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <h2 id="modal-title">...</h2>
</div>
```

### Focus management en modales

Al abrir un modal:
```tsx
useEffect(() => {
  if (abierto) {
    // Mover foco al primer elemento interactivo del modal
    modalRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus()
  }
}, [abierto])
```

Al cerrar: devolver foco al elemento que abrio el modal:
```tsx
const triggerRef = useRef<HTMLElement | null>(null)

// Antes de abrir:
triggerRef.current = document.activeElement as HTMLElement

// Al cerrar:
triggerRef.current?.focus()
```

### Contraste de colores — verificacion WCAG AA

| Texto | Fondo | Ratio estimado | Cumple AA (4.5:1) |
|-------|-------|----------------|---------------------|
| `#15803d` verde sobre `#f0fdf4` | — | ~5.1:1 | Si |
| `#b91c1c` rojo sobre `#fef2f2` | — | ~5.8:1 | Si |
| `#b45309` amarillo sobre `#fff7ed` | — | ~4.7:1 | Si (ajustado) |
| `#1e3a8a` sobre `#dbeafe` | — | ~6.2:1 | Si |
| `#fff` sobre `#07c5a8` teal | — | ~3.1:1 | No para texto < 18px |

**Alerta:** el texto blanco sobre el fondo teal `#07c5a8` no cumple WCAG AA para texto de tamaño normal (< 18px). El boton "Filtrar" y la celda TOTAL usan este patron. Para el boton, el texto es `fontWeight: 600` y `fontSize: 0.875rem` (14px) — no cumple. **Recomendacion:** cambiar el color del texto del boton a `#050f0d` (casi negro) o oscurecer el teal a `#059d87`. Esto se evalua en PR FE-7.

### Mensajes de loading vs disabled

**Loading:** usar un skeleton shimmer en el `<td>` de la celda cuando los estados de envio estan cargando por primera vez:

```tsx
{cargandoEstados ? (
  <td style={{ padding: "8px 14px" }}>
    <div style={{
      height: 16, borderRadius: 4,
      background: "linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s infinite",
    }}/>
  </td>
) : (
  <CeldaCargo ... />
)}
```

No usar un spinner bloqueante para la tabla completa — los datos del pivot ya estan disponibles, solo los estados de envio son los que cargan.

### Confirmaciones destructivas

- **Cancelar lote:** confirmacion en dos pasos dentro del `PanelLoteEnCurso` (el primer click muestra "Confirmar cancelacion?" con boton rojo, no abre otro modal).
- **Reenviar cargo:** confirmacion inline dentro del `DetalleEnvioModal` (ya documentado en seccion 9).
- **No usar `window.confirm()`:** feo, bloquea el main thread, no estilizable.

---

## 12. Riesgos y decisiones pendientes

### Decisiones que necesitan confirmacion antes de arrancar FE-2

| # | Pregunta | Impacto si se responde tarde |
|---|----------|------------------------------|
| D1 | En el endpoint `GET /estados`, los `orIds` son los **`id`** de `ConfiguracionOR` o el **`codigo`** (string como "OR-AFINIA")? | Los keys del mapa de estados no matchearan con los datos del pivot. Bloquea FE-2. |
| D2 | El endpoint `GET /lote/activo` (para detectar lote al montar la pagina) se va a implementar? | Sin el, el panel solo aparece en la sesion que creo el lote. Aceptable en Fase 1. |
| D3 | `MAX_ENVIOS_POR_LOTE` confirmado en 100? | Determina el aviso en la UI y la validacion cliente. |
| D4 | El endpoint de detalle de envio individual existe (`GET /envio/:id`) o hay que extraerlo del lote completo? | Afecta la implementacion de `handleVerDetalle` en page.tsx. |

### Decisiones de UX a validar con el usuario (no tecnicas)

| # | Pregunta | Recomendacion frontend |
|---|----------|------------------------|
| U1 | Shift+click para seleccion de rango en la tabla? | No implementar en Fase 1 — agrega complejidad de estado (lastClickedIndex) sin demanda confirmada. |
| U2 | Pausar el polling cuando la pestana pierde foco? | Si, implementar el guard `document.visibilityState` desde FE-5. |
| U3 | Mantener el filtro aplicado cuando arranca un lote? | Si — no limpiar los filtros. El usuario quiere ver el progreso en la misma vista filtrada. |
| U4 | Persistencia del panel de lote en el layout del dashboard? | No en Fase 1 (vive en la pagina). Re-evaluar en Fase 3 segun feedback. |
| U5 | Mostrar el panel de lote para otros usuarios (no solo el que lo inicio)? | Si — el Arquitecto lo requiere en B.4. El endpoint `/lote/activo` o el polling lo habilita. |

### Dependencias criticas con el backend

El frontend de Fase 1 puede completarse con datos mock hasta PR FE-5. Para FE-6 (integracion real), se necesitan:
1. Los 6 endpoints operativos.
2. Confirmacion de D1 (id vs codigo en los keys de estados).
3. `NETSUITE_MODE=mock` configurado en el ambiente de preview de Vercel para testing.

---

## Archivos a crear/modificar

### Crear (carpeta nueva):
- `components/cargos-str/CeldaCargo.tsx`
- `components/cargos-str/BotonGenerarOC.tsx`
- `components/cargos-str/ModalConfirmarLote.tsx`
- `components/cargos-str/PanelLoteEnCurso.tsx`
- `components/cargos-str/DetalleEnvioModal.tsx`
- `components/cargos-str/types.ts`
- `_dev/mocks/netsuite.ts`

### Modificar:
- `app/(dashboard)/cargos-str/page.tsx` (state, effects, helpers, integracion de componentes)

### No tocar (confirmacion explicita de que no se modifica backend):
- `app/api/cargos-str/` y subcarpetas (son del backend)
- `lib/integrations/netsuite/` (es del backend)
- `prisma/schema.prisma` (es del backend)
- `app/(dashboard)/layout.tsx` (hasta Fase 3 si se decide persistir el panel)

---

## Proximos pasos inmediatos

- [ ] **Confirmar D1** (id vs codigo en el endpoint de estados) con el backend antes de arrancar FE-2.
- [ ] Crear carpeta `components/cargos-str/` y el archivo `types.ts` como primer commit de FE-1.
- [ ] Agregar en `globals.css` los keyframes `badge-pop` y `shimmer` que varios componentes usan.
- [ ] Acordar con el Arquitecto si el endpoint `GET /lote/activo` se incluye en Fase 1 o se deja para Fase 3.
- [ ] Verificar que el patron de color teal sobre blanco en los botones es acceptable para accesibilidad o definir el color de texto alternativo.
