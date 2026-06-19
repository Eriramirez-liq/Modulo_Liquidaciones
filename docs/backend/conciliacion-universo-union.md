# Criterio de universo de conciliación: UNIÓN de fuentes

> **Aplica a todas las conciliaciones del módulo:** SDL, TC1 y (a futuro) COT.
> **Fecha:** 2026-06-19

## Regla

El universo de fronteras a conciliar es la **UNIÓN** de las fronteras de **todas
las fuentes involucradas**, no solo las de Facturación. Una frontera que aparezca
en **una sola** fuente NO se omite: se reporta como **INCOMPLETA** con una
observación que indica en qué fuente falta, para que el analista la revise.

**Por qué:** si el universo fuera solo Facturación, una frontera presente en
TC1/SDL/XM pero ausente en Facturación (o filtrada por una etiqueta de operador
que no matchea) desaparecía silenciosamente del resultado, y el total conciliado
quedaba por debajo de las fronteras reales. Con la unión, el total nunca es menor
que las fronteras distintas de cualquiera de las fuentes.

El cruce entre fuentes se hace por `codigo_frontera` **normalizado** (trim +
upper). El conteo (`totalFronteras`) = tamaño del universo (unión).

## Estado por conciliación

### SDL — `lib/engine/conciliacion-orchestrator.ts`
Ya implementa la unión. Recorre las fronteras de Facturación (universo maestro)
y luego agrega las **huérfanas**: fronteras presentes en SDL —y en XM cuando NO
se filtra por OR— que no están en Facturación. Las huérfanas se persisten como
`caso = INCOMPLETA` con motivo *"No existe en Facturación; falta XM/SDL"* y entran
en `totalFronteras` y en el detalle de incompletas. Las huérfanas de SDL se
atribuyen al `or_id` del registro SDL.

### TC1 — `lib/engine/conciliacion-tc1.ts`
Universo = Facturación ∪ TC1 (por `codigo_frontera` normalizado). Para cada
frontera del universo:
- **En ambas:** compara `nivel_tension` y `propiedad_activos` →
  `SIN_DIFERENCIA` / `DIFERENCIA` / `INCOMPLETA` (si falta un campo).
- **Solo en Facturación:** `INCOMPLETA` — *"Frontera en Facturación pero no en TC1."*
- **Solo en TC1:** `INCOMPLETA` — *"Frontera en TC1 pero no en Facturación."*

En corridas por OR, las fronteras de un solo lado se atribuyen al OR
(`or_id`/`operador_red`) para que aparezcan en el detalle filtrado por operador.
La persistencia borra/recrea por las fronteras del universo (no solo las de
Facturación).

> Nota TC1: el nivel de tensión a conciliar se toma por **posición** (primera
> columna de "nivel de tensión", la que va después de `TIPO_DE_CONEXION`), no por
> nombre — porque algunos OR (ej. CENS) traen dos columnas y la segunda, aunque
> se llame "Nivel de tensión", es la primaria.

### COT — pendiente
No existe motor de conciliación COT todavía. Cuando se implemente, debe seguir
este mismo criterio: universo = unión de las fuentes (Facturación ∪ COT ∪ …),
fronteras de un solo lado reportadas como INCOMPLETA.

## Casos de un solo lado (cómo se ven en la UI)
Caen bajo el indicador **Incompletas** del módulo de Conciliaciones; la columna
de observación/motivo indica en qué fuente falta la frontera.
