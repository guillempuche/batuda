# Frontend

TanStack Start SSR app for the internal Forja sales tool. Deployed to Unikraft (Node.js). Mobile-first.
For system context see [architecture.md](architecture.md).

Deployed at `batuda.co`. The public marketing site lives in a separate repo (`engranatge-marketing`).

---

## Stack

- **TanStack Start** — SSR framework (file-based routing, server functions)
- **TanStack Router** — type-safe client routing
- **Tailwind CSS v4** — utility-first CSS, configured via `@theme` bridging MD3 tokens
- **styled-components** — CSS-in-JS for dynamic/stateful styles (transient props, runtime interpolation)
- **BaseUI** — headless, accessible components (styled with Tailwind classes + styled-components)
- **Motion + Motion Plus** — animations (`motion/react` for layout/transitions, `motion-plus/react` for premium components)
- **react-map-gl + MapLibre** — interactive map with company markers and clustering
- **Tiptap** — rich text editor for documents and proposals

---

## TypeScript config

`apps/internal/tsconfig.json` extends `../../tsconfig.base.json` and adds:

- `"lib": ["ESNext", "DOM", "DOM.Iterable"]` — browser globals
- `"jsx": "react-jsx"` — React 19 automatic transform, no `import React` needed per file
- `"types": ["vite/client"]` — Vite client type definitions
- `"paths": { "#/*": ["./src/*"] }` — import alias (`#/components/Foo`)

React 19 versions: `react@^19`, `react-dom@^19`, `@types/react@^19`, `@types/react-dom@^19`.
The `@types/react@19` package aligns with the React 19 runtime API (new hooks, `ref` as prop, etc.).

Same `moduleResolution: bundler` as the server — no `.js` in imports, `import type` for type-only.

## Build config

`apps/internal/vite.config.ts` — Vite with TanStack Start:

- `tanstackStart()` from `@tanstack/react-start/plugin/vite` — SSR framework
- `tailwindcss()` from `@tailwindcss/vite` — Tailwind v4 Vite plugin
- `viteReact()` — React JSX transform
- `tsconfigPaths()` — resolve `#/*` path alias

Deployed to Unikraft (Node.js SSR) via `Dockerfile` + `Kraftfile`. Build output in `.output/server/index.mjs`.

---

## Token system

**Note:** Tokens are defined in `packages/ui/src/tokens.css` and imported by `apps/internal` via the workspace link; the separate marketing repo consumes the same tokens via the published `@engranatge/ui` npm package. The values below document the full token set.

All spacing, typography, and color values come from CSS custom properties defined in
`packages/ui/src/tokens.css`. Tailwind's `@theme` bridges these tokens to utility classes. Never hardcode values — use Tailwind utilities or `var(--token)` in styled-components.

### Typography — MD3 type scale

```css
/* packages/ui/src/tokens.css */

/* --- Type scale --- */
/* Display */
--typescale-display-large-size:    3.5625rem;   /* 57px */
--typescale-display-large-line:    4rem;
--typescale-display-large-weight:  400;
--typescale-display-large-tracking: -0.016rem;

--typescale-display-medium-size:   2.8125rem;   /* 45px */
--typescale-display-medium-line:   3.25rem;
--typescale-display-medium-weight: 400;
--typescale-display-medium-tracking: 0;

--typescale-display-small-size:    2.25rem;     /* 36px */
--typescale-display-small-line:    2.75rem;
--typescale-display-small-weight:  400;
--typescale-display-small-tracking: 0;

/* Headline */
--typescale-headline-large-size:   2rem;        /* 32px */
--typescale-headline-large-line:   2.5rem;
--typescale-headline-large-weight: 400;

--typescale-headline-medium-size:  1.75rem;     /* 28px */
--typescale-headline-medium-line:  2.25rem;
--typescale-headline-medium-weight: 400;

--typescale-headline-small-size:   1.5rem;      /* 24px */
--typescale-headline-small-line:   2rem;
--typescale-headline-small-weight: 400;

/* Title */
--typescale-title-large-size:      1.375rem;    /* 22px */
--typescale-title-large-line:      1.75rem;
--typescale-title-large-weight:    400;

--typescale-title-medium-size:     1rem;        /* 16px */
--typescale-title-medium-line:     1.5rem;
--typescale-title-medium-weight:   500;
--typescale-title-medium-tracking: 0.009rem;

--typescale-title-small-size:      0.875rem;    /* 14px */
--typescale-title-small-line:      1.25rem;
--typescale-title-small-weight:    500;
--typescale-title-small-tracking:  0.006rem;

/* Body */
--typescale-body-large-size:       1rem;        /* 16px */
--typescale-body-large-line:       1.5rem;
--typescale-body-large-weight:     400;
--typescale-body-large-tracking:   0.031rem;

--typescale-body-medium-size:      0.875rem;    /* 14px */
--typescale-body-medium-line:      1.25rem;
--typescale-body-medium-weight:    400;
--typescale-body-medium-tracking:  0.016rem;

--typescale-body-small-size:       0.75rem;     /* 12px */
--typescale-body-small-line:       1rem;
--typescale-body-small-weight:     400;
--typescale-body-small-tracking:   0.025rem;

/* Label */
--typescale-label-large-size:      0.875rem;    /* 14px */
--typescale-label-large-line:      1.25rem;
--typescale-label-large-weight:    500;
--typescale-label-large-tracking:  0.006rem;

--typescale-label-medium-size:     0.75rem;     /* 12px */
--typescale-label-medium-line:     1rem;
--typescale-label-medium-weight:   500;
--typescale-label-medium-tracking: 0.031rem;

--typescale-label-small-size:      0.6875rem;   /* 11px */
--typescale-label-small-line:      1rem;
--typescale-label-small-weight:    500;
--typescale-label-small-tracking:  0.031rem;
```

### Tailwind setup

Tailwind v4 is used for **layout utilities only** (flex, grid, gap, positioning, responsive breakpoints). All visual tokens (colors, typography, spacing, shape, elevation) come from the MD3 CSS custom properties in `tokens.css` — referenced via `var()` in styled-components or Tailwind's arbitrary value syntax.

```css
/* packages/ui/src/tailwind.css */
@import "tailwindcss";
@import "./tokens.css";

@theme {
  /* Only breakpoints — everything else uses the token system directly */
  --breakpoint-sm: 640px;
  --breakpoint-md: 768px;
  --breakpoint-lg: 1024px;
  --breakpoint-xl: 1280px;
}
```

Each app imports this file as its CSS entry point:

```css
/* apps/internal/src/styles.css */
@import '@engranatge/ui/tailwind.css';
```

### Using tokens with Tailwind

Tailwind handles layout structure. Tokens handle all visual properties via styled-components + `var()`:

```tsx
import styled from 'styled-components'

const Card = styled.div`
  background: var(--color-surface);
  border-radius: var(--shape-medium);
  padding: var(--space-4);
  box-shadow: var(--elevation-1);
`

// Tailwind for grid layout, styled-components for card visuals
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[var(--space-4)]">
  <Card>{children}</Card>
</div>
```

For Tailwind spacing in layout, use arbitrary values with token references: `gap-[var(--space-4)]`, `p-[var(--page-gutter)]`.

### Color tokens — MD3 color scheme

```css
/* Light scheme (default) */
:root {
  /* Primary */
  --color-primary:                #1a56db;
  --color-on-primary:             #ffffff;
  --color-primary-container:      #d6e4ff;
  --color-on-primary-container:   #001551;

  /* Secondary */
  --color-secondary:              #575e71;
  --color-on-secondary:           #ffffff;
  --color-secondary-container:    #dbe2f9;
  --color-on-secondary-container: #141b2c;

  /* Tertiary */
  --color-tertiary:               #715573;
  --color-on-tertiary:            #ffffff;
  --color-tertiary-container:     #fcd7fb;
  --color-on-tertiary-container:  #29132d;

  /* Error */
  --color-error:                  #ba1a1a;
  --color-on-error:               #ffffff;
  --color-error-container:        #ffdad6;
  --color-on-error-container:     #410002;

  /* Surface */
  --color-surface:                #f8f9ff;
  --color-on-surface:             #191c20;
  --color-surface-variant:        #e1e2ec;
  --color-on-surface-variant:     #44464f;
  --color-surface-container-low:  #f2f3fa;
  --color-surface-container:      #ececf4;
  --color-surface-container-high: #e6e7ef;

  /* Background */
  --color-background:             #f8f9ff;
  --color-on-background:          #191c20;

  /* Outline */
  --color-outline:                #747680;
  --color-outline-variant:        #c5c6d0;

  /* Status colors — pipeline */
  --color-status-prospect:        var(--color-surface-variant);
  --color-status-contacted:       #e8f4fd;
  --color-status-responded:       #fff3e0;
  --color-status-meeting:         #e8f5e9;
  --color-status-proposal:        #f3e5f5;
  --color-status-client:          #e8f5e9;
  --color-status-closed:          var(--color-surface-container);
  --color-status-dead:            var(--color-surface-container);
}

/* Dark scheme */
@media (prefers-color-scheme: dark) {
  :root {
    --color-primary:                #adc6ff;
    --color-on-primary:             #002e6e;
    --color-primary-container:      #003fa0;
    --color-on-primary-container:   #d6e4ff;

    --color-secondary:              #bfc6dc;
    --color-on-secondary:           #293041;
    --color-secondary-container:    #3f4759;
    --color-on-secondary-container: #dbe2f9;

    --color-surface:                #111318;
    --color-on-surface:             #e2e2e9;
    --color-surface-variant:        #44464f;
    --color-on-surface-variant:     #c5c6d0;
    --color-surface-container-low:  #191c20;
    --color-surface-container:      #1e2026;
    --color-surface-container-high: #282a2f;

    --color-background:             #111318;
    --color-on-background:          #e2e2e9;

    --color-outline:                #8f9099;
    --color-outline-variant:        #44464f;
  }
}
```

### Fluid spacing scale

```css
/* packages/ui/src/tokens.css — continued */

/* 8px base grid — fluid between 320px and 1280px viewports */
--space-1:   clamp(0.25rem, 0.4vw,  0.5rem);    /*  4–8px */
--space-2:   clamp(0.5rem,  0.75vw, 1rem);       /*  8–16px */
--space-3:   clamp(0.75rem, 1vw,    1.25rem);    /* 12–20px */
--space-4:   clamp(1rem,    1.5vw,  1.5rem);     /* 16–24px */
--space-5:   clamp(1.25rem, 1.75vw, 1.75rem);   /* 20–28px */
--space-6:   clamp(1.5rem,  2vw,    2rem);       /* 24–32px */
--space-8:   clamp(2rem,    2.5vw,  2.5rem);     /* 32–40px */
--space-10:  clamp(2.5rem,  3vw,    3rem);       /* 40–48px */
--space-12:  clamp(3rem,    4vw,    4rem);       /* 48–64px */
--space-16:  clamp(4rem,    5vw,    5rem);       /* 64–80px */

/* Page layout */
--page-gutter:    clamp(1rem, 4vw, 2rem);
--page-max-width: 75rem;   /* 1200px */
--card-radius:    0.75rem;
--chip-radius:    999px;
```

### Shape tokens

```css
--shape-none:        0;
--shape-extra-small: 0.25rem;
--shape-small:       0.5rem;
--shape-medium:      0.75rem;
--shape-large:       1rem;
--shape-extra-large: 1.75rem;
--shape-full:        999px;
```

### Elevation (MD3 tonal surface elevation)

```css
--elevation-0: none;
--elevation-1: 0 1px 2px 0 rgb(0 0 0 / 0.08);
--elevation-2: 0 1px 2px 0 rgb(0 0 0 / 0.08), 0 2px 6px 2px rgb(0 0 0 / 0.08);
--elevation-3: 0 4px 8px 3px rgb(0 0 0 / 0.12), 0 1px 3px 0 rgb(0 0 0 / 0.12);
```

---

## Component naming convention

### Primitives — `Pri` prefix

Primitive components wrapping BaseUI headless components use the `Pri` prefix. They live in `src/components/pri/` and combine Tailwind classes for static styles with styled-components for dynamic/stateful styles:

```
PriButton, PriInput, PriSelect, PriDialog, PriTabs,
PriCheckbox, PriMenu, PriTooltip, PriCollapsible
```

### Composed — domain names

Components that compose primitives or implement domain-specific UI use descriptive names without prefix:

```
StatusBadge, PriorityDot, ChannelIcon, CompanyCard,
TaskItem, EmptyState, LoadingSpinner, TiptapEditor,
TiptapViewer, CompanyMap
```

---

## BaseUI components

BaseUI provides headless, accessible components. Style them with styled-components using MD3 tokens, and use Tailwind for layout when composing them.

### Usage pattern

```tsx
// src/components/pri/PriButton.tsx
import { Button } from '@base-ui/react/button'
import styled, { css } from 'styled-components'

const variants = {
  filled: css`
    background: var(--color-primary);
    color: var(--color-on-primary);
    &:hover { filter: brightness(0.92); }
  `,
  outlined: css`
    background: transparent;
    color: var(--color-primary);
    border: 1px solid var(--color-outline);
  `,
  text: css`
    background: transparent;
    color: var(--color-primary);
  `,
}

const PriButton = styled(Button.Root)<{ $variant?: keyof typeof variants }>`
  font-size: var(--typescale-label-large-size);
  font-weight: var(--typescale-label-large-weight);
  padding: var(--space-2) var(--space-6);
  border-radius: var(--shape-full);
  cursor: pointer;
  border: none;
  ${p => variants[p.$variant ?? 'filled']}
`

export default PriButton

// Usage
<PriButton $variant="filled">Log interaction</PriButton>
```

Dynamic data-driven styles:

```tsx
const StatusBadge = styled.span<{ $status: string }>`
  background: var(--color-status-${p => p.$status});
  border-radius: var(--shape-full);
  padding: var(--space-1) var(--space-3);
  font-size: var(--typescale-label-small-size);
`

<StatusBadge $status={company.status}>{company.status}</StatusBadge>
```

### Primitives in this project

| Primitive        | BaseUI base   | Used for                                                    |
| ---------------- | ------------- | ----------------------------------------------------------- |
| `PriButton`      | `Button`      | All interactive buttons                                     |
| `PriInput`       | `Input`       | Text inputs in forms                                        |
| `PriSelect`      | `Select`      | Status, region, industry dropdowns                          |
| `PriDialog`      | `Dialog`      | Interaction log modal, company quick-edit                   |
| `PriTabs`        | `Tabs`        | Company detail (Profile / Interactions / Documents / Tasks) |
| `PriMenu`        | `Menu`        | Action menus on company cards                               |
| `PriCheckbox`    | `Checkbox`    | Task completion                                             |
| `PriTooltip`     | `Tooltip`     | Short field explanations                                    |
| `PriCollapsible` | `Collapsible` | Expandable sections on company detail                       |

---

## Motion — animations

[Motion](https://motion.dev/) (formerly Framer Motion) for layout animations, transitions, and gestures. [Motion Plus](https://plus.motion.dev/) for premium components (animated numbers, typewriter, carousel, cursor, ticker).

### Installation

```bash
pnpm --filter internal add motion motion-plus
```

### Core Motion — layout and transitions

```tsx
import { motion, AnimatePresence } from 'motion/react'
import styled from 'styled-components'

const AnimatedCard = styled(motion.div)`
  background: var(--color-surface);
  border-radius: var(--shape-medium);
  padding: var(--space-4);
  box-shadow: var(--elevation-1);
`

// Layout animation on a card
<AnimatedCard layout>
  <h2>{company.name}</h2>
</AnimatedCard>

// Enter/exit transitions
const Panel = styled(motion.div)`
  background: var(--color-surface-container);
  border-radius: var(--shape-large);
  padding: var(--space-6);
`

<AnimatePresence>
  {isOpen && (
    <Panel
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
    >
      {children}
    </Panel>
  )}
</AnimatePresence>
```

### Motion Plus — premium components

All components are client-only (`"use client"` directive). Lazy-load in SSR routes.

```tsx
import { AnimateNumber, Typewriter, Carousel, Ticker, ScrambleText } from 'motion-plus/react'

// Animated dashboard counter
<AnimateNumber locales="ca-ES" format={{ style: 'decimal' }}>
  {pipelineCount}
</AnimateNumber>

// Typewriter for animated headlines
<Typewriter speed="normal" play>
  Organitza el teu pipeline comercial
</Typewriter>

// Horizontal carousel
<Carousel snap="page" velocity={50}>
  {companies.map(c => <CompanyCard key={c.id} company={c} />)}
</Carousel>

// Continuous ticker/marquee
<Ticker items={testimonials} velocity={30} gap={24} axis="x" />

// Scramble text on hover
<ScrambleText active={isHovered} duration={0.8}>
  Engranatge
</ScrambleText>
```

### Motion + styled-components

Motion wraps any element including styled-components:

```tsx
import { motion } from 'motion/react'
import styled from 'styled-components'

// Option 1: motion() wrapper
const AnimatedBadge = styled(motion.span)<{ $status: string }>`
  background: var(--color-status-${p => p.$status});
`

// Option 2: motion on styled element
const HoverCard = styled(motion.div)`
  background: var(--color-surface);
  border-radius: var(--shape-medium);
  padding: var(--space-4);
  box-shadow: var(--elevation-1);
  cursor: pointer;
`

<HoverCard whileHover={{ scale: 1.02 }}>
  <CompanyCard company={company} />
</HoverCard>
```

### SSR

Motion components marked `"use client"` work with TanStack Start SSR — they render static on the server and hydrate with animations on the client. Motion Plus components (AnimateNumber, Typewriter, etc.) use browser APIs and should be lazy-loaded or wrapped in `Suspense` if used in SSR-rendered routes.

---

## Tiptap — rich text editor

[Tiptap](https://github.com/ueberdosis/tiptap) is used for editing styled text content: documents (research, meeting notes), proposals, and any other rich text fields.

### Installation

Scaffolded via `apps/internal/package.json`:

- `@tiptap/react` — React integration
- `@tiptap/starter-kit` — bold, italic, headings, lists, code blocks, etc.
- `@tiptap/pm` — ProseMirror core (peer dep)

### Usage pattern

```tsx
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

function DocumentEditor({ content, onUpdate }: { content: string; onUpdate: (html: string) => void }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content,
    onUpdate: ({ editor }) => onUpdate(editor.getHTML()),
  })

  return <EditorContent editor={editor} className="tiptap-editor" />
}
```

### Styling

Tiptap renders standard HTML elements inside `.tiptap` — these need global styles. Use `createGlobalStyle` from styled-components:

```tsx
import { createGlobalStyle } from 'styled-components'

const TiptapStyles = createGlobalStyle`
  .tiptap-editor .tiptap {
    font-size: var(--typescale-body-large-size);
    line-height: var(--typescale-body-large-line);
    color: var(--color-on-surface);
    padding: var(--space-4);
    min-height: 12rem;
    outline: none;
  }

  .tiptap-editor .tiptap h1 { font-size: var(--typescale-headline-large-size); }
  .tiptap-editor .tiptap h2 { font-size: var(--typescale-headline-medium-size); }
  .tiptap-editor .tiptap h3 { font-size: var(--typescale-headline-small-size); }
`
```

### Where used

| View                      | Usage                                         |
| ------------------------- | --------------------------------------------- |
| Documents tab (edit mode) | Full editor — research, meeting pre/postnotes |
| Proposals tab (edit)      | Proposal notes and description                |
| Interaction summary       | Optional rich text for detailed summaries     |

For read-only display, render the stored HTML directly (no editor instance needed).

---

## Map — react-map-gl + MapLibre

Company locations are displayed on an interactive map with clustering using [react-map-gl](https://visgl.github.io/react-map-gl/) + [MapLibre GL JS](https://maplibre.org/).

### Installation

Scaffolded via `apps/internal/package.json`:

- `react-map-gl` — React wrapper for MapLibre
- `maplibre-gl` — open-source WebGL map renderer
- `supercluster` — fast marker clustering

### Usage pattern

```tsx
import Map, { Marker, Popup } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import styled from 'styled-components'

const Pin = styled.div<{ $status: string }>`
  width: 12px;
  height: 12px;
  border-radius: var(--shape-full);
  background: var(--color-status-${p => p.$status});
  border: 2px solid var(--color-on-primary);
`

function CompanyMap({ companies }: { companies: CompanySummary[] }) {
  return (
    <Map
      initialViewState={{ longitude: 1.52, latitude: 41.39, zoom: 7 }}
      style={{ height: 500 }}
      mapStyle={`https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`}
    >
      {companies.map(c => (
        <Marker key={c.id} longitude={c.lng} latitude={c.lat}>
          <Pin $status={c.status} />
        </Marker>
      ))}
    </Map>
  )
}
```

### SSR

MapLibre requires `window`/WebGL — it cannot render server-side. Lazy-load the map client-only:

```tsx
import { lazy, Suspense } from 'react'
const CompanyMap = lazy(() => import('../components/CompanyMap'))

// In route component:
<Suspense fallback={<div style={{ height: 500 }} />}>
  <CompanyMap companies={companies} />
</Suspense>
```

### Tiles

Use [MapTiler](https://www.maptiler.com/) free tier (100K tile requests/month). Set `MAPTILER_KEY` env var.

---

## Breakpoints

Mobile-first. Breakpoints are defined in `@theme` (sm: 640px, md: 768px, lg: 1024px, xl: 1280px). Use Tailwind's responsive prefixes for layout:

```html
<!-- Tailwind for responsive layout -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[var(--space-4)]">
  ...
</div>
```

Or `@media` in styled-components for responsive visual changes:

```tsx
const PipelineGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }

  @media (min-width: 1024px) {
    grid-template-columns: repeat(4, 1fr);
  }
`
```

---

## Route structure

TanStack Start uses file-based routing under `src/routes/`:

```
src/routes/
├── __root.tsx              # Root layout: nav, page wrapper
├── index.tsx               # / — Pipeline dashboard
├── companies/
│   ├── index.tsx           # /companies — list with filters
│   └── $slug.tsx           # /companies/$slug — detail
└── tasks/
    └── index.tsx           # /tasks — next steps
```

### Server functions (data fetching)

Use TanStack Start server functions to call the backend — never call the API from the browser directly:

```tsx
// src/routes/companies/index.tsx
import { createServerFn } from "@tanstack/react-start"

const fetchCompanies = createServerFn({ method: "GET" })
  .validator(CompanyFiltersSchema)
  .handler(async ({ data }) => {
    const res = await fetch(`${process.env.SERVER_URL}/companies?${toQueryString(data)}`)
    return res.json()
  })
```

### Typed API client

```typescript
// src/lib/api.ts
// Derived from @engranatge/controllers — see TODO_FRONTEND Phase 6
// HttpApiClient.make(EngranatgeApi) gives a fully typed client
// Used only inside server functions
```

---

## Code quality — Biome

All `.tsx` and `.ts` files are covered by the root `biome.json`. Run `pnpm check` before committing.

---

## Styling conventions — styled-components + Tailwind

**styled-components** is the primary styling tool — all visual styles (colors, typography, spacing, shape, elevation) use MD3 tokens via `var()`. **Tailwind** is used for structural layout only (flex, grid, positioning, responsive breakpoints).

### When to use what

| Scenario                                                          | Use                                        |
| ----------------------------------------------------------------- | ------------------------------------------ |
| Visual properties (colors, typography, spacing, borders, shadows) | styled-components with `var(--token)`      |
| Data-driven dynamic values (e.g. `--color-status-${status}`)      | styled-components with `$` transient props |
| Layout structure (flex, grid, columns)                            | Tailwind classes                           |
| Responsive layout changes                                         | Tailwind `sm:`, `md:`, `lg:` prefixes      |
| Quick layout one-offs (centering, hiding)                         | Tailwind classes                           |
| Animation targets                                                 | styled-components or Motion `style` prop   |

### Examples

**styled-components for visual styling (default):**

```tsx
import styled from 'styled-components'

const Card = styled.div`
  background: var(--color-surface);
  border-radius: var(--shape-medium);
  padding: var(--space-4);
  box-shadow: var(--elevation-1);
`

const Title = styled.h2`
  font-size: var(--typescale-title-medium-size);
  font-weight: var(--typescale-title-medium-weight);
  color: var(--color-on-surface);
`

function CompanyCard({ company }: { company: Company }) {
  return (
    <Card>
      <Title>{company.name}</Title>
    </Card>
  )
}
```

**Tailwind for layout structure:**

```tsx
// Grid layout via Tailwind, card visuals via styled-components
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)]">
  {companies.map(c => <CompanyCard key={c.id} company={c} />)}
</div>

// Flex layout
<div className="flex items-center justify-between">
  <Title>{name}</Title>
  <StatusBadge $status={status} />
</div>
```

### Rules

1. **Tokens always.** Use `var(--token)` — never hardcode hex, px, or font values.
2. **styled-components for visuals.** Colors, typography, spacing, borders, shadows — all via styled-components with tokens.
3. **Tailwind for layout.** Grid, flex, positioning, responsive breakpoints, visibility.
4. **Co-locate styles.** Styled components live in the same `.tsx` file as the React component.
5. **Transient props.** Use `$` prefix for styling-only props in styled-components.
6. **No `!important`.** Fix specificity properly.
7. **SSR.** styled-components handles SSR via `ServerStyleSheet`. Tailwind is static CSS — no SSR concern.

---

## Pages

### Pipeline dashboard (`/`)

- Status lane counts: prospect, contacted, responded, meeting, proposal, client
- "Overdue" section: tasks past due + companies with `next_action_at` in the past
- "This week" section: tasks due within 7 days
- Top 5 priority companies without a scheduled next action
- Mobile: stacked cards. Desktop: 2-column grid.

### Company list (`/companies`)

- Filter bar: status, region, industry, priority, product_fit (pills, multi-select)
- Search input (name)
- Company cards: name, location, status chip, industry, last contacted date, priority dot
- Sorted by priority ASC, then last_contacted_at DESC

### Company detail (`/companies/$slug`)

- Header: name, status chip, priority, location, website/linkedin/instagram links
- Tabs: Profile | Interactions | Documents | Tasks | Proposals
- **Profile tab:** all fields, contacts list, edit inline
- **Interactions tab:** timeline, newest first, log new button
- **Documents tab:** list by type (research, prenotes, postnotes), open in read/edit view
- **Tasks tab:** open tasks sorted by due date, completed tasks collapsed
- **Proposals tab:** proposal list with status

### Tasks (`/tasks`)

- Today + overdue (urgent section, highlighted)
- Next 7 days grouped by day
- Each task: company name, task type icon, title, due date
- Tap to mark complete (optimistic update)
