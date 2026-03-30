# Frontend

TanStack Start SSR app deployed to Cloudflare Pages. Mobile-first.
For system context see [architecture.md](architecture.md).

---

## Stack

- **TanStack Start** — SSR framework (file-based routing, server functions)
- **TanStack Router** — type-safe client routing
- **BaseUI** — headless, accessible components (no built-in styles)
- **CSS custom properties** — MD3 design tokens, no CSS-in-JS

---

## TypeScript config

`apps/web/tsconfig.json` extends `../../tsconfig.base.json` and adds:
- `"lib": ["ES2022", "DOM", "DOM.Iterable"]` — browser globals
- `"jsx": "react-jsx"` — React 19 automatic transform, no `import React` needed per file

React 19 versions: `react@^19`, `react-dom@^19`, `@types/react@^19`, `@types/react-dom@^19`.
The `@types/react@19` package aligns with the React 19 runtime API (new hooks, `ref` as prop, etc.).

Same `moduleResolution: bundler` as the server — no `.js` in imports, `import type` for type-only.

---

## Token system

All spacing, typography, and color values come from CSS custom properties defined in
`src/styles/tokens.css`. Never hardcode these values.

### Typography — MD3 type scale

```css
/* src/styles/tokens.css */

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

### Typography utility classes

```css
/* src/styles/tokens.css — continued */

.typescale-display-large {
  font-size: var(--typescale-display-large-size);
  line-height: var(--typescale-display-large-line);
  font-weight: var(--typescale-display-large-weight);
  letter-spacing: var(--typescale-display-large-tracking, 0);
}
/* ... repeat for all roles */

/* Usage:
   <h1 class="typescale-headline-large">Pipeline</h1>
   <p class="typescale-body-medium">14 prospects this week</p>
   <span class="typescale-label-small">3 days ago</span>
*/
```

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
/* src/styles/tokens.css — continued */

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

## BaseUI components

BaseUI provides headless, accessible components. You style them entirely with CSS.

### Installation

```bash
pnpm --filter web add @base-ui-components/react
```

### Usage pattern

Import the component, add a className or CSS selector, style with tokens:

```tsx
import * as Button from '@base-ui-components/react/button'

// Component
<Button.Root className="btn btn-filled">
  Log interaction
</Button.Root>
```

```css
/* Style using tokens */
.btn {
  font-size: var(--typescale-label-large-size);
  font-weight: var(--typescale-label-large-weight);
  padding: var(--space-2) var(--space-6);
  border-radius: var(--shape-full);
  cursor: pointer;
  border: none;
}

.btn-filled {
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.btn-filled:hover {
  filter: brightness(0.92);
}
```

### Components used in this project

| BaseUI component | Used for |
|-----------------|---------|
| `Button` | All interactive buttons |
| `Input` | Text inputs in forms |
| `Select` | Status, region, industry dropdowns |
| `Dialog` | Interaction log modal, company quick-edit |
| `Tabs` | Company detail (Profile / Interactions / Documents / Tasks) |
| `Menu` | Action menus on company cards |
| `Checkbox` | Task completion |
| `Tooltip` | Short field explanations |
| `Collapsible` | Expandable sections on company detail |

---

## Breakpoints

Mobile-first. Write base styles for small screens, expand upward:

```css
/* tokens.css */
--bp-sm:  640px;
--bp-md:  768px;
--bp-lg:  1024px;
--bp-xl:  1280px;

/* Usage */
.pipeline-grid {
  display: grid;
  grid-template-columns: 1fr;               /* mobile: single column */
  gap: var(--space-4);
}

@media (min-width: 768px) {
  .pipeline-grid {
    grid-template-columns: repeat(2, 1fr);  /* tablet: 2 columns */
  }
}

@media (min-width: 1024px) {
  .pipeline-grid {
    grid-template-columns: repeat(4, 1fr);  /* desktop: 4 columns */
  }
}
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
import { createServerFn } from "@tanstack/start"

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
// Thin typed wrapper around fetch → apps/server
// All functions are async, throw on non-2xx
// Used only inside server functions
```

---

## Code quality — Biome

All `.tsx` and `.ts` files are covered by the root `biome.json`. Run `pnpm check` before committing.
Biome does not lint `.css` files — follow the CSS conventions below manually.

---

## CSS conventions

1. **Tokens always.** If you write a color hex, spacing px, or font-size value directly — use a token instead.
2. **No inline styles** unless dynamically computed (e.g. progress bar width).
3. **BEM-lite naming:** `.component`, `.component__element`, `.component--modifier`.
4. **Co-locate styles.** Each component has its own `.css` file imported in the `.tsx`.
5. **No `!important`.** Fix specificity properly.

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
