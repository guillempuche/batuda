# Frontend

TanStack Start SSR app for the Batuda web app — the multi-tenant SaaS CRM. Deployed to Cloudflare Workers. Mobile-first.
For system context see [architecture.md](architecture.md).

Deployed at `batuda.co`. Tenant marketing sites live in their own repos (e.g. the Engranatge tenant uses `engranatge-marketing`).

---

## Stack

- **TanStack Start** — SSR framework (file-based routing, server functions)
- **TanStack Router** — type-safe client routing
- **Tailwind CSS v4** — in the build pipeline for its `@theme` breakpoint declarations; utility classes are not used in app code
- **styled-components** — CSS-in-JS, the styling tool for both visuals and layout (transient props, runtime interpolation)
- **BaseUI** — headless, accessible components (styled with styled-components)
- **Motion + Motion Plus** — animations (`motion/react` for layout/transitions, `motion-plus/react` for premium components)
- **react-leaflet + Leaflet** — interactive map showing a company's location
- **Tiptap** — rich text editor for instruction templates, pages, and the email composer

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
- `cloudflare()` from `@cloudflare/vite-plugin` — builds and serves the app on Workers. Dev-only `/auth/*`, `/v1/*`, `/openapi.json` and `/docs` proxy rules live in Vite's `server.proxy`, mirroring the forwarding that `src/worker.ts` performs in production so dev parity holds.
- `tailwindcss()` from `@tailwindcss/vite` — Tailwind v4 Vite plugin
- `viteReact()` with `@swc/plugin-styled-components` (stable `componentId` for SSR ↔ CSR matching) and `@lingui/swc-plugin` (compiles macros)
- `lingui()` plugin for catalog handling

`@batuda/ui` workspace dual export — load-bearing for hydration:

```jsonc
// packages/ui/package.json (exports)
"development": "./src/...",   // workspace consumers
"import":      "./dist/..."   // npm consumers
```

The **stylesheets are exempt** — `./tokens.css` and `./tailwind.css` point at
`./src/*.css` for everyone. They used to be copied into `dist/` and served from
there, which meant editing the source changed nothing until the package was
rebuilt: a stale copy silently beat the real file. The copies were byte-identical,
so they bought nothing. Tailwind's `@import` resolver does not consult
`resolve.conditions` either, so a condition-based split would not have helped.

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
`packages/ui/src/tokens.css`. Never hardcode values — use `var(--token)` in styled-components.

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

Tailwind v4 is in the build pipeline, but **no app code uses Tailwind utility classes** — `className` appears twice in the whole of `apps/internal/src` and `packages/ui/src`, once to forward a class so `styled()` can target a primitive and once for `sr-only`. What it is there for is the `@theme` block below, which declares the canonical breakpoints that `tokens.css` refers to. Styling is done with styled-components (see [Styling conventions](#styling-conventions--styled-components)).

```css
/* packages/ui/src/tailwind.css */
@import "tailwindcss";
@import "./tokens.css";

@theme {
  /* Only breakpoints — everything else uses the token system directly */
  --breakpoint-md: 768px;
  --breakpoint-lg: 1024px;
}
```

Each app imports this file as its CSS entry point:

```css
/* apps/internal/src/styles.css */
@import '@batuda/ui/tailwind.css';
```

Adding Tailwind utility classes to a component would make that file the only one of its kind in the codebase, so reach for styled-components instead.

### Color tokens — Mediterranean industrial

Brand palette + WCAG rationale live in
[`docs/brand-visual.md`](brand-visual.md); canonical values in
`packages/ui/src/tokens.css`. The summary below is a pointer, not a duplicate.

- **Primary** — terracotta (`--color-primary: #95400F`); `--color-on-primary` is white.
- **Secondary** — olive green (`--color-secondary: #2E6B4F`); `--color-on-secondary` is white.
- **Surface system** — warm cream, not cool grey. `--color-surface` is `#F5F0E8`; the full ramp goes through `--color-surface-dim/container-low/container/container-high/container-highest`.
- **On-surface** — warm graphite `--color-on-surface: #2D2A24`, with `--color-on-surface-variant` for secondary text.
- **Outline** — `--color-outline` for visible borders, `--color-outline-variant` for subtle dividers.
- **No tertiary, no fixed accents.** Two-accent system by design (terracotta + olive).
- **Three themes** — light, `dark`, and `dark-hc` (high contrast). See §Theming below.

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

## Theming

Three themes: light (the bare `:root` block), `dark`, and `dark-hc` (high contrast). The palettes and their WCAG tables live in [`docs/brand-visual.md`](brand-visual.md) §Dark Workshop; canonical values in `packages/ui/src/tokens.css`.

### The attribute is the single source of truth

The active theme is a `data-theme` attribute on `<html>`. CSS never reads `prefers-color-scheme` directly — the media query only feeds the initial resolution in JS. Reading it in both places is how a theme system ends up disagreeing with itself, with CSS following the device while JS follows an explicit choice.

```
:root                        → light (also the fallback when the attribute is absent)
:root[data-theme='dark']     ┐ shared dark structure
:root[data-theme='dark-hc']  ┘
:root[data-theme='dark-hc']  → high-contrast palette + flattening, later so it wins
```

**It must be on `<html>`, not on a wrapper.** Every Base UI popup — dialog, popover, menu, tooltip, preview card, combobox, navigation menu — portals into `document.body`, and its `Portal` part is mandatory (the positioner throws without it). A `data-theme` on a wrapper inside the app root would leave every one of those resolving custom properties against `:root`, so popups would silently stay light. `<html>` is the only ancestor enclosing both the app root and `document.body`.

### Preference versus resolved theme

These are different values and conflating them is a real bug:

- The **preference** is `light | dark | dark-hc | system`, stored in the `batuda.theme` cookie and mirrored to localStorage.
- The **attribute** always holds a resolved theme and never `system`.

If the pre-paint script wrote its resolved value back into the preference cookie, a reader following the system would be silently converted to a fixed choice with no way back. The cookie stores only what was explicitly chosen.

Resolution order, mirroring the `lang` flow in `__root.tsx`:

1. `beforeLoad` reads the cookie — SSR from the request header, client from `document.cookie`.
2. A concrete preference renders straight into `<html data-theme>`. No script, no flash.
3. `system` or no cookie renders `light` and emits a `ScriptOnce` that corrects the attribute from `matchMedia` while the page is still parsing. `<html>` carries `suppressHydrationWarning` because that script mutates it before React hydrates.
4. `ThemeProvider` reconciles against localStorage on mount, and — for `system` only — listens for OS changes so the page keeps up live.

`theme-color` is emitted from the resolved theme rather than a media query, so an explicit choice also tints the mobile browser chrome. `color-scheme` does not do this.

### High contrast is a distinct theme

`dark-hc` inherits dark's structure, then removes what is contrast *noise* rather than depth: `--texture-brushed-metal` goes `none`, gradients flatten, the amber `--glow-active` halo becomes a solid ring, the emboss/engrave text shadows and inset highlights go off, and every divider is held visible. Text targets AAA rather than AA.

OS forced-colors mode is a separate, independent axis. Base UI has no handling for it, and in that mode the user agent overrides author colours regardless of theme — `dark-hc` neither implements nor substitutes for it.

### Surfaces the palette cannot reach

Three things need explicit handling because the colour is not ours:

- **Map tiles** are images of a light map from a third party. The tile layer is inverted and hue-corrected in dark themes, and Leaflet's own popups and controls are restyled from tokens.
- **Sender-authored email HTML** keeps its own white sheet in every theme. Recolouring arbitrary markup would wreck logos and quoted screenshots, so the message reads as a printout.
- **The calendar's event palette** carries its own light/dark pairs and is deliberately left alone — forcing brand tokens on it would flatten the category distinctions it exists to draw.

### Checking contrast

`pnpm --filter @batuda/ui check-contrast` reads `tokens.css` and fails if any text pairing drops below its target. It runs on pre-push. The tables in brand-visual.md had already drifted from the code once — this makes them a check rather than a claim.

---

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
`PriInput`, `PriMenu`, `PriNumberField`, `PriPopover`, `PriPreviewCard`,
`PriScrollArea`, `PriSelect`, `PriSwitch`, `PriTabs`, `PriTextarea`,
`PriToast`, `PriToggle`, `PriToggleGroup`, `PriToolbar`, `PriTooltip`.

App-local primitives at the time of writing: `PriCombobox`, `PriCopyButton`,
`PriPasswordInput`, `PriRichText`, `PriTable`.

**Styling a router `Link`.** `styled(Link)` keeps the styling but drops
TanStack Router's typing of `to`, `params` and `search`, so a wrong destination
becomes a dead click instead of a compile error. Style a wrapper and put a bare
`<Link>` inside it — stretched over the box with `position: absolute; inset: 0`
when the whole row should navigate. `company-card.tsx` and the pipeline's status
chips both do this.

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

BaseUI provides headless, accessible components. Style them with styled-components using MD3 tokens — layout included, the same as anywhere else.

### Usage pattern

```tsx
// packages/ui/src/pri/pri-button.tsx
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

const PriButton = styled(Button)<{ $variant?: keyof typeof variants }>`
  font-size: var(--typescale-label-large-size);
  font-weight: var(--typescale-label-large-weight);
  padding: var(--space-2xs) var(--space-md);
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
  padding: var(--space-3xs) var(--space-xs);
  font-size: var(--typescale-label-small-size);
`

<StatusBadge $status={company.status}>{company.status}</StatusBadge>
```

### Primitives in this project

| Primitive        | BaseUI base   | Used for                                                   |
| ---------------- | ------------- | ---------------------------------------------------------- |
| `PriButton`      | `Button`      | All interactive buttons                                    |
| `PriInput`       | `Input`       | Text inputs in forms                                       |
| `PriField`       | `Field`       | Labelled fields with their validation text                 |
| `PriSelect`      | `Select`      | Status and size dropdowns                                  |
| `PriDialog`      | `Dialog`      | Interaction log modal, company quick-edit                  |
| `PriTabs`        | `Tabs`        | Company detail (Overview / Conversations / People / Files) |
| `PriMenu`        | `Menu`        | Action menus on company cards                              |
| `PriCheckbox`    | `Checkbox`    | Task completion — a choice submitted with a form           |
| `PriSwitch`      | `Switch`      | A setting that takes effect the moment it is flicked       |
| `PriTooltip`     | `Tooltip`     | Short field explanations                                   |
| `PriCollapsible` | `Collapsible` | Expandable sections on company detail                      |

`PriField` is where a validation message belongs. It ties the label, the control and `PriField.Error` together, so what the server said is announced with the input rather than floating beside it, and the label is visible as well as spoken — three unlabelled boxes in a row say nothing about which is the address. Reach for it instead of an `aria-label`ed bare `PriInput` and a hand-rolled error paragraph. A message the server sent rather than the browser needs `match={true}` on the error, which is what tells Base UI to show it.

A folded `PriCollapsible` panel keeps its text on the page rather than dropping it, so the browser's own find-in-page reaches it and opens the section on a match. That is `hiddenUntilFound`, defaulted on in the wrapper — pass `hiddenUntilFound={false}` where content should not linger while folded, as the company timeline does because it holds a status line read aloud by screen readers. It relies on Tailwind's reset scoping `display: none` to `[hidden]:where(:not([hidden='until-found']))`; without that carve-out a folded section would be permanently invisible rather than merely unfindable.

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
  border-radius: var(--shape-md);
  padding: var(--space-sm);
  box-shadow: var(--elevation-1);
`

// Layout animation on a card
<AnimatedCard layout>
  <h2>{company.name}</h2>
</AnimatedCard>

// Enter/exit transitions
const Panel = styled(motion.div)`
  background: var(--color-surface-container);
  border-radius: var(--shape-lg);
  padding: var(--space-md);
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
  border-radius: var(--shape-md);
  padding: var(--space-sm);
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

[Tiptap](https://github.com/ueberdosis/tiptap) backs the app's rich text surfaces. Each one stores a different shape — markdown, ProseMirror JSON, HTML — so the storage format is the first thing to settle when adding another.

### Installation

Scaffolded via `apps/internal/package.json`:

- `@tiptap/react` — React integration
- `@tiptap/core` — editor core
- `@tiptap/starter-kit` — bold, italic, headings, lists, code blocks, etc.
- `@tiptap/markdown` — markdown in and out, for editors that store markdown text
- `@tiptap/pm` — ProseMirror core (peer dep)

### Where used

| Surface                               | Stores           | Editor                                       |
| ------------------------------------- | ---------------- | -------------------------------------------- |
| Instruction templates (`PriRichText`) | markdown string  | `components/primitives/pri-rich-text.tsx`    |
| Pages block editor                    | ProseMirror JSON | `routes/pages/$id.tsx` (`getJSON()`)         |
| Email composer                        | HTML             | `packages/email/src/editor/email-editor.tsx` |

The documents dialog is **not** one of them — it edits its body in a `PriTextarea` (`components/companies/documents-panel.tsx`).

### Usage pattern

`PriRichText` is the one to copy for a new markdown field. It round-trips a plain markdown **string** rather than HTML: `contentType: 'markdown'` reads the initial `content` as markdown, and `editor.getMarkdown()` returns it.

```tsx
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

const editor = useEditor({
  extensions: [StarterKit, Markdown],
  content: defaultValue,
  contentType: 'markdown',
  // apps/internal server-renders; deferring the first paint avoids a hydration
  // mismatch on the contenteditable. Leaving it out throws on load.
  immediatelyRender: false,
  onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
})
```

Keep the field **uncontrolled** and read it from `FormData` on submit, mirroring `PriPasswordInput` — `PriRichText` mirrors its markdown into a hidden input for exactly that. A controlled `value` + `onChange` drops programmatic fills, so Playwright `fill()` silently does nothing.

### Styling

Tiptap renders standard HTML elements inside `.tiptap`. Style them from a styled wrapper around `EditorContent`, the way `PriRichText` does — there is no `createGlobalStyle` anywhere in the app, and a global rule would leak across every editor on the page.

```tsx
const Content = styled.div`
  .tiptap {
    min-height: 14rem;
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--typescale-body-large-size);
    color: var(--color-on-surface);
    outline: none;
  }

  .tiptap h1 { font-size: var(--typescale-title-large-size); }
  .tiptap h2 { font-size: var(--typescale-title-medium-size); }
`
```

For read-only display, render the stored markdown through `MarkdownView` (`components/markdown/markdown-view.tsx`, backed by Streamdown) rather than mounting an editor.

---

## Map — react-leaflet + Leaflet

A company's saved coordinates are shown on a small map in the Where panel, using [react-leaflet](https://react-leaflet.js.org/) over [Leaflet](https://leafletjs.com/). Tiles are raster images from OpenStreetMap; there is no vector renderer, no tile key, and no clustering — one marker per company detail page.

Installed via `apps/internal/package.json`: `react-leaflet`, `leaflet`, `@types/leaflet`.

### Usage pattern

`apps/internal/src/components/companies/where-panel-client.client.tsx` holds the whole map. It is a `.client.tsx` module because Leaflet needs `window`, so it never runs during SSR.

Two things are worth knowing before editing it:

- **Marker images come from a CDN.** Leaflet ships its default icons through CSS `url()` that Vite cannot resolve without extra plumbing, so `icon({ iconUrl: … })` points at the unpkg-hosted assets instead.
- **Leaflet brings its own stylesheet** (`leaflet/dist/leaflet.css`), which styles popups, zoom buttons and the attribution line in its own light palette. Those are overridden from tokens in the map frame — see §Theming for why the tiles themselves are filtered rather than restyled.

Attribution to OpenStreetMap contributors is required and is rendered by the `TileLayer`.

## Breakpoints

Mobile-first. The canonical breakpoints are declared once in `@theme` (md: 768px, lg: 1024px) and referenced from `tokens.css`. Use `@media` in styled-components:

```tsx
const PipelineGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-sm);

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

TanStack Start uses file-based routing under `src/routes/`. The top level, at the time of writing:

```
src/routes/
├── __root.tsx              # Root layout: nav, page wrapper
├── index.tsx               # / — Pipeline dashboard
├── login.tsx               # plus forgot-password / reset-password
├── calendar/               # companies/, documents/, emails/, oauth/,
├── pages/                  # profile/, research/, settings/, tasks/
└── …
```

### Data fetching — `BatudaApiAtom`

Data is read and written **from the browser**, through `BatudaApiAtom` (`src/lib/batuda-api-atom.ts`), an `AtomHttpApi.Service` derived from `@batuda/controllers`. It gives a fully typed client over the same contract the server implements, consumed with `@effect/atom-react`:

```tsx
// src/atoms/instruction-atoms.ts — one atom per endpoint
export const instructionTemplatesAtom = BatudaApiAtom.query(
  'instructions',
  'listTemplates',
  {},
)
export const updateTemplateAtom = BatudaApiAtom.mutation(
  'instructions',
  'updateTemplate',
)

// in a component
const result = useAtomValue(instructionTemplatesAtom)
const refresh = useAtomRefresh(instructionTemplatesAtom)
const update = useAtomSet(updateTemplateAtom, { mode: 'promiseExit' })
```

A query resolves to an `AsyncResult` — narrow it with `AsyncResult.isSuccess` / `isFailure`. `useAtomRefresh` keeps serving the **previous** value while the new one is in flight, so a component that must show what was just written should read the mutation's own reply rather than waiting on the refreshed list.

A mutation run with `mode: 'promiseExit'` fails with a cause rather than the error itself, and the client buries the decoded error inside it — so without digging, every failure looks alike and a screen can only say "try again". `taggedFailure(cause, tag)` in `src/lib/tagged-failure.ts` pulls a named one back out, and `badRequestMessage(cause)` gets straight to the sentence the server wrote for the reader.

Auth is the exception: it goes through `authClient` (Better Auth). `createServerFn` is used in exactly one place, `src/lib/server-cookie.ts`, for cookie access during SSR — not for reaching the API.

---

## Code quality — Biome

All `.tsx` and `.ts` files are covered by the root `biome.json`. Run `pnpm check` before committing.

---

## Styling conventions — styled-components

**styled-components** is the styling tool, for visual properties *and* layout alike — colors, typography, spacing, shape and elevation all use MD3 tokens via `var()`, and flex/grid/positioning live in the same styled component. Responsive changes use `@media`. Tailwind is installed but unused in component code (see [Tailwind setup](#tailwind-setup)).

### When to use what

| Scenario                                                          | Use                                        |
| ----------------------------------------------------------------- | ------------------------------------------ |
| Visual properties (colors, typography, spacing, borders, shadows) | styled-components with `var(--token)`      |
| Data-driven dynamic values (e.g. `--color-status-${status}`)      | styled-components with `$` transient props |
| Layout structure (flex, grid, columns)                            | styled-components                          |
| Responsive layout changes                                         | `@media` in styled-components              |
| Animation targets                                                 | styled-components or Motion `style` prop   |

### Examples

**styled-components for visual styling (default):**

```tsx
import styled from 'styled-components'

const Card = styled.div`
  background: var(--color-surface);
  border-radius: var(--shape-md);
  padding: var(--space-sm);
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

**styled-components for layout too:**

```tsx
// Grid layout and card visuals both live in styled-components
const CompanyGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-sm);

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
`

const CardHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`
```

### Rules

1. **Tokens always.** Use `var(--token)` — never hardcode hex, px, or font values.
2. **styled-components for visuals.** Colors, typography, spacing, borders, shadows — all via styled-components with tokens.
3. **styled-components for layout.** Grid, flex, positioning and visibility too, with `@media` for responsive changes. Tailwind classes are not used anywhere in app code.
4. **Co-locate styles.** Styled components live in the same `.tsx` file as the React component.
5. **Transient props.** Use `$` prefix for styling-only props in styled-components.
6. **No `!important`.** Fix specificity properly.
7. **SSR.** styled-components handles SSR via `ServerStyleSheet`.

---

## Pages

### Pipeline dashboard (`/`)

Every list on this page is decided by the server, not assembled in the browser. `nextStepsAtom` (`/v1/pipeline/next-steps`) returns the company lists already sorted by urgency and already counted; the task buckets come from the same shelf atoms `/tasks` uses, which take the edges of the reader's own day from the browser because the server cannot know their timezone.

- Four counters and eight status counts, each a link to the list it counted.
- **Needs attention** — overdue tasks, companies past their follow-up date, companies mid-deal gone quiet, and finished research awaiting a decision. A company appears on **exactly one** of these; the rules and their precedence live in `apps/server/src/services/company-attention.ts`, shared with the `attention` filter on `/companies` so a count here opens a list of the same size there.
- **Today** / **This week** — the `today` and `thisWeek` task shelves.
- **High priority** — hot companies with nothing scheduled, minus any already listed above.
- Each section shows the first few rows with the true total beside it and a way through to the rest; each row carries a chip saying why it is there.
- Nothing on the page goes above two columns at any width.

### Company list (`/companies`)

- Filter bar: status (pills), then country, industry, priority, owner and sort (dropdowns)
- Search input (name)
- Company cards: name, location, status chip, industry, last contacted date, priority dot
- Sorted by priority ASC, then last_contacted_at DESC

### Company detail (`/companies/$slug`)

- Header: name, status chip, priority, location, website/linkedin/instagram links
- Tabs: Overview | Conversations | People | Files
- **Overview tab:** all fields, activity timeline, open tasks, upcoming meetings
- **Conversations tab:** emails, calls, meetings and logged interactions in one feed
- **People tab:** the company's contacts; the tab badge counts everyone on file, not the rows fetched
- **Files tab:** documents, offers and landing pages, each loading further rows as you reach the end of them

"Manage channels", on a contact in the People tab, is where a person's ways of being reached are put right: added, corrected in place, removed, and told which of a kind is the main one. Rows edit one at a time and only the row being saved is disabled, so a slow write on one address never freezes the rest. An address the contact already holds is refused rather than merged — the server says so in words, shown beside the box with what was typed still in it — because merging would delete a row nobody named.

How far an address is trusted and whether it bounced are two different facts, shown in two different places. The trust badge says what is expected before sending; the suppression banner and its Clear action say what happened after. Trust can only be lowered by hand — `deliverable` is what a check establishes, so nobody at a keyboard may write it — and a later research check can raise it again.

The controls do two different jobs, which the wording has to keep apart. Risky and undeliverable record doubt about an address. Removing a verdict asserts nothing — it says nobody has checked, which is the honest record for a word that was written down rather than found out. `unknown` is deliberately not offered in the dialog: it records a check that settled nothing, which reads identically to removing one and leaves a reader choosing between two controls that look the same. Removing shows only when there is a verdict to remove. The dialog says only what each does, and does not promise what a send will do about it: which verdicts stop a send is the sending side's rule, it has changed, and copy that enumerated it would go stale here. Nothing in the web app reads a verdict before sending in any case.

Documents also have a screen of their own at `/documents`, and one page each at `/documents/$id`.

### Tasks (`/tasks`)

- Today + overdue (urgent section, highlighted)
- Next 7 days grouped by day
- Each task: company name, task type icon, title, due date
- Tap to mark complete (optimistic update)
