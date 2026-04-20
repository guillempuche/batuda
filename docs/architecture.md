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
│  apps/internal  (Batuda web app — batuda.co)                    │
│  TanStack Start — Unikraft, Node.js SSR                          │
│                                                                  │
│  Pipeline  /companies  /companies/$slug  /tasks                 │
│                                                                  │
│  Calls apps/server HTTP API                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Tenant marketing sites (each tenant runs its own public site)   │
│  e.g. Engranatge tenant → engranatge.com (separate repo)         │
│  TanStack Start — deployed independently                         │
│  Fetches page content from apps/server at GET /pages/{slug}     │
│  CORS-allowed origin only — no other runtime coupling            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Email (AgentMail)                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Outbound: apps/server → AgentMail API → recipient       │   │
│  │  Inbound:  reply → AgentMail webhook → POST /webhooks/.. │   │
│  │  Both auto-logged as interactions                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Object storage (S3-compatible)                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Local dev: MinIO via docker compose (:9000)             │   │
│  │  Production: Cloudflare R2                                │   │
│  │  Stores: call recording audio (m4a/mp4/wav)              │   │
│  │  Linked to call interactions (existing or auto-created)  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Research providers (packages/research infrastructure)           │
│  Selected at boot via RESEARCH_PROVIDER_* env vars               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Brave Search │  │  Firecrawl   │  │  libreBORME/einforma │  │
│  │  (web search)│  │ (scrape/ext) │  │  (ES registries)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐   ���
│  │  LLM inference (Groq, Nebius, Fireworks, Together, etc.) │   │
│  │  via @effect/ai-openai-compat (OpenAI-compatible API)    │   │
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

### `packages/auth`

Bounded context for authentication. Owns the Better-Auth config builder plus a set of use cases (`bootstrapFirstAdmin`, `inviteUser`, `createApiKey`, `listUsers`, `promoteUser`, `revokeApiKey`, `resetPassword`, `listSessions`) consumed by both `apps/server` and `apps/cli`. Layered as:

- `domain/` — tagged errors (`UsersAlreadyExist`, `UserAlreadyExists`, `UserNotFound`, `ApiKeyNotFound`, `MagicLinkFailed`, `AuthConfigError`) + role/user/session value types
- `application/` — use cases + ports (`UserRepository`, `ApiKeyRepository`, `SessionRepository`, `MagicLinkSender`)
- `infrastructure/` — `buildBetterAuthConfig` (shared config builder), `makeBetterAuthAdapter` (pg + `betterAuth()` instance implementing the ports), scoped `acquirePgPool`

The shared builder is why CLI-minted API keys validate against the running server: any drift in plugin list, prefix scheme, or rate-limit shape would break the apiKey plugin's verification path.

### `packages/research`

Bounded context for company research. Owns the research agent loop, provider port interfaces, budget/quota services, output schemas, and infrastructure implementations. Layered as:

- `domain/` — tagged errors (`ProviderError`, `BudgetExceeded`, `MonthlyCapExceeded`, `QuotaExhausted`, `ApprovalRequired`) + value types (`SearchResult`, `ScrapedPage`, `DiscoverResult`, `RegistryRecord`, `CompanyReport`, etc.)
- `application/` — ports (`SearchProvider`, `ScrapeProvider`, `ExtractProvider`, `DiscoverProvider`, `RegistryRouter`, `ReportRouter`, `Budget`, `ProviderQuota`), `ResearchService` (fiber-per-run agent loop with PubSub for SSE), policy resolution, output schema registry (freeform, company-enrichment-v1, competitor-scan-v1, contact-discovery-v1, prospect-scan-v1)
- `infrastructure/` — boot-time provider selection (`providers-live.ts` for 6 capability ports, `llm-live.ts` for LLM inference), stub providers for zero-cost local dev, real providers (Brave Search, Firecrawl, libreBORME, einforma), cached search wrapper, OpenAI-compatible LLM layer via `@effect/ai-openai-compat`

Provider selection uses `Layer.unwrap + Config.schema` — env vars pick the implementation at startup, same pattern as `EmailProviderLive`. Each provider is a `Layer<PortTag, E, R>` with R declaring its dependencies (stubs need nothing, real providers need `HttpClient` + `Config`).

### `packages/controllers`

Shared HttpApi spec (route groups, tagged HTTP errors, middleware tag). Consumed by the server as handler targets and by the frontend as a typed Atom client.

### `packages/ui`

Shared design system for the Batuda web app and for tenant public marketing sites (consumed as a published npm package there). Contains:

- CSS design tokens (`tokens.css`) — MD3 typography, color, spacing, shape, elevation
- Tiptap custom block extensions (hero, cta, valueProps, painPoints, socialProof)

Consumers import tokens via `@import '@batuda/ui/tokens.css'` and use the shared block extensions for content consistency.

### `apps/cli`

Local development CLI and TUI. Two entry points:

- **CLI** (`pnpm cli <command>`) — scriptable commands via Effect CLI
- **TUI** (`pnpm cli:tui`) — interactive menu via @clack/prompts

Commands: `setup` (copy .env files), `doctor` (health checks), `seed` (sample data), `db migrate`/`db reset`, `services up`/`down`/`status` (Docker Compose).

Connects to Postgres via `@effect/sql-pg` using `DATABASE_URL` from `apps/cli/.env`. Commands that don't need the DB never require it.

### `apps/server`

Effect v4 HTTP server deployed at `api.batuda.co`. Responsibilities:

- REST API (consumed by both frontend apps)
- MCP server — stdio for Claude Code, HTTP/SSE for remote AI
- Page content API — public routes for prospect pages, internal routes for CRUD
- Outbound email via AgentMail (outreach, follow-ups) — auto-logged as interactions
- Inbound email reply handling via AgentMail webhooks — auto-logged as interactions
- Object storage for call recording audio (S3-compatible: MinIO local, R2 prod) — linked to call interactions (existing or auto-created on upload)
- Webhook fan-out (fire-and-forget POST to registered endpoints)
- API key authentication for external integrations

### `apps/internal`

Batuda web app — the multi-tenant SaaS CRM UI at `batuda.co`.
TanStack Start SSR app deployed to Unikraft (Node.js). Responsibilities:

- Pipeline and company management UI
- styled-components for co-located CSS with MD3 design tokens
- Rich text editing via Tiptap (public prospect pages; planned for research docs)
- Email composition via React Email v6 (`@react-email/editor`) — wraps Tiptap internally but the web app's email module never imports `@tiptap/*` directly; see `packages/email` and `docs/backend.md` § Email service
- Interactive map view via react-map-gl + MapLibre (company clustering)
- Page management (create, edit, publish prospect pages)
- Mobile-first, no backend logic
- Calls `apps/server` HTTP API for all data

---

## Bounded contexts

Batuda has three bounded contexts. Each owns its own domain errors and types; dependencies only flow from consumers (apps) into the packages, never sideways.

```
┌─────────────────────────────────────────────────────────────────┐
│  CRM context                                                     │
│                                                                  │
│    packages/domain  ──┐                                          │
│    packages/controllers ──┐                                      │
│                           ├──► apps/server (services, routes)    │
│                           └──► apps/internal (typed API client)  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Auth context                                                    │
│                                                                  │
│    packages/auth  ──┬──► apps/server/src/lib/auth.ts             │
│                     │     (serves /auth/*, wires magicLink +     │
│                     │      EmailProvider)                         │
│                     │                                             │
│                     └──► apps/cli/src/commands/auth-*.ts         │
│                           (bootstrap, invite, list, create-key,  │
│                            promote, revoke, reset, sessions)     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Research context                                                │
│                                                                  │
│    packages/research  ──► apps/server                            │
│      domain/     errors, value types (SearchResult, etc.)        │
│      application/                                                │
│        ports     6 capability ports + Budget + ProviderQuota     │
│        schemas/  output schemas (freeform, enrichment, etc.)     │
│        research-service  fiber-per-run agent loop + PubSub       │
│        budget    per-run + monthly spending control               │
│        policy    system defaults → user policy → per-run clamp   │
│      infrastructure/                                             │
│        stub/     7 stubs (zero-cost local dev)                   │
│        brave/    Brave Search API                                │
│        providers-live  boot-time selection (6 capabilities)      │
│        llm-live        boot-time LLM provider selection          │
│        cached-search   TTL cache wrapping SearchProvider         │
└─────────────────────────────────────────────────────────────────┘
```

**Dependency direction.** `packages/auth`, `packages/domain`, and `packages/research` have no dependency between them. All are consumed by the apps; the apps do not consume each other. Each context's domain errors stay within the context — if the server needs to map them to HTTP-surface errors, that mapping lives at the edge in `apps/server`, not in the packages.

**Why a shared `buildBetterAuthConfig`.** The CLI and server both instantiate `betterAuth(...)` — the CLI because it mints users/keys out-of-band, the server because it serves `/auth/*`. If the plugin list or field set drifts between the two, the apiKey plugin's verification path breaks at runtime (keys minted in one process fail to validate in the other). Keeping the builder in one place makes that drift impossible.

**Why the CLI omits `magicLink()`.** The magic-link sender depends on the server's `EmailProvider` service (local inbox catcher in dev, AgentMail in prod). The CLI doesn't run that service, so it injects its own `MagicLinkSender` port implementation when it needs to issue a link (see `pnpm cli auth invite`). The builder takes `plugins` as a parameter precisely so each caller supplies the plugin list it can back.

**Why research is a separate bounded context.** Research has its own domain model (providers, budgets, quotas, schemas), its own error hierarchy (`ProviderError`, `BudgetExceeded`, `QuotaExhausted`), and its own infrastructure concerns (external API keys, LLM inference, cost tracking). It reads CRM data (companies, contacts) but never writes directly — proposed changes go through the `propose_update` tool, reviewed by the outer AI or user before applying. This separation means research provider implementations, pricing models, and LLM providers can evolve independently of the CRM schema.

**Provider selection pattern.** Each of the 6 research capabilities (search, scrape, extract, discover, registry, report) plus LLM inference is configured by an env var (`RESEARCH_PROVIDER_*`) that picks the implementation at boot time. The pattern is `Layer.unwrap(Config.schema(...) → switch → return Layer)` — same as `EmailProviderLive`. Stubs provide zero-cost deterministic data for local dev. Real providers (Brave, Firecrawl, libreBORME, einforma) declare their dependencies (`HttpClient`, `Config`) in the R type, satisfied at the composition root.

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
Agent calls start_research(query, schemaName, subjects)
  → POST /v1/research → creates research_runs row (status: queued)
  → Server forks an Effect Fiber for the run

  Fiber phases (inside packages/research ResearchService):
    Phase 1 — Tool loop: LLM calls web_search, web_read, lookup_registry, crm_lookup
      Each tool call → routes through the matching provider port (Brave, Firecrawl, etc.)
      Findings accumulated, sources deduped and archived
    Phase 2 — Structured output: LLM.generateObject with the run's schema
      Findings → typed JSON (e.g. CompanyEnrichmentV1)
    Phase 3 — Brief generation: LLM.generateText → markdown summary

  → SSE events streamed to GET /v1/research/:id/events
  → Agent reads findings via get_research(id)
  → Agent calls propose_update to suggest CRM changes (reviewed before applying)
  → Agent calls create_task({ type: "call", ... }) for follow-up
```

### AI agent runs a fan-out prospect scan

```
Agent calls start_research(query, schemaName, selector: { table: companies, filter })
  → Server creates a parent group run + N leaf runs (one per matching company)
  → Leaf fibers run concurrently (capped by RESEARCH_MAX_CONCURRENCY_FANOUT)
  → Each leaf completion merges findings onto parent row (advisory-locked)
  → Parent status rolls up automatically (running → succeeded/failed)
  → Agent calls get_research(parentId) → gets full group with children inline
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
  → Page accessible at <tenant-domain>/ca/{slug} (e.g. engranatge.com/ca/{slug})
  → Agent creates translations: create_page({ slug, lang: "es", content: {...} })
```

### Prospect visits a page

```
Browser requests <tenant-domain>/ca/{slug} (e.g. engranatge.com/ca/{slug})
  → Tenant marketing site SSR calls GET api.batuda.co/pages/{slug}?lang=ca
  → Server returns published page content (Tiptap JSON + meta)
  → Tenant site renders blocks to HTML, emits SEO tags
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
kraft deploy                    # deploys to Unikraft Cloud → batuda.co
```

### Tenant marketing sites

Each tenant deploys its own public site from its own repo. The first tenant is Engranatge: its marketing repo (`engranatge-marketing`) deploys to KraftCloud (service `engranatge-marketing` → `engranatge.com`). No coupling to this repo except the server's CORS allow-list (`ALLOWED_ORIGINS` includes the tool origin `https://batuda.co` and each tenant origin, e.g. `https://engranatge.com`).

Both Batuda apps (server + web) run on Unikraft — stateless Node.js SSR. Scales to zero when idle.

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
call_recordings     — audio metadata per call (transcript columns nullable, populated in a later phase)
```

### Research tables (migration 0003_research)

```
research_runs       — one row per research run (leaf, group, or followup)
                      parent_id for fan-out groups, kind = leaf|group|followup
                      status = queued|running|succeeded|failed|cancelled|deleted
                      findings (jsonb), brief_md, tool_log, cost tracking columns
sources             — globally deduped web/registry/report sources (keyed by url_hash)
research_run_sources — many-to-many: runs ↔ sources (with local_ref citation key)
research_links      — polymorphic: runs ↔ companies/contacts (input or finding)
research_paid_spend — audit log: every paid API call with idempotency_key
user_research_policy — per-user budget/quota preferences
provider_quotas     — per-user per-provider quota config (monthly plan or pay-per-call)
provider_usage      — consumption counter per provider per billing period
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
