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
│  TanStack Start — Cloudflare Workers SSR                         │
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
│  Email (generic IMAP/SMTP — bring your own mailbox)              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Outbound: apps/server → SMTP (nodemailer) → recipient   │   │
│  │            then APPEND to user's Sent folder via IMAP    │   │
│  │  Inbound:  apps/mail-worker holds IMAP IDLE per inbox    │   │
│  │            persists raw RFC822 to R2 + parsed bodies     │   │
│  │            DSN bounces (RFC 3464) flip status='bounced'  │   │
│  │  Credentials: AES-256-GCM on inboxes row (HKDF subkey)   │   │
│  │  Providers: Infomaniak / Fastmail / M365 / Proton Bridge │   │
│  │             / Gmail Workspace / Generic IMAP             │   │
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

### Intelligence locus

The primary intelligence is *external* — the MCP client (Claude, ChatGPT) the user talks to does most of the reasoning and generation (email bodies, chat replies, synthesis). apps/server is the data, tools, and authoring surface; it hosts *specialized* server-side intelligence only where it earns its place — `research` runs a server-side agent loop because it needs the budget/provider/cache and fan-out the external client can't run. So the leverage is being an excellent MCP context provider (tools, resources, prompts) plus a few deep specialized agents, not a general brain.

Instruction templates follow the same split, *per surface*: the research agent enforces its resolved stack server-side, while client-composed surfaces (email, chat) expose their stack as advisory context the external client reads — via the `batuda://instructions/{agent}` resource — and follows when it composes.

---

## Packages

### `packages/domain`

Shared between server and web. Contains:

- Effect Schema definitions for all entities
- Shared TypeScript types

No runtime code. Build output consumed by all apps.

### `packages/auth`

Bounded context for authentication. Owns the Better-Auth config builder plus the auth use cases (one file per use case under `packages/auth/src/application/` — `ls packages/auth/src/application/` for the current set) consumed by both `apps/server` and `apps/cli`. Layered as:

- `domain/` — tagged errors (`UsersAlreadyExist`, `UserAlreadyExists`, `UserNotFound`, `ApiKeyNotFound`, `MagicLinkFailed`, `AuthConfigError`) + role/user/session value types
- `application/` — use cases + ports (`UserRepository`, `ApiKeyRepository`, `SessionRepository`, `MagicLinkSender`)
- `infrastructure/` — `buildBetterAuthConfig` (shared config builder), `makeBetterAuthAdapter` (pg + `betterAuth()` instance implementing the ports), scoped `acquirePgPool`

The shared builder is why CLI-minted API keys validate against the running server: any drift in plugin list, prefix scheme, or rate-limit shape would break the apiKey plugin's verification path.

### `packages/research`

Bounded context for company research. Owns the research agent loop, provider port interfaces, budget/quota services, output schemas, and infrastructure implementations. Layered as:

- `domain/` — tagged errors (`ProviderError`, `BudgetExceeded`, `MonthlyCapExceeded`, `QuotaExhausted`, `ApprovalRequired`) + value types (`SearchResult`, `ScrapedPage`, `RegistryRecord`, `CompanyReport`, etc.)
- `application/` — ports (`SearchProvider`, `ScrapeProvider`, `RegistryRouter`, `ReportRouter`, `Budget`, `ProviderQuota`), `ResearchService` (fiber-per-run agent loop with PubSub for SSE), policy resolution, output schema registry (freeform, company-enrichment-v1, competitor-scan-v1, contact-discovery-v1, prospect-scan-v1)
- `infrastructure/` — boot-time provider selection (`providers-live.ts` for the capability ports, `llm-live.ts` for LLM inference), stub providers for zero-cost local dev, real providers (Brave Search, Firecrawl, libreBORME, Companies House, Hunter), cached search wrapper, OpenAI-compatible LLM layer via `@effect/ai-openai-compat`

Provider selection uses `Layer.unwrap + Config.schema` — env vars pick the implementation at startup, same pattern as `EmailProviderLive`. Each provider is a `Layer<PortTag, E, R>` with R declaring its dependencies (stubs need nothing, real providers need `HttpClient` + `Config`).

### `packages/instructions`

Bounded context for AI instruction templates — named, reusable prompt blocks (org- or user-owned) plus per-(surface, scope) default stacks that compose an agent's prompt. Surface-neutral: the same template can apply to any agent. Layered as:

- `domain/` — the code-defined surface set (`research`, `email`; a string set, not a DB enum, so adding a surface is a code change, never a migration), plus template/stack/donation value types. Exposed at the browser-safe `@batuda/instructions/domain` subpath so the web shares the same surface set.
- pure logic — the precedence ladder (per-run override > user stack > org default > none), name/id reference resolution scoped by RLS, replace/extend stack composition, and the donation flow (personal → org)
- `resolveInstructions` turns a run's (org, user, agent) into ordered prompt segments + a cache fingerprint; the table DDL lives with the app's migrations, not here

The research agent enforces its resolved stack server-side; client-composed surfaces (email) read their stack as advisory context via the `batuda://instructions/{agent}` MCP resource. See §Intelligence locus.

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
- **TUI** (`pnpm cli:tui`) — interactive menu via @clack/prompts. The menu is auto-generated by walking the exported `batuda` command tree from `cli.ts`; leaves are executed in-process via `Command.runWith`. New `Command.make` entries in `cli.ts` appear in both surfaces with no extra wiring, and `Flag.withFallbackPrompt` drives prompts identically in both.

Both entry points accept `--env local|cloud`. The flag selects **non-secret** configuration only: in cloud mode the loader layers `apps/server/config.production.json` — the deployed server's own committed settings — over the local `.env` baseline. Secrets never come from a file; they are injected by running the command under `infisical run --env=prod`, and anything already present in the environment outranks every file the loader reads.

Destructive commands do not trust the flag; both guards read the host out of the resolved `DATABASE_URL`. `requireLocalDatabase` hard-fails `db reset` and `seed` against any non-local host — no prompt, no override, since rebuilding a real database from empty is never the intent. `confirmCloud` gives the `auth` writes a `y/N` confirm instead, because reaching production *is* their purpose. Either way a forgotten `--env cloud` changes nothing, and a localhost target is never obstructed.

Commands: `setup` (copy .env files), `doctor` (health checks), `seed` (sample data), `db migrate`/`db reset`, `services up`/`down`/`status` (Docker Compose), plus the `auth`/`calendar`/`email` groups documented separately.

Connects to Postgres via `@effect/sql-pg` using `DATABASE_URL` from `apps/cli/.env`. Commands that don't need the DB never require it.

### `apps/server`

Effect v4 HTTP server deployed at `api.batuda.co`. Responsibilities:

- REST API (consumed by both frontend apps)
- MCP server — stdio for Claude Code, HTTP/SSE for remote AI
- Page content API — public routes for prospect pages, internal routes for CRUD
- Outbound email via per-org IMAP/SMTP credentials (`nodemailer` SMTP + IMAP `APPEND` to Sent) — auto-logged as interactions
- Inbound email handled by `apps/mail-worker` (IMAP IDLE per inbox), not by `apps/server`
- Object storage for call recording audio (S3-compatible: MinIO local, R2 prod) — linked to call interactions (existing or auto-created on upload)
- Webhook fan-out (fire-and-forget POST to registered endpoints)
- API key authentication for external integrations

### `apps/internal`

Batuda web app — the multi-tenant SaaS CRM UI at `batuda.co`.
TanStack Start SSR app deployed to Cloudflare Workers. Responsibilities:

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
│                           (run `pnpm cli auth --help` for the    │
│                            current subcommand list)              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Research context                                                │
│                                                                  │
│    packages/research  ──► apps/server                            │
│      domain/     errors, value types (SearchResult, etc.)        │
│      application/                                                │
│        ports     capability ports + Budget + ProviderQuota       │
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

**Why the CLI omits `magicLink()`.** The magic-link sender depends on the server's `EmailProvider` service (local inbox catcher in dev, real SMTP via the requesting org's primary inbox in prod). The CLI doesn't run that service, so it injects its own `MagicLinkSender` port implementation when it needs to issue a link (see `pnpm cli auth invite`). The builder takes `plugins` as a parameter precisely so each caller supplies the plugin list it can back.

**Why research is a separate bounded context.** Research has its own domain model (providers, budgets, quotas, schemas), its own error hierarchy (`ProviderError`, `BudgetExceeded`, `QuotaExhausted`), and its own infrastructure concerns (external API keys, LLM inference, cost tracking). It reads CRM data (companies, contacts) but never writes directly — proposed changes go through the `propose_update` tool, reviewed by the outer AI or user before applying. This separation means research provider implementations, pricing models, and LLM providers can evolve independently of the CRM schema.

**Provider selection pattern.** Each research capability (search, scrape, enrich, verify, registry, report) plus LLM inference is configured by an env var (`RESEARCH_PROVIDER_*`) that picks the implementation at boot time. The pattern is `Layer.unwrap(Config.schema(...) → switch → return Layer)` — same as `EmailProviderLive`. Stubs provide zero-cost deterministic data for local dev. Real providers (Brave, Firecrawl, libreBORME, Companies House, Hunter) declare their dependencies (`HttpClient`, `Config`) in the R type, satisfied at the composition root.

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

Research runs its own server-side agent loop across MCP, HTTP, and the web app. Its input modes (including the selector fan-out scan), run lifecycle, contact discovery, cost rails, and surfaces are documented together in [§Research](#research).

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

## Research

Research is Batuda's largest feature and the one place the server runs its own AI agent loop. An agent — Claude or ChatGPT over MCP, or a team member through the web app — asks a question; the server drives a tool-calling loop over the external web and structured-data providers, produces findings with inline citations, and proposes (never applies) changes to CRM rows. It spans all three surfaces: the MCP tools an external agent calls, the HTTP API and SSE stream the web app drives, and the `packages/research` bounded context that runs the loop. This section is the flow-level reference; the code shape lives in [backend.md](backend.md) and evolves independently of it.

### Why it runs server-side

Most Batuda intelligence is external — the MCP client does the reasoning and generation (see [Intelligence locus](#intelligence-locus)). Research is the deliberate exception: it needs a budget governor, provider selection and caching, a citation ledger, and bounded fan-out that an external client cannot run. So the server hosts the loop and the external agent consumes it as tools. Research reads CRM data (companies, contacts) but never writes it directly — every change is a proposal a human or the outer agent applies.

### Capabilities

Every external capability is a role, not a vendor. Each is a port selected at boot by a `RESEARCH_PROVIDER_*` env var, with a comma-list fallback chain and a zero-cost stub for local dev. The roles:

- **search** — web search (e.g. Firecrawl, Brave)
- **scrape** — fetch a page as markdown, or as structured JSON against a schema (Firecrawl)
- **enrich** — decision-maker name + email discovery for a company (Hunter)
- **verify** — email deliverability, with a free DNS MX pre-gate in front of it (Hunter)
- **registry** — company identity + officers, routed by country (libreBORME for Spain, Companies House for the UK)
- **report** — a paid deep company report, routed by country (the port is defined; no live vendor is wired yet)

The agent sees the role (`registry_lookup`, not the vendor); swapping a provider is an env change plus an adapter, never a change to the loop.

### Input modes

One entry point, three shapes of request:

- **Free-text exploratory** — "agroecology cooperatives frustrated with spreadsheets." No anchor; the loop searches, reads, dedupes against the CRM, and returns a standalone list of prospects the user can import.
- **Subject-anchored** — "enrich this company." The run is pinned to a CRM row, snapshotted at a known version; proposed updates target that row and are blocked by optimistic concurrency if it changed meanwhile.
- **Selector fan-out** — "for each lead matching this filter, find recent funding news." The server expands the filter into N child runs under one parent, runs them with bounded concurrency, and rolls their cost and status up to the parent.

### The run flow

A run is dispatched, not run inline. `start_research` commits a run row as `queued` inside the request transaction and returns immediately; a consumer daemon drains the queue and runs each as a fiber on its own connection. The fiber has three phases: a tool-calling loop (search, read, registry, CRM lookup — accumulating findings and archiving each source), a structured-output pass that validates the findings against the run's schema, and a brief pass that renders a human-readable markdown summary. Tool calls stream to the web app over SSE as they happen; findings, sources, and the tool log persist at the end.

The first phase starts from the target's own site where there is one: the run maps that domain and reads its own pages before anything a search engine offers, because a company is the best source on itself. The second phase does not settle for what the first pass happened to find — fields still empty afterwards earn further rounds of targeted search and scraping, each round re-running the guards, until the fields fill or the run's budget or deadline stops it.

A run says how far it got rather than reporting a flat success. `succeeded` means the findings are grounded and confident; `succeeded_low_confidence` means real findings came back but thin enough to want a person's eye, and the web app surfaces those for review; `no_reliable_data` is the honest answer when nothing could be grounded, which is preferred to shipping a confident guess; `failed` and `cancelled` cover a run that broke or was stopped.

Because those fibers live in the server process, a deploy interrupts in-flight runs. A running fiber refreshes a heartbeat while it works, and a periodic sweep fails any run whose heartbeat has gone stale — so an orphaned run is reclaimed within about a minute, while a legitimately long run keeps beating and is never mistaken for dead. Reclaim only marks a run `failed`; a paid run is never silently re-run.

At a glance:

```
  start_research  →  run row 'queued'  →  consumer daemon  →  fiber (own connection)

  Phase 1 · agent reflect-loop
      web_search · scrape_page · registry_lookup · crm_lookup
      site discovery: map the target's own domain and read its own pages first
      accumulate findings, archive each source as it is read

  Phase 2 · structured extraction
      validate the findings against the run's schema
      guard chain — a list of named links, run in the order they are written:
          citations · contact entity · scalars · websites · value provenance
          fit evidence · vocabulary · applicability · discovered-existing
          prospect criteria · model critics · per-source entity · source tier
      gap rounds: fields still empty earn another targeted search and scrape,
          until the run's budget or its deadline says stop

  Phase 3 · brief
      render a markdown summary, headed with the company and the date

  tool calls stream to the web app over SSE as they happen
  findings + sources + tool log persist
  status = succeeded | succeeded_low_confidence | no_reliable_data
         | failed | cancelled
  proposed updates  →  a human (or the org's auto-apply threshold) applies each
```

### What an apply writes

Research proposes; applying is what actually changes a CRM row, and it records more than the values themselves.

Alongside each accepted value the row keeps **where that value came from** — the page it was read from, the run that read it, how sure that run was, and the date it was true as of. That trail accumulates rather than being replaced: a run that fills only a phone number leaves untouched the note saying where an earlier run found the industry. The row also keeps **when research was last accepted onto it**, so a stale company is visible without opening anything, and the run's **fit judgement** — an overall verdict, the per-criterion checks with the quote and page that decided each, and any readings the sources disagreed on. Fit is filterable, so "who actually passes this rule?" is a question the CRM can answer.

The **account brief** is written by both sides. While nobody has edited it, an apply replaces it with the run's own brief — the AI may freely improve its own text. Once a person edits it, the brief becomes theirs: later runs add a new dated section underneath and never overwrite what was written. That decision is made inside the same statement that performs the write, reading the row as it stands, so a person's edit and a run's apply cannot interleave and lose each other. An agent editing over MCP writes the text but does not take ownership, so it can never make its own writing look like a person's and shut research out.

Auto-apply is narrower than a person's reach. An org can set a confidence threshold above which proposals apply without review, but it only ever runs for a fully succeeded run, and never for a value whose confidence was capped for coming from a third party rather than the company itself — an outside estimate always waits for a human.

### Contact discovery

Turning a company into ranked, verified decision-maker contacts is its own flow, shared by the `discover_contacts` tool and the in-loop path. It is registry-first where a national registry exists — those officers are free and authoritative — and falls back to the paid enrichment provider elsewhere. For each person it takes the vendor's email or generates ordered pattern guesses (`first.last`, `flast`, …), gates every candidate through the free MX check, and verifies deliverability. A guessed address is asserted only when the verifier positively confirms it; a vendor-provided address is kept unless it verifies as undeliverable. Contacts come back ranked — decision-makers first, then by deliverability verdict — and the flow never writes CRM rows; the caller decides what to keep.

### Cost & safety rails

Two independent layers gate every external call, and the agent experiences both only as tool errors — it never reads a policy.

- **Provider quota** (hard limit) — does the user have units left with this provider? A `QuotaExhausted` tells the agent to try an alternative provider.
- **Resource budget** (volume governor) — notional per-run and per-month cents, so one run cannot burn a disproportionate share even of prepaid credits. A `BudgetExceeded` tells the agent to finish with what it has.

The rules the loop follows: climb cost tiers only when a cheaper one cannot answer (cheap web search and scrape before a paid per-company report); never exceed the paid budget without proposing the paid action for human approval; and the monthly cap is the only rail a user cannot override per-run, enforced exactly under a per-user advisory lock so concurrent fan-out fibers cannot overshoot it.

Three safety invariants hold regardless of budget: the agent never mutates a CRM row (it proposes; a human applies, under optimistic concurrency), every claim in the findings must carry a citation that resolves to an archived source (an uncited claim fails the run), and paid calls are metered idempotently so a retried fiber is never double-charged.

### Surfaces

The same loop is reached three ways. External agents call the MCP tools (`start_research`, `get_research`, and the in-loop `web_search` / `scrape_page` / `registry_lookup` / `discover_contacts` and the propose-update family) and read a run as an MCP resource. The web app drives the HTTP API — create a run, poll or stream it over SSE, approve a paid action, apply or reject a proposed update. And the research page renders the findings, the human brief, the source list with archived snapshots, and the proposals panel where a human applies changes.

### Data model

Research owns a small set of tables, created together in the `research` migration: `research_runs` (one row per run — leaf, group, or follow-up — with findings, brief, cost, and tool log), `sources` and `research_run_sources` (globally-deduped sources linked to runs with a stable citation ref), `research_links` (polymorphic run ↔ company/contact links carrying applied-change provenance), `research_paid_spend` (an idempotent audit row per paid call), and the policy and quota tables (`user_research_policy`, `provider_quotas`, `provider_usage`). Companies and contacts are soft-deleted so a research link never dangles, and carry a version column so a proposed update cannot silently overwrite a human edit made mid-run. An hourly sweep prunes run transcripts and orphaned scrape blobs past their retention window while keeping every applied contact's provenance trail.

### Quality — the eval harness

A CLI eval measures the pipeline against a fixed golden set of companies whose correct answers are known, so a change to grounding or extraction shows up as a number rather than a guess. It reports grounding accuracy (did the run reach the target company's own site, or confirm it in a registry?), field precision and recall, titled-contact recall (did it find the company's decision-makers?), and the wrong-company and empty rates — the look-alike failure the harness exists to catch. It runs on demand from the CLI, never in production, and can export each run's scores to the observability board.

### Observability

The run lifecycle fires webhook events (`research.created`, `research.tool_called`, `research.budget_exceeded`, `research.approval_required`, `research.succeeded`, `research.failed`, `research.paid_spend_recorded`, `research.quota_exhausted`, and the proposed-update-applied event) and emits spans and metrics; see [observability.md](observability.md).

---

## Authentication (Better Auth)

All auth is handled by [Better Auth](https://www.better-auth.com/) v1.6.11 with plugins: `openAPI`, `bearer`, `admin`, `apiKey`, `organization`, `magicLink`, `jwt`, and `oauthProvider` (the OAuth 2.1 authorization server for web-chat MCP clients).

**Multi-org scoping.** Every request resolves an `activeOrganizationId` from the session (or env var, for MCP stdio in dev). Middleware loads the matching `organization` row into a `CurrentOrg` ServiceMap service, then opens a transactional connection that runs `SET LOCAL app.current_org_id = $orgId` before any tenant-scoped reads/writes. Three Postgres roles enforce isolation: `app_user` (RLS enforced — HTTP + MCP path), `app_service` (BYPASSRLS — mail worker + cron jobs that resolve org ownership explicitly per row), and `app_mcp_resolver` (a NOLOGIN role the MCP OAuth path switches into to read a caller's own memberships and consents under user-scoped RLS).

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

**API key flow.** Two kinds of `x-api-key` keys exist:

- **Org-scoped keys** (the `/mcp` path) — any org member self-serves them under
  `/settings/api-keys`. Each key is owned by the org's agent user but stamps its
  creating member in metadata. On a `/mcp` call the key resolves to its org plus
  that member — re-checking a live `member` row, so the key stops working once the
  creator leaves the org — and the session acts as the member, so actions
  attribute to the person. Keys carry a per-key rate limit (`API_KEY_RATE_LIMIT_*`,
  enabled in prod); a throttled key gets `429` + `Retry-After`.
- **User-owned keys** (admin / external integrations like n8n, Zapier) — minted
  out-of-band against a specific user (`pnpm cli auth create-key` or
  `POST /auth/api-key/create`). They carry no org metadata and serve `/auth/admin/*`
  and webhook callers, not `/mcp`.

Both are validated by `@better-auth/api-key` (`enableSessionForAPIKeys: true`); `SessionMiddleware` validates `/v1/*` uniformly via `auth.api.getSession()`.

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

### Internal (Cloudflare Workers)

```bash
pnpm turbo run build --filter=@batuda/internal   # @cloudflare/vite-plugin → dist/
cd apps/internal && wrangler deploy               # uploads Worker + assets
```

The `src/worker.ts` entry SSRs the app and forwards `/auth/*`, `/v1/*`,
`/openapi.json`, `/docs/*` to `api.batuda.co` (the API stays on Unikraft).
The `batuda.co/*` Workers Route is bound out-of-band, not by the deploy.

### Tenant marketing sites

Each tenant deploys its own public site from its own repo. The first tenant is Engranatge: its marketing repo (`engranatge-marketing`) deploys to KraftCloud (service `engranatge-marketing` → `engranatge.com`). No coupling to this repo except the server's CORS allow-list — `ALLOWED_ORIGINS` lists the tool origin `https://batuda.co` and each tenant origin (e.g. `https://engranatge.com`) as literal entries (see [backend.md → Cross-origin policy](backend.md#cross-origin-policy)).

The server runs on Unikraft (stateless Node.js, scales to zero when idle); the web app runs on Cloudflare Workers (SSR at the edge).

### Database (NeonDB)

- Managed Postgres — no infrastructure to run
- Use NeonDB branching for staging/preview environments
- Migrations via `pnpm db:migrate` run from local or CI

---

## Environment variables & secrets

Configuration splits two ways: **secret vs non-secret** (secrets are never committed), and **where the code runs** — a developer's machine versus the deployed cloud. The through-line is that Infisical is the single source of truth for every secret, while non-secret values are committed to the repo.

### Local machine

A local process (server, CLI, tests) reads a gitignored root `.env`, seeded from the committed `.env.example` template — Docker Postgres/MinIO endpoints, `stub` research providers, throwaway dev secrets — so a fresh clone runs end-to-end with no real credentials. `apps/internal/.env.example` is the web app's template; a git worktree gets its own generated `.env` from `pnpm cli worktree up` (see the `worktrees` skill).

Real cloud values reach a local machine one way: `infisical run --env=<env> -- <command>` injects one Infisical environment's secrets into a single process — nothing lands on disk. That is how the research eval gets real dev-tier keys, and how the CLI reaches production:

```bash
infisical run --env=prod -- pnpm cli auth invite-admin --env cloud …
```

The `--env cloud` flag contributes only the non-secret half, read from `apps/server/config.production.json` (§ `apps/cli` above). The two are deliberately separate: the Infisical environment decides *which credentials*, the flag decides *which settings*, and neither can quietly stand in for the other.

### Deployed cloud — Infisical → GitHub Actions → the instance

Infisical (project pinned in `.infisical.json`) holds the cloud secrets, organized by **environment** (`dev`, `prod`) and by **folder**, and a sync in Infisical's GitHub integration pushes each folder down into a GitHub Actions **environment**. No workflow calls `infisical` — the deploy only ever reads `${{ secrets.* }}`. The folder → GitHub-environment split mirrors a trust boundary: the one credential that can rewrite the prod schema sits alone, behind its own reviewer gate.

| Infisical `prod` folder | GitHub environment | Read by                                                                 | Holds                                                                                                                                                                             |
| ----------------------- | ------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` (root)              | `production`       | server `deploy` job → injected into the Unikraft instance as `-e VAR=…` | runtime secrets — `DATABASE_URL` (pooled, `app_service`), `BETTER_AUTH_SECRET`, `STORAGE_*`, `EMAIL_*`, `RESEARCH_*`, `CALENDAR_*`, plus `KRAFTCLOUD_TOKEN` for the deploy itself |
| `/ci`                   | `production-db`    | gated `migrate` job                                                     | only `MIGRATION_DATABASE_URL` — schema-owner `neondb_owner` over the **unpooled** endpoint, the connection that runs DDL/`GRANT`; `production-db` requires a reviewer's approval  |

So adding or rotating a cloud secret is an edit in Infisical (the matching `prod` folder) — never in GitHub and never in a file — and the sync carries it to the right environment. The prod migration credential, for instance, is `MIGRATION_DATABASE_URL` in `prod` → `/ci`; see [runbooks.md → Applying database migrations](runbooks.md#applying-database-migrations) for why it is quarantined and reviewer-gated.

Non-secret deployed config does **not** ride this path: boot-required non-secret values (`ALLOWED_ORIGINS`, the research provider/model selections, `RESEARCH_MAX_*`) live in `apps/server/config.production.json`, shipped with the image and loaded at boot — `apps/server/src/lib/config-provider.ts` throws if the file is missing. The GitHub Actions **Variables** mentioned above are a separate non-secret store, used only by the CLI's cloud mode, not by the deploy.

---

## Tables

### CRM tables (Effect SQL migrations)

```
companies           — core entity, all prospect/client data
contacts            — people at companies (email stays the canonical send address)
contact_channels    — open per-contact channel list (email, phone, linkedin, x, website, bluesky...)
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
research_links      — polymorphic: runs ↔ companies/contacts (input or finding);
                      citations (jsonb) carries the applied row's provenance trail
research_paid_spend — audit log: every paid API call with idempotency_key
user_research_policy — per-user budget/quota preferences + auto_apply_min_confidence
provider_quotas     — per-user per-provider quota config (monthly plan or pay-per-call)
provider_usage      — consumption counter per provider per billing period
```

**Retention.** A scheduled sweep (`ResearchRetention`, in `ServicesLive`) runs hourly and prunes storage that would otherwise grow unbounded: expired cache rows (their TTL only gates reads), the `research_text` + `tool_log` transcript of runs older than `RESEARCH_RETENTION_DAYS` (default 90), and scrape blobs whose `sources` row no surviving run fetches and no applied contact cites. It keeps the run rows, `sources`, `research_run_sources`, and `research_links.citations`, so a contact's provenance trail survives the prune (see [§Research](#research)).

### Better Auth tables (auto-managed)

```
user                — auth users (team members + AI agents, with isAgent field)
session             — active sessions; activeOrganizationId picks per-request tenant
account             — auth provider accounts
verification        — email verification tokens
api_key             — hashed API keys (referenceId, configId, quotas, per-key
                      rate limits; metadata carries organizationId + createdByUserId
                      for org-scoped /mcp keys)
organization        — tenant root; users belong via member rows
member              — (organization_id, user_id) plus primary_inbox_id additionalField
invitation          — created by Better Auth's schema, unused by Batuda:
                      people are added straight to an org, never invited.
                      Kept RLS-policied so the live table is never unguarded.
```

### Email tables (per-org, RLS-enforced)

```
inboxes              — one row per IMAP+SMTP mailbox; carries credentials
                       (password_ciphertext/nonce/tag, AES-256-GCM, HKDF
                       subkey from EMAIL_CREDENTIAL_KEY + inbox.id),
                       grant_status, folder_state JSONB per IMAP folder.
                       Owned by (organization_id, owner_user_id);
                       purpose ∈ {human, agent, shared}
email_thread_links   — (organization_id, external_thread_id) where
                       external_thread_id is the thread root's RFC Message-ID
email_messages       — every fetched/sent message; raw_rfc822_ref points at
                       R2 object; status ∈ {normal, spam, blocked, bounced}
                       with bounce_type/bounce_sub_type populated by the
                       worker's DSN parser
inbox_footers        — per-inbox signature blocks
email_draft_bodies   — sidecar storage for in-progress draft authoring trees
email_attachment_staging — attachment uploads pending send
message_participants — flat index of From/To/Cc/Bcc per message
```

All email tables enable RLS with policy `organization_id = current_setting('app.current_org_id')`. `message_participants` uses a subquery policy via its joined `email_messages` row.

Relations across the CRM tables:

```
companies ──< contacts
companies ──< interactions >── contacts
companies ──< tasks        >── contacts
companies ──< proposals    >── contacts
companies ──< documents    >── interactions
companies ──< pages (nullable — generic pages have no company)
webhook_endpoints (standalone)
api_keys (standalone)
products (standalone, referenced by proposals.line_items jsonb)

pages: UNIQUE(slug, lang) — each language version is a separate row
```

---

## Key decisions

**Language & scope.** The code and UI are English-first, and Batuda is internationally scoped — a company can be anywhere (US, NL, …), not only Spain.
Catalan/Spanish appears only in seed/mock data (the repo owner's nationality) and in the research pipeline's classification vocabularies (`COMPANY_INDUSTRIES`, `COMPANY_REGIONS`, `COMPANY_SIZE_RANGES` in `packages/domain/src/schema/companies.ts`), which are a research-mapping aid the enrichment guard maps to — not a CRM constraint.
CRM surfaces (the company filters, the pipeline board) therefore treat region and industry as open, data-driven values, never a fixed Spanish list.

**Why NeonDB over SQLite:** analytics queries, JSONB for evolving metadata, email/calendar integrations planned. Postgres is the right foundation.

**Why Unikraft for server:** lightweight unikernel deployment, fast cold starts, matches the "lean infrastructure" philosophy of the project.

**Why Unikraft for web:** same deployment model as the server (Dockerfile + Kraftfile), Node.js SSR enables runtime CSS-in-JS (styled-components), scales to zero. Both apps on one platform simplifies ops.

**Why MCP over a custom SDK:** works with all major AI interfaces (Claude Code, Claude.ai, ChatGPT) without per-client integration work.

**Why documents as a separate table:** keeps company queries fast, allows multiple documents per company, enables fetching content only when needed (critical for AI context size).
