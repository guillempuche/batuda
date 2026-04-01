# Engranatge

**Make your business run itself.**

Engranatge builds tools that let machines handle the work humans shouldn't waste time on — repetitive tasks, manual processes, data that nobody looks at until it's too late.

We sell automations, AI integrations, and micro-SaaS tools to local businesses. The goal is simple: free up people to do the work that actually matters.

Domains: `engranatge.com` (marketing) · `batuda.engranatge.com` (internal) · `api.engranatge.com` (server)

## What we build

**For clients** — automations, AI workflows, and small focused tools (micro-SaaS) that replace manual busywork in local businesses: auto-scheduling, smart invoicing, lead follow-up, inventory alerts, report generation, whatever the business needs.

**For ourselves** — Batuda, our internal sales prospecting tool:
- Track prospect companies through a pipeline
- Log every interaction: cold visits, calls, emails, LinkedIn, Instagram
- Store AI-researched company profiles and meeting notes
- Connect to n8n/Zapier via webhooks and API keys
- Expose all data to AI agents via MCP (Claude Code, Claude.ai, ChatGPT)
- Generate AI-powered prospect pages with multilingual support (ca/es/en)

## The idea

Most local businesses — restaurants, clinics, shops, agencies — run on manual labor that a machine could do better. Someone copies data from one spreadsheet to another. Someone sends the same follow-up email by hand. Someone checks inventory by walking to the back room.

These aren't hard problems. They're just problems nobody has solved for them yet, because enterprise software is too expensive and too complex, and their "tech guy" cousin set up a WordPress site in 2016.

Engranatge fills that gap:

1. **Automations** — Connect the tools they already use. When X happens, do Y. No code, no maintenance.
2. **AI integrations** — Let AI handle the stuff that requires judgment but not creativity: categorizing emails, writing first-draft invoices, summarizing customer feedback.
3. **Micro-SaaS** — Small, focused tools that do one thing well. A booking widget. An inventory alert system. A client follow-up tracker. Built fast, priced fair, maintained forever.

The philosophy: **machines do the low-value work, humans do the high-value work.** We don't replace people — we give them their time back.

## Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces |
| Dev environment | Nix flake (Node 24 + pnpm + kraft) |
| Shared schema | `packages/domain` — Effect Schema |
| CLI | `apps/cli` — Effect CLI + @clack/prompts TUI |
| Backend | `apps/server` — Effect v4 HTTP + MCP server |
| Internal frontend | `apps/internal` — TanStack Start (Batuda) |
| Marketing frontend | `apps/marketing` — TanStack Start (Engranatge) |
| Shared UI | `packages/ui` — design tokens + Tiptap blocks |
| Database | NeonDB (Postgres) |
| Server deploy | Unikraft via kraft CLI |
| Design system | MD3 tokens + BaseUI headless components |
| Code quality | Biome (lint + format, root config) |

## Quick start

```bash
nix develop          # enter dev environment
pnpm install         # install deps
pnpm cli setup       # copy .env files from examples
# edit .env — fill in DATABASE_URL, etc.
pnpm cli services up # start local Postgres via Docker
pnpm cli doctor      # verify everything is healthy
pnpm db:migrate      # apply migrations
pnpm dev:server      # terminal 1
pnpm dev:internal    # terminal 2
```

## Scripts

```bash
# CLI (no -- needed)
pnpm cli setup       # copy .env files from examples
pnpm cli doctor      # check environment health (DB, Docker, server)
pnpm cli seed        # insert sample data (additive)
pnpm cli db migrate  # run database migrations
pnpm cli db reset    # truncate + migrate + seed (clean slate)
pnpm cli services up # start Docker services
pnpm cli:tui         # interactive TUI menu (same commands)

# Development
pnpm dev:server      # start server (Effect HTTP + MCP)
pnpm dev:internal    # start internal app (Batuda)
pnpm dev:marketing   # start marketing app (Engranatge)

# Build & lint
pnpm build           # build all packages in order
pnpm lint            # Biome lint check
pnpm format          # Biome auto-format
pnpm check           # Biome lint + format (use in CI)
```

## Docs

- [Architecture](docs/architecture.md) — system design, data flow, deployment
- [Backend](docs/backend.md) — Effect v4 patterns, routes, MCP tools
- [Frontend](docs/frontend.md) — design tokens, MD3, BaseUI, components
- [Marketing](docs/marketing.md) — public site, prospect pages, i18n
- [Brand proposal](docs/brand-proposal.md) — visual identity, tone, metaphor
- [PostHog analysis](docs/posthog-analysis.md) — design reference study
- [Build plan](PLAN.md) — full scaffold specification

## AI agents

See [AGENTS.md](AGENTS.md) for how AI agents should interact with this system.

## Environment variables

```bash
DATABASE_URL      # NeonDB connection string
MCP_SECRET        # Bearer token for remote MCP (Claude.ai, ChatGPT)
PORT              # HTTP server port (default 3000)
MAPTILER_KEY      # MapTiler API key for map tiles
RESEND_API_KEY    # Resend email service
```
