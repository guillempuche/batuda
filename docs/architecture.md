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
│  │   stdio transport   │   │   /auth/* (Better Auth)          │ │
│  │   HTTP transport    │   │   /v1/companies /v1/contacts     │ │
│  │     at /mcp         │   │   /v1/interactions /v1/tasks     │ │
│  │                     │   │   /v1/proposals /v1/documents    │ │
│  │   tools + resources │   │   /v1/products /v1/webhooks      │ │
│  │   + prompts         │   │   /health /docs                  │ │
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
│                    │  Effect SQL    │                            │
│                    └───────┬────────┘                            │
└────────────────────────────┼────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │    NeonDB       │
                    │   (Postgres)    │
                    └─────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  apps/internal  (Forja — forja.engranatge.com)                 │
│  TanStack Start — Unikraft, Node.js SSR                          │
│                                                                  │
│  Pipeline  /companies  /companies/$slug  /tasks                 │
│                                                                  │
│  Calls apps/server HTTP API                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  apps/marketing  (Engranatge — engranatge.com)                   │
│  TanStack Start — Unikraft, Node.js SSR                          │
│                                                                  │
│  /  (homepage)  /:lang/:slug  (prospect pages)                  │
│                                                                  │
│  Calls apps/server HTTP API for page content                    │
│  SEO: hreflang, og tags, SSR                                    │
│  Languages: ca | es | en                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Email (Resend)                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Outbound: apps/server → Resend API → recipient          │   │
│  │  Inbound:  reply → Resend webhook → POST /webhooks/email │   │
│  │  Both auto-logged as interactions                         │   │
│  └──────────────────────────────────────────────────────────┘   │
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

- Effect Schema definitions for all entities
- Shared TypeScript types

No runtime code. Build output consumed by all apps.

### `packages/ui`

Shared between internal and marketing apps. Contains:

- CSS design tokens (`tokens.css`) — MD3 typography, color, spacing, shape, elevation
- Tiptap custom block extensions (hero, cta, valueProps, painPoints, socialProof)

Both apps import tokens via `@import '@engranatge/ui/tokens.css'` and use the shared block extensions for content consistency.

### `apps/cli`

Local development CLI and TUI. Two entry points:

- **CLI** (`pnpm cli <command>`) — scriptable commands via Effect CLI
- **TUI** (`pnpm cli:tui`) — interactive menu via @clack/prompts

Commands: `setup` (copy .env files), `doctor` (7 health checks), `seed` (sample data), `db migrate`/`db reset`, `services up`/`down`/`status` (Docker Compose).

Connects to Postgres via `@effect/sql-pg` using `DATABASE_URL` from `apps/cli/.env`. Commands that don't need the DB never require it.

### `apps/server`

Effect v4 HTTP server deployed at `api.engranatge.com`. Responsibilities:

- REST API (consumed by both frontend apps)
- MCP server — stdio for Claude Code, HTTP/SSE for remote AI
- Page content API — public routes for prospect pages, internal routes for CRUD
- Outbound email via Resend (outreach, follow-ups) — auto-logged as interactions
- Inbound email reply handling via Resend webhooks — auto-logged as interactions
- Webhook fan-out (fire-and-forget POST to registered endpoints)
- API key authentication for external integrations

### `apps/internal`

Forja — internal sales prospecting tool at `forja.engranatge.com`.
TanStack Start SSR app deployed to Unikraft (Node.js). Responsibilities:

- Pipeline and company management UI
- styled-components for co-located CSS with MD3 design tokens
- Rich text editing via Tiptap (documents, proposals)
- Interactive map view via react-map-gl + MapLibre (company clustering)
- Page management (create, edit, publish prospect pages)
- Mobile-first, no backend logic
- Calls `apps/server` HTTP API for all data

### `apps/marketing`

Engranatge — public marketing site at `engranatge.com`.
TanStack Start SSR app deployed to Unikraft (Node.js). Responsibilities:

- Marketing homepage for Engranatge brand
- Public prospect pages at `/:lang/:slug` (ca/es/en)
- Renders Tiptap JSON block content from `pages` table
- SSR for SEO: hreflang, og tags, canonical URLs
- View tracking (fire-and-forget POST on page load)
- No backend logic — calls `apps/server` HTTP API

---

## Data flow

### AI agent reads a company

```
Agent calls get_company(slug)
  → MCP tool queries DB via Effect SQL
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

### AI agent creates a prospect page

```
Agent researches company (get_company, Firecrawl/Exa)
  → Agent calls create_page({ company_id, slug, lang: "ca", template: "product-pitch", content: {...} })
  → Server creates pages row with status: "draft"
  → Agent reviews, then calls publish_page(id)
  → Server sets status: "published", published_at: now
  → Page accessible at engranatge.com/ca/{slug}
  → Agent creates translations: create_page({ slug, lang: "es", content: {...} })
```

### Prospect visits a page

```
Browser requests engranatge.com/ca/{slug}
  → apps/marketing SSR calls GET api.engranatge.com/pages/{slug}?lang=ca
  → Server returns published page content (Tiptap JSON + meta)
  → apps/marketing renders blocks to HTML, emits SEO tags
  → Client-side fires POST /pages/{slug}/view (fire-and-forget)
  → Server increments view_count
```

### n8n triggers on new client

```
Company status updated to "client" via MCP or web
  → Server fires webhook POST to all endpoints listening for "company.status_changed"
  → n8n receives payload, starts onboarding workflow
```

---

## Authentication (Better Auth)

All auth is handled by [Better Auth](https://www.better-auth.com/) v1.5.6 with plugins: `openAPI`, `bearer`, `admin`, `apiKey`.

**Two user types:**

- **Team members** — email/password sign-in, browser session cookies
- **AI agents** — admin-created users (`isAgent: true`), long-lived API keys via `x-api-key` header

**Route protection:**

| Routes                                                      | Auth                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /health`, `GET /pages/:slug`, `POST /pages/:slug/view` | Public — no auth                                                                  |
| `/auth/*`                                                   | Better Auth endpoints (sign-up, sign-in, session, API key management)             |
| All `/v1/*` routes                                          | Protected — `SessionMiddleware` validates cookie, bearer token, or API key        |
| `/mcp` (HTTP transport)                                     | Protected — HTTP middleware validates Better Auth session, provides `CurrentUser` |
| MCP stdio                                                   | Trusted local process — static `CurrentUser`                                      |

**API key flow for AI agents and external services (n8n, Zapier):**

1. Admin creates agent user: `POST /auth/admin/create-user`
2. Admin creates API key: `POST /auth/api-key/create`
3. Agent/service sends `x-api-key: sk_...` header
4. `@better-auth/api-key` plugin with `enableSessionForAPIKeys: true` mocks a session
5. `SessionMiddleware` validates uniformly via `auth.api.getSession()`

**MCP auth on behalf of user:**

MCP protocol has no built-in auth. Auth happens at the transport level:

- **HTTP** (`/mcp`): middleware validates Better Auth session on each POST, provides `CurrentUser` context to tool handlers
- **Stdio**: `CurrentUser` provided statically (trusted local user)
- Tool handlers can `yield* CurrentUser` for audit logging and permissions

---

## Deployment

### Server (Unikraft)

```bash
kraft build          # builds unikernel image
kraft run            # runs locally for testing
kraft deploy         # deploys to Unikraft Cloud
```

The server is stateless — all state in NeonDB. Scales to zero when idle.

### Internal (Unikraft)

```bash
pnpm --filter internal build   # produces .output/server/index.mjs
kraft build                     # builds unikernel image
kraft deploy                    # deploys to Unikraft Cloud → forja.engranatge.com
```

### Marketing (Unikraft)

```bash
pnpm --filter marketing build  # produces .output/server/index.mjs
kraft build                     # builds unikernel image
kraft deploy                    # deploys to Unikraft Cloud → engranatge.com
```

All three apps run on Unikraft — stateless Node.js SSR. Scales to zero when idle.

### Database (NeonDB)

- Managed Postgres — no infrastructure to run
- Use NeonDB branching for staging/preview environments
- Migrations via `pnpm db:migrate` run from local or CI

---

## Tables

### CRM tables (Effect SQL migrations)

```
companies           — core entity, all prospect/client data
contacts            — people at companies
interactions        — every touchpoint (call, visit, email, DM...)
tasks               — follow-up queue
products            — service/product catalog
proposals           — quotes sent to companies
documents           — long-form markdown (research, meeting notes)
pages               — public prospect sales pages (Tiptap JSON, multilingual)
webhook_endpoints   — outgoing webhook configuration
```

### Better Auth tables (auto-managed)

```
user                — auth users (team members + AI agents, with isAgent field)
session             — active sessions
account             �� auth provider accounts
verification        — email verification tokens
api_key             — hashed API keys (referenceId, configId, quotas, rate limits)
```

Relations: see `PLAN.md` § Entity relationships summary.

```
companies ──< pages (nullable — generic pages have no company)
pages: UNIQUE(slug, lang) — each language version is a separate row
```

---

## Key decisions

**Why NeonDB over SQLite:** analytics queries, JSONB for evolving metadata, email/calendar integrations planned. Postgres is the right foundation.

**Why Unikraft for server:** lightweight unikernel deployment, fast cold starts, matches the "lean infrastructure" philosophy of the project.

**Why Unikraft for web:** same deployment model as the server (Dockerfile + Kraftfile), Node.js SSR enables runtime CSS-in-JS (styled-components), scales to zero. Both apps on one platform simplifies ops.

**Why MCP over a custom SDK:** works with all major AI interfaces (Claude Code, Claude.ai, ChatGPT) without per-client integration work.

**Why documents as a separate table:** keeps company queries fast, allows multiple documents per company, enables fetching content only when needed (critical for AI context size).
