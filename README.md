# Engranatge

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Open-source automation platform for agencies serving local businesses.**

Build and sell automations, AI workflows, and micro-SaaS tools to restaurants, clinics, shops, and service businesses — with a built-in CRM to manage your sales pipeline.

## Why Engranatge

Most local businesses run on manual work a machine could handle: copying spreadsheets, sending follow-up emails by hand, checking inventory by walking to the back room. Enterprise software is too expensive and too complex for them.

Engranatge gives agencies like yours everything you need to fill that gap:

- **Automations** — connect the tools your clients already use. When X happens, do Y.
- **AI integrations** — let AI handle tasks that require judgment but not creativity: categorizing emails, drafting invoices, summarizing feedback.
- **Micro-SaaS** — small, focused tools that do one thing well. Booking widgets, inventory alerts, client follow-up trackers.
- **Built-in CRM (Forja)** — track prospects, log interactions (visits, calls, emails, LinkedIn, Instagram), and manage your pipeline.
- **AI-agent ready** — expose all data to AI agents via MCP (Claude, ChatGPT) and connect to n8n/Zapier via webhooks.
- **Multilingual prospect pages** — generate AI-powered pages for prospects with i18n support (ca/es/en).

## Tech stack

| Layer           | Technology                                          |
| --------------- | --------------------------------------------------- |
| Monorepo        | pnpm workspaces + Turborepo                         |
| Dev environment | Nix flake (Node 24 + pnpm + kraft)                  |
| Shared schema   | `packages/domain` — Effect Schema                   |
| CLI             | `apps/cli` — Effect CLI + @clack/prompts TUI        |
| Backend         | `apps/server` — Effect HTTP + MCP server            |
| Marketing site  | `apps/marketing` — TanStack Start                   |
| CRM frontend    | `apps/internal` — TanStack Start (Forja)            |
| Shared UI       | `packages/ui` — MD3 design tokens + BaseUI + Tiptap |
| Database        | Postgres (NeonDB)                                   |
| Deploy          | Unikraft via kraft CLI                              |
| Code quality    | Biome (lint + format) + dprint (markdown)           |

## Quick start

```bash
nix develop          # enter dev environment (or install Node 24 + pnpm manually)
pnpm install         # install dependencies
pnpm cli setup       # copy .env files from examples
# edit .env files — fill in DATABASE_URL, etc.
pnpm cli services up # start local Postgres via Docker
pnpm cli doctor      # verify everything is healthy
pnpm db:migrate      # apply migrations
pnpm dev:server      # terminal 1 — API + MCP server
pnpm dev:internal    # terminal 2 — CRM (Forja)
pnpm dev:marketing   # terminal 3 — marketing site
```

## Scripts

```bash
# CLI
pnpm cli setup         # copy .env files from examples
pnpm cli doctor        # check environment health
pnpm cli seed          # insert sample data
pnpm cli db migrate    # run database migrations
pnpm cli db reset      # truncate + migrate + seed
pnpm cli services up   # start Docker services
pnpm cli:tui           # interactive TUI menu

# Development
pnpm dev:server        # start API + MCP server
pnpm dev:internal      # start CRM app (Forja)
pnpm dev:marketing     # start marketing site

# Build & lint
pnpm build             # build all packages
pnpm lint              # lint + format
pnpm check             # lint + format (CI mode)
```

## Documentation

- [Architecture](docs/architecture.md) — system design, data flow, deployment
- [Backend](docs/backend.md) — Effect patterns, routes, MCP tools
- [Frontend](docs/frontend.md) — design tokens, MD3, BaseUI, components
- [Marketing](docs/marketing.md) — public site, prospect pages, i18n
- [AI agents](AGENTS.md) — how AI agents interact with this system

## Environment variables

```bash
DATABASE_URL      # Postgres connection string
MCP_SECRET        # Bearer token for remote MCP
PORT              # HTTP server port (default 3000)
MAPTILER_KEY      # MapTiler API key for map tiles
```

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
