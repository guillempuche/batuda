# AGENTS.md — AI Agent Instructions

Rules and patterns for AI agents working in this codebase.
For project overview, stack, and setup see [README.md](README.md).

---

## Dev environment

This project uses a **Nix flake** (`flake.nix`) with **direnv** (`.envrc`) to provide Node 24 and pnpm. On entering the directory, direnv activates the flake automatically — no manual `nix develop` needed.

If you need to verify the environment: `node --version` and `pnpm --version`.

Never install Node or pnpm globally or via other package managers for this project.

---

## Testing & debugging the frontend

Use **`agent-browser`** (already installed) to test and debug the local web app.

Dev URLs (via portless): **Batuda web app `https://batuda.localhost`** and API server `https://api.batuda.localhost`. Most debugging is against the web app.

### Dev login

A test user is created by `pnpm cli seed` (any preset). Use it to log in when debugging authenticated screens:

- **Email:** `admin@taller.cat`
- **Password:** `batuda-dev-2026`

Exported from `apps/cli/src/commands/seed.ts` as `TEST_USER`. If login fails, re-run `pnpm cli seed --preset minimal` — the seed is idempotent and will (re)create the user via Better-Auth's `signUpEmail`.

Better-Auth lives on the API server at `api.batuda.localhost/auth/*`. The web browser sends cookies cross-origin via `credentials: 'include'`; on SSR, loaders forward the incoming `cookie` header server-to-server. Both flows require the API server (`pnpm dev:server`) to be running.

### Open & navigate

```bash
agent-browser open https://batuda.localhost              # open pipeline dashboard
agent-browser open https://batuda.localhost/companies    # company list
agent-browser open https://batuda.localhost/tasks        # tasks view
agent-browser back                                    # go back
agent-browser reload                                  # reload page
```

### Inspect page state

```bash
agent-browser snapshot                  # accessibility tree with refs (best for AI)
agent-browser screenshot                # screenshot to stdout
agent-browser screenshot /tmp/page.png  # screenshot to file
agent-browser get text "h1"             # read heading text
agent-browser get text "[data-testid='company-name']"
agent-browser get url                   # current URL
agent-browser get title                 # page title
agent-browser get html ".pipeline"      # HTML of an element
```

### Interact with UI

```bash
agent-browser click "button:has-text('Add company')"
agent-browser fill "input[name='name']" "Can Joan"
agent-browser fill "input[name='slug']" "can-joan"
agent-browser select "select[name='status']" "prospect"
agent-browser press Enter
agent-browser check "input[name='is_decision_maker']"
agent-browser scroll down 300
agent-browser scrollintoview ".task-list"
```

### Find elements by role/text

```bash
agent-browser find role "button" click             # click first button
agent-browser find text "Save" click               # click element containing "Save"
agent-browser find placeholder "Search companies" fill "restaurant"
agent-browser find testid "pipeline-card" click
```

### Verify state

```bash
agent-browser is visible ".company-card"            # check element exists and visible
agent-browser is enabled "button[type='submit']"    # check not disabled
agent-browser is checked "input[name='active']"     # check checkbox state
agent-browser get count ".company-card"             # count elements
agent-browser wait ".pipeline"                      # wait for element to appear
agent-browser wait 2000                             # wait 2 seconds
```

### Debug

```bash
agent-browser console                   # view console logs
agent-browser errors                    # view JS errors
agent-browser highlight ".status-badge" # highlight element visually
agent-browser eval "document.title"     # run arbitrary JS
agent-browser diff snapshot             # compare current vs last snapshot
agent-browser set media dark            # test dark mode
agent-browser set viewport 375 812     # test mobile (iPhone X)
agent-browser set viewport 1440 900    # test desktop
```

### Network & requests

```bash
agent-browser network requests                        # list network requests
agent-browser network requests --filter "/api/"       # filter API calls
agent-browser set offline on                          # test offline behavior
agent-browser set offline off
```

---

## API documentation

The server exposes auto-generated OpenAPI docs from the Effect HttpApi spec and Better Auth:

| URL                                                          | What                                        |
| ------------------------------------------------------------ | ------------------------------------------- |
| `https://api.batuda.localhost/docs`                          | Scalar interactive docs (all CRM endpoints) |
| `https://api.batuda.localhost/openapi.json`                  | Raw OpenAPI 3.1 spec (machine-readable)     |
| `https://api.batuda.localhost/auth/reference`                | Better Auth Scalar docs (auth endpoints)    |
| `https://api.batuda.localhost/auth/open-api/generate-schema` | Better Auth raw OpenAPI spec                |

The CRM spec is generated from `packages/controllers/src/api.ts` (`BatudaApi`). Adding a new route group or endpoint automatically appears in `/docs` and `/openapi.json`.

---

## Reference source

Key libraries are vendored as git subtrees under `docs/repos/` so agents can read real source when an API is unclear, instead of guessing. Read the source first; fall back to WebFetch only if the answer isn't in the tree.

| Path                         | Library                                                                                    | Use when                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `docs/repos/effect`          | Effect v4 (`effect` package, unstable modules)                                             | Any Effect / Schema / ServiceMap / HttpApi / SQL / AI question — read `packages/effect/src/*.ts` directly         |
| `docs/repos/tanstack-router` | TanStack Router + Start + Nitro plugin                                                     | File routes, rewrites, i18n, SSR, `createServerFn`, loader types                                                  |
| `docs/repos/better-auth`     | Better Auth                                                                                | Session handling, cookies, sign-in flows, adapter contracts                                                       |
| `docs/repos/base-ui`         | Base UI                                                                                    | Unstyled primitive internals behind `@batuda/ui/pri` wrappers                                                     |
| `docs/repos/tiptap`          | Tiptap v3 monorepo (`@tiptap/core`, `/html`, `/react`, `/static-renderer`, all extensions) | Node/Mark API, `generateHTML`/`generateJSON`, schema checks, extension authoring — relevant for the pages feature |
| `docs/repos/motion`          | Motion (framer-motion successor)                                                           | Animation primitives                                                                                              |
| `docs/repos/motion-plus`     | Motion Plus                                                                                | Commercial Motion features                                                                                        |

To add a new reference: `git subtree add --prefix=docs/repos/<name> <git-url> <branch> --squash`. To update an existing one: `git subtree pull --prefix=docs/repos/<name> <git-url> <branch> --squash`.

---

## CLI

Use the CLI for local environment management. No `--` needed between `pnpm cli` and the command.

```bash
pnpm cli setup            # copy .env files from examples
pnpm cli doctor           # check environment health
pnpm cli seed             # insert sample data (additive)
pnpm cli db migrate       # run migrations
pnpm cli db reset         # truncate + migrate + seed (clean slate)
pnpm cli services up      # start Docker Postgres
pnpm cli services down    # stop Docker services
pnpm cli services status  # show Docker status
pnpm cli:tui              # interactive TUI (same commands)
```

The CLI connects to Postgres via `DATABASE_URL` in `apps/cli/.env`. Commands that don't need the DB (`setup`, `services`) work without it.

---

## Modifying code

### File naming

Use **kebab-case** for all filenames, including React components:

- `workshop-nav.tsx` not `WorkshopNav.tsx`
- `indicator-light.tsx` not `IndicatorLight.tsx`
- `lang-provider.tsx` not `LangProvider.tsx`

This applies to `.ts`, `.tsx`, `.css`, and all other source files.

### Env var naming

Env vars name the **capability**, not the vendor. Swapping from one vendor to another must not require renaming secrets.

**Grammar:** `<DOMAIN>_<ROLE>[_<CAPABILITY>][_<CC>][_<N>]`

- **`<DOMAIN>`** — one of `STORAGE`, `EMAIL`, `RESEARCH`, `BETTER_AUTH`, …
- **`<ROLE>`** — what kind of knob: `PROVIDER`, `API_KEY`, `BASE_URL`, `MODEL`, `ENDPOINT`, `REGION`, `BUCKET`, `SECRET`, `WEBHOOK_SECRET`. Role comes before capability so grepping `RESEARCH_API_KEY_` picks up every secret in the family at once.
- **`<CAPABILITY>`** (optional) — what's being provided: `SEARCH`, `SCRAPE`, `EXTRACT`, `DISCOVER`, `REGISTRY`, `REPORT`, `LLM`. Present when the domain has multiple capabilities; absent when the domain has only one (e.g. `STORAGE_ENDPOINT`, not `STORAGE_ENDPOINT_S3`).
- **`<CC>`** (optional) — ISO-3166-1 alpha-2 suffix when the capability is per-country: `_ES`, `_FR`. Placed after capability so adding a country doesn't disturb the rest of the name.
- **`<N>`** (optional) — slot index for multi-provider fallback chains. Slot 0 (primary) is unsuffixed; slot N ≥ 1 uses `_${N + 1}` (e.g. `RESEARCH_API_KEY_SEARCH_2` = slot 1).

**Examples (good):**

| Var                             | Domain   | Role     | Capability | CC | Slot |
| ------------------------------- | -------- | -------- | ---------- | -- | ---- |
| `STORAGE_ENDPOINT`              | STORAGE  | ENDPOINT | —          | —  | —    |
| `EMAIL_PROVIDER`                | EMAIL    | PROVIDER | —          | —  | —    |
| `EMAIL_API_KEY`                 | EMAIL    | API_KEY  | —          | —  | —    |
| `RESEARCH_PROVIDER_SEARCH`      | RESEARCH | PROVIDER | SEARCH     | —  | —    |
| `RESEARCH_API_KEY_SEARCH`       | RESEARCH | API_KEY  | SEARCH     | —  | —    |
| `RESEARCH_PROVIDER_REGISTRY_ES` | RESEARCH | PROVIDER | REGISTRY   | ES | —    |
| `RESEARCH_API_KEY_SEARCH_2`     | RESEARCH | API_KEY  | SEARCH     | —  | 1    |
| `RESEARCH_MODEL_LLM`            | RESEARCH | MODEL    | LLM        | —  | —    |

**Anti-patterns (don't do):**

- `BRAVE_SEARCH_API_KEY`, `FIRECRAWL_API_KEY`, `AGENTMAIL_API_KEY`, `R2_ACCESS_KEY_ID` — vendor in the name. Swapping Brave → something else now requires a secret rename in every deployment.
- `SEARCH_PROVIDER` (capability first) — breaks "grep by role" because `RESEARCH_PROVIDER_*` across all capabilities no longer clusters.
- `RESEARCH_PROVIDER_SEARCH_FIRECRAWL` — vendor as a suffix. The vendor goes in the **value**, never the key.

**Multi-provider fallback (comma-list values).** Any `RESEARCH_PROVIDER_<CAP>` var accepts a comma list: first value = primary, rest = fallback chain on `ProviderError`. One entry means single provider. No separate `*_STRATEGY` knob — list length drives behaviour.

```
RESEARCH_PROVIDER_SEARCH=brave,firecrawl   # primary + fallback
RESEARCH_API_KEY_SEARCH=bsa_...            # slot 0 key
RESEARCH_API_KEY_SEARCH_2=fc_...           # slot 1 key
```

**No backwards-compat shims.** When an env var is renamed, update `.env.example`, `.env.example.github`, all consumers, and every deployment in one atomic commit. Do not add a fallback that reads the old name.

### Backend (apps/server)

- Effect patterns: see `docs/backend.md`
- Every new route needs: handler + Effect Schema validation + error mapping
- New MCP tool: add to `src/mcp/tools/`, register in `src/mcp/server.ts`

### Frontend (apps/internal)

- Use design tokens, never hardcoded values: see `docs/frontend.md`
- Use BaseUI for interactive components
- Mobile-first: start with smallest viewport, expand with `@media (min-width: ...)`

### Schema changes

1. Edit `packages/domain/src/schema/<table>.ts`
2. Run `pnpm db:generate` to create migration
3. Run `pnpm db:migrate` to apply
4. Update affected MCP tools and routes

### Build & lint

- Use `pnpm build` (runs `turbo build` with caching)
- Use `pnpm check-types` for type checking across all packages
- Use `pnpm lint` for Biome linting
- Use `pnpm format` to format all files (Biome + dprint for markdown)
- Use `pnpm check-deps` to verify dependency version consistency (syncpack)
- Git hooks (lefthook) run automatically on commit and push

---

## Skills

| Skill      | Use for                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| `/crm`     | CRM data operations — MCP tools, companies, interactions, documents, tasks, pages |
| `/commits` | Git commit messages following project conventions                                 |
| `/debug`   | Diagnose server and internal apps — health checks, logs, Docker, auth             |
