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

> **Importante (cruce por código, NO por operador):** el match contra
> Facturación debe hacerse por `codigo_frontera` (clave única de la frontera)
> contra TODA la facturación del período, **no** filtrando facturación por el
> texto `operador_red = código del OR`. Ese texto puede no coincidir con el
> código del OR y deja fronteras fuera (caso CENS: FRT26970/FRT71035 estaban en
> Facturación con otra etiqueta de operador y salían como "no en Facturación").
> El `operador_red`/`or_id` se usa solo para **delimitar el universo del OR**
> (qué fronteras pertenecen al OR), no para el cruce de datos.

## Estado por conciliación

### SDL — `lib/engine/conciliacion-orchestrator.ts`
Implementa la unión vía **huérfanas**: recorre las fronteras de Facturación
(universo maestro) y agrega las de SDL —y XM cuando NO se filtra por OR— que no
están en Facturación, persistidas como `caso = INCOMPLETA` con motivo *"No existe
en Facturación; falta XM/SDL"*. Entran en `totalFronteras` y en el detalle de
incompletas. Las huérfanas de SDL se atribuyen al `or_id` del registro SDL.

> **Pendiente (mismo patrón que TC1):** al correr por OR, SDL filtra Facturación
> por `operador_red = código` (líneas ~89/96). Por eso una frontera de SDL que
> esté en Facturación bajo otra etiqueta de operador puede marcarse como huérfana
> falsa. El refinamiento es cruzar contra TODA la facturación del período por
> `codigo_frontera` (como ya se hizo en TC1), usando `or_id`/`operador_red` solo
> para delimitar el universo del OR. A aplicar cuando se valide con datos (motor
> financiero — requiere cuidado).

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
