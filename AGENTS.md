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

### Open & navigate

```bash
agent-browser open http://localhost:3010              # open pipeline dashboard
agent-browser open http://localhost:3010/companies    # company list
agent-browser open http://localhost:3010/tasks        # tasks view
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
