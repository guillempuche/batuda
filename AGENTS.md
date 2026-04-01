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
agent-browser open http://localhost:3000              # open pipeline dashboard
agent-browser open http://localhost:3000/companies    # company list
agent-browser open http://localhost:3000/tasks        # tasks view
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

## MCP first

Always use MCP tools to read and write data. Never write raw SQL.
Never read `.env` or database credentials. Never call the HTTP API directly from agent code.

The MCP server is registered in `.mcp.json`. In Claude Code, run `/mcp` to verify tools are loaded.

---

## Context efficiency

Data is large. Fetch only what you need:

```
search_companies(filters)      → summaries only, no full profiles
get_company(id_or_slug)        → full profile + last 5 interactions (not documents)
get_documents(company_id)      → list (id, type, title) — no content
get_document(id)               → full markdown content
get_pipeline()                 → counts only
get_next_steps(limit)          → due tasks + overdue next_action_at
create_page(...)               → create a prospect sales page (draft) with Tiptap JSON content
update_page(...)               → update page content, title, or meta
publish_page(id)               → publish a draft page (makes it publicly accessible)
list_pages(filters)            → list pages by company, status, or language
get_page(id_or_slug_lang)      → get full page content by id or slug+lang
```

Rule: always call `search_companies` before `get_company`. Fetch document content only when you need to read or rewrite it.

---

## Working with companies

**Status flow** (only moves forward):

```
prospect → contacted → responded → meeting → proposal → client
                                                       → closed
                                                       → dead
```

To re-engage a dead/closed company: set status back to `contacted`.

**Slug format:** kebab-case from name. If duplicate, append city: `can-joan-girona`.

**Priority:** 1 = hot (contact this week), 2 = medium, 3 = cold (backlog).

**source field:** always set when creating a company. Use: `firecrawl | exa | google_maps | referral | linkedin | instagram | manual`.

**metadata jsonb:** use freely for any data that doesn't fit existing columns. Future columns will be promoted from metadata. Examples: fiscal data (NIF), employee names not worth a full contact, scraped social stats, competitor notes.

---

## Logging interactions

Always set `next_action` and `next_action_at` when known. This drives the daily task list.

```typescript
log_interaction({
  company_id: "...",
  channel: "visit",        // email | phone | visit | linkedin | instagram | whatsapp | event
  direction: "outbound",   // outbound | inbound
  type: "cold",            // cold | followup | meeting | demo | check-in
  summary: "...",
  outcome: "interested",   // no_response | responded | interested | not_interested
                           // | meeting_scheduled | proposal_requested
  next_action: "Send proposal for delivery notes automation",
  next_action_at: "2026-04-07"
})
```

After `log_interaction`, update the company's `next_action` and `next_action_at` if they changed.

---

## Writing documents

`documents.content` is full markdown. Write it as a human would — structured, scannable, no AI filler phrases.

Document types:

- `research` — scraped/researched company profile. Use Firecrawl/Exa first, then create this.
- `prenote` — prep before a meeting. Link to the interaction via `interaction_id` once scheduled.
- `postnote` — what happened. Always link to `interaction_id` of the meeting.
- `call_notes` — phone call notes. Link to interaction.
- `visit_notes` — on-site visit notes. Link to interaction.
- `general` — anything else.

When researching a new company with Firecrawl/Exa:

1. `create_company(...)` with known fields
2. `create_document({ type: "research", content: <scraped + structured markdown> })`

---

## Schema conventions

All IDs are UUIDs. All timestamps are UTC.

Text enum fields (status, industry, channel, etc.) are plain strings — not Postgres enums.
Valid values are documented in `packages/domain/src/schema/`.

`metadata jsonb` columns accept any valid JSON object. Always merge, never replace:

```
update_company({ id, metadata: { ...existing, new_field: value } })
```

---

## Working with tasks

Tasks are the action queue. `get_next_steps` returns them sorted by due date.

After completing a task, always check if a new task should be created for the next step.

---

## Working with pages

Use `create_page` to generate prospect sales pages. Set `lang: 'ca'` first, then create translations for the same slug.

Pages use Tiptap JSON with custom block nodes (hero, cta, valueProps, painPoints, socialProof). Standard rich text uses Tiptap StarterKit.

Always `publish_page` after review — pages are draft by default.

---

## Modifying code

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

## Dos and don'ts

| Do | Don't |
|----|-------|
| Use MCP tools for all data access | Write raw SQL |
| Set `next_action_at` on every interaction | Leave a company with no next action |
| Use `metadata jsonb` for evolving data | Add DB columns for one-off fields |
| Write documents in clean markdown | Dump raw scraped HTML |
| Use design tokens in CSS | Hardcode colors, spacing, font sizes |
| Mobile-first CSS | Desktop-first with override hacks |
| Effect patterns from docs/backend.md | Mix patterns from older Effect versions |
| Run `pnpm format` before committing | Commit unformatted code |
