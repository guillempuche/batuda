# Architecture

## System overview

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Agents                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Claude Code  │  │  Claude.ai   │  │      ChatGPT         │  │
│  │  (local)     │  │   (web)      │  │      (web)           │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │ stdio MCP        │ HTTP/SSE MCP         │ HTTP/SSE MCP │
└─────────┼──────────────────┼─────────────────────┼─────────────-┘
          │                  │                      │
          ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/server  (Effect v4 — Unikraft)                            │
│                                                                  │
│  ┌─────────────────────┐   ┌──────────────────────────────────┐ │
│  │   MCP Server        │   │   HTTP API                       │ │
│  │   stdio transport   │   │   /companies /contacts           │ │
│  │   HTTP/SSE transport│   │   /interactions /tasks           │ │
│  │                     │   │   /proposals /documents          │ │
│  │   14 tools          │   │   /products /webhooks            │ │
│  │   2 resources       │   │                                  │ │
│  └──────────┬──────────┘   └────────────────┬─────────────────┘ │
│             │                                │                   │
│             └──────────────┬─────────────────┘                   │
│                            │                                     │
│                    ┌───────▼────────┐                            │
│                    │  Services      │                            │
│                    │  (business     │                            │
│                    │   logic)       │                            │
│                    └───────┬────────┘                            │
│                            │                                     │
│                    ┌───────▼────────┐                            │
│                    │  Drizzle ORM   │                            │
│                    └───────┬────────┘                            │
└────────────────────────────┼────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │    NeonDB       │
                    │   (Postgres)    │
                    └─────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  apps/web  (TanStack Start — Cloudflare Pages)                  │
│                                                                  │
│  Pipeline  /companies  /companies/$slug  /tasks                 │
│                                                                  │
│  Calls apps/server HTTP API                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  External automations                                            │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │     n8n      │  │    Zapier    │  ← authenticate via API key │
│  └──────┬───────┘  └──────┬───────┘                            │
│         │ webhook POST     │ webhook POST                        │
└─────────┼──────────────────┼─────────────────────────────────-──┘
          │                  │
          ▼                  ▼
     apps/server HTTP API  (/webhooks/...)
```

---

## Packages

### `packages/domain`
Shared between server and web. Contains:
- Drizzle table schemas (source of truth for DB structure)
- Effect Schema definitions for all entities
- Shared TypeScript types

No runtime code. Build output consumed by both apps.

### `apps/server`
Effect v4 HTTP server. Responsibilities:
- REST API (consumed by web frontend)
- MCP server — stdio for Claude Code, HTTP/SSE for remote AI
- Webhook fan-out (fire-and-forget POST to registered endpoints)
- API key authentication for external integrations

### `apps/web`
TanStack Start SSR app deployed to Cloudflare Pages. Responsibilities:
- Pipeline and company management UI
- Mobile-first, no backend logic
- Calls `apps/server` HTTP API for all data

---

## Data flow

### AI agent reads a company
```
Agent calls get_company(slug)
  → MCP tool queries DB via Drizzle
  → Returns: company fields + contacts + last 5 interactions
  → Documents NOT included (fetch separately with get_document)
```

### AI agent researches a new prospect
```
Agent uses Firecrawl/Exa MCP to scrape company website
  → Agent calls create_company(...) with structured fields
  → Agent calls create_document({ type: "research", content: <markdown> })
  → Agent calls create_task({ type: "call", title: "First cold call", due_at: ... })
```

### User logs a visit in the web UI
```
User fills interaction form
  → POST /interactions
  → Server creates interaction row
  → Server updates company.last_contacted_at
  → Server fires webhooks for event "interaction.logged"
  → Response returns updated company
```

### n8n triggers on new client
```
Company status updated to "client" via MCP or web
  → Server fires webhook POST to all endpoints listening for "company.status_changed"
  → n8n receives payload, starts onboarding workflow
```

---

## Authentication

**Web frontend → server:** No auth for now (personal tool, private deployment).

**External services (n8n, Zapier) → server:** API key in `x-api-key` header.
- Keys stored hashed (SHA-256) in `api_keys` table
- Each key has a `scopes` array
- Middleware validates key and attaches scopes to request context

**Remote MCP (Claude.ai, ChatGPT) → server:** Bearer token in `Authorization` header.
- Single secret from `MCP_SECRET` env var
- Checked on the `/mcp` SSE endpoint

---

## Deployment

### Server (Unikraft)
```bash
kraft build          # builds unikernel image
kraft run            # runs locally for testing
kraft deploy         # deploys to Unikraft Cloud
```
The server is stateless — all state in NeonDB. Scales to zero when idle.

### Web (Cloudflare Pages)
```bash
pnpm --filter web build
wrangler pages deploy .output/public
```
Or connect GitHub repo to Cloudflare Pages for automatic deploys on push to `main`.

### Database (NeonDB)
- Managed Postgres — no infrastructure to run
- Use NeonDB branching for staging/preview environments
- Migrations via `pnpm db:migrate` run from local or CI

---

## 9 tables

```
companies           — core entity, all prospect/client data
contacts            — people at companies
interactions        — every touchpoint (call, visit, email, DM...)
tasks               — follow-up queue
products            — service/product catalog
proposals           — quotes sent to companies
documents           — long-form markdown (research, meeting notes)
api_keys            — external integration auth
webhook_endpoints   — outgoing webhook configuration
```

Relations: see `PLAN.md` § Entity relationships summary.

---

## Key decisions

**Why NeonDB over SQLite:** analytics queries, JSONB for evolving metadata, email/calendar integrations planned. Postgres is the right foundation.

**Why Unikraft for server:** lightweight unikernel deployment, fast cold starts, matches the "lean infrastructure" philosophy of the project.

**Why Cloudflare Pages for web:** edge delivery, free tier, zero-config deploys, integrates with the existing `guillempuche.com` domain.

**Why MCP over a custom SDK:** works with all major AI interfaces (Claude Code, Claude.ai, ChatGPT) without per-client integration work.

**Why documents as a separate table:** keeps company queries fast, allows multiple documents per company, enables fetching content only when needed (critical for AI context size).
