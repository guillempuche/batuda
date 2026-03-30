# TODO — Frontend

Ordered implementation checklist for `apps/web`.
See [frontend.md](frontend.md) for token system, MD3 typography, BaseUI patterns.
See [architecture.md](architecture.md) for data flow.

---

## Phase 1 — Project setup

- [ ] Create `apps/web/package.json` — React 19, `@types/react@^19`, `@types/react-dom@^19`, TanStack Start, BaseUI latest, TypeScript `^5.8.0`
- [ ] Create `apps/web/tsconfig.json` extending `../../tsconfig.base.json` — add `lib: [ES2022, DOM, DOM.Iterable]`, `jsx: react-jsx`
- [ ] Create `app.config.ts` with `cloudflare-pages` preset — verify exact preset name in TanStack Start docs
- [ ] Create `wrangler.toml` (name, compatibility_date, pages_build_output_dir, SERVER_URL var)
- [ ] Verify `pnpm dev:web` starts without errors

## Phase 2 — Design tokens

- [ ] Create `src/styles/tokens.css`
  - [ ] MD3 typography scale — all 15 roles (display/headline/title/body/label × large/medium/small)
  - [ ] Typography utility classes for each role
  - [ ] MD3 color tokens — light scheme (primary, secondary, tertiary, error, surface, background, outline)
  - [ ] MD3 color tokens — dark scheme (`@media prefers-color-scheme: dark`)
  - [ ] Pipeline status color tokens (prospect, contacted, responded, meeting, proposal, client, closed, dead)
  - [ ] Fluid spacing scale (--space-1 through --space-16 using clamp())
  - [ ] Shape tokens (none, extra-small, small, medium, large, extra-large, full)
  - [ ] Elevation tokens (0–3)
  - [ ] Breakpoint tokens (--bp-sm, --bp-md, --bp-lg, --bp-xl)
  - [ ] Page layout tokens (--page-gutter, --page-max-width, --card-radius)
- [ ] Create `src/styles/global.css`
  - [ ] Import tokens.css
  - [ ] CSS reset (box-sizing, margin 0, font-family)
  - [ ] Base body styles using color and typography tokens
  - [ ] Scrollbar styles

## Phase 3 — Layout and navigation

- [ ] Create `src/routes/__root.tsx`
  - [ ] Page wrapper with max-width and gutter tokens
  - [ ] Bottom navigation bar (mobile): Pipeline, Companies, Tasks
  - [ ] Side navigation (desktop, ≥1024px)
  - [ ] Nav items: Pipeline `/`, Companies `/companies`, Tasks `/tasks`
  - [ ] Active route highlight using TanStack Router's `useMatchRoute`

## Phase 4 — Shared components

Each component: `.tsx` + co-located `.css`, all values from tokens.

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

## Phase 5 — BaseUI components

Install `@base-ui-components/react` and style with tokens.

- [ ] `Button` component (variants: filled, outlined, text)
- [ ] `Input` component (text input with label + error state)
- [ ] `Select` component (status, region, industry, priority dropdowns)
- [ ] `Dialog` component (for log interaction modal, quick-edit)
- [ ] `Tabs` component (company detail tabs)
- [ ] `Checkbox` component (task completion)
- [ ] `Menu` component (action menu on company cards: edit, log interaction, add task)

## Phase 6 — API client

- [ ] Create `src/lib/api.ts`
  - [ ] `getCompanies(filters)` → company summaries
  - [ ] `getCompany(slug)` → full company detail
  - [ ] `getPipeline()` → status counts + overdue
  - [ ] `getTasks(params)` → tasks list
  - [ ] `logInteraction(data)` → create interaction
  - [ ] `completeTask(id)` → mark task done
  - [ ] Error handling: throw typed errors on non-2xx

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
- [ ] Tabs component: Profile | Interactions | Documents | Tasks | Proposals

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
- [ ] Click to open in read view (rendered markdown)
- [ ] Edit button → markdown textarea
- [ ] "New document" button → type select + textarea

### Tasks tab
- [ ] Open tasks sorted by due date — overdue highlighted
- [ ] Completed tasks collapsible section
- [ ] Add task button → Dialog (type, title, due_at)
- [ ] Checkbox to complete (optimistic update)

### Proposals tab
- [ ] Proposal list: title, status badge, total value, sent date
- [ ] "New proposal" → basic form (title, notes, manual line items for now)

## Phase 10 — Tasks page (`/tasks`)

- [ ] Server function: fetch tasks due today + past + next 7 days
- [ ] Overdue section (highlighted with error color token)
- [ ] Today section
- [ ] Day-by-day sections for next 7 days
- [ ] Each task links to company name → `/companies/$slug`
- [ ] Checkbox to complete (optimistic update)

## Phase 11 — Cloudflare deployment

- [ ] Run `pnpm --filter web build` and verify `.output/public` generated
- [ ] Run `wrangler pages dev .output/public` and verify locally
- [ ] Connect GitHub repo to Cloudflare Pages (auto-deploy on push to `main`)
- [ ] Set `SERVER_URL` env var in Cloudflare Pages dashboard
- [ ] Configure `batuda.guillempuche.com` subdomain in Cloudflare DNS
- [ ] Verify production deploy works end-to-end
