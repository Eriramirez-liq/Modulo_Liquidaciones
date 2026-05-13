# PRD – Aplicativo de Conciliación de Liquidaciones BIA
**Versión:** 2.3
**Fecha:** Abril 2026
**Plataforma de desarrollo:** Antigravity
**Producto:** Módulo de Conciliación SDL – Comercializador Puro BIA

---

## 1. VISIÓN GENERAL

### 1.1 Contexto del negocio
BIA opera como comercializador puro en el mercado de energía eléctrica colombiano. Mensualmente debe conciliar la energía registrada por frontera (usuario) entre tres fuentes de verdad:

| # | Fuente | Descripción |
|---|--------|-------------|
| 1 | **Facturación BIA** | Energía por frontera reportada por el equipo interno de facturación, incluyendo los componentes tarifarios cobrados al usuario |
| 2 | **CGM → XM** | Energía reportada por el Centro de Gestión de Medida a XM por cada frontera |
| 3 | **SDL Operadores de Red** | Liquidación enviada mensualmente por cada uno de los 20 operadores de red vía correo, con el costo SDL en COP y kWh por frontera |

> **Nota:** En este aplicativo, el concepto de **frontera comercial es equivalente a usuario**. Cada frontera representa un punto de medición asociado a un único usuario final.

### 1.2 Alcance de energía — Fase 1 vs. Fase 2

**Fase 1 (actual):** El aplicativo gestiona únicamente **energía activa** (kWh).

**Fase 2 (futura — planteada):** Incorporación del análisis de **energía reactiva** (kVARh) cobrada por cada OR. La arquitectura debe permitir activar esta dimensión sin rediseño estructural. Los campos de energía reactiva deben estar presentes en el modelo de datos pero inactivos en Fase 1.

### 1.3 Problema a resolver
- Errores manuales en la identificación de diferencias por frontera
- Falta de trazabilidad en provisiones y contingencias abiertas
- Dificultad para cuantificar el impacto financiero de las desviaciones
- Riesgo de no detectar cobros indebidos de operadores de red
- Falta de control sobre balances de energía enviados posteriormente por los OR

### 1.4 Objetivo del aplicativo
Automatizar la conciliación frontera a frontera entre las tres fuentes, clasificar las diferencias en dos líneas de análisis, calcular el impacto financiero de cada caso y proveer un dashboard de seguimiento con reportes exportables.

---

## 2. STACK TECNOLÓGICO

| Capa | Tecnología |
|------|------------|
| **Backend** | Python 3.12 + FastAPI (async) |
| **Validación de datos** | Pydantic v2 |
| **ORM** | SQLAlchemy 2.0 (async) |
| **Migraciones** | Alembic |
| **Base de datos** | PostgreSQL 16 |
| **Procesamiento de archivos** | pandas + openpyxl |
| **Frontend** | React 18 + TypeScript + Vite |
| **UI Components** | shadcn/ui + Tailwind CSS |
| **Gráficos** | Recharts |
| **HTTP Client (frontend)** | TanStack Query + Axios |
| **Autenticación** | FastAPI + JWT (python-jose) + bcrypt |
| **Exportación Excel** | openpyxl |
| **Exportación PDF** | WeasyPrint o ReportLab |
| **Testing** | pytest + pytest-asyncio + httpx |
| **Gestión de entorno** | uv (gestor de paquetes Python moderno) |

### Estructura de carpetas del proyecto

```
bia-conciliacion/
├── backend/
│   ├── app/
│   │   ├── main.py               # Entrada FastAPI
│   │   ├── core/
│   │   │   ├── config.py         # Settings con Pydantic BaseSettings
│   │   │   ├── security.py       # JWT, hashing
│   │   │   └── database.py       # Engine async SQLAlchemy
│   │   ├── models/               # Modelos SQLAlchemy
│   │   ├── schemas/              # Schemas Pydantic (request/response)
│   │   ├── routers/              # Endpoints FastAPI por módulo
│   │   ├── services/             # Lógica de negocio por módulo
│   │   ├── engine/               # Motor de conciliación
│   │   └── utils/                # Parseo de archivos, exportación
│   ├── alembic/                  # Migraciones
│   ├── tests/
│   └── pyproject.toml            # Dependencias con uv
├── frontend/
│   ├── src/
│   │   ├── components/           # Componentes React reutilizables
│   │   ├── pages/                # Páginas por módulo
│   │   ├── hooks/                # Custom hooks TanStack Query
│   │   ├── lib/                  # Cliente Axios, utils
│   │   └── types/                # Tipos TypeScript
│   ├── package.json
│   └── vite.config.ts
└── docker-compose.yml            # PostgreSQL + backend + frontend
```

---

## 3. USUARIOS Y ROLES

| Rol | Descripción | Permisos |
|-----|-------------|----------|
| **Analista** | Carga archivos, ejecuta conciliación, gestiona provisiones/contingencias/disputas, genera reportes | Lectura + Carga + Edición de estados |
| **Administrador** | Todo lo del Analista + gestión de usuarios, configuración de formatos SDL/Balance, parámetros del sistema | Acceso total |

---

## 4. MÓDULOS DEL APLICATIVO

| Módulo | Nombre |
|--------|--------|
| M1 | Carga y Procesamiento de Fuentes |
| M2 | Motor de Conciliación |
| M3 | Gestión de Provisiones, Contingencias y Disputas |
| M4 | Dashboard de Seguimiento |
| M5 | Reportes y Exportación |
| M6 | Administración del Sistema |

---

## 5. REQUERIMIENTOS FUNCIONALES DETALLADOS

---

### M1 – CARGA Y PROCESAMIENTO DE FUENTES

#### Consideraciones generales sobre el catálogo de fronteras

El sistema **no mantiene un catálogo fijo de fronteras**. El universo de fronteras activas para cada período se deriva directamente del archivo de Facturación BIA (Fuente 1). Cada mes pueden ingresar fronteras nuevas y salir fronteras que ya no están activas.

El único control histórico sobre fronteras: si una frontera aparece en el mes actual asociada a un OR distinto al de meses anteriores, se emite una **alerta de cambio de OR** para validación manual.

**RF-M1-01:** El sistema permite la carga mensual de fuentes identificadas por período (AAAA-MM).

**RF-M1-02:** Panel de estado del período con semáforo visual: rojo = pendiente, amarillo = parcial, verde = completo.

**RF-M1-03:** Log de carga con: usuario, fecha/hora, período, tipo de fuente, operador, archivo, registros procesados, errores.

**RF-M1-04:** Si ya existe carga para el mismo período+fuente+OR: advertir y exigir justificación escrita para reemplazar.

---

#### Fuente 1 – Facturación BIA

**RF-M1-05:** Archivo Excel/CSV con una fila por frontera. Es la fuente maestra del período.

**Estructura obligatoria:**

| Columna | Tipo Python | Descripción |
|---------|-------------|-------------|
| `codigo_frontera` | `str` | Identificador único de la frontera/usuario |
| `nombre_usuario` | `str` | Nombre o razón social del usuario |
| `operador_red` | `str` | Nombre o código del operador de red asignado |
| `periodo` | `str` (AAAA-MM) | Período de facturación |
| `energia_facturada_kwh` | `Decimal` | Energía total facturada al usuario en kWh |
| `g_bia` | `Decimal` | Componente G cobrado al usuario ($/kWh) |
| `t_bia` | `Decimal` | Componente T cobrado al usuario ($/kWh) |
| `d_bia` | `Decimal` | Componente D cobrado al usuario ($/kWh) |
| `pr_bia` | `Decimal` | Componente PR cobrado al usuario ($/kWh) |
| `r_bia` | `Decimal` | Componente R cobrado al usuario ($/kWh) |
| `c_bia` | `Decimal` | Componente C de comercialización cobrado al usuario ($/kWh) |
| `tarifa_total_bia` | `Decimal` | Suma G+T+D+PR+R+C — campo calculado de validación |

> Todos los campos numéricos deben manejarse con `Decimal` (no `float`) para evitar errores de precisión en cálculos financieros.

**RF-M1-06:** Al cargar la Fuente 1 el sistema:
- Construye el universo de fronteras del período
- Detecta cambios de OR respecto a meses anteriores → alerta
- Valida: `tarifa_total_bia ≈ G+T+D+PR+R+C` (tolerancia ±0.01)

---

#### Fuente 2 – Reporte CGM/XM

**RF-M1-07:** Archivo Excel/CSV. Campos mínimos:

| Columna | Tipo Python | Descripción |
|---------|-------------|-------------|
| `codigo_frontera` | `str` | Identificador de la frontera |
| `periodo` | `str` | Período del reporte |
| `energia_xm_kwh` | `Decimal` | Energía reportada a XM en kWh |

**RF-M1-08:** Alertar sobre fronteras en Fuente 2 no presentes en Fuente 1 del período (sin bloquear carga).

---

#### Fuente 3 – SDL de Operadores de Red

**RF-M1-09:** Cada OR tiene formato propio, configurable por el administrador. Campos extraídos por frontera:

| Campo | Tipo Python | Descripción |
|-------|-------------|-------------|
| `codigo_frontera` | `str` | Identificador de la frontera |
| `periodo_sdl` | `str` | Período del cobro |
| `energia_sdl_kwh` | `Decimal` | Energía cobrada — **campo clave** |
| `valor_sdl_cop` | `Decimal` | Costo SDL total en COP |
| `tarifa_sdl` | `Decimal` | Calculada: `valor_sdl_cop / energia_sdl_kwh` |

> **Validación crítica:** Si `tarifa_sdl > d_bia` para alguna frontera → bloquear esa frontera, emitir error. No procesar en el motor hasta corregir.

> **Fase 2:** Campos `energia_reactiva_sdl_kvarh` y `valor_reactivo_sdl_cop` presentes en el modelo, inactivos.

**RF-M1-10:** Carga independiente por OR. La conciliación puede ejecutarse con los SDL disponibles.

**RF-M1-11:** Alertar si una frontera aparece en el SDL de un OR distinto al de Fuente 1.

---

#### Fuente 4 – Balances de Energía de Operadores de Red

**RF-M1-12:** Archivos de balance enviados por el OR en cualquier momento, con estructura configurable.

**RF-M1-13:** Al cargar: indicar OR, período al que aplica el ajuste, referencia del documento.

**RF-M1-14:** Campos extraídos:

| Campo | Tipo Python | Descripción |
|-------|-------------|-------------|
| `codigo_frontera` | `str` | Identificador de la frontera |
| `periodo_ajuste` | `str` | Período original del ajuste |
| `energia_balance_kwh` | `Decimal` | kWh del ajuste (+cobro / −abono) |
| `valor_balance_cop` | `Decimal` | Valor del ajuste en COP |
| `tarifa_balance` | `Decimal` | Calculada: `valor_balance_cop / energia_balance_kwh` |
| `periodo_tarifa` | `str` | Período de tarifas que aplica el OR |

**RF-M1-15:** Un balance es cobro/abono adicional que se cruza contra provisiones/contingencias. No reemplaza el SDL original.

---

### M2 – MOTOR DE CONCILIACIÓN

#### Diagrama de referencia — Las dos líneas de conciliación

```
┌─────────────────────┐          ┌─────────────────────┐          ┌─────────────────────┐
│  Usuario / Frontera │ ──────►  │         XM          │ ──────►  │   Operador de Red   │
│  Facturación BIA    │          │   Reporte CGM       │          │  Liquidación SDL    │
│      (E_fac)        │          │      (E_xm)         │          │      (E_sdl)        │
└─────────────────────┘          └─────────────────────┘          └─────────────────────┘
         │                                 │                                 │
         └──────────── LÍNEA 1 ────────────┘         └────── LÍNEA 2 ───────┘
              ΔL1 = E_xm – E_fac                          ΔL2 = E_sdl – E_xm
         ¿BIA cobró lo mismo que reportó a XM?      ¿XM coincide con lo que cobra el OR?
              Umbral: |ΔL1| > 100 kWh                    Umbral: |ΔL2| > 100 kWh

RESULTADOS:
  Sin diferencia   │  Contingencia L1  │  Provisión L1/D3  │  Disputa L2
  |Δ| ≤ 100 kWh   │  ΔL1 > 100 kWh   │  ΔL1 < –100 kWh  │  |ΔL2| > 100 kWh

Techo: E_xm es siempre el límite superior para E_sdl.
```

#### Definiciones base

- **E_fac:** Energía facturada por BIA al usuario (Fuente 1)
- **E_xm:** Energía reportada por CGM a XM (Fuente 2)
- **E_sdl:** Energía cobrada por el OR en el SDL (Fuente 3)
- **Línea 1 (L1):** ΔL1 = E_xm – E_fac
- **Línea 2 (L2):** ΔL2 = E_sdl – E_xm

#### Umbral de clasificación

**RF-M2-01:** Umbral inicial: **±100 kWh** absolutos, configurable.

**RF-M2-02 (futura):** Soporte para umbral dual (absoluto + % relativo, con criterio AND/OR). Campos disponibles en configuración pero inactivos en Fase 1.

#### Regla del techo

**RF-M2-03:** E_xm es el techo para E_sdl. Si E_sdl > E_xm → Disputa L2.

#### Clasificación por escenario

**RF-M2-04:** El motor implementa los siguientes casos como una función Python pura y testeable (`classify_frontera(e_fac, e_xm, e_sdl, threshold) -> CasoEnum`):

| Caso | Relación | Resultado L1 | Resultado L2 | Acción |
|------|----------|--------------|--------------|--------|
| **A1** | E_fac = E_xm = E_sdl | Sin diferencia | Sin diferencia | Cerrado |
| **B1** | E_fac < E_xm = E_sdl | Contingencia L1 | Sin diferencia | Gestionar cobro OR |
| **B2** | E_fac > E_xm = E_sdl | Provisión L1 | Sin diferencia | Crear provisión |
| **C1** | E_fac = E_xm > E_sdl | Sin diferencia | Disputa L2 | Pedir SDL corregido |
| **C2** | E_fac = E_xm < E_sdl | Sin diferencia | Disputa L2 | Pedir SDL corregido |
| **D1** | E_fac < E_sdl < E_xm | Contingencia L1 | Disputa L2 | Alerta manual |
| **D2** | E_sdl < E_xm < E_fac | Provisión combinada | Absorbida | Alerta manual |
| **D3** | E_xm < E_fac = E_sdl | Provisión D3 | Sin diferencia | Cálculo automático |
| **D4** | Tres valores distintos s/patrón | — | — | Alerta manual |
| **ERROR** | tarifa_sdl > d_bia (en D3) | — | — | Bloquear |
| **IMPOSIBLE** | E_fac < E_xm y E_sdl > E_xm | — | — | Bloquear |

#### Cálculo financiero — fórmulas por caso

> Todos los cálculos usan `Decimal` para precisión financiera. El componente **C se excluye siempre** de las fórmulas de provisión porque corresponde al servicio de comercialización que BIA sí prestó. BIA retiene ese valor.

**RF-M2-05 – Contingencia L1 (B1, D1):**
```python
# Sin valorización al momento de la conciliación
# Al recibir cobro del OR:
costo_l1 = delta_kwh * tarifa_sdl_cobro_recibido
```
- Sin refacturación → **"pérdida por diferencia de reporte"**
- Con refacturación → `costo_neto = costo_l1 - monto_refacturado` → ganancia/pérdida real

**RF-M2-06 – Provisión L1 (B2):**
```python
provision_l1 = abs(e_fac - e_xm) * (g_bia + t_bia + d_bia + pr_bia + r_bia)
# C excluido — BIA lo retiene
```

**RF-M2-07 – Disputa L2 — C1 (OR cobra menos que XM):**
```python
valor_estimado = (e_xm - e_sdl) * tarifa_sdl
# Estado: ABIERTA — PENDIENTE_RELIQUIDACION_OR
# No genera provisión
```

**RF-M2-08 – Disputa L2 — C2 (OR excede techo XM):**
```python
valor_estimado = (e_sdl - e_xm) * tarifa_sdl
# Estado: ABIERTA — OR_EXCEDE_TECHO_XM
# No genera provisión
```

**RF-M2-09 – Provisión combinada D2:**
```python
provision_d2 = abs(e_fac - e_sdl) * (g_bia + t_bia + d_bia + pr_bia + r_bia)
# C excluido. Genera alerta manual adicional.
```

**RF-M2-10 – Provisión D3:**
```python
# Validar primero:
if tarifa_sdl > d_bia:
    raise ValueError("tarifa_sdl > d_bia — error en carga SDL")

provision_d3 = abs(e_fac - e_xm) * (
    g_bia + t_bia + (d_bia - tarifa_sdl) + pr_bia + r_bia
)
# Cálculo automático. Sin alerta manual.
```

#### Ejecución del proceso

**RF-M2-11:** La conciliación se ejecuta manualmente por el analista. El motor corre como una tarea async en FastAPI.

**RF-M2-12:** Advertir si faltan SDL de algún OR antes de ejecutar, con opción de continuar o esperar.

**RF-M2-13:** Resultados almacenados históricamente. Re-ejecución requiere justificación obligatoria.

**RF-M2-14:** Fronteras sin alguna fuente → clasificar como `INCOMPLETA`, excluir del cálculo, alertar.

**RF-M2-15:** Al recargar SDL corregido: re-ejecutar conciliación para fronteras afectadas. Cerrar disputas automáticamente si la diferencia desaparece.

---

### M3 – GESTIÓN DE PROVISIONES, CONTINGENCIAS Y DISPUTAS

#### Provisiones (B2, D2, D3)

**RF-M3-01:** El motor crea automáticamente un registro `Provision` por cada resultado de tipo provisión.

**RF-M3-02:** Al cruzar con balance del OR (Fuente 4):
```python
resultado_neto = valor_provisionado - valor_balance_cop
# > 0 → GananciaReal
# < 0 → PerdidaReal
# = 0 → Exacto
```
El cruce es **definitivo e irreversible**. Una provisión cerrada no admite nuevos cruces.

**RF-M3-03:** Un balance puede cruzar N provisiones del mismo período. Se calcula el resultado neto global del conjunto.

**RF-M3-04:** Alerta para provisiones > 90 días en estado Pendiente.

#### Contingencias (B1, parte D1)

**RF-M3-05:** El motor crea automáticamente un registro `Contingencia` por cada resultado de tipo contingencia.

**RF-M3-06:** Al registrar cobro del OR:
```python
costo_contingencia = delta_kwh * tarifa_balance
```

**RF-M3-07:** Registro opcional de refacturación al cliente:
```python
costo_neto = costo_contingencia - refacturacion_cliente_cop
```
Resultado: `GananciaReal` / `PerdidaReal`.

**RF-M3-08:** Cierre sin refacturación → clasificar como **"PérdidaPorDiferenciaDeReporte"**.

**RF-M3-09:** Alerta para contingencias > 90 días en estado Pendiente.

#### Disputas (C1, C2, parte D1)

**RF-M3-10:** El motor crea un registro `Disputa` con tipo `OR_COBRA_MENOS` (C1) o `OR_EXCEDE_TECHO` (C2).

**RF-M3-11:** Flujo de cierre: OR envía SDL corregido → analista recarga Fuente 3 → motor re-ejecuta → si diferencia desaparece → estado `CERRADA_SDL_CORREGIDO`.

**RF-M3-12:** Si persiste diferencia tras recarga → actualizar disputa, mantener `ABIERTA`.

---

### M4 – DASHBOARD DE SEGUIMIENTO

**RF-M4-01:** Para el período seleccionado, mostrar KPIs: total fronteras, distribución por caso, impacto financiero estimado, saldo provisiones, exposición contingencias, valor en disputa.

**RF-M4-02:** Vista histórica 12 meses: evolución por categoría, impacto financiero, saldo acumulado.

**RF-M4-03:** Vista por OR: fronteras por resultado, saldo provisión, contingencias, disputas, tendencia.

**RF-M4-04:** Panel de estado de fuentes del período.

**RF-M4-05:** Gráficos interactivos con filtros por período, OR y tipo de resultado.

---

### M5 – REPORTES Y EXPORTACIÓN

**RF-M5-01 – R1 (sin diferencia):** código frontera, OR, E_fac, E_xm, E_sdl.

**RF-M5-02 – R2 (contingencias L1):** código frontera, OR, E_fac, E_xm, ΔL1, estado, cobro OR, costo calculado, refacturación cliente, clasificación final.

**RF-M5-03 – R3 (provisiones):** código frontera, OR, período origen, tipo, energía, fórmula, valor provisionado, balance cruzado, resultado neto, clasificación, antigüedad.

**RF-M5-04 – R4 (disputas L2):** código frontera, OR, tipo disputa, E_xm, E_sdl, diferencia kWh, valor estimado, estado, SDL corregido recibido, observaciones.

**RF-M5-05 – R5 (alertas manuales D1/D2/D4):** código frontera, OR, E_fac, E_xm, E_sdl, caso, estado revisión.

**RF-M5-06 – R6 (consolidado del período):** resumen ejecutivo con totales e impacto financiero global.

**RF-M5-07:** Exportación en Excel (.xlsx con openpyxl) y PDF (WeasyPrint). Colores por tipo de resultado.

---

### M6 – ADMINISTRACIÓN DEL SISTEMA

**RF-M6-01:** CRUD de usuarios con roles Analista/Administrador, activación/desactivación, historial de sesiones.

**RF-M6-02:** Configuración de formato SDL por OR: mapeo de columnas, fila de inicio, formato de fecha, prueba de parseo con archivo de muestra.

**RF-M6-03:** Configuración de formato de Balance por OR: análogo a RF-M6-02, incluyendo `periodo_tarifa`.

**RF-M6-04:** Configuración de umbrales: absoluto (inicial 100 kWh), relativo % (visible, inactivo), criterio AND/OR (visible, inactivo).

**RF-M6-05:** Log de auditoría completo con filtros por usuario, acción, entidad, rango de fechas.

**RF-M6-06:** Notificaciones in-app: fuente lista para conciliar, conciliación completada, provisión/contingencia > 90 días, disputa > 30 días.

---

## 6. MODELO DE DATOS (SQLAlchemy)

```python
# Enums
class CasoEnum(str, Enum):
    A1="A1"; B1="B1"; B2="B2"; C1="C1"; C2="C2"
    D1="D1"; D2="D2"; D3="D3"; D4="D4"
    INCOMPLETA="INCOMPLETA"; ERROR="ERROR"

class TipoProvisionEnum(str, Enum):
    L1="L1"; COMBINADA="COMBINADA"; D3="D3"

class TipoDisputaEnum(str, Enum):
    OR_COBRA_MENOS="OR_COBRA_MENOS"
    OR_EXCEDE_TECHO="OR_EXCEDE_TECHO"

class EstadoDisputaEnum(str, Enum):
    ABIERTA="ABIERTA"; SDL_RECARGADO="SDL_RECARGADO"
    CERRADA_SDL_CORREGIDO="CERRADA_SDL_CORREGIDO"

class ClasificacionContingenciaEnum(str, Enum):
    PENDIENTE="PENDIENTE"
    PERDIDA_REPORTE="PERDIDA_REPORTE"
    GANANCIA_REAL="GANANCIA_REAL"
    PERDIDA_REAL="PERDIDA_REAL"

class TipoResultadoCruceEnum(str, Enum):
    GANANCIA_REAL="GANANCIA_REAL"
    PERDIDA_REAL="PERDIDA_REAL"
    EXACTO="EXACTO"

# Tablas principales
PeriodoConciliacion  : id, periodo str, estado str
CargaFuente          : id, periodo_id, tipo_fuente int(1-4), operador_ref str,
                       archivo str, usuario_id, fecha_carga, registros int,
                       errores int, reemplaza_id
RegistroFacturacion  : id, carga_id, codigo_frontera, nombre_usuario,
                       operador_red, energia_kwh Decimal, g_bia, t_bia,
                       d_bia, pr_bia, r_bia, c_bia, tarifa_total_bia Decimal
RegistroXM           : id, carga_id, codigo_frontera, energia_xm_kwh Decimal
RegistroSDL          : id, carga_id, codigo_frontera, operador_red,
                       energia_sdl_kwh Decimal, valor_sdl_cop Decimal,
                       tarifa_sdl Decimal,
                       energia_reactiva_sdl_kvarh Decimal nullable,  # Fase 2
                       valor_reactivo_sdl_cop Decimal nullable         # Fase 2
RegistroBalance      : id, carga_id, codigo_frontera, operador_red,
                       periodo_ajuste, energia_balance_kwh Decimal,
                       valor_balance_cop Decimal, tarifa_balance Decimal,
                       periodo_tarifa str
ResultadoConciliacion: id, periodo_id, codigo_frontera, operador_red,
                       e_fac Decimal, e_xm Decimal, e_sdl Decimal,
                       delta_l1 Decimal, delta_l2 Decimal,
                       caso CasoEnum,
                       impacto_financiero_l1 Decimal nullable,
                       impacto_financiero_l2 Decimal nullable,
                       requiere_alerta_manual bool
Provision            : id, resultado_id, tipo TipoProvisionEnum,
                       codigo_frontera, operador_red, periodo_origen,
                       energia_kwh Decimal, valor_provisionado_cop Decimal,
                       componentes_json JSON, estado str,
                       fecha_creacion, fecha_cierre nullable
Contingencia         : id, resultado_id, codigo_frontera, operador_red,
                       periodo_origen, energia_kwh Decimal, estado str,
                       clasificacion ClasificacionContingenciaEnum,
                       costo_calculado_cop Decimal nullable,
                       refacturacion_cliente_cop Decimal nullable,
                       fecha_creacion, fecha_cierre nullable
CruceBalance         : id, provision_id nullable, contingencia_id nullable,
                       registro_balance_id,
                       energia_cruzada_kwh Decimal,
                       valor_cruzado_cop Decimal,
                       resultado_neto_cop Decimal,
                       tipo_resultado TipoResultadoCruceEnum,
                       fecha_cruce
Disputa              : id, resultado_id, codigo_frontera, operador_red,
                       periodo, tipo TipoDisputaEnum,
                       energia_diferencia_kwh Decimal,
                       valor_estimado_cop Decimal,
                       estado EstadoDisputaEnum,
                       observaciones str nullable,
                       fecha_creacion, fecha_cierre nullable
ConfiguracionOR      : id, nombre_or, codigo, correo,
                       mapeo_sdl_json JSON, mapeo_balance_json JSON
LogAuditoria         : id, usuario_id, accion, entidad, entidad_id,
                       timestamp, detalle str
```

---

## 7. FLUJO PRINCIPAL DEL PROCESO MENSUAL

```
1.  Analista carga Fuente 1 – Facturación BIA
     → Define universo del período
     → Alerta cambios de OR históricos
     → Valida tarifa_total_bia
2.  Analista carga Fuente 2 – Reporte CGM/XM
3.  Analista carga SDL de cada OR (Fuente 3)
     → Valida tarifa_sdl ≤ d_bia por frontera
4.  Analista ejecuta conciliación (POST /api/conciliacion/{periodo}/ejecutar)
     → Motor async clasifica cada frontera
     → Crea Provision, Contingencia, Disputa según caso
5.  Dashboard se actualiza (GET /api/dashboard/{periodo})
6.  Analista gestiona casos abiertos:
     - Contingencias: seguimiento cobro OR / refacturación cliente
     - Provisiones: espera balance para cruce definitivo
     - Disputas: solicita SDL corregido al OR
7.  [OR envía SDL corregido] → Analista recarga Fuente 3
     → Motor re-ejecuta para fronteras afectadas
     → Disputas resueltas se cierran automáticamente
8.  [OR envía balance] → Analista carga Fuente 4
     → Sistema cruza contra provisiones/contingencias
     → Calcula resultado neto definitivo
9.  Analista cierra registros resueltos con observaciones
```

---

## 8. CRITERIOS DE ACEPTACIÓN GLOBALES

- ✅ Universo de fronteras construido exclusivamente desde Fuente 1
- ✅ Alerta cuando una frontera cambia de OR respecto a meses anteriores
- ✅ Bloqueo de fronteras donde `tarifa_sdl > d_bia`
- ✅ Clasificación correcta de los 9 casos (A1...D4) con función pura testeable
- ✅ C1 y C2 generan Disputa L2, no provisión. Cierre por recarga de SDL corregido
- ✅ Provisiones B2 y D2 usan `(G+T+D+PR+R)_bia` — C excluido
- ✅ Provisión D3 usa `(G+T+(D–tarifa_sdl)+PR+R)_bia`, calculada automáticamente
- ✅ Cruces de balance son definitivos e irreversibles
- ✅ Contingencias sin refacturación → "PérdidaPorDiferenciaDeReporte"
- ✅ Disputas se cierran automáticamente cuando SDL corregido elimina la diferencia
- ✅ Todos los cálculos financieros usan `Decimal`, no `float`
- ✅ Exportación a Excel y PDF funcionando
- ✅ Log de auditoría registra todas las acciones relevantes
- ✅ Cobertura de tests ≥ 80% en el motor de conciliación (`engine/`)

---

## 9. REQUERIMIENTOS NO FUNCIONALES

| ID | Categoría | Requerimiento |
|----|-----------|---------------|
| RNF-01 | Rendimiento | Conciliación de hasta 5.000 fronteras en < 30 segundos (procesamiento async con pandas) |
| RNF-02 | Disponibilidad | 99.5% uptime en días hábiles |
| RNF-03 | Seguridad | JWT con expiración, bcrypt para contraseñas, HTTPS en producción |
| RNF-04 | Escalabilidad | Hasta 20 OR y 10.000 fronteras activas por período |
| RNF-05 | Trazabilidad | Todo cambio de estado auditado en LogAuditoria |
| RNF-06 | Exportación | Excel (.xlsx) y PDF generados en backend, descargables desde frontend |
| RNF-07 | UX | Interfaz responsive, Chrome / Edge / Safari |
| RNF-08 | Precisión | Todos los campos monetarios y de energía con `Decimal` (Python) / `NUMERIC` (PostgreSQL) |
| RNF-09 | Testing | pytest + pytest-asyncio. Motor de conciliación con ≥ 80% cobertura |

---

## 10. PROMPTS DE DESARROLLO POR MÓDULO

---

### PROMPT BASE — Contexto del proyecto (enviar primero)

```
Contexto del proyecto que vas a construir:

BIA es un comercializador puro de energía eléctrica en Colombia.
Este aplicativo concilia mensualmente la energía por frontera (usuario)
entre tres fuentes: Facturación BIA, Reporte CGM/XM, y SDL de
Operadores de Red.

TECH STACK:
- Backend: Python 3.12 + FastAPI (async) + SQLAlchemy 2.0 + Alembic
  + PostgreSQL 16 + pandas + openpyxl
- Validación: Pydantic v2
- Frontend: React 18 + TypeScript + Vite + shadcn/ui + Tailwind + Recharts
- Gestión de paquetes Python: uv
- Testing: pytest + pytest-asyncio + httpx

REGLAS DE CÓDIGO:
- Usar async/await en todos los endpoints FastAPI
- Todos los campos monetarios y de energía como Decimal (nunca float)
- Type hints en todo el código Python
- Pydantic v2 para todos los schemas de request/response
- Inyección de dependencias con FastAPI Depends()
- Idioma de la interfaz: español
- Moneda: COP. Unidad energía: kWh

Roles: Analista y Administrador.

A lo largo de esta sesión te voy a dar los prompts de cada módulo
uno por uno. Antes de ejecutar cada uno, genera un plan de
implementación como Artefacto para que yo lo revise y apruebe.
```

---

### PROMPT M0 – Inicialización del proyecto

```
Inicializa el proyecto base con la siguiente estructura:

bia-conciliacion/
├── backend/          # FastAPI + SQLAlchemy + Alembic
├── frontend/         # React 18 + Vite + TypeScript + shadcn/ui
└── docker-compose.yml  # PostgreSQL + backend + frontend

BACKEND:
- Proyecto Python con uv (pyproject.toml)
- FastAPI con estructura: routers/, services/, models/,
  schemas/, engine/, utils/, core/
- SQLAlchemy 2.0 async con PostgreSQL
- Alembic configurado para migraciones
- JWT auth con dos roles: Analista y Administrador
- CORS configurado para el frontend en desarrollo
- Endpoint de health check: GET /api/health

FRONTEND:
- Vite + React 18 + TypeScript
- shadcn/ui inicializado con tema neutral
- TanStack Query para data fetching
- Axios con interceptor JWT
- Layout con sidebar de navegación en español
- Página de login conectada al backend

DOCKER:
- docker-compose.yml con PostgreSQL 16, backend y frontend
- Variables de entorno en .env.example

No construyas ningún módulo de negocio todavía.
Solo la base del proyecto funcional.
```

---

### PROMPT M1 – Carga y Procesamiento de Fuentes

```
Desarrolla el módulo de Carga y Procesamiento de Fuentes.

BACKEND (FastAPI + pandas):

Endpoints:
- POST /api/cargas/{periodo}/facturacion      # Fuente 1
- POST /api/cargas/{periodo}/xm               # Fuente 2
- POST /api/cargas/{periodo}/sdl/{or_id}      # Fuente 3
- POST /api/cargas/{periodo}/balance/{or_id}  # Fuente 4
- GET  /api/cargas/{periodo}/estado           # Panel de estado
- GET  /api/cargas/log                        # Log histórico

Servicio de parseo (utils/parser.py):
- Leer Excel/CSV con pandas
- Aplicar mapeo de columnas configurable por OR (Fuente 3 y 4)
- Retornar DataFrame validado con los campos requeridos

Validaciones al cargar:
Fuente 1:
  - tarifa_total_bia ≈ G+T+D+PR+R+C (tolerancia Decimal('0.01'))
  - Detectar fronteras con OR distinto al histórico → alerta
Fuente 2:
  - Alertar fronteras no presentes en Fuente 1 del período
Fuente 3:
  - Calcular tarifa_sdl = valor_sdl_cop / energia_sdl_kwh
  - BLOQUEAR fronteras donde tarifa_sdl > d_bia (error de carga)
  - Alertar frontera con OR distinto al de Fuente 1
Todas:
  - Valores numéricos no negativos
  - Si ya existe carga: advertir, exigir justificación para reemplazar

Schemas Pydantic:
- CargaFuenteCreate, CargaFuenteResponse
- EstadoPeriodoResponse (semáforo por fuente)
- LogCargaResponse

FRONTEND:
- Página "Cargas" con selector de período
- Panel de estado con semáforo visual por fuente y por OR
- Formulario de carga con drag-and-drop, preview de 20 filas
  y estadísticas (total filas, fronteras, errores)
- Modal de confirmación con detalle de errores
- Tabla de log de cargas

Todos los campos numéricos como Decimal en backend.
TECH STACK: FastAPI / SQLAlchemy / pandas / React / shadcn/ui
```

---

### PROMPT M2 – Motor de Conciliación

```
Desarrolla el Motor de Conciliación como módulo Python puro y testeable.

ESTRUCTURA:
backend/app/engine/
├── __init__.py
├── classifier.py     # Función pura de clasificación
├── calculator.py     # Fórmulas de cálculo financiero
├── conciliador.py    # Orquestador del proceso completo
└── tests/
    ├── test_classifier.py
    └── test_calculator.py

classifier.py — implementar función pura:
from decimal import Decimal
from app.models import CasoEnum

def classify_frontera(
    e_fac: Decimal, e_xm: Decimal, e_sdl: Decimal,
    threshold: Decimal = Decimal('100')
) -> CasoEnum:
    # Implementar los 9 casos + ERROR + IMPOSIBLE
    # Retornar CasoEnum correspondiente

calculator.py — implementar las fórmulas:

# B2 — Provisión L1 (C excluido)
def calc_provision_l1(delta_kwh, g, t, d, pr, r) -> Decimal

# C1 — Disputa OR cobra menos
def calc_disputa_c1(e_xm, e_sdl, tarifa_sdl) -> Decimal

# C2 — Disputa OR excede techo
def calc_disputa_c2(e_sdl, e_xm, tarifa_sdl) -> Decimal

# D2 — Provisión combinada (C excluido)
def calc_provision_d2(e_fac, e_sdl, g, t, d, pr, r) -> Decimal

# D3 — Provisión D3 con tarifa neta
def calc_provision_d3(e_fac, e_xm, g, t, d_bia, tarifa_sdl, pr, r) -> Decimal:
    if tarifa_sdl > d_bia:
        raise ValueError("tarifa_sdl > d_bia — error en SDL")
    return abs(e_fac - e_xm) * (g + t + (d_bia - tarifa_sdl) + pr + r)

conciliador.py — orquestador async:
async def ejecutar_conciliacion(periodo_id, db) -> ResumenConciliacion:
    # 1. Cargar las tres fuentes del período
    # 2. Para cada frontera en Fuente 1:
    #    a. Obtener E_fac, E_xm, E_sdl
    #    b. Llamar classifier.classify_frontera()
    #    c. Llamar calculator según el caso
    #    d. Crear ResultadoConciliacion, Provision, Contingencia o Disputa
    # 3. Retornar resumen con conteos y totales financieros

Endpoint:
POST /api/conciliacion/{periodo}/ejecutar
  → Corre conciliador.ejecutar_conciliacion() como background task
GET  /api/conciliacion/{periodo}/resultados
GET  /api/conciliacion/{periodo}/resumen
POST /api/conciliacion/{periodo}/re-ejecutar  # Para SDL corregidos

TESTS (pytest):
- test_classifier.py: un test por cada caso (A1...D4, ERROR, IMPOSIBLE)
- test_calculator.py: test de cada fórmula con valores conocidos
- Cobertura mínima: 80% del módulo engine/

TECH STACK: Python / FastAPI / SQLAlchemy async / pytest
```

---

### PROMPT M3 – Gestión de Provisiones, Contingencias y Disputas

```
Desarrolla el módulo de Gestión de Provisiones, Contingencias y Disputas.

ENDPOINTS FastAPI:

Provisiones:
GET    /api/provisiones?periodo=&or=&estado=&antiguedad_min=
POST   /api/provisiones/{id}/cruzar-balance
         body: { balance_id, observaciones }
         → Cálculo definitivo e irreversible
         → resultado_neto = valor_provisionado - valor_balance_cop
         → Clasificar como GananciaReal / PerdidaReal / Exacto

Contingencias:
GET    /api/contingencias?estado=&or=&antiguedad_min=
POST   /api/contingencias/{id}/registrar-cobro
         body: { balance_id }
POST   /api/contingencias/{id}/registrar-refacturacion
         body: { monto_cop, fecha, referencia }
POST   /api/contingencias/{id}/cerrar-sin-refacturacion
         → Clasificar como PerdidaPorDiferenciaDeReporte

Disputas:
GET    /api/disputas?estado=&or=&tipo=
PATCH  /api/disputas/{id}/observaciones
         body: { observaciones }
         → El cierre automático lo maneja el motor al recargar SDL

REGLA CRÍTICA — Provisiones:
El cruce con balance es DEFINITIVO. Una vez ejecutado:
- El estado pasa a CRUZADO_TOTAL
- No se permiten más cruces sobre esa provisión
- Registrar en LogAuditoria con usuario y timestamp

PANEL DE SALDOS (GET /api/provisiones/saldos):
- Total provisionado pendiente agrupado por OR
- Provisiones por antigüedad (0-30, 31-60, 61-90, >90 días)
- Total exposición contingencias abiertas
- Total en disputa por OR

ALERTAS automáticas:
- Provisiones y contingencias > 90 días sin movimiento
- Disputas > 30 días abiertas

FRONTEND:
- Tres pestañas: Provisiones / Contingencias / Disputas
- Filtros por OR, estado, antigüedad
- Badges de alerta en provisiones/contingencias vencidas
- Modal de cruce de balance con confirmación de irreversibilidad
- Panel de saldos en la cabecera

TECH STACK: FastAPI / SQLAlchemy / React / shadcn/ui
```

---

### PROMPT M4 – Dashboard de Seguimiento

```
Desarrolla el Dashboard de Seguimiento.

ENDPOINTS FastAPI:
GET /api/dashboard/{periodo}/resumen
GET /api/dashboard/{periodo}/por-operador
GET /api/dashboard/historico?meses=12
GET /api/dashboard/{periodo}/estado-fuentes

PANEL PRINCIPAL (período seleccionable):
KPI Cards:
- Total fronteras del período
- Distribución: A1 / Contingencia L1 / Provisiones (B2,D2,D3) /
  Disputas (C1,C2) / Alertas manuales / Incompletas
- Impacto financiero estimado total
- Saldo provisiones (COP + kWh)
- Exposición contingencias abiertas
- Valor total en disputa

Gráficos (Recharts):
- Dona: distribución de fronteras por resultado
- Barras horizontales: top 10 fronteras por impacto financiero
- Tabla: estado de fuentes del período (cargadas, usuario, fecha)

PANEL HISTÓRICO (12 meses):
- Líneas: evolución mensual de fronteras por categoría
- Barras apiladas: ganancias reales vs. pérdidas reales mensuales
- Área: saldo acumulado de provisiones y contingencias

PANEL POR OR:
- Tabla de 20 OR con: fronteras por resultado, saldo provisión,
  contingencias, disputas, tendencia (vs. mes anterior con flecha ↑↓)

Filtros globales: período, OR, tipo de resultado.
Todos los gráficos con tooltips en español y formato COP.

TECH STACK: FastAPI / React / Recharts / shadcn/ui / TanStack Query
```

---

### PROMPT M5 – Reportes y Exportación

```
Desarrolla el módulo de Reportes y Exportación.

ENDPOINTS FastAPI:
GET /api/reportes/{periodo}/sin-diferencia        → JSON + Excel + PDF
GET /api/reportes/{periodo}/contingencias         → JSON + Excel + PDF
GET /api/reportes/{periodo}/provisiones           → JSON + Excel + PDF
GET /api/reportes/{periodo}/disputas              → JSON + Excel + PDF
GET /api/reportes/{periodo}/alertas-manuales      → JSON + Excel + PDF
GET /api/reportes/{periodo}/consolidado           → JSON + Excel + PDF

Parámetro de formato: ?formato=json|excel|pdf

GENERACIÓN EXCEL (utils/export_excel.py con openpyxl):
- Hoja por reporte
- Cabecera con logo BIA, período, fecha de generación
- Columnas numéricas con formato #,##0.00 (COP) y #,##0.000 (kWh)
- Colores por tipo de resultado:
  * Verde: sin diferencia (A1)
  * Amarillo: provisión (B2, D2, D3)
  * Naranja: contingencia (B1)
  * Azul: disputa (C1, C2)
  * Rojo: pérdida real
- Auto-ajuste de ancho de columnas

GENERACIÓN PDF (utils/export_pdf.py con WeasyPrint):
- Template HTML con CSS (WeasyPrint lo convierte)
- Encabezado: "BIA – Reporte de Conciliación · Período {AAAA-MM}"
- Pie de página: "Generado el {fecha} · Confidencial BIA"
- Tabla con bordes, alternancia de filas
- Resumen ejecutivo en primera página

FRONTEND:
- Página "Reportes" con selector de período y tipo de reporte
- Botones "Exportar Excel" y "Exportar PDF" por reporte
- Preview del reporte en tabla antes de exportar

TECH STACK: FastAPI / openpyxl / WeasyPrint / React / shadcn/ui
```

---

### PROMPT M6 – Administración del Sistema

```
Desarrolla el módulo de Administración del Sistema.

ENDPOINTS FastAPI:

Usuarios:
GET    /api/admin/usuarios
POST   /api/admin/usuarios
PUT    /api/admin/usuarios/{id}
PATCH  /api/admin/usuarios/{id}/activar
PATCH  /api/admin/usuarios/{id}/desactivar

Configuración de OR:
GET    /api/admin/operadores
POST   /api/admin/operadores
PUT    /api/admin/operadores/{id}
POST   /api/admin/operadores/{id}/probar-parseo-sdl   # Sube muestra, retorna preview
POST   /api/admin/operadores/{id}/probar-parseo-balance

Umbrales:
GET    /api/admin/umbrales
PUT    /api/admin/umbrales
  body: {
    umbral_absoluto_kwh: Decimal,       # Activo, default 100
    umbral_relativo_pct: Decimal,       # Inactivo Fase 1
    criterio_combinacion: "AND" | "OR"  # Inactivo Fase 1
  }

Log de auditoría:
GET /api/admin/auditoria?usuario=&accion=&entidad=&desde=&hasta=

CONFIGURACIÓN DE MAPEO DE COLUMNAS (mapeo_sdl_json):
Estructura JSON por OR:
{
  "codigo_frontera": "Código Punto",
  "energia_sdl_kwh": "Energía kWh",
  "valor_sdl_cop": "Valor COP",
  "periodo_sdl": "Período",
  "fila_inicio": 2,
  "formato_fecha": "YYYY-MM"
}

FRONTEND:
- Sección Usuarios: tabla con roles, estado, historial de sesiones
- Sección Operadores de Red: lista de 20 OR con configuración de
  formatos SDL y Balance, botón "Probar parseo" que sube muestra
  y muestra las primeras 5 filas parseadas
- Sección Umbrales: formulario con campos activos e inactivos
  claramente diferenciados
- Sección Auditoría: tabla con filtros avanzados

TECH STACK: FastAPI / SQLAlchemy / React / shadcn/ui
```

---

*Documento generado para uso interno de BIA – Área Comercial / Mercado de Energía*
*Versión 2.3 – Abril 2026*