# TODO — Frontend

Ordered implementation checklist for `apps/internal` (Forja) and `apps/marketing` (Engranatge).
See [frontend.md](frontend.md) for internal app patterns. See [marketing.md](marketing.md) for public site.
See [architecture.md](architecture.md) for data flow.

## Design system direction

Two apps, one system.

- **Marketing (Engranatge)** — *the workshop*. Theatrical workshop metaphor (machine buttons, blueprints, pegboards, brushed metal). Storytelling for prospects. Bespoke scene components stay inside `apps/marketing/`.
- **Forja (internal CRM)** — *the workbench*. Data-dense, keyboard-first, compact rows, command palette. No theater. Desktop-first productivity idiom (closer to Linear/Attio/Height than to stock MD3).

**Shared layer (`packages/ui`)**:

- Tokens (`tokens.css`) — colors, typography, spacing, shape, elevation, motion.
- **`Pri*` primitives** — `PriButton`, `PriInput`, `PriSelect`, `PriDialog`, `PriMenu`, `PriTooltip`, `PriTabs`, `PriCheckbox`, `PriRadio`, `PriSwitch`, `PriToast`, `PriCombobox`, `PriPopover`. Headless Base UI wrapped with styled-components. The `Pri` prefix (short for "Primitive") marks them as shared, low-level building blocks — both marketing forms and Forja forms use the same `<PriInput>`.
- Tiptap block schemas (`blocks/`).

**Not shared**: workshop-specific aesthetic tokens (`--texture-brushed-metal`, `--elevation-workshop-*`) and scene components (`MachineButton`, `BlueprintSheet`, `ConveyorBelt`) stay in `apps/marketing/`. Forja gets its own CRM patterns (`DataTable`, `CommandPalette`, `Sidebar`, `KanbanBoard`, `Timeline`).

**MD3 stance**: we keep MD3's *structural* concepts that marketing already uses — color roles, typescale, shape, spacing — but reject MD3's stock components (mobile-first, too airy for a data-dense CRM). Marketing diverges via bespoke scene components; Forja diverges via a desktop-dense, keyboard-first idiom. We do **not** import MD3 concepts the codebase isn't already using (state layers, density scales) — if Forja needs them later, we add them with evidence, not speculation.

---

## Phase 1 — Project setup (TanStack CLI scaffold)

- [ ] Scaffold with TanStack CLI:
  ```bash
  npx @tanstack/cli create web \
    --toolchain biome \
    --no-examples \
    --no-git \
    --no-install \
    --package-manager pnpm \
    --framework React \
    --target-dir apps/internal
  ```
- [ ] Post-scaffold cleanup — remove Cloudflare, devtools, demo files:
  - [ ] Remove from `package.json`: `@cloudflare/vite-plugin`, `wrangler` (if scaffolded)
  - [ ] Remove from `package.json`: `@tanstack/react-devtools`, `@tanstack/devtools-vite`, `@tanstack/react-router-devtools`, `lucide-react`
  - [ ] Remove from `package.json`: `@tailwindcss/typography` (if scaffolded — keep `tailwindcss` and `@tailwindcss/vite`)
  - [ ] Keep in `vite.config.ts`: `tailwindcss()` plugin. Remove `cloudflare()`, `devtools()` + their imports
  - [ ] Delete demo files: `src/components/Header.tsx`, `src/components/Footer.tsx`, `src/components/ThemeToggle.tsx`, `src/routes/about.tsx`
  - [ ] Delete `wrangler.jsonc` if created
  - [ ] Replace `src/styles.css` demo content — `@import '@engranatge/ui/tailwind.css'` + app-level reset
- [ ] Adapt for monorepo:
  - [ ] `package.json`: set name to `@engranatge/internal`, add `@engranatge/domain: "workspace:*"`, `@engranatge/controllers: "workspace:*"`, `@engranatge/ui: "workspace:*"`
  - [ ] `package.json`: add `styled-components`, `@base-ui/react`, `motion`, `motion-plus`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `react-map-gl`, `maplibre-gl`, `supercluster`, `effect`, `@chenglou/pretext`
  - [ ] `package.json`: add devDep `@types/supercluster`
  - [ ] `tsconfig.json`: add `"extends": "../../tsconfig.base.json"`
- [ ] Create `Dockerfile` and `Kraftfile` for Unikraft deployment (see PLAN.md)
- [ ] Clean up `src/routes/__root.tsx` — remove demo Header/Footer/ThemeToggle imports, devtools panel
- [ ] Run `pnpm install` from root, verify `pnpm dev:internal` starts without errors

## Phase 1b — packages/ui

- [ ] Create `packages/ui/package.json` — `@engranatge/ui`, deps: `@tiptap/core`, `@tiptap/pm`, `@base-ui/react`, `styled-components`, peerDeps: `tailwindcss`, `react`, `react-dom`
- [ ] Create `packages/ui/tsconfig.json` extending `../../tsconfig.base.json`
- [ ] Create `packages/ui/src/tokens.css` — MD3 CSS custom properties (shared by both apps)
- [ ] Create `packages/ui/src/tailwind.css` — `@import "tailwindcss"` + `@import "./tokens.css"` + `@theme` with breakpoints only (see frontend.md)
- [ ] Create Tiptap block extensions in `packages/ui/src/blocks/`:
  - [ ] `hero.ts` — heading, subheading, CTA
  - [ ] `cta.ts` — heading, body, buttons
  - [ ] `value-props.ts` — feature grid items
  - [ ] `pain-points.ts` — problem list items
  - [ ] `social-proof.ts` — testimonials
  - [ ] `index.ts` — re-exports all block extensions
- [ ] Create `packages/ui/src/pri/` — shared `Pri*` primitive components (see Phase 5)
  - [ ] `index.ts` — re-exports all primitives
- [ ] Add subpath export `"./pri"` to `packages/ui/package.json` exports map
- [ ] Create `packages/ui/src/index.ts` — re-exports blocks (primitives live under `@engranatge/ui/pri` subpath)

## Phase 2 — Design tokens

- [ ] Create `packages/ui/src/tokens.css` (was `src/styles/tokens.css`)
  - [ ] MD3 typography scale — all 15 roles (display/headline/title/body/label × large/medium/small)
  - [ ] Typography utility classes for each role
  - [ ] MD3 color tokens — light scheme (primary, secondary, tertiary, error, surface, background, outline)
  - [ ] MD3 color tokens — dark scheme (`@media prefers-color-scheme: dark`)
  - [ ] Pipeline status color tokens (prospect, contacted, responded, meeting, proposal, client, closed, dead)
  - [ ] Semantic status aliases over MD3 roles (active → primary, won → secondary, lost → on-surface-variant, pending → tertiary)
  - [ ] Fluid spacing scale (semantic names: 3xs/2xs/xs/sm/md/lg/xl/2xl/3xl/4xl/5xl, all `clamp()`)
  - [ ] Shape tokens (2xs, xs, sm, md, lg, full)
  - [ ] Elevation tokens (0–3)
  - [ ] Breakpoint tokens (--bp-sm, --bp-md, --bp-lg, --bp-xl)
  - [ ] Page layout tokens (--page-gutter, --page-max-width, --card-radius)
- [ ] Keep marketing-only aesthetic tokens **out** of shared `tokens.css` — `--texture-brushed-metal`, `--elevation-workshop-*` live in `apps/marketing/src/styles.css`
- [ ] Create `src/styles/global.css`
  - [ ] Import tokens.css
  - [ ] CSS reset (box-sizing, margin 0, font-family)
  - [ ] Base body styles using color and typography tokens
  - [ ] Scrollbar styles
  - [ ] `font-variant-numeric: tabular-nums` on `.numeric` utility for tables

## Phase 3 — Layout and navigation

- [ ] Create `src/routes/__root.tsx`
  - [ ] Page wrapper with max-width and gutter tokens
  - [ ] Bottom navigation bar (mobile): Pipeline, Companies, Correus, Tasks
  - [ ] Side navigation (desktop, ≥1024px)
  - [ ] Nav items: Pipeline `/`, Companies `/companies`, Correus `/emails`, Tasks `/tasks`
  - [ ] Active route highlight using TanStack Router's `useMatchRoute`

## Phase 4 — Shared components

Each component: styled-components co-located in `.tsx`, all values from CSS custom property tokens.

- [ ] `StatusBadge` — colored pill for company status
  - [ ] Uses `--color-status-*` tokens
  - [ ] `.typescale-label-small` text
- [ ] `PriorityDot` — colored dot (1=hot/red, 2=yellow, 3=grey)
- [ ] `ChannelIcon` — icon for interaction channel (email, phone, visit, linkedin, instagram, whatsapp)
- [ ] `CompanyCard` — name, location, status badge, industry, last contacted, priority dot
  - [ ] Tappable, links to `/companies/$slug`
  - [ ] Elevation token on card surface
- [ ] `TaskItem` — company name, task type, title, due date, checkbox to complete
- [ ] `EmptyState` — icon + message for empty lists
- [ ] `LoadingSpinner` — simple CSS animation
- [ ] `TiptapEditor` — rich text editor wrapper (documents, proposals)
  - [ ] Uses `@tiptap/react` + `StarterKit`
  - [ ] Styled with MD3 typography tokens
  - [ ] Co-located `tiptap-editor.css`
- [ ] `TiptapViewer` — read-only renderer for stored HTML (no editor instance)
- [ ] `CompanyMap` — react-map-gl + MapLibre map view
  - [ ] Lazy-loaded (client-only, no SSR)
  - [ ] Markers styled with `--color-status-*` tokens via styled-components
  - [ ] Clustering via `supercluster`
  - [ ] Click marker → popup with company summary + link to detail
  - [ ] MapTiler free tier for vector tiles (`MAPTILER_KEY` env var)

## Phase 5 — Pri* primitives (Base UI + styled-components, shared in packages/ui)

Primitives live in `packages/ui/src/pri/` and are consumed by **both** Forja and Marketing via the `@engranatge/ui/pri` subpath export. The `Pri` prefix (short for "Primitive") marks them as shared, low-level building blocks — one canonical `<PriInput>` for the whole monorepo.

Naming: always `Pri` + PascalCase component name (`PriButton`, not `PrimitiveButton` or `UiButton`). Filenames: kebab-case (`pri-button.tsx`). Compound primitives mirror Base UI's namespace exactly (e.g. `PriSelect.Root`, `PriSelect.Trigger`, `PriSelect.Popup`).

Each primitive:

- Wraps a headless Base UI primitive with styled-components
- All values from CSS custom property tokens (no hex, no hardcoded px)
- Variants via `$`-prefixed transient props (`$variant`, `$size`)
- No business logic, no data fetching, no i18n — pure visual primitive
- **Neutral defaults only**: structural tokens (shape, focus ring, spacing, typescale, transitions). No theme-specific gradients, textures, or accent colors. Consumers compose styled overrides on top to apply their own visual language (e.g. marketing's metal-skin wrappers).

### Lazy-extraction rule

A primitive is created **only** when at least one real consumer exists in `apps/marketing` or `apps/internal`. No speculative primitives — if Forja later needs a primitive that doesn't exist yet, we extract it then with a real consumer driving the API.

This avoids the trap of building 14 primitives up-front, half of which would never be used or would need rework once a real consumer appears.

### Status

| Primitive        | Status    | First consumer                                             |
| ---------------- | --------- | ---------------------------------------------------------- |
| `PriSelect`      | extracted | `apps/marketing/src/components/layout/language-select.tsx` |
| `PriButton`      | stub      | Forja `FormField`, marketing CTAs (if refactored)          |
| `PriInput`       | stub      | Forja forms                                                |
| `PriDialog`      | stub      | Forja quick-edit modals                                    |
| `PriMenu`        | stub      | Forja row action menus                                     |
| `PriTooltip`     | stub      | Forja keyboard-shortcut hints                              |
| `PriPopover`     | stub      | Forja filter popovers                                      |
| `PriTabs`        | stub      | Forja company detail tabs                                  |
| `PriCheckbox`    | stub      | Forja task completion                                      |
| `PriCombobox`    | stub      | Forja contact autocomplete                                 |
| `PriRadio`       | stub      | Forja form options                                         |
| `PriSwitch`      | stub      | Forja settings toggles                                     |
| `PriToast`       | stub      | Forja success/error notifications                          |
| `PriAlertDialog` | stub      | Forja destructive confirmations                            |

### Consumption

- Marketing's theatrical components (`MachineButton`, `BlueprintSheet`, `ConveyorBelt`) stay bespoke — they're not primitives, they're scene components
- Forja imports everything from `@engranatge/ui/pri` — no local primitives

## Phase 5c — State management (effect-atom + SSR)

`@effect-atom/atom-react` is SSR-compatible with TanStack Start. Key evidence from source:

- **`useSyncExternalStore` with `getServerSnapshot`** — all hooks use React's SSR-safe API, calling `Atom.getServerValue(atom, registry)` for server renders.
- **`Hydration.dehydrate()` / `Hydration.hydrate()`** — serializes atom values on server, restores on client. Handles async atoms via `resultPromise`.
- **`HydrationBoundary`** — React component that hydrates new atoms in render phase (before children mount) and defers existing atoms to `useEffect` (transition-safe).
- **`RegistryProvider`** — creates a fresh `Registry.make()` per render, preventing state leakage between requests.
- **`withServerValue()` / `withServerValueInitial()`** — per-atom server value overrides.

### Integration pattern with TanStack Start

```tsx
// Server: in loader or server function
const registry = Registry.make()
// ... populate atoms ...
const dehydrated = Hydration.dehydrate(registry, { encodeInitialAs: "promise" })

// Client: in root layout
<RegistryProvider>
  <HydrationBoundary state={dehydratedState}>
    <Outlet />
  </HydrationBoundary>
</RegistryProvider>
```

### Setup tasks

- [ ] Add deps: `@effect-atom/atom`, `@effect-atom/atom-react`, `effect`
- [ ] Create `src/lib/registry.ts` — shared registry setup with `scheduleTask` and `defaultIdleTTL`
- [ ] Wrap `__root.tsx` with `RegistryProvider` + `HydrationBoundary`
- [ ] Create `Atom.runtime` instances for Effect service layers (API client, etc.)
- [ ] Use `AtomHttpApi.Tag` or `AtomRpc.Tag` for server communication where applicable

### SSR caveats

- `Atom.searchParam()` — has `typeof window === "undefined"` guard, safe on server
- `Atom.windowFocusSignal` — client-only, do not use in SSR-rendered atoms
- `Atom.kvs()` with `BrowserKeyValueStore` — needs a server-side `KeyValueStore` layer alternative
- `Atom.make()` with `window`/`document` access (e.g. scroll listeners) — use `withServerValue()` to provide a fallback

## Phase 6 — API client (derived from shared controllers)

Client is derived from `@engranatge/controllers` — same `EngranatgeApi` spec the server implements.
No manual endpoint definitions; schemas, types, and error handling are shared.

- [ ] Add dep: `@engranatge/controllers: "workspace:*"`
- [ ] Create `src/lib/api.ts` — derive typed client from `EngranatgeApi`:
  ```ts
  import { HttpApiClient } from '@effect/platform'
  import { EngranatgeApi } from '@engranatge/controllers'

  // Typed client — all endpoints, request/response schemas, and errors derived from spec
  const client = HttpApiClient.make(EngranatgeApi, {
    baseUrl: import.meta.env.SERVER_URL
  })
  ```
- [ ] Create `AtomHttpApi.Tag` integration for effect-atom (query/mutation atoms from spec):
  ```ts
  import { AtomHttpApi } from '@effect-atom/atom-react'
  import { EngranatgeApi } from '@engranatge/controllers'

  class ApiClient extends AtomHttpApi.Tag<ApiClient>()('ApiClient', {
    api: EngranatgeApi,
    httpClient: FetchHttpClient.layer,
    baseUrl: import.meta.env.SERVER_URL
  }) {}
  ```
- [ ] Wire `ApiClient.query` / `ApiClient.mutation` for each entity:
  - [ ] Companies — list, get by slug
  - [ ] Pipeline — counts + overdue
  - [ ] Tasks — list, complete (mutation with reactivity key)
  - [ ] Interactions — log (mutation)
  - [ ] Documents, Proposals — as needed per route

## Phase 7 — Pipeline dashboard (`/`)

- [ ] Server function: fetch pipeline counts + overdue companies + due-soon tasks
- [ ] Status lanes: 6 status chips with counts (prospect → client)
- [ ] Overdue section: companies past `next_action_at` + tasks past `due_at`
- [ ] This week section: tasks due in next 7 days
- [ ] Top priorities: companies with priority=1 and no next action scheduled
- [ ] Mobile layout: stacked sections, full-width cards
- [ ] Desktop layout (≥768px): 2-column grid for status lanes

## Phase 8 — Company list (`/companies`)

- [ ] Server function: fetch companies with filters
- [ ] Filter bar: status (multi), region, industry, priority — pill buttons using tokens
- [ ] Search input (debounced, 300ms)
- [ ] Company card grid: 1 col mobile, 2 col tablet, 3 col desktop
- [ ] Sort: priority ASC, then last_contacted_at DESC
- [ ] Empty state when no results
- [ ] "Add company" button → Dialog with create form (name, slug, region, industry, priority, source)

## Phase 9 — Company detail (`/companies/$slug`)

- [ ] Server function: fetch company + contacts + recent interactions + open tasks + proposals
- [ ] Header: name, status badge, priority dot, location, icon links (website, linkedin, instagram, google maps)
- [ ] Status change control (select in header area)
- [ ] Tabs component: Profile | Interactions | Correus | Documents | Tasks | Proposals

### Profile tab

- [ ] All company fields displayed, edit button opens Dialog
- [ ] Contacts section: card per contact, add contact button

### Interactions tab

- [ ] Timeline: newest first, channel icon, date, summary, outcome chip
- [ ] "Log interaction" button → Dialog
  - [ ] Fields: date (default today), channel, direction, type, summary, outcome, next_action, next_action_at
  - [ ] On submit: POST /interactions + update company next_action + update company last_contacted_at

### Documents tab

- [ ] List by type group: Research, Meeting notes (pre/post), Other
- [ ] Each item: type badge, title (or auto-title), created date
- [ ] Click to open in read view (`TiptapViewer` — renders stored HTML)
- [ ] Edit button → `TiptapEditor` (rich text with StarterKit)
- [ ] "New document" button → type select + `TiptapEditor`

### Tasks tab

- [ ] Open tasks sorted by due date — overdue highlighted
- [ ] Completed tasks collapsible section
- [ ] Add task button → Dialog (type, title, due_at)
- [ ] Checkbox to complete (optimistic update)

### Correus tab

- [ ] Company-scoped thread list (reuses `ThreadListItem`, filtered by companyId)
- [ ] "Nou correu" button pre-fills company + shows `ContactAutocomplete`
- [ ] Tap thread navigates to `/emails/$threadId`

### Proposals tab

- [ ] Proposal list: title, status badge, total value, sent date
- [ ] "New proposal" → form (title, `TiptapEditor` for notes/description, manual line items for now)

## Phase 10 — Tasks page (`/tasks`)

- [ ] Server function: fetch tasks due today + past + next 7 days
- [ ] Overdue section (highlighted with error color token)
- [ ] Today section
- [ ] Day-by-day sections for next 7 days
- [ ] Each task links to company name → `/companies/$slug`
- [ ] Checkbox to complete (optimistic update)

## Phase 10b — Email inbox (`/emails`)

Route structure:

```
src/routes/emails/
├── index.tsx           # /emails — inbox (thread list + thread detail split)
└── $threadId.tsx       # /emails/$threadId — deep-link to thread
```

New components in `src/components/email/`:

| Component             | Purpose                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `SplitPane`           | Responsive layout: list left + detail right (desktop ≥1024px); stacked with back nav (mobile)    |
| `ThreadListItem`      | Row: sender initials, subject, snippet (height measured via Pretext), date, labels, company pill |
| `ThreadDetail`        | Full thread: header + message list + reply box                                                   |
| `MessageBubble`       | Single email: from/to, timestamp, body (HTML rendered), attachments list                         |
| `ComposeDialog`       | PriDialog: To (`ContactAutocomplete`), Subject, Body (`TiptapEditor`), company link              |
| `ReplyBox`            | Inline reply at bottom of thread: `TiptapEditor` + Send button                                   |
| `InboxSelector`       | Dropdown or pill tabs: "guillem@" / "info@" / All — filters threads by inbox                     |
| `EmailFilterBar`      | Filters: company select, label pills, search                                                     |
| `ContactAutocomplete` | BaseUI Combobox wrapped as Pri\* for contact search by name/email                                |
| `EmailEmptyState`     | 3 variants: no emails, no results, no selection (desktop right panel)                            |
| `ThreadSkeleton`      | Loading skeleton for thread list                                                                 |
| `MessageSkeleton`     | Loading skeleton for messages                                                                    |

Desktop layout (≥1024px): split-pane — 360px thread list left, detail fills right.
Mobile (<1024px): thread list full-width; tap navigates to `$threadId` route with back button.

```
DESKTOP:
+----------------------------+--------------------------------------+
| THREAD LIST (360px)        | THREAD DETAIL                        |
|                            |                                      |
| > Restaurant Can Joan      | Subject: Proposta automatització     |
|   Proposta automatització  | hola@engranatge.com → joan@...       |
|   "Hola, us envio..."      | Mar 31, 2026 10:23                   |
|   2h ago      [2 msgs]     | Hola Joan, us envio la proposta...   |
|                            |                                      |
| > Bar El Taller            | joan@canjoan.cat → hola@...          |
|   Seguiment demo           | Mar 31, 2026 14:45                   |
|   "Moltes gràcies..."      | Moltes gràcies! Quan podríem...      |
|   1d ago      [1 msg]      |                                      |
|                            | [Reply — TiptapEditor]  [Send]       |
+----------------------------+--------------------------------------+
```

### Implementation checklist

- [ ] `SplitPane` — responsive split layout, 360px list / fluid detail
- [ ] `ThreadListItem` — sender, subject, snippet (Pretext for height calc), date, message count, company pill
- [ ] `ThreadDetail` — header with subject + participants, scrollable message list, `ReplyBox` pinned to bottom
- [ ] `MessageBubble` — from/to line, timestamp, rendered HTML body (`dangerouslySetInnerHTML` from AgentMail `html` field), attachment list
- [ ] `ComposeDialog` — PriDialog with "From" `InboxSelector` (guillem@ or info@), `ContactAutocomplete` for To, subject input, `TiptapEditor` body, company select, send button
- [ ] `ReplyBox` — inline `TiptapEditor` with send button, uses `POST /api/emails/reply/:threadId/:messageId`
- [ ] `InboxSelector` — PriSelect or pill tabs for inbox switching (guillem@ / info@ / All), fetched from `GET /api/emails/inboxes`
- [ ] `EmailFilterBar` — company PriSelect filter, search PriInput (debounced 300ms), label pills
- [ ] `ContactAutocomplete` — BaseUI Combobox, searches contacts by name/email, returns contact object
- [ ] `EmailEmptyState` — 3 variants: inbox empty, no search results, no thread selected (desktop)
- [ ] `ThreadSkeleton` + `MessageSkeleton` — loading states
- [ ] Server function: fetch threads from `GET /api/emails/threads` (optionally filtered by companyId)
- [ ] Server function: fetch thread detail from `GET /api/emails/threads/:threadId`
- [ ] Server function: fetch inboxes from `GET /api/emails/inboxes`
- [ ] State: `inboxesAtom` (list), `activeInboxAtom` (selected inbox or "all"), `threadsAtom` (list), `activeThreadAtom` (selected ID from route), `threadDetailAtom` (messages)
- [ ] Mutations: send via `POST /api/emails/send`, reply via `POST /api/emails/reply/:threadId/:messageId`
- [ ] Optimistic updates: reply appears immediately in thread, revert on error
- [ ] Route `/emails` — `InboxSelector` at top, thread list with `EmailFilterBar`, desktop shows `SplitPane`
- [ ] Route `/emails/$threadId` — deep-link loads thread detail, mobile shows back button to list

## Phase 11 — Unikraft deployment

- [ ] Run `pnpm --filter internal build` and verify `.output/server/index.mjs` generated
- [ ] Test locally: `node apps/internal/.output/server/index.mjs` on port 3000
- [ ] Run `kraft build` with `apps/internal/Kraftfile` and verify image builds
- [ ] Run `kraft run` locally and verify SSR responds
- [ ] Deploy to Unikraft Cloud with `kraft deploy`
- [ ] Point `forja.engranatge.com` to deployed instance
- [ ] Set `SERVER_URL` env var to `https://api.engranatge.com`
- [ ] Verify production deploy works end-to-end

---

# apps/marketing (Engranatge)

See [marketing.md](marketing.md) for architecture, [brand-proposal.md](brand-proposal.md) for visual identity.

Workshop metaphor: the site IS a mechanical workshop. Each page is a room, the blog is a logbook, case studies are blueprints. All static marketing pages live as route components with hardcoded content — no CMS, no Tiptap (except prospect pages). Marketing copy is Catalan-first.

```
apps/marketing/src/
├── routes/
│   ├── __root.tsx                    # workbench shell — pegboard + blueprint + bench
│   ├── index.tsx                     # homepage — workshop entrance
│   ├── projects/
│   │   ├── index.tsx                 # case study list — blueprint wall
│   │   └── $slug.tsx                 # single case study — blueprint
│   ├── blog/
│   │   ├── index.tsx                 # blog index — logbook shelf
│   │   └── $slug.tsx                 # blog post — logbook entry
│   ├── about.tsx                     # about — workshop tour
│   ├── pricing.tsx                   # pricing — parts catalog
│   └── $lang/
│       └── $slug.tsx                 # prospect pages (Tiptap-driven)
├── components/
│   ├── layout/
│   │   ├── workshop-nav.tsx          # top nav strip with CTA
│   │   ├── workshop-footer.tsx       # footer (mobile only, hidden on desktop)
│   │   ├── workshop-desktop.tsx      # desktop layout: pegboard bg + icon columns + blueprint
│   │   ├── blueprint-sheet.tsx       # content sheet with pushpins + stencil title
│   │   ├── pegboard-icon.tsx         # tool icon with hook (Lucide icons)
│   │   ├── bench-edge.tsx            # bottom strip with indicator lights (desktop)
│   │   ├── drawer-tabs.tsx           # fixed bottom tab bar (mobile)
│   │   └── section.tsx              # reusable page section wrapper
│   ├── workshop/
│   │   ├── conveyor-belt.tsx         # animated problem→solution flow
│   │   ├── control-panel.tsx         # CTA styled as machine interface
│   │   ├── blueprint-card.tsx        # case study card — technical drawing
│   │   ├── logbook-card.tsx          # blog card — journal page style
│   │   ├── before-after.tsx          # manual vs automated comparison
│   │   ├── parts-row.tsx             # pricing line item — catalog style
│   │   ├── indicator-light.tsx       # status dot (green/amber/red)
│   │   └── gear-mascot.tsx           # gear emoji mascot with expressions
│   └── blocks/                       # Tiptap renderers (prospect pages only)
│       ├── block-renderer.tsx        # type → component dispatch
│       ├── hero-block.tsx
│       ├── cta-block.tsx
│       ├── value-props-block.tsx
│       ├── pain-points-block.tsx
│       ├── social-proof-block.tsx
│       └── rich-text-block.tsx
├── data/
│   ├── navigation.ts                 # nav items array
│   └── copy.ts                       # shared marketing copy strings
├── lib/
│   └── api.ts                        # typed fetch for prospect page API
└── styles.css                        # @import tokens + base reset + viewport lock
```

---

## Phase 12 — Project scaffold

- [ ] Scaffold with TanStack CLI:
  ```bash
  npx @tanstack/cli create marketing \
    --toolchain biome \
    --no-examples \
    --no-git \
    --no-install \
    --package-manager pnpm \
    --framework React \
    --target-dir apps/marketing
  ```
- [ ] Post-scaffold cleanup — remove Cloudflare, devtools, demo files:
  - [ ] Remove from `package.json`: `@cloudflare/vite-plugin`, `wrangler` (if scaffolded)
  - [ ] Remove from `package.json`: `@tanstack/react-devtools`, `@tanstack/devtools-vite`, `@tanstack/react-router-devtools`, `lucide-react`
  - [ ] Remove from `package.json`: `@tailwindcss/typography` (if scaffolded — keep `tailwindcss` and `@tailwindcss/vite`)
  - [ ] Keep in `vite.config.ts`: `tailwindcss()` plugin. Remove `cloudflare()`, `devtools()` + their imports
  - [ ] Delete demo files: `src/components/Header.tsx`, `src/components/Footer.tsx`, `src/components/ThemeToggle.tsx`, `src/routes/about.tsx`
  - [ ] Delete `wrangler.jsonc` if created
  - [ ] Replace `src/styles.css` demo content — `@import '@engranatge/ui/tailwind.css'` + app-level reset
- [ ] Adapt for monorepo:
  - [ ] `package.json`: set name to `@engranatge/marketing`
  - [ ] `package.json`: add `@engranatge/ui: "workspace:*"`
  - [ ] `package.json`: add `styled-components`, `motion`, `motion-plus`
  - [ ] `package.json`: add `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm` (for prospect pages)
  - [ ] `tsconfig.json`: add `"extends": "../../tsconfig.base.json"`
- [ ] Create `Dockerfile` and `Kraftfile` for Unikraft deployment
- [ ] Run `pnpm install` from root, verify `pnpm dev:marketing` starts

## Phase 13 — Layout shell (workbench)

Fixed-viewport workbench layout. Desktop: pegboard wall with tools on hooks, blueprint sheet pinned with pushpins, bench edge strip. Mobile: normal scroll with drawer tab bar.

- [x] `src/routes/__root.tsx`:
  - [x] `<html lang="ca">` default
  - [x] Load `styles.css` (viewport lock for desktop)
  - [x] Shell wrapper: flex column, `height: 100dvh` on desktop
  - [x] Desktop: `<WorkshopNav />` + `<WorkshopDesktop>{children}</WorkshopDesktop>` + `<BenchEdge />`
  - [x] Mobile: `<WorkshopFooter />` + `<DrawerTabs />` (footer hidden on desktop, tabs hidden on desktop)
- [x] `src/components/layout/workshop-nav.tsx`:
  - [x] Logo: "Engranatge" wordmark (DM Sans bold) + gear icon
  - [x] Links: Eines, Pressupost
  - [x] "Parlem" CTA button (desktop only, terracotta primary)
  - [x] Mobile: hamburger → slide-in panel
- [x] `src/components/layout/workshop-desktop.tsx`:
  - [x] Pegboard background: `radial-gradient` dot pattern on `surface-dim`
  - [x] Left icon column: Inici, Eines, Preus, Parla (Lucide icons on hooks)
  - [x] Center: `<BlueprintSheet>` wrapping page content
  - [x] Right icon column: Per què?, Projectes, Diari, Nosaltres, Paperera (disabled)
- [x] `src/components/layout/blueprint-sheet.tsx`:
  - [x] CSS pushpins at 4 corners (terracotta circles with shadow)
  - [x] Stencil title derived from route (`INICI · ESQUEMA`, `EINES · CATÀLEG`, etc.)
  - [x] Scrollable content area (desktop only)
  - [x] Sheet styling: `surface-bright` bg, border, shadow (desktop only)
- [x] `src/components/layout/pegboard-icon.tsx`:
  - [x] Hook (CSS inverted-U), icon circle (48px), label
  - [x] Active route highlighting with `primary-container` bg
  - [x] Disabled state at 30% opacity
- [x] `src/components/layout/bench-edge.tsx`:
  - [x] Dark strip with indicator lights + copyright (desktop only)
- [x] `src/components/layout/drawer-tabs.tsx`:
  - [x] Fixed bottom tab bar (mobile only) with Lucide icons
  - [x] Drawer pull indicator, active tab highlighting, safe area padding
- [x] `src/components/layout/workshop-footer.tsx`:
  - [x] Hidden on desktop (BenchEdge replaces it)
  - [x] Bottom padding for drawer tabs on mobile
- [x] `src/components/layout/section.tsx`:
  - [x] Reusable section wrapper with heading + optional subheading
  - [ ] Props: `title`, `subtitle`, `background` (surface level token), `children`
  - [ ] Padding: `var(--space-12)` vertical, responsive
  - [ ] Heading: `typescale-headline-large`

## Phase 14 — Workshop components

Shared visual components that implement the workshop metaphor. Pure presentational — no data fetching.

### ConveyorBelt

The homepage hero animation. Shows a business problem entering one side and a solution exiting the other.

- [ ] `src/components/workshop/conveyor-belt.tsx`:
  - [ ] Horizontal track with CSS dashed border (conveyor belt line)
  - [ ] Items slide left→right via CSS `@keyframes translateX`
  - [ ] Left side: problem label (e.g. "4h factures manuals")
  - [ ] Right side: solution label (e.g. "10 min automatitzat")
  - [ ] Items are small cards with `var(--color-surface-container-low)` bg
  - [ ] Belt track: `var(--color-outline-variant)` dashed border
  - [ ] `prefers-reduced-motion: reduce` → no animation, show static before/after
  - [ ] Mobile: vertical flow (top→bottom) instead of horizontal

### ControlPanel

CTA section styled as a machine control panel. Used at the bottom of pages.

- [ ] `src/components/workshop/control-panel.tsx`:
  - [ ] Props: `heading`, `body`, `actions: { label, href, variant }[]`
  - [ ] Background: `var(--color-surface-container-high)` with `var(--color-outline)` border
  - [ ] Top bar: row of 3 IndicatorLight dots (decorative — red, amber, green)
  - [ ] Heading: `typescale-headline-small`
  - [ ] Body: `typescale-body-large`
  - [ ] Action buttons row: primary (filled) + secondary (outlined)
  - [ ] Primary button: `var(--color-primary)` bg
  - [ ] Secondary button: `var(--color-outline)` border, `var(--color-primary)` text

### BlueprintCard

Case study teaser card. Technical drawing aesthetic.

- [ ] `src/components/workshop/blueprint-card.tsx`:
  - [ ] Props: `title`, `client` (anonymized), `industry`, `result`, `slug`
  - [ ] Background: `var(--color-surface-container-lowest)` — light, paper-like
  - [ ] Border: `1px dashed var(--color-outline)` — technical drawing style
  - [ ] Title: `typescale-title-medium`, monospace or decorative font
  - [ ] Client/industry: `typescale-label-medium`, `var(--color-on-surface-variant)`
  - [ ] Result highlight: `var(--color-secondary)` text, bold metric
  - [ ] Link → `/projects/${slug}`

### LogbookCard

Blog post teaser. Handwritten journal page feel.

- [ ] `src/components/workshop/logbook-card.tsx`:
  - [ ] Props: `title`, `date`, `excerpt`, `slug`
  - [ ] Background: `var(--color-surface-container-lowest)`
  - [ ] Left border: `3px solid var(--color-primary-container)` — page binding
  - [ ] Date: `typescale-label-small`, `var(--color-on-surface-variant)`, decorative font
  - [ ] Title: `typescale-title-medium`
  - [ ] Excerpt: `typescale-body-medium`, 3-line clamp
  - [ ] Link → `/blog/${slug}`

### BeforeAfter

Manual vs automated comparison. Two-column layout.

- [ ] `src/components/workshop/before-after.tsx`:
  - [ ] Props: `items: { manual: string, automated: string }[]`
  - [ ] Two columns: "Sense Engranatge" (without) vs "Amb Engranatge" (with)
  - [ ] Left column: `var(--color-surface-dim)` bg, strikethrough text style
  - [ ] Right column: `var(--color-secondary-container)` bg, bold metrics
  - [ ] Mobile: stacked rows, each row shows both states

### Small utility components

- [ ] `src/components/workshop/indicator-light.tsx`:
  - [ ] Props: `color: 'green' | 'amber' | 'red'`
  - [ ] 8px circle, `border-radius: var(--shape-full)`
  - [ ] Green: `var(--color-secondary)`, Amber: `#C4851C`, Red: `var(--color-error)`
  - [ ] Subtle `box-shadow` glow in same color at 30% opacity

- [ ] `src/components/workshop/parts-row.tsx`:
  - [ ] Props: `name`, `description`, `price`, `unit`
  - [ ] Table-row style: name left, price right, description below in smaller text
  - [ ] Border bottom: `var(--color-outline-variant)`
  - [ ] Price: `typescale-title-medium`, `var(--color-on-surface)`
  - [ ] Unit: `typescale-label-small`, `var(--color-on-surface-variant)`

- [ ] `src/components/workshop/gear-mascot.tsx`:
  - [ ] Props: `expression: 'default' | 'building' | 'celebrating' | 'sleeping' | 'thinking'`
  - [ ] Inline SVG — gear cog with eyes + accessories per expression
  - [ ] `building`: hard hat, `celebrating`: confetti, `sleeping`: closed eyes + zzz, `thinking`: wrench
  - [ ] Default size: 64px, scalable via `width` prop
  - [ ] Placeholder: simple CSS circle with emoji until SVGs are designed

## Phase 15 — Static data

Marketing content lives as typed constants. No CMS. Changes require a deploy.

- [ ] `src/data/navigation.ts`:
  - [ ] Type: `NavItem = { label, href, description }`
  - [ ] Items: Projectes, Diari, Taller, Pressupost

- [ ] `src/data/copy.ts`:
  - [ ] Hero headline: "Les màquines fan la feina. Tu fas el negoci."
  - [ ] Hero subheadline: "Construïm eines que treballen mentre tu dorms."
  - [ ] Section headings, CTA labels, footer text
  - [ ] All strings in Catalan, plain object export

## Phase 16 — Homepage (workshop entrance)

`/` — the main landing page. Short, scannable. Business owners don't scroll long pages.

- [ ] `src/routes/index.tsx`:
  - [ ] No data fetching — pure static render

### Hero section

- [ ] Full-width, `var(--color-surface)` bg
- [ ] Headline: `typescale-display-large`, copy from `data/copy.ts`
- [ ] Subheadline: `typescale-headline-small`, `var(--color-on-surface-variant)`
- [ ] ConveyorBelt animation below headline
- [ ] CTA button: "Parlem" (Let's talk) → `/pricing`
- [ ] GearMascot in `default` expression, positioned beside CTA (desktop) or below (mobile)

### BeforeAfter section

- [ ] Section heading: "Abans i després" (Before and after)
- [ ] 3-4 concrete comparisons:
  - "4h copiant factures a mà" → "10 min, automàtic"
  - "Seguiment de clients en un Excel" → "Recordatoris intel·ligents"
  - "Comandes per WhatsApp, comptades a mà" → "Sistema de comandes amb estoc en temps real"
- [ ] BeforeAfter component

### Social proof (when available)

- [ ] Section heading: "Qui ja ho fa servir" (Who already uses it)
- [ ] Placeholder: empty for now, conditionally rendered
- [ ] When content exists: client name (anonymized), industry, one-line quote, key result metric

### Bottom CTA

- [ ] ControlPanel component
- [ ] Heading: "Parlem del teu negoci" (Let's talk about your business)
- [ ] Body: one sentence about free consultation
- [ ] Actions: primary "Demana pressupost" → `/pricing`, secondary "Escriu-nos" → email

## Phase 18 — Case studies (/projects)

Content is hardcoded — no database. Each case study is a route component.

### Blueprint wall — `/projects`

- [ ] `src/routes/projects/index.tsx`:
  - [ ] Page heading: "Projectes" (Blueprints)
  - [ ] BlueprintCard grid from hardcoded list
  - [ ] Grid: 1 col mobile, 2 col desktop
  - [ ] Empty state with GearMascot `thinking` if no projects yet

### Individual blueprint — `/projects/$slug`

- [ ] `src/routes/projects/$slug.tsx`:
  - [ ] Loader: match slug to hardcoded case study, 404 if not found
  - [ ] Header: project title + client industry + date
  - [ ] Section "El problema" (The problem): what was manual/broken
  - [ ] Section "La solució" (The solution): what we built, with BeforeAfter
  - [ ] Section "Resultats" (Results): key metrics in large type
  - [ ] Technical details: tools used, integration points (for credibility)
  - [ ] Blueprint aesthetic: dashed borders, monospace labels, grid-line background via CSS
  - [ ] Bottom ControlPanel CTA

## Phase 19 — Blog (/blog)

Workshop logbook. Content is hardcoded in route components until volume justifies a CMS.

### Logbook shelf — `/blog`

- [ ] `src/routes/blog/index.tsx`:
  - [ ] Page heading: "Diari de taller" (Workshop logbook)
  - [ ] LogbookCard list from hardcoded entries
  - [ ] Layout: single column, max-width `var(--bp-md)` centered
  - [ ] Most recent first
  - [ ] GearMascot `building` in sidebar decoration (desktop)

### Logbook entry — `/blog/$slug`

- [ ] `src/routes/blog/$slug.tsx`:
  - [ ] Loader: match slug to hardcoded post, 404 if not found
  - [ ] Article layout: max-width `var(--bp-md)`, centered
  - [ ] Date in decorative font, `var(--color-on-surface-variant)`
  - [ ] Title: `typescale-headline-large`
  - [ ] Body: `typescale-body-large`, generous line-height (1.7)
  - [ ] Code blocks: `JetBrains Mono`, `var(--color-surface-container)` bg
  - [ ] Images: full-width within content column
  - [ ] Bottom: link back to `/blog` + ControlPanel CTA

## Phase 20 — About (/about)

Workshop tour. Who works here, what tools we use, why we do this.

- [ ] `src/routes/about.tsx`:
  - [ ] Hero: "El taller" heading + one-paragraph mission statement
  - [ ] GearMascot `celebrating` beside mission text
  - [ ] Section "Per què existim" (Why we exist): the SMB gap — enterprise software too expensive, their tech cousin set up WordPress in 2016
  - [ ] Section "Com treballem" (How we work): direct, honest, anti-consultant approach
  - [ ] Section "Les eines del taller" (Workshop tools): tech stack in plain language — not to impress, to show we use serious tools
  - [ ] Section "On som" (Where we are): Catalan, local, "som del barri" energy
  - [ ] Bottom ControlPanel CTA

## Phase 21 — Pricing (/pricing)

Parts catalog. Clean, honest, no-nonsense. Also doubles as a contact/quote form.

- [ ] `src/routes/pricing.tsx`:
  - [ ] Hero: "Pressupost" heading + "Sense lletra petita" (No fine print) subheading
  - [ ] PartsRow list for each service (from `data/services.ts` — loop, not hardcoded)
  - [ ] Annual support contract row (optional add-on, per service)
  - [ ] Clear "Què inclou" (What's included) and "Què no inclou" (What's not included) per service
  - [ ] Contact section: email, phone, WhatsApp link
  - [ ] Optional: simple contact form (name, business, what they need) — POST to server API
  - [ ] GearMascot `thinking` beside the form
  - [ ] Tone: "Digue'ns què necessites i et direm què costa." (Tell us what you need, we'll tell you what it costs.)

## Phase 22 — Prospect pages (/:lang/:slug)

Dynamic pages powered by Tiptap JSON from the server. These are the only pages that fetch data.

- [ ] `src/routes/$lang/$slug.tsx`:
  - [ ] Server function: `GET ${SERVER_URL}/pages/${slug}?lang=${lang}`
  - [ ] Validate `lang` param: `ca | es | en`, 404 on invalid
  - [ ] Handle 404 for unpublished or missing pages
  - [ ] Set `<html lang>` to match route param
  - [ ] Render page content through BlockRenderer
  - [ ] SEO tags: `<title>`, og:title, og:description, og:image, og:locale
  - [ ] `<link rel="alternate" hreflang="...">` for all available translations
  - [ ] `<link rel="canonical">` pointing to current lang URL
  - [ ] Fire `POST /pages/${slug}/view` on client load (fire-and-forget, no await)

### Tiptap block renderers

- [ ] `src/components/blocks/BlockRenderer.tsx`:
  - [ ] `BLOCK_MAP: Record<string, ComponentType>` — maps block type string to React component
  - [ ] Iterates `content` array from Tiptap JSON, renders matching component or falls through to RichTextBlock
  - [ ] Unknown block types: log warning, render nothing

- [ ] `src/components/blocks/HeroBlock.tsx`:
  - [ ] Props from Tiptap attrs: `heading`, `subheading`, `ctaLabel`, `ctaHref`
  - [ ] Full-width, `typescale-display-large` heading
  - [ ] CTA button with primary color

- [ ] `src/components/blocks/CtaBlock.tsx`:
  - [ ] Props: `heading`, `body`, `buttons: { label, href, type }[]`
  - [ ] Renders as ControlPanel component
  - [ ] Button types: `calendar` (Cal.com link), `whatsapp`, `email`, `link`

- [ ] `src/components/blocks/ValuePropsBlock.tsx`:
  - [ ] Props: `items: { title, description, icon }[]`
  - [ ] Grid: 1 col mobile, 2 col tablet, 3 col desktop
  - [ ] Card per item with icon, title, description

- [ ] `src/components/blocks/PainPointsBlock.tsx`:
  - [ ] Props: `items: { problem, cost }[]`
  - [ ] Styled as a problem list — each item shows the pain and its business cost
  - [ ] Left accent border in `var(--color-error-container)`

- [ ] `src/components/blocks/SocialProofBlock.tsx`:
  - [ ] Props: `items: { quote, source, role }[]`
  - [ ] Testimonial cards with quote marks, source name, role

- [ ] `src/components/blocks/RichTextBlock.tsx`:
  - [ ] Catch-all for standard Tiptap nodes (paragraphs, headings, lists, links, images, code)
  - [ ] Uses `generateHTML()` from `@tiptap/html` with StarterKit extensions
  - [ ] Styled via global CSS targeting `.rich-text` wrapper class
  - [ ] Typography: body text `typescale-body-large`, headings from MD3 scale

## Phase 23 — SEO and meta

- [ ] `src/lib/seo.ts`:
  - [ ] Helper: `buildMeta({ title, description, image, url, lang })` → returns TanStack Start meta array
  - [ ] Default og:image: Engranatge social card (static PNG in `public/`)
  - [ ] Default description: one-line company pitch in Catalan
- [ ] Per-page meta tags:
  - [ ] Homepage: title "Engranatge — Les màquines fan la feina", full meta
  - [ ] Service pages: title "Eines — Engranatge" / "Automatitzacions — Engranatge"
  - [ ] Blog: title from post data
  - [ ] Prospect pages: title + og from server page `meta` field
- [ ] `public/robots.txt`: allow all, sitemap reference
- [ ] `public/sitemap.xml`: static pages only (prospect pages are dynamic, not indexed)

## Phase 24 — Unikraft deployment

- [ ] Run `pnpm --filter marketing build` and verify `.output/server/index.mjs` generated
- [ ] Test locally: `node apps/marketing/.output/server/index.mjs` on port 3001
- [ ] Run `kraft build` with `apps/marketing/Kraftfile` and verify image builds
- [ ] Run `kraft run` locally and verify SSR responds
- [ ] Deploy to Unikraft Cloud with `kraft deploy`
- [ ] Point `engranatge.com` to deployed instance
- [ ] Set `SERVER_URL` env var to `https://api.engranatge.com`
- [ ] Verify static pages render: `/`, `/tools`, `/about`, `/pricing`
- [ ] Verify prospect page renders at `engranatge.com/ca/test-slug` (needs server running)
