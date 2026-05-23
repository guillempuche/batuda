# Frontend

TanStack Start SSR app for the Batuda web app — the multi-tenant SaaS CRM. Deployed to Cloudflare Workers. Mobile-first.
For system context see [architecture.md](architecture.md).

Deployed at `batuda.co`. Tenant marketing sites live in their own repos (e.g. the Engranatge tenant uses `engranatge-marketing`).

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
- `nitro()` from `nitro/vite` — server framework underlying TanStack Start. Dev-only `/auth/*` and `/v1/*` HTTPS proxy rules live in `nitro({ routeRules })` (NOT Vite's `server.proxy`; Nitro's pre-middleware short-circuits document requests before Vite's proxy runs).
- `tailwindcss()` from `@tailwindcss/vite` — Tailwind v4 Vite plugin
- `viteReact()` with `@swc/plugin-styled-components` (stable `componentId` for SSR ↔ CSR matching) and `@lingui/swc-plugin` (compiles macros)
- `lingui()` plugin for catalog handling

`@batuda/ui` workspace dual export — load-bearing for hydration:

```jsonc
// packages/ui/package.json (exports)
"development": "./src/...",   // workspace consumers
"import":      "./dist/..."   // npm consumers
```

`'development'` must appear in BOTH `resolve.conditions` and
`ssr.resolve.conditions` so SSR and client load the same build. Otherwise
`noExternal: ['@batuda/ui']` re-runs the SWC styled-components plugin on
`dist/` for SSR (adding componentIds), while the client loads `dist/`
as-is (no IDs). Mismatched classnames → React 19 bails hydration and
`onClick` handlers silently never attach. See the comment block at
`apps/internal/vite.config.ts:120-138`.

Deployed to Cloudflare Workers via `@cloudflare/vite-plugin` + `wrangler` (config in `apps/internal/wrangler.jsonc`, Worker entry in `src/worker.ts`). Build output in `dist/`.

---

## Token system

**Note:** Tokens are defined in `packages/ui/src/tokens.css` and imported by `apps/internal` via the workspace link; tenant marketing repos consume the same tokens via the published `@batuda/ui` npm package. The values below document the full token set.

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
@import '@batuda/ui/tailwind.css';
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

### Color tokens — Mediterranean industrial

Brand palette + WCAG rationale live in
[`docs/brand-visual.md`](brand-visual.md); canonical values in
`packages/ui/src/tokens.css`. The summary below is a pointer, not a duplicate.

- **Primary** — terracotta (`--color-primary: #B05220`); `--color-on-primary` is white.
- **Secondary** — olive green (`--color-secondary: #2E6B4F`); `--color-on-secondary` is white.
- **Surface system** — warm cream, not cool grey. `--color-surface` is `#F5F0E8`; the full ramp goes through `--color-surface-dim/container-low/container/container-high/container-highest`.
- **On-surface** — warm graphite `--color-on-surface: #2D2A24`, with `--color-on-surface-variant` for secondary text.
- **Outline** — `--color-outline` for visible borders, `--color-outline-variant` for subtle dividers.
- **No tertiary, no fixed accents.** Two-accent system by design (terracotta + olive).
- **No dark mode** at this writing — light only.

The workshop visual language layers a second palette on top — metal, paper,
ledger lines — covered in the §Workshop tokens section below.

### Fluid spacing scale — semantic names

T-shirt names so the scale reads independently of pixel size. The earlier
numeric `--space-1/2/4` convention is gone. Canonical values in
`packages/ui/src/tokens.css`.

`--space-3xs` · `--space-2xs` · `--space-xs` · `--space-sm` · `--space-md` ·
`--space-lg` · `--space-xl` · `--space-2xl` · `--space-3xl` · `--space-4xl` ·
`--space-5xl`. All `clamp()`-based, fluid between 320px and 1280px viewports.

### Shape tokens

T-shirt names. Canonical values in `packages/ui/src/tokens.css`.

`--shape-2xs` (0.25rem) · `--shape-xs` (0.5rem) · `--shape-sm` (0.75rem) ·
`--shape-md` (1rem) · `--shape-lg` (1.75rem) · `--shape-full` (999px).

### Workshop visual language

The brand layers a workshop aesthetic on top of the base tokens —
brushed-metal plates, aged-paper surfaces, masking-tape strips, stenciled
labels. The system and rationale live in
[`docs/brand-visual.md`](brand-visual.md) §Workshop Visual Language.

Reusable CSS fragments are exposed as `styled-components` `css` mixins from
`apps/internal/src/lib/workshop-mixins.ts`:

| Mixin               | Used for                                                              |
| ------------------- | --------------------------------------------------------------------- |
| `agedPaperSurface`  | Card / dialog / empty-state surfaces — cream paper with fibre flecks. |
| `agedPaperRow`      | List rows (tasks, timeline) — lighter paper variant.                  |
| `ruledLedgerRow`    | Ledger-style list rows with thin bottom rule and 5n emphasis.         |
| `brushedMetalPlate` | Plate-style cards — 145deg metal gradient + noise overlay.            |
| `brushedMetalBezel` | Icon bezels — rounded metal frame for embedded icons.                 |
| `stenciledTitle`    | Display-font uppercase titles with embossed text-shadow.              |
| `rulerUnderRule`    | Dashed under-rule on page-intro headings.                             |
| `maskingTapeCorner` | Decorative beige tape strip at the corner of a paper surface.         |

Workshop tokens (metal palette, paper colours, elevation-workshop shadows,
brushed-metal texture) live in `packages/ui/src/tokens.css` §Workshop. Use
them via `var(--color-metal-*)`, `var(--color-paper-*)`, etc. — never
hardcode metal greys.

### Elevation tokens

Two ramps — MD3 tonal (`--elevation-0/1/2/3`) for generic surfaces, and
workshop-specific (`--elevation-workshop-sm/md/lg`) for the brushed-metal
plates and bezels. Canonical values in `packages/ui/src/tokens.css`.

---

## Component naming convention

### Primitives — `Pri` prefix

The `Pri` prefix marks primitive components. Two locations:

- **`packages/ui/src/pri/`** — library primitives shared across apps (and
  published to npm as `@batuda/ui/pri` for tenant marketing sites). Each
  wraps a BaseUI headless component with Batuda's workshop styling.
- **`apps/internal/src/components/primitives/`** — app-local primitives
  that compose library primitives or BaseUI directly, but stay too
  internal to publish. Example: `PriPasswordInput` (eye-toggle wrapper
  around `PriInput`).

Library primitives at the time of writing: `PriAvatar`, `PriButton`,
`PriCheckbox`, `PriCollapsible`, `PriContextMenu`, `PriDialog`, `PriField`,
`PriInput`, `PriNumberField`, `PriPopover`, `PriPreviewCard`,
`PriScrollArea`, `PriSelect`, `PriTabs`, `PriTextarea`, `PriToast`,
`PriToggleGroup`, `PriToolbar`, `PriTooltip`.

App-local primitives at the time of writing: `PriPasswordInput`, `PriTable`.

#### `PriPasswordInput` — uncontrolled only

Use this primitive as **uncontrolled**: omit `value=` / `onChange=` and
read the typed value via `new FormData(event.currentTarget).get('fieldName')`
in the submit handler (same pattern as `/login`).

Controlled `value` + React `onChange` silently drops Playwright `fill()`
updates because BaseUI's `FieldControl` owns `onChange` and exposes
`onValueChange` instead; the eye-toggle wrapper compounds the mismatch.
The caveat is specific to `PriPasswordInput` — `PriInput` used directly
(e.g. the `/emails` search input) works fine when controlled.

### Composed — domain names

Components that compose primitives or implement domain-specific UI use
descriptive names without a prefix. They live in
`apps/internal/src/components/<domain>/` (e.g. `companies/company-card.tsx`,
`profile/set-password-nudge.tsx`).

### Lingui macros — every user-facing string

Every visible string in `apps/internal` is wrapped in a Lingui macro:

- **JSX text**: `<Trans>Sign in</Trans>` (`@lingui/react/macro`)
- **Template strings inside hooks / handlers**: `` t`Saving…` `` from
  `useLingui()` (`@lingui/react/macro`)
- **Module-scope descriptors** (e.g. error-code → message tables):
  `` msg`Email or password is incorrect.` `` (`@lingui/core/macro`), then
  resolve in-component via `t(MESSAGES[code])`.

Run `pnpm i18n:extract` (in `apps/internal/`) after each batch of changes;
it updates the `.po` catalogs in `src/locales/{en,ca}/`. Catalan
translations must be filled in before merge (i18n-check pre-commit hook
will block on missing strings).

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
  Batuda
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
// Derived from @batuda/controllers — see TODO_FRONTEND Phase 6
// HttpApiClient.make(BatudaApi) gives a fully typed client
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
