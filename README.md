# Batuda

B2B prospecting CRM and automation platform for finding and converting local SMB clients.
Deployed at `batuda.guillempuche.com`.

## What it does

- Track prospect companies through a sales pipeline
- Log every interaction: cold visits, calls, emails, LinkedIn, Instagram
- Store AI-researched company profiles and meeting notes as markdown documents
- Connect to automation tools (n8n, Zapier) via webhooks and API keys
- Expose all data to AI agents via MCP (Claude Code, Claude.ai, ChatGPT)

## Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces |
| Dev environment | Nix flake (Node 24 + pnpm + kraft) |
| Shared schema | `packages/domain` — Drizzle ORM + Effect Schema |
| Backend | `apps/server` — Effect v4 HTTP + MCP server |
| Frontend | `apps/web` — TanStack Start → Cloudflare Pages |
| Database | NeonDB (Postgres) |
| Server deploy | Unikraft via kraft CLI |
| Design system | MD3 tokens + BaseUI headless components |
| Code quality | Biome (lint + format, root config) |

## Quick start

```bash
# Enter dev environment
nix develop

# Install deps
pnpm install

# Copy and fill env
cp .env.example .env
# Add DATABASE_URL from neon.tech dashboard

# Run migrations
pnpm db:migrate

# Start everything
pnpm dev:server   # terminal 1
pnpm dev:web      # terminal 2
```

## Scripts

```bash
pnpm db:generate     # generate Drizzle migration from schema changes
pnpm db:migrate      # apply migrations to NeonDB
pnpm db:studio       # open Drizzle Studio (local DB browser)
pnpm build           # build all packages in order
pnpm lint            # Biome lint check
pnpm format          # Biome auto-format
pnpm check           # Biome lint + format (use in CI)
```

## Docs

- [Architecture](docs/architecture.md) — system design, data flow, deployment
- [Backend](docs/backend.md) — Effect v4 patterns, routes, MCP tools
- [Frontend](docs/frontend.md) — design tokens, MD3, BaseUI, components
- [Build plan](PLAN.md) — full scaffold specification

## AI agents

See [AGENTS.md](AGENTS.md) for how AI agents should interact with this system.

## Environment variables

```bash
DATABASE_URL      # NeonDB connection string
MCP_SECRET        # Bearer token for remote MCP (Claude.ai, ChatGPT)
PORT              # HTTP server port (default 3000)
```
