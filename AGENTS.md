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

Dev URLs (via portless): **Forja (internal CRM) `https://forja.engranatge.localhost`**, Marketing `https://engranatge.localhost`, API server `https://api.engranatge.localhost`. Most debugging is against Forja.

### Dev login

A test user is created by `pnpm cli seed` (any preset). Use it to log in when debugging authenticated screens:

- **Email:** `dev@forja.cat`
- **Password:** `forja-dev-2026`

Exported from `apps/cli/src/commands/seed.ts` as `TEST_USER`. If login fails, re-run `pnpm cli seed --preset minimal` — the seed is idempotent and will (re)create the user via Better-Auth's `signUpEmail`.

Better-Auth lives on the API server at `api.engranatge.localhost/auth/*`. The Forja browser sends cookies cross-origin via `credentials: 'include'`; on SSR, loaders forward the incoming `cookie` header server-to-server. Both flows require the API server (`pnpm dev:server`) to be running.

### Open & navigate

```bash
agent-browser open https://forja.engranatge.localhost              # open pipeline dashboard
agent-browser open https://forja.engranatge.localhost/companies    # company list
agent-browser open https://forja.engranatge.localhost/tasks        # tasks view
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

| URL                                                              | What                                        |
| ---------------------------------------------------------------- | ------------------------------------------- |
| `https://api.engranatge.localhost/docs`                          | Scalar interactive docs (all CRM endpoints) |
| `https://api.engranatge.localhost/openapi.json`                  | Raw OpenAPI 3.1 spec (machine-readable)     |
| `https://api.engranatge.localhost/auth/reference`                | Better Auth Scalar docs (auth endpoints)    |
| `https://api.engranatge.localhost/auth/open-api/generate-schema` | Better Auth raw OpenAPI spec                |

The CRM spec is generated from `packages/controllers/src/api.ts` (`ForjaApi`). Adding a new route group or endpoint automatically appears in `/docs` and `/openapi.json`.

---

## Reference source

Key libraries are vendored as git subtrees under `docs/repos/` so agents can read real source when an API is unclear, instead of guessing. Read the source first; fall back to WebFetch only if the answer isn't in the tree.

| Path                         | Library                                                                                    | Use when                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `docs/repos/effect`          | Effect v4 (`effect` package, unstable modules)                                             | Any Effect / Schema / ServiceMap / HttpApi / SQL / AI question — read `packages/effect/src/*.ts` directly         |
| `docs/repos/tanstack-router` | TanStack Router + Start + Nitro plugin                                                     | File routes, rewrites, i18n, SSR, `createServerFn`, loader types                                                  |
| `docs/repos/better-auth`     | Better Auth                                                                                | Session handling, cookies, sign-in flows, adapter contracts                                                       |
| `docs/repos/base-ui`         | Base UI                                                                                    | Unstyled primitive internals behind `@engranatge/ui/pri` wrappers                                                 |
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
| `/debug`   | Diagnose server, internal, and marketing apps — health checks, logs, Docker, auth |
