# 🎨 Design System — BIA Energy

> Este documento documenta el sistema de diseño BIA Energy extraído de `app/globals.css`.
> El asistente lo usa como referencia para mantener consistencia visual en el proyecto.

---

## 1. Paleta de Colores

### Colores de Acento (Turquesa BIA)
| Token CSS | Valor | Uso |
|-----------|-------|-----|
| `--bia-accent` | `#07c5a8` | Color primario — botones, links activos, íconos destacados |
| `--bia-accent-hover` | `#06b096` | Estado hover del acento |
| `--bia-accent-dim` | `rgba(7, 197, 168, 0.10)` | Fondos sutiles de elementos activos |
| `--bia-accent-border` | `rgba(7, 197, 168, 0.30)` | Bordes de elementos activos / focus ring |

### Fondos
| Token CSS | Valor | Uso |
|-----------|-------|-----|
| `--bia-bg-base` | `#f3f4f6` | Fondo general de la app |
| `--bia-bg-surface` | `#ffffff` | Superficie principal (sidebar, modales) |
| `--bia-bg-card` | `#ffffff` | Tarjetas y paneles |
| `--bia-bg-elevated` | `#f9fafb` | Elementos elevados, hover de filas de tabla |

### Texto
| Token CSS | Valor | Uso |
|-----------|-------|-----|
| `--bia-text-primary` | `#0f172a` | Texto principal |
| `--bia-text-secondary` | `#475569` | Texto secundario, labels |
| `--bia-text-muted` | `#94a3b8` | Texto desactivado, placeholders |

### Bordes
| Token CSS | Valor | Uso |
|-----------|-------|-----|
| `--bia-border` | `rgba(0,0,0,0.08)` | Borde sutil general |
| `--bia-border-strong` | `rgba(0,0,0,0.14)` | Borde más visible (inputs) |

### Estados
| Token CSS | Valor | Uso |
|-----------|-------|-----|
| `--bia-error` | `#ef4444` | Errores, campos inválidos |
| `--bia-error-dim` | `rgba(239,68,68,0.08)` | Fondo de alertas de error |
| `--bia-success` | `#16a34a` | Éxito |

---

## 2. Tipografía

- **Fuente principal**: Inter (Google Fonts)
- **Tamaño base**: `0.875rem` (14px)
- **Line-height base**: `1.5`
- **Anti-aliasing**: `-webkit-font-smoothing: antialiased`

### Escala tipográfica usada
| Uso | Tamaño |
|-----|--------|
| Título de página (h1) | `1.5rem` / `fontWeight: 700` |
| Títulos de sección (h2) | `1rem` / `fontWeight: 600` |
| Labels de nav | `0.875rem` / `fontWeight: 500` |
| Texto de tabla (td) | `0.85rem` |
| Labels de input | `0.8rem` / `fontWeight: 500` |
| Badges, meta | `0.72rem` / `fontWeight: 600` |

---

## 3. Componentes CSS

### `.bia-panel`
Panel de contenido principal. Fondo blanco, borde, sombra suave.
```css
background: white; border: 1px solid --bia-border;
border-radius: 12px; padding: 24px;
box-shadow: 0 4px 24px rgba(0,0,0,0.06);
```

### `.bia-card`
Tarjeta de navegación o información.
```css
background: white; border: 1px solid --bia-border;
border-radius: 12px; padding: 20px 24px;
```

### `.bia-stat-card`
Tarjeta de estadística (KPI).
```css
background: white; border: 1px solid --bia-border;
border-radius: 10px; padding: 16px 20px;
display: flex; flex-direction: column; gap: 4px;
```

### `.bia-btn-primary`
Botón primario turquesa.
```css
background: --bia-accent; color: #050f0d;
border-radius: 8px; padding: 10px 20px;
font-weight: 600; font-size: 0.875rem;
transition: background 0.15s, transform 0.1s;
```
- Hover: `background: --bia-accent-hover; transform: translateY(-1px)`
- Disabled: `opacity: 0.5; cursor: not-allowed`

### `.bia-btn-secondary`
Botón secundario ghost.
```css
background: transparent; color: --bia-text-secondary;
border: 1px solid --bia-border-strong;
border-radius: 8px; padding: 9px 18px;
```

### Badges
- `.bia-badge-accent` — turquesa (estados positivos)
- `.bia-badge-error` — rojo (errores/alertas)
- `.bia-badge-neutral` — índigo (neutral/informativo)

### `.bia-table-container`
Tabla con bordes, hover de fila, headers en mayúsculas.

### `.bia-input`
Input estándar con focus ring turquesa.

### `.bia-tabs` / `.bia-tab` / `.bia-tab.active`
Sistema de pestañas con línea inferior activa en turquesa.

---

## 4. Layout

### Sidebar
- Ancho: **240px**, fijo
- Fondo: `--bia-bg-surface` (blanco)
- Borde derecho: `1px solid --bia-border`
- Logo BIA: ícono Zap en cuadrado turquesa 32×32px

### TopBar
- Altura: **64px**
- Fondo: blanco, borde inferior

### Contenido principal
- Fondo: `--bia-bg-base` (#f3f4f6 gris suave)
- Padding: `24px`

---

## 5. Estados visuales de navegación (Sidebar)

| Estado | Fondo | Color texto | Borde |
|--------|-------|-------------|-------|
| Normal | transparent | `--bia-text-secondary` | transparent |
| Hover | — | `--bia-text-primary` | — |
| Activo | `--bia-accent-dim` | `--bia-accent` | `1px solid --bia-accent-border` |

---

## 6. Scrollbar personalizado
```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }
```

---

## 7. Entorno de desarrollo (banner)
El dashboard muestra un banner oscuro (`#141414`) con texto en `#2DFFC2` para indicar que está en modo dev.

---

## 8. Notas de diseño
- **Radio general**: `0.5rem` (8px)
- **Sombra de panel**: `0 4px 24px rgba(0,0,0,0.06)` — muy suave
- Evitar colores planos puros (rojo, azul, verde genérico)
- Todas las transiciones: `0.15s` ease
- El color `#050f0d` se usa como color de texto sobre el acento turquesa (contraste)
