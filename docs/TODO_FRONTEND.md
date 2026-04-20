# TODO — Frontend

Ordered implementation checklist for `apps/internal` (the Batuda web app). Each tenant's public marketing site lives in its own repo (for example, the Engranatge tenant uses `engranatge-marketing`).

See [frontend.md](frontend.md) for web app patterns. See [architecture.md](architecture.md) for data flow.

## Design system direction

Batuda web app — *the workbench*. Data-dense, keyboard-first, compact rows, command palette. Desktop-first productivity idiom (closer to Linear/Attio/Height than to stock MD3).

**Shared layer (`packages/ui`)** — consumed by the Batuda web app locally via workspace link, and published to npm for tenant marketing sites:

- Tokens (`tokens.css`) — colors, typography, spacing, shape, elevation, motion.
- **`Pri*` primitives** — `PriButton`, `PriInput`, `PriSelect`, `PriDialog`, `PriMenu`, `PriTooltip`, `PriTabs`, `PriCheckbox`, `PriRadio`, `PriSwitch`, `PriToast`, `PriCombobox`, `PriPopover`. Headless Base UI wrapped with styled-components. The `Pri` prefix (short for "Primitive") marks them as shared, low-level building blocks.
- Tiptap block schemas (`blocks/`) — used by the Batuda web app for prospect-page editing; rendered by tenant marketing sites (e.g. the Engranatge tenant's `engranatge-marketing` repo).

**MD3 stance**: we keep MD3's *structural* concepts — color roles, typescale, shape, spacing — but reject MD3's stock components (mobile-first, too airy for a data-dense CRM). Batuda diverges via a desktop-dense, keyboard-first idiom. We do **not** import MD3 concepts the codebase isn't already using (state layers, density scales) — if Batuda needs them later, we add them with evidence, not speculation.

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
  - [ ] Replace `src/styles.css` demo content — `@import '@batuda/ui/tailwind.css'` + app-level reset
- [ ] Adapt for monorepo:
  - [ ] `package.json`: set name to `@batuda/web`, add `@batuda/domain: "workspace:*"`, `@batuda/controllers: "workspace:*"`, `@batuda/ui: "workspace:*"`
  - [ ] `package.json`: add `styled-components`, `@base-ui/react`, `motion`, `motion-plus`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `react-map-gl`, `maplibre-gl`, `supercluster`, `effect`, `@chenglou/pretext`
  - [ ] `package.json`: add devDep `@types/supercluster`
  - [ ] `tsconfig.json`: add `"extends": "../../tsconfig.base.json"`
- [ ] Create `Dockerfile` and `Kraftfile` for Unikraft deployment (see PLAN.md)
- [ ] Clean up `src/routes/__root.tsx` — remove demo Header/Footer/ThemeToggle imports, devtools panel
- [ ] Run `pnpm install` from root, verify `pnpm dev:internal` starts without errors

## Phase 1b — packages/ui

- [ ] Create `packages/ui/package.json` — `@batuda/ui`, deps: `@tiptap/core`, `@tiptap/pm`, `@base-ui/react`, `styled-components`, peerDeps: `tailwindcss`, `react`, `react-dom`
- [ ] Create `packages/ui/tsconfig.json` extending `../../tsconfig.base.json`
- [ ] Create `packages/ui/src/tokens.css` — MD3 CSS custom properties
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
- [ ] Create `packages/ui/src/index.ts` — re-exports blocks (primitives live under `@batuda/ui/pri` subpath)

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

Primitives live in `packages/ui/src/pri/` and are consumed by the Batuda web app via the `@batuda/ui/pri` subpath export (and by tenant marketing sites via the published npm package). The `Pri` prefix (short for "Primitive") marks them as shared, low-level building blocks — one canonical `<PriInput>` for every consumer.

Naming: always `Pri` + PascalCase component name (`PriButton`, not `PrimitiveButton` or `UiButton`). Filenames: kebab-case (`pri-button.tsx`). Compound primitives mirror Base UI's namespace exactly (e.g. `PriSelect.Root`, `PriSelect.Trigger`, `PriSelect.Popup`).

Each primitive:

- Wraps a headless Base UI primitive with styled-components
- All values from CSS custom property tokens (no hex, no hardcoded px)
- Variants via `$`-prefixed transient props (`$variant`, `$size`)
- No business logic, no data fetching, no i18n — pure visual primitive
- **Neutral defaults only**: structural tokens (shape, focus ring, spacing, typescale, transitions). No theme-specific gradients, textures, or accent colors. Consumers compose styled overrides on top to apply their own visual language.

### Lazy-extraction rule

A primitive is created **only** when at least one real consumer exists. No speculative primitives — if the Batuda web app later needs a primitive that doesn't exist yet, we extract it then with a real consumer driving the API.

This avoids the trap of building 14 primitives up-front, half of which would never be used or would need rework once a real consumer appears.

### Status

| Primitive        | Status    | First consumer                                          |
| ---------------- | --------- | ------------------------------------------------------- |
| `PriSelect`      | extracted | Tenant marketing site language selector (external repo) |
| `PriButton`      | stub      | Web app `FormField`                                     |
| `PriInput`       | stub      | Web app forms                                           |
| `PriDialog`      | stub      | Web app quick-edit modals                               |
| `PriMenu`        | stub      | Web app row action menus                                |
| `PriTooltip`     | stub      | Web app keyboard-shortcut hints                         |
| `PriPopover`     | stub      | Web app filter popovers                                 |
| `PriTabs`        | stub      | Web app company detail tabs                             |
| `PriCheckbox`    | stub      | Web app task completion                                 |
| `PriCombobox`    | stub      | Web app contact autocomplete                            |
| `PriRadio`       | stub      | Web app form options                                    |
| `PriSwitch`      | stub      | Web app settings toggles                                |
| `PriToast`       | stub      | Web app success/error notifications                     |
| `PriAlertDialog` | stub      | Web app destructive confirmations                       |

### Consumption

- The Batuda web app imports everything from `@batuda/ui/pri` via the workspace link — no local primitives.
- Each tenant marketing repo consumes the same primitives via the published `@batuda/ui` npm package.

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

Client is derived from `@batuda/controllers` — same `BatudaApi` spec the server implements.
No manual endpoint definitions; schemas, types, and error handling are shared.

- [ ] Add dep: `@batuda/controllers: "workspace:*"`
- [ ] Create `src/lib/api.ts` — derive typed client from `BatudaApi`:
  ```ts
  import { HttpApiClient } from '@effect/platform'
  import { BatudaApi } from '@batuda/controllers'

  // Typed client — all endpoints, request/response schemas, and errors derived from spec
  const client = HttpApiClient.make(BatudaApi, {
    baseUrl: import.meta.env.SERVER_URL
  })
  ```
- [ ] Create `AtomHttpApi.Tag` integration for effect-atom (query/mutation atoms from spec):
  ```ts
  import { AtomHttpApi } from '@effect-atom/atom-react'
  import { BatudaApi } from '@batuda/controllers'

  class ApiClient extends AtomHttpApi.Tag<ApiClient>()('ApiClient', {
    api: BatudaApi,
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
- [ ] Point `batuda.co` to deployed instance
- [ ] Set `SERVER_URL` env var to `https://api.batuda.co`
- [ ] Verify production deploy works end-to-end
