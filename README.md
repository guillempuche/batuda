# Batuda

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Open-source, multi-tenant SaaS CRM for small agencies serving local businesses.**

A workbench for independent agencies to manage prospects, log interactions, publish multilingual pages, and expose their pipeline to AI agents — all under one tenant-isolated instance.

## Contents

- [Why Batuda](#why-batuda)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start) · [Detailed walkthrough →](docs/getting-started.md)
- [Scripts](#scripts)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Why Batuda

Most agencies serving local businesses juggle prospect tracking in spreadsheets, send follow-ups by hand, and have no shared view of their pipeline. Enterprise CRMs are priced for sales teams of 50, not for one-to-five-person shops.

Batuda gives small agencies everything they need without the sprawl:

- **Multi-tenant by default** — every agency gets an isolated workspace, users, pages, and pipeline.
- **Pipeline + interactions** — track prospects, log visits, calls, emails, LinkedIn, Instagram. Next steps surface automatically.
- **Page publishing** — Tiptap-based page builder with hero/CTA/value blocks, multilingual, tenant-scoped.
- **AI-agent ready** — expose pipeline + documents to AI agents via MCP (Claude, ChatGPT) and connect to n8n/Zapier via webhooks.

The first tenant is [**Engranatge**](https://engranatge.com) — a one-person automation agency in Catalonia (and the author of this tool). Examples and seed data use a fictitious tenant **Taller** at `taller.cat` so contributors can explore the product without touching real data.

## Tech stack

| Layer           | Technology                                          |
| --------------- | --------------------------------------------------- |
| Monorepo        | pnpm workspaces + Turborepo                         |
| Dev environment | Nix flake (Node 24 + pnpm + kraft)                  |
| Shared schema   | `packages/domain` — Effect Schema                   |
| CLI             | `apps/cli` — Effect CLI + @clack/prompts TUI        |
| Backend         | `apps/server` — Effect HTTP + MCP server            |
| Web app         | `apps/internal` — TanStack Start                    |
| Shared UI       | `packages/ui` — MD3 design tokens + BaseUI + Tiptap |
| Database        | Postgres (NeonDB)                                   |
| Deploy          | Unikraft via kraft CLI                              |
| Code quality    | Biome (lint + format) + dprint (markdown)           |

## Quick start

**Requires:** Node 24, pnpm 10, Docker + Docker Compose. If you use [Nix](https://nixos.org), `nix develop` drops you into a shell with Node + pnpm already pinned.

```bash
nix develop                 # or: install Node 24 + pnpm manually
pnpm install                # install dependencies
pnpm cli setup              # copy .env files from .env.example
pnpm cli services up        # start Postgres + MinIO via Docker
pnpm cli db migrate         # create CRM + auth tables
pnpm cli auth bootstrap     # create first admin (interactive)
pnpm cli doctor             # verify everything is healthy
# in 2 terminals:
pnpm dev:server             # API + MCP server
pnpm dev:internal           # Batuda web app
```

First time? See the [detailed walkthrough](docs/getting-started.md) for explanations of each step, env var guidance, and troubleshooting.

## Scripts

```bash
# CLI
pnpm cli setup         # copy .env files from examples
pnpm cli doctor        # check environment health
pnpm cli seed          # insert sample data (Taller fictitious tenant)
pnpm cli db migrate    # run database migrations
pnpm cli db reset      # truncate + migrate + seed
pnpm cli services up   # start Docker services
pnpm cli:tui           # interactive TUI menu

# Development
pnpm dev:server        # start API + MCP server
pnpm dev:internal      # start Batuda web app

# Build & lint
pnpm build             # build all packages
pnpm lint              # lint + format
pnpm check             # lint + format (CI mode)
```

## Documentation

- [Getting started](docs/getting-started.md) — first-run setup, auth bootstrap, troubleshooting
- [Architecture](docs/architecture.md) — system design, data flow, deployment
- [Backend](docs/backend.md) — Effect patterns, routes, MCP tools
- [Frontend](docs/frontend.md) — design tokens, MD3, BaseUI, components
- [AI agents](AGENTS.md) — how AI agents interact with this system

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
