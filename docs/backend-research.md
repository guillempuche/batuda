# Backend Research

Generic, cross-topic research feature for the Batuda web app. An LLM-driven agent loop that consumes the external web (and structured data APIs) via pluggable capability providers, produces verifiable findings with inline citations, and never mutates domain rows directly.

For system context see [architecture.md](architecture.md). For backend structure see [backend.md](backend.md).

> Status: v0 implementation in progress. See [backend-research-todo.md](backend-research-todo.md) for progress.

---

## 1. Overview

`/research` is a **first-class resource**, not a subroute of `/companies` or any other table. A research run is a standalone artifact: query, structured findings, human-readable brief, sources, citations, cost. It may optionally be *anchored* to domain rows (companies, contacts) but its existence does not depend on them.

```
┌──────────────────────────────────────────────────────────────────┐
│  /research (HTTP + MCP)                                          │
│                                                                   │
│  POST /research         → creates a row, forks a fiber           │
│  GET  /research/:id     → current state + findings               │
│  GET  /research/:id/events  → SSE live stream (in-memory PubSub) │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ResearchService (fiber)                                   │  │
│  │   resolve context → build prompt → LLM tool loop           │  │
│  │   ↓ streams tool calls via PubSub → SSE                    │  │
│  │   ↓ writes findings, brief_md, sources, tool_log at end    │  │
│  └────────────────────────────────────────────────────────────┘  │
│           │                                                       │
│           ▼                                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Toolkit (shared by LLM loop and MCP)                      │  │
│  │   web_search / web_read / web_discover                     │  │
│  │   lookup_registry / crm_lookup                             │  │
│  │   propose_update / attach_finding / propose_paid_action    │  │
│  └────────────────────────────────────────────────────────────┘  │
│           │                                                       │
│           ▼                                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Capability Providers (env-selected at boot)               │  │
│  │   SearchProvider  ScrapeProvider  ExtractProvider          │  │
│  │   DiscoverProvider  RegistryProvider  ReportProvider       │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

The LLM sees capability tools (`web_read`, not `firecrawl_scrape`). Providers are swapped at boot via env vars. The same toolkit is exposed to Claude Desktop through MCP.

---

## 2. Goals and non-goals

### Goals

- **Cross-topic**: one endpoint handles "enrich this company," "find leads matching a description," "find competitors of X," "check registry data for a NIF." No per-topic routes.
- **Tech-agnostic**: every external capability is an interface. Firecrawl, Exa, Tavily, Brave, libreBORME, einforma, Claude's native web_search are *implementations*.
- **Links as source of truth**: every claim carries inline citations pointing at sources with content hashes and archived copies. A user can always answer "where did this come from?" and "is it still true?"
- **Cost-aware**: tiered tools; per-run and per-day budget enforcement at the runtime level, not just in prompts. Default = €20/month cap, €5/run paid budget, auto-approved within budget.
- **Safety rails**: research never mutates domain rows directly. It proposes updates that humans accept.
- **Frontend-friendly**: users interact via the Batuda web app; the server runs the agent loop, the browser streams tool calls via SSE.
- **MCP parity**: Claude Desktop users reach the same capabilities via MCP tools + prompts.

### Non-goals (v1)

- **No internal corpus**: no pgvector, no embeddings over Batuda's own data, no RAG on interactions/documents/emails. Research is about pulling from the outside. `crm_lookup` stays because it's a relational lookup, not corpus search.
- **No multi-agent orchestration**: one LLM loop with a broad toolkit. No coordinator/sub-agent split.
- **No agentic framework**: no LangChain, Mastra, LangGraph. Effect's `LanguageModel` + `Toolkit` + `Stream` is the whole loop.
- **No scheduled watchers** (v1).
- **No knowledge graph** of discovered entities (v1). The shape leaves room to add one later.

---

## 3. Input modes

One endpoint, three shapes of input. Expressed via the `context` field:

```ts
POST /research
{
  query: string,                         // always required — the free-text question
  mode: 'deep',                          // v1 has a single mode (see §4.2)
  context?: {
    subjects?: Array<{                   // anchor the run to existing CRM rows
      table: 'companies' | 'contacts'   // v1: just these two
      id: string
    }>
    selector?: {                         // or: "run for each row matching this filter"
      table: 'companies'
      filter: Record<string, unknown>
    }
    hints?: {
      language?: 'ca' | 'es' | 'en'
      recency_days?: number
      location?: string                  // ISO country, passed to providers
    }
  }
  schema_name?: string                   // closed set, resolved in code (§8)
  budget_cents?: number                  // per-run override
  paid_budget_cents?: number             // per-run override
  auto_approve_paid_cents?: number       // per-run override
}
```

### 3.1 Free-text exploratory

```jsonc
{ "query": "Catalan agroecology cooperatives complaining about spreadsheets in 2025" }
```

No subjects, no selector. The LLM runs `web_search` → `web_read` → `crm_lookup` (to dedupe against Batuda) → produces a list of new prospects. Findings live standalone; user imports matches.

### 3.2 Subject-anchored

```jsonc
{
  "query": "Enrich this company: industry, size, current tools, competitors, key contacts",
  "context": { "subjects": [{ "table": "companies", "id": "01J9T0QH6A..." }] },
  "schema_name": "company_enrichment_v1"
}
```

Server resolves the subject into a frozen snapshot (with `expected_version`), injects into the prompt. Run is auto-linked to the subject via `research_links(link_kind='input')`. `propose_update` targets the subject.

### 3.3 Selector-anchored (fan-out)

```jsonc
{
  "query": "For each lead, find recent hiring ads or funding news",
  "context": { "selector": { "table": "companies", "filter": { "status": "lead", "region": "es-CT" } } }
}
```

Server expands the filter into N rows, creates a **parent** `research_runs` row (`kind='group'`) and N **leaf** rows (`kind='leaf'`, `parent_id=parent.id`). Each leaf is a subject-anchored run. Parent aggregates cost and status. Fan-out is bounded by `Effect.withConcurrency(n)` and by `paid_monthly_cap_cents`.

---

## 4. Cost tiers

### 4.1 Tier matrix

| Tier  | Name            | Cost/call     | Examples                                                                   | Gating                                                                                                                  |
| ----- | --------------- | ------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **0** | Free / internal | 0             | `lookup_registry` basic (libreBORME), `crm_lookup`, Brave free-tier search | no gate                                                                                                                 |
| **1** | Cheap web       | ~€0.001–0.005 | `web_search` (Exa), `web_read` (Firecrawl markdown or structured extract)  | debited from `budget_cents`, fails with `BudgetExceeded`                                                                |
| **2** | Moderate        | ~€0.01–0.05   | `web_discover` (Firecrawl agent, Claude web_search)                        | debited from `budget_cents`; LLM sees warning when >50% consumed                                                        |
| **3** | Paid structured | €1–5          | `lookup_registry` depth='financials'\|'full' (einforma)                    | debited from **separate** `paid_budget_cents`; above `auto_approve_paid_cents` (default €2), uses `propose_paid_action` |

The "Cost/call" column is **notional** — it drives the resource-budget governor (§11), not actual spend. Real billing depends on each provider's pricing model (credit blocks, monthly plans, per-call). See §11.6 for how provider quotas track actual consumption in native units.

The rule: **climb tiers only when a lower one cannot answer the question.** `lookup_registry` basic before `web_read`. `web_read` before `lookup_registry` financials. Enforced by a prompt rule (soft) and by budget errors (hard).

### 4.2 Modes

v1 has a single research mode: `deep`. It means "LLM drives a tool-calling loop over the full toolkit." No `auto`, no `agent`, no `scrape`-as-mode. `web_discover` is a *tool* inside the loop, not a mode.

`mode` stays in the schema so adding future modes (e.g. a batched `corpus` mode when internal corpus lands) is additive.

---

## 5. Provider model (tech-agnostic)

### 5.1 Six capability interfaces

```
apps/server/src/services/research/
├── search-provider.ts         interface: SearchProvider
├── scrape-provider.ts         interface: ScrapeProvider
├── extract-provider.ts        interface: ExtractProvider
├── discover-provider.ts       interface: DiscoverProvider
├── registry-provider.ts       interface: RegistryProvider     (country-routed)
├── report-provider.ts         interface: ReportProvider       (country-routed, paid)
│
├── firecrawl-search.ts        SearchProvider impl
├── firecrawl-scrape.ts        ScrapeProvider impl
├── firecrawl-extract.ts       ExtractProvider impl
├── firecrawl-discover.ts      DiscoverProvider impl
├── exa-search.ts              SearchProvider impl
├── tavily-search.ts           SearchProvider impl
├── brave-search.ts            SearchProvider impl
├── anthropic-discover.ts      DiscoverProvider impl (Claude's native web_search)
├── local-scrape.ts            ScrapeProvider impl (Playwright, dev fallback)
├── librebor-registry.ts       RegistryProvider impl (ES)
└── einforma-report.ts         ReportProvider impl (ES)
```

Each interface uses Effect v4's `ServiceMap.Service` pattern (same as `EmailProvider` and `StorageProvider` in the existing codebase):

```ts
// search-provider.ts
export class SearchProvider extends ServiceMap.Service<
  SearchProvider,
  {
    readonly search: (input: {
      query: string
      limit?: number
      recency?: { days: number }
      location?: string
      languages?: string[]
    }) => Effect.Effect<SearchResult, ProviderError>
  }
>()('research/SearchProvider') {}

// scrape-provider.ts
export class ScrapeProvider extends ServiceMap.Service<
  ScrapeProvider,
  {
    readonly scrape: (input: {
      url: string
      formats?: ('markdown' | 'html' | 'links' | 'screenshot')[]
      waitForSelector?: string
      location?: string
    }) => Effect.Effect<ScrapedPage, ProviderError>
  }
>()('research/ScrapeProvider') {}

// extract-provider.ts
// Returns `unknown` — caller decodes with Schema.decodeUnknown(schema)(raw).
// Generic methods on ServiceMap.Service lose type params through the tag.
export class ExtractProvider extends ServiceMap.Service<
  ExtractProvider,
  {
    readonly extract: (input: {
      url: string
      schema: Schema.Schema.Any
      prompt?: string
    }) => Effect.Effect<unknown, ProviderError>
  }
>()('research/ExtractProvider') {}

// discover-provider.ts
// Same pattern: returns `unknown`, caller decodes.
export class DiscoverProvider extends ServiceMap.Service<
  DiscoverProvider,
  {
    readonly discover: (input: {
      prompt: string
      urls?: string[]
      schema?: Schema.Schema.Any
      maxCostCents?: number
    }) => Effect.Effect<DiscoverResult, ProviderError>
    readonly cancel: (jobRef: ExternalJobRef) => Effect.Effect<void, ProviderError>
  }
>()('research/DiscoverProvider') {}

// registry-provider.ts — country-routed
export class RegistryRouter extends ServiceMap.Service<
  RegistryRouter,
  {
    readonly lookup: (input: {
      country: 'ES'                       // v1: ES only
      query?: string
      tax_id?: string
    }) => Effect.Effect<RegistryRecord, ProviderError>
  }
>()('research/RegistryRouter') {}

// report-provider.ts — country-routed, paid
export class ReportRouter extends ServiceMap.Service<
  ReportRouter,
  {
    readonly report: (input: {
      country: 'ES'
      tax_id: string
      depth: 'basic' | 'financials' | 'full'
    }) => Effect.Effect<CompanyReport, ProviderError>
  }
>()('research/ReportRouter') {}
```

### 5.2 Boot-time selection

Role-first, vendor-neutral (`feedback_env_var_naming`). `RESEARCH_PROVIDER_<CAP>` accepts a comma list — slot 1 = primary, slot N = fallback on `ProviderError`. API keys parallel the same grammar (`RESEARCH_API_KEY_<CAP>`, `_2`, `_3`, …).

```ts
// packages/research/src/infrastructure/providers-live.ts
const searchLayer = Layer.effect(
  SearchProvider,
  Effect.gen(function* () {
    const vendors = yield* providerListConfig(
      SEARCH_VENDORS,
      'RESEARCH_PROVIDER_SEARCH',
    )
    yield* Effect.logInfo(`research.search: ${vendors.join(',')}`)
    const instances = yield* Effect.all(
      vendors.map((v, slot) => searchInstance(v, slot)),
    )
    if (instances.length === 1) return instances[0]!
    const search = withFallback(instances, (svc, input) => svc.search(input))
    return SearchProvider.of({ search })
  }),
)
```

Same shape for scrape, extract, discover. Registry and report loop over `SUPPORTED_COUNTRIES` and build a per-country dispatcher (`buildRegistryDispatcher(cc)` / `buildReportDispatcher(cc)`).

### 5.3 Quota awareness

Provider interfaces stay clean — they don't know about quotas. Quota tracking lives in a separate `ProviderQuota` service (§11.6) that wraps provider calls at the instrumentation layer (§12.2). Each provider impl reports how many native units a call consumed via a `units` field on its return type, so the quota service can record it.

---

## 6. Tool surface

Tools are named by **capability**, not vendor. Each is defined once as an Effect `Tool.make` and annotated with the existing `Tool.Readonly` / `Tool.Destructive` / `Tool.OpenWorld` pattern (see `apps/server/src/mcp/tools/companies.ts:105`).

### 6.1 Research tools (4 tools)

```ts
// apps/server/src/mcp/tools/research-web.ts

web_search({ query, limit?, recency_days?, location?, languages? })
  → Readonly, OpenWorld, tier 1
  // Search the web. Returns a list of URLs with titles and snippets.

web_read({ url, schema? })
  → Readonly, OpenWorld, tier 1
  // Fetch a URL as markdown. With `schema`: extract structured JSON instead.
  // Merges scrape + extract — same provider call, schema is the only difference.

web_discover({ prompt, urls?, max_cost_cents? })
  → Readonly, OpenWorld, tier 2
  // Autonomous browsing: follows links, reasons over pages, returns findings.
  // Expensive — only use when search + read can't answer the question.

// apps/server/src/mcp/tools/research-registry.ts

lookup_registry({ country, query?, tax_id?, depth? })
  → Readonly, OpenWorld, tier 0 (basic) / tier 3 (financials|full)
  // One tool, two backends. depth='basic' → free registry (libreBORME).
  // depth='financials'|'full' → paid report (einforma), gated by budget.
```

### 6.2 CRM-read tool (1 tool)

```ts
// apps/server/src/mcp/tools/research-crm.ts

crm_lookup({ table: 'companies' | 'contacts', query?, id? })
  → Readonly, !OpenWorld, tier 0
  // With `id`: get a single row. With `query`: search by name/fields.
  // Replaces separate search_companies + get_company + search_contacts + get_contact.
```

### 6.3 Sink tools (3 tools)

```ts
// apps/server/src/mcp/tools/research-sink.ts

propose_update({
  subject_table: 'companies' | 'contacts',
  subject_id: string,
  expected_version: int,
  fields: Record<string, unknown>,
  reason: string,
  citations: Array<{ source_id: string, quote: string }>
})
  → writes to research_runs.findings.proposed_updates[], NEVER mutates domain rows
  → !Destructive, !OpenWorld

attach_finding({
  subject_table,
  subject_id,
  kind: 'already_in_db' | 'discovered' | 'related'
})
  → writes to research_links with link_kind='finding'
  → !Destructive, Idempotent, !OpenWorld

propose_paid_action({
  tool: string,                 // 'lookup_registry'
  args: unknown,
  estimated_cents: int,
  reason: string
})
  → records the proposal, returns immediately — LLM continues without the data
  → human approves/skips after the run (see §11.5 for follow-up mechanics)
  → writes to research_runs.findings.pending_paid_actions[]
  → !Destructive, !OpenWorld
```

**8 tools total.** Effect's `toolChoice: { oneOf: [...] }` further restricts which tools the LLM sees at each step of the loop, so it typically works with 3–5 at a time.

`propose_update` does **not** call `update_company`. Domain mutations only happen when a human clicks "Apply" in the UI, which fires the existing `update_company` endpoint with OCC via `expected_version`.

`attach_finding` is the only write the agent makes to mutable state, and it only touches `research_links`.

---

## 7. Data model

### 7.1 Tables

```sql
--
-- Core
--
CREATE TABLE research_runs (
  id                      uuid PRIMARY KEY,
  parent_id               uuid REFERENCES research_runs(id) ON DELETE CASCADE,
  kind                    text NOT NULL CHECK (kind IN ('leaf','group','followup')) DEFAULT 'leaf',

  query                   text NOT NULL,
  mode                    text NOT NULL DEFAULT 'deep',       -- v1: only 'deep'
  schema_name             text,                                -- §8

  status                  text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','deleted')),
  context                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {subjects?, selector?, hints?}

  findings                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- structured output (§8)
  brief_md                text,                                -- human narrative (§8)

  -- Budget / cost (cents are notional — volume governor, not actual spend; see §11)
  budget_cents            int NOT NULL DEFAULT 0,
  paid_budget_cents       int NOT NULL DEFAULT 0,
  cost_cents              int NOT NULL DEFAULT 0,
  paid_cost_cents         int NOT NULL DEFAULT 0,
  cost_breakdown          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { provider: notional_cents, ... }
  quota_breakdown         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { provider: { units: N, unit: 'credits' }, ... } — native units consumed
  tokens_in               int NOT NULL DEFAULT 0,
  tokens_out              int NOT NULL DEFAULT 0,
  paid_policy             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- resolved policy snapshot

  -- Audit
  idempotency_key         text UNIQUE,
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  started_at              timestamptz,
  completed_at            timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- Written once at run completion; array of tool call/result events for audit
  tool_log                jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX research_runs_status_idx ON research_runs(status) WHERE status IN ('queued','running');
CREATE INDEX research_runs_parent_idx ON research_runs(parent_id);
CREATE INDEX research_runs_created_by_idx ON research_runs(created_by);

--
-- Sources (globally deduped by url_hash)
--
CREATE TABLE sources (
  id                text PRIMARY KEY,                          -- 'src_' + ulid
  kind              text NOT NULL CHECK (kind IN ('web','registry','archive','report')),
  provider          text NOT NULL,                             -- 'firecrawl','librebor','einforma',...
  url               text NOT NULL,
  url_hash          text NOT NULL UNIQUE,                      -- sha256(canonicalize(url))
  domain            text NOT NULL,                             -- registrable domain
  title             text,
  author            text,
  published_at      timestamptz,
  language          text,
  first_fetched_at  timestamptz NOT NULL DEFAULT now(),
  last_fetched_at   timestamptz NOT NULL DEFAULT now(),
  content_hash      text NOT NULL,                             -- sha256(normalized content)
  content_ref       text,                                      -- s3://.../sources/<hash>.md — archived copy
);

CREATE INDEX sources_domain_idx ON sources(domain);

--
-- Many-to-many: research_runs ↔ sources, with a stable local ref for citations
--
CREATE TABLE research_run_sources (
  research_id  uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  source_id    text NOT NULL REFERENCES sources(id),
  local_ref    text NOT NULL,                                  -- 'src_1', 'src_2' — stable within run
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  cost_cents   int NOT NULL DEFAULT 0,
  PRIMARY KEY (research_id, source_id)
);

--
-- Polymorphic link between a run and a subject row (companies/contacts)
--
CREATE TABLE research_links (
  research_id    uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  subject_table  text NOT NULL CHECK (subject_table IN ('companies','contacts')),
  subject_id     uuid NOT NULL,
  link_kind      text NOT NULL CHECK (link_kind IN ('input','finding')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (research_id, subject_table, subject_id)
);

CREATE INDEX research_links_subject_idx ON research_links(subject_table, subject_id);

--
-- Paid-spend audit log (even for auto-approved calls)
--
CREATE TABLE research_paid_spend (
  id               uuid PRIMARY KEY,
  research_id      uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL,
  provider         text NOT NULL,
  tool             text NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,                       -- '{research_id}:{tool}:{hash(args)}' — prevents double-charge on retry
  amount_cents     int NOT NULL,                                -- notional cents (volume governor)
  quota_units      int,                                         -- provider-native units consumed (e.g., 1 credit, 1 report)
  quota_unit       text,                                        -- 'credits', 'reports', 'requests' — matches provider_quotas.quota_unit
  args             jsonb NOT NULL,                              -- redacted of secrets
  result_hash      text,                                       -- sha256 of normalized response
  result_data      jsonb,                                      -- write-ahead: full provider response, persisted immediately after provider returns
  source_id        text REFERENCES sources(id),
  auto_approved    boolean NOT NULL,
  approved_by      uuid,                                       -- if manual
  at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX research_paid_spend_user_at_idx ON research_paid_spend(user_id, at DESC);

--
-- User-level spending policy (one editable policy per user, see §11)
--
CREATE TABLE user_research_policy (
  user_id                    uuid PRIMARY KEY,                 -- → users(id)
  budget_cents               int NOT NULL DEFAULT 100,         -- €1/run cheap tier
  paid_budget_cents          int NOT NULL DEFAULT 500,         -- €5/run paid tier
  auto_approve_paid_cents    int NOT NULL DEFAULT 200,         -- €2 auto-approve; first einforma call silent, second triggers propose_paid_action
  paid_monthly_cap_cents     int NOT NULL DEFAULT 2000,        -- €20/month hard cap
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

--
-- Provider quota config (one row per user per provider, see §11.6)
--
CREATE TABLE provider_quotas (
  user_id          uuid NOT NULL,
  provider         text NOT NULL,                               -- 'firecrawl', 'einforma', 'exa', etc.
  billing_model    text NOT NULL CHECK (billing_model IN ('monthly_plan', 'pay_per_call')),
  sync_mode        text NOT NULL CHECK (sync_mode IN ('api', 'manual')) DEFAULT 'manual',
                                                                -- 'api' = auto-sync from provider balance API; 'manual' = user maintains quota_total
  quota_total      int NOT NULL,                                -- units per period: credits, reports, requests
  quota_unit       text NOT NULL,                               -- 'credits', 'reports', 'requests'
  period_months    int NOT NULL DEFAULT 1,                      -- 1 = monthly (most providers)
  period_anchor    date,                                        -- first day of current period (auto-synced from provider for sync_mode='api')
  cents_per_unit   int NOT NULL DEFAULT 0,                      -- notional conversion for budget governor
  warn_at_pct      int NOT NULL DEFAULT 80,                     -- UI warns when usage exceeds this %
  last_synced_at   timestamptz,                                 -- last successful API sync (null for manual)
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

--
-- Provider usage counter (tracks consumption in native units, see §11.6)
--
CREATE TABLE provider_usage (
  user_id          uuid NOT NULL,
  provider         text NOT NULL,
  period_start     date NOT NULL,                               -- first day of period (monthly providers: month start; lifetime: epoch)
  units_consumed   int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, provider, period_start)
);
```

### 7.2 Polymorphic FK integrity (soft-delete)

`research_links` connects a research run to a company OR a contact via `subject_table` + `subject_id`. Postgres can't enforce a foreign key that checks different tables depending on a column value, so if you hard-delete a company, nothing stops `research_links` from pointing at a row that no longer exists.

**Decision:** soft-delete. Add `deleted_at timestamptz` to `companies` and `contacts`. Rows are never physically removed — they get a timestamp instead. Queries filter them out (`WHERE deleted_at IS NULL`). Research links stay valid because the underlying row still exists.

This also means the research UI can show "this company was deleted after this research ran" instead of a broken reference.

### 7.3 OCC on subject rows

Research proposes changes, but the human clicks "Apply" later — minutes, hours, maybe days after the run. If someone edited the company in between, the proposal would silently overwrite their work.

**Fix:** a `version int NOT NULL DEFAULT 0` column on `companies` and `contacts`, bumped on every update. The flow:

1. Research starts → snapshots the company at version 5
2. `propose_update` carries `expected_version: 5`
3. Meanwhile, someone edits the company → version bumps to 6
4. Human clicks "Apply" → fires `UPDATE companies SET ... WHERE id = ? AND version = 5` → 0 rows affected → conflict error
5. UI tells the user: "this company was modified since the research ran — review before applying"

Requires a `version` column on `companies`/`contacts` (not present today) + a check in each update handler.

---

## 8. Output formats per field

| Field                                                          | Format              | Why                                                                                     |
| -------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `research_runs.query`                                          | `text`              | user free text                                                                          |
| `research_runs.mode`                                           | `text`              | enum, v1='deep' only                                                                    |
| `research_runs.schema_name`                                    | `text`              | registry key (see §8.1)                                                                 |
| `research_runs.context`                                        | `jsonb`             | `{subjects?, selector?, hints?}`                                                        |
| `research_runs.findings`                                       | `**jsonb`**         | structured, schema-valid, queryable, drives UI                                          |
| `research_runs.brief_md`                                       | `**text`** markdown | human synthesis, regenerable per language                                               |
| `research_runs.cost_breakdown`                                 | `jsonb`             | per-provider notional cents (volume governor, not actual spend)                         |
| `research_runs.quota_breakdown`                                | `jsonb`             | per-provider native units consumed: `{ firecrawl: { units: 6, unit: 'credits' } }`      |
| `research_runs.paid_policy`                                    | `jsonb`             | resolved policy snapshot for audit                                                      |
| `research_runs.tool_log`                                       | `jsonb`             | array of tool call/result events, written once at completion for audit                  |
| `sources` columns                                              | relational          | no JSON; normalized table                                                               |
| `research_run_sources.local_ref`                               | `text`              | `"src_1"`, `"src_2"` — stable within a run for readable citations                       |
| `documents.content` (only when user clicks "Save as document") | `**jsonb**` Tiptap  | existing project convention; lazy conversion from `brief_md` via `prosemirror-markdown` |

### 8.1 Schema registry

`schema_name` points at a closed set of **server-compiled Effect Schemas**, *not* stored JSON Schema. Storing JSON Schema and trying to compile it at runtime loses type safety; a closed registry keeps the agent loop typed end-to-end.

```
apps/server/src/services/research/schemas/
├── index.ts                        // Record<schema_name, Schema.Any>
├── company_enrichment_v1.ts
├── competitor_scan_v1.ts
├── contact_discovery_v1.ts
├── prospect_scan_v1.ts
└── freeform.ts                     // no schema — markdown only
```

Versioned (`_v1`, `_v2`) so schemas can evolve without breaking old runs. Callers pass `schema_name: 'company_enrichment_v1'`; the service resolves it and uses it for `LanguageModel.generateObject`'s structured output (see §13.1).

### 8.2 `findings` shape (example: `company_enrichment_v1`)

```jsonc
{
  "enrichment": {
    "industry": "Agriculture — olive oil cooperative",
    "size_range": "51-200",
    "pain_points": "Manual sales tracking via spreadsheets",
    "current_tools": "Microsoft Office; no CRM",
    "products_fit": ["crm-starter", "workshop-sales-funnel"],
    "tags": ["cooperative", "agri-food", "ecological"],
    "citations": [
      { "source_id": "src_reg_1", "quote": "Sociedad Cooperativa, capital social €450k", "confidence": 1.0 },
      { "source_id": "src_1", "quote": "120 socis productors", "confidence": 0.95 }
    ]
  },
  "competitors": [
    {
      "name": "Oliaire",
      "website": "https://oliaire.cat",
      "why": "Same product, same region",
      "citations": [
        { "source_id": "src_3", "quote": "producció artesanal d'oli ecològic al Bages" }
      ]
    }
  ],
  "contacts": [
    {
      "name": "Jordi Pla",
      "role": "President",
      "email": "president@olivera-vilanova.cat",
      "citations": [
        { "source_id": "src_reg_1", "quote": "Administrador: Jordi Pla, des de 2019" }
      ]
    }
  ],
  "discovered_existing": [
    { "subject_table": "companies", "subject_id": "01J9A...", "name": "L'Olivera SCCL" }
  ],
  "proposed_updates": [
    {
      "subject_table": "companies",
      "subject_id": "01J9T0QH6A...",
      "expected_version": 5,
      "fields": { "industry": "...", "size_range": "51-200" },
      "reason": "libreBORME + memoria-2024.pdf pp.12,18",
      "citations": [{ "source_id": "src_reg_1" }, { "source_id": "src_2" }]
    }
  ],
  "pending_paid_actions": []
}
```

### 8.3 Conversion pipeline

```
Firecrawl / Exa / libreBORME HTTP JSON
  → Effect Schema-typed provider objects
  → Tool results back to the LLM (markdown for scrape, JSON for registry/extract)
  → LLM final answer (Effect Schema structured output)
  → research_runs.findings (jsonb)                    ← canonical
  → second LLM pass (cheap model, Haiku): findings → markdown in hint.language
  → research_runs.brief_md (markdown text)
  → GET /research/:id → JSON (row serialized)
  → UI renders brief_md via react-markdown, findings via typed components
  → "Save as document" → MD → Tiptap JSON → documents.content (jsonb)
```

Rules:

- **Markdown is the LLM-facing currency.** Cheapest for the model to reason over.
- **jsonb is the machine-facing currency.** Anything the UI branches on lives in jsonb with a registered schema.
- **Tiptap never touches `research_runs`.** Converted lazily at "Save as document" time.
- `**findings` is canonical. `brief_md` is derivative.** Generated in a second pass so it can be regenerated in a different language without re-researching.

---

## 9. Sources and citations

### 9.1 The citation rule

> Every claim in `findings` MUST carry at least one `citations` entry with a `source_id` that resolves to a row in `sources`. If the LLM cannot cite a claim, it must not make the claim.

Enforced three ways:

1. **System prompt rule** (soft).
2. **Schema validation**: `company_enrichment_v1` and all other schemas require `citations: [{source_id, quote}]` on every leaf claim. Missing citations = failed structured output = run fails loudly, not silently.
3. **Dangling-reference check**: after structured output, the service walks findings for `source_id` references and fails the run if any don't exist in `research_run_sources`.

### 9.2 Source lifecycle

1. **Scrape/lookup fetches content.** Provider returns normalized content (markdown for web, JSON for registry).
2. **Hash and dedupe.** Compute `url_hash = sha256(canonicalize(url))`. If an existing `sources` row has the same `url_hash` AND unchanged `content_hash`, reuse it. Otherwise insert or update.
3. **Archive to S3.** Reuses the existing `StorageProvider` service (`apps/server/src/services/storage-provider.ts`) and its `S3StorageProviderLive` implementation — same bucket, same `put`/`get`/`signedUrl` code path used by recordings and documents. Write normalized content to `sources/<content_hash>.md` (or `.json` for registry). Store the key in `content_ref`. The UI retrieves the archived copy via `StorageProvider.signedUrl(content_ref, 600)` when the original URL is dead.
4. **Link to the run.** Insert `research_run_sources(research_id, source_id, local_ref)` with `local_ref = 'src_1'`, `'src_2'`, ... — stable within the run so citations stay readable.
5. **LLM cites.** Every claim references `source_id = 'src_reg_1'` etc.

### 9.3 UI treatment

- Every claim in the findings panel gets a `[1]`, `[2]` badge.
- Clicking opens a side panel with the source's title, URL, archived snapshot link, and the exact quote highlighted.
- Dead links (404) still resolve to the archived copy via `content_ref`.
- Source list is sortable by domain, provider, cost, fetched_at.

---

## 10. Safety rules

Collected here so they can be copy-pasted into the system prompt and into review.

### 10.1 Who writes what (the LLM never touches the DB directly)

The LLM produces *content*; `ResearchService` validates and persists it. The LLM never gets a SQL connection.

| What                                                  | Who writes                                                                       | How                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `research_runs` row (create, status, findings, brief) | `ResearchService` (server code)                                                  | creates at POST time, updates incrementally during fiber                |
| `research_runs.tool_log`                              | `ResearchService`                                                                | written once at completion; accumulated in-memory during run            |
| `sources` rows                                        | `ResearchService`                                                                | upserts after each scrape/registry call, hashes content, archives to S3 |
| `research_run_sources` rows                           | `ResearchService`                                                                | links sources to the run with a stable `local_ref`                      |
| `research_links` rows                                 | `attach_finding` tool (called BY the LLM, handled by `ResearchService`)          | insert-only, never deletes                                              |
| `findings.proposed_updates`                           | LLM produces the proposal, `ResearchService` persists it inside `findings` jsonb | **never applied to domain tables** until human clicks Apply             |
| Domain table mutations (`companies`, `contacts`)      | **Human** via the existing REST endpoints                                        | completely separate from research, uses OCC                             |

### 10.2 No direct domain mutation

The research agent **never** calls `update_company`, `create_company`, `delete_company`, `update_contact`, etc. Domain mutations are exclusively human-driven via the "Apply" button in the research UI, which fires the existing domain endpoints with OCC.

### 10.3 Citations are mandatory

See §9.1. No unsourced claims.

### 10.4 Cost discipline

Two independent layers gate every external call (see §12.2):

1. **Provider quota** (hard limit) — does the user have remaining units with this provider? Checked first. `QuotaExhausted` is recoverable: the LLM should try an alternative provider or tool.
2. **Resource budget** (volume governor) — notional cents, prevents a single run from consuming disproportionate resources even when those resources are prepaid. `BudgetExceeded` is terminal for the exhausted tier.

Rules:

- Try tier 0 first. Registry before scrape.
- Never exceed `paid_budget_cents` without `propose_paid_action`.
- `BudgetExceeded` → finish with what you have.
- `QuotaExhausted` → try an alternative (e.g., Brave if Firecrawl credits are gone).

### 10.5 Subject snapshot freeze

When a run starts, the current version of every subject row is captured into `context.subjects[i].snapshot` with `expected_version`. The agent reasons from the snapshot; if the underlying row changes mid-run, `propose_update` still references the old version and OCC blocks silent overwrites.

### 10.6 Human-in-the-loop gates

| Action                                                | Gate                                                   |
| ----------------------------------------------------- | ------------------------------------------------------ |
| Write to Batuda domain rows                           | Always human via "Apply"                               |
| Call tier-3 paid tool above `auto_approve_paid_cents` | `propose_paid_action` → human approve                  |
| Provider quota exhausted                              | `QuotaExhausted` → LLM tries alternative provider/tool |
| Fan-out over `paid_monthly_cap_cents`                 | Hard block, no override                                |
| Exceed system hard ceiling                            | Hard block, not overridable per-run                    |

---

## 11. Spending policy

Two independent layers control resource consumption:

1. **Resource budget** (§11.1–11.5) — notional cents. A volume governor that limits how much a single run or a month of runs can consume, regardless of actual billing. Useful even when resources are prepaid: prevents one run from burning half your Firecrawl credits.
2. **Provider quotas** (§11.6) — native units (credits, reports, requests). Tracks actual consumption against the user's plan with each provider. Prevents hitting plan limits or triggering overage charges.

The two layers are checked independently. A call can pass the budget check but fail the quota check (provider out of credits), or pass the quota check but fail the budget check (run budget exhausted).

### 11.1 Table

```sql
CREATE TABLE user_research_policy (
  user_id                    uuid PRIMARY KEY,
  budget_cents               int NOT NULL DEFAULT 100,     -- €1/run for cheap tier (scraping, search)
  paid_budget_cents          int NOT NULL DEFAULT 500,     -- €5/run for paid tier (1-2 einforma calls)
  auto_approve_paid_cents    int NOT NULL DEFAULT 200,     -- €2 auto-approve; first einforma call silent, second triggers propose_paid_action
  paid_monthly_cap_cents     int NOT NULL DEFAULT 2000,    -- €20/month hard cap
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
```

New user → row created with env defaults. User edits in settings. Per-run overrides via POST body (clamped — see §11.2). System env var `RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS` is the only non-editable limit.

**Out-of-the-box behavior:** agent can spend up to €1/run on web scraping/search, up to €5/run on paid APIs (einforma). The first ~€2 of paid calls are auto-approved silently; beyond that the agent calls `propose_paid_action` and the user approves or skips after the run. €20/month hard cap. User adjusts any number anytime in settings.

### 11.2 Layered resolution

```
system env defaults
  → user policy (four editable fields)
    → per-run POST body overrides (clamped: see below)
      → resolved policy snapshot → research_runs.paid_policy (captured for audit)
```

Per-run wins over user, user wins over env. The snapshot is frozen on the row so "what policy was in effect for this run" is always answerable.

**Per-run override clamping.** Per-run overrides in the POST body are clamped to the user's own policy, not the system ceiling. A request with `paid_budget_cents: 10000` when the user's policy says 500 resolves to 500. The user must update their policy first (via `PUT /research/policy`) to raise their ceiling. This prevents a buggy or compromised frontend from bypassing the user's own spending limits. The system hard ceiling (`RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS`) remains the absolute max that even the user policy cannot exceed.

### 11.3 The monthly cap is the only non-overridable rail

Monthly (not daily) because a small team shouldn't be blocked on Tuesday for researching hard on Monday.

```ts
chargePaid: (provider, cents) => Effect.gen(function* () {
  const runBudget = yield* Ref.get(paidRef)
  if (runBudget.remaining < cents)
    return yield* new BudgetExceeded({ tier: 'paid-run', needed: cents, remaining: runBudget.remaining })

  // Monthly cap check-and-debit is serialized per user via pg advisory lock.
  // Multiple concurrent fibers for the same user all hit this lock, so only
  // one can read-check-debit at a time. Without this, N concurrent fibers
  // could each see room and overshoot the cap by up to N * paid_budget_cents.
  yield* MonthlyPaidSpend.chargeWithinCap(userId, cents, runId, provider, policy.paidMonthlyCapCents)

  yield* Ref.update(paidRef, b => ({ ...b, remaining: b.remaining - cents, spent: b.spent + cents }))
})
```

`MonthlyPaidSpend.chargeWithinCap` runs inside a single Postgres transaction:

```sql
SELECT pg_advisory_xact_lock(hashtext('research_monthly_cap:' || $user_id));
SELECT COALESCE(SUM(amount_cents), 0) AS spent
  FROM research_paid_spend
 WHERE user_id = $user_id
   AND at >= date_trunc('month', now());
-- if spent + $cents > LEAST($user_cap, $system_ceiling) → raise MonthlyCapExceeded
INSERT INTO research_paid_spend (id, research_id, user_id, provider, tool, idempotency_key, amount_cents, args, auto_approved, at)
VALUES (...);
```

The advisory lock is transaction-scoped (`pg_advisory_xact_lock`), so it releases automatically on commit or rollback. No risk of orphaned locks.

- `RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS` (env) is the absolute max. A user's `paid_monthly_cap_cents` can only go *up to* but never past it.
- Prompt injection / runaway loops stop at the monthly cap.
- Concurrent fibers serialize on the advisory lock, so the cap is exact — no overshoot.

### 11.4 How the LLM experiences policy

The LLM does **not** read the policy or quotas. It learns from tool errors:

- Within budget & quota → tool runs silently, charges both layers.
- Provider quota exhausted → tool errors with `QuotaExhausted { provider, unit, remaining: 0 }`. System prompt: *"if you receive QuotaExhausted, try an alternative tool or provider for the same information. Do not retry the same tool."*
- Above approval threshold → tool errors with `ApprovalRequired`. System prompt: *"if you receive ApprovalRequired, call `propose_paid_action` instead."*
- Above run budget → tool errors with `BudgetExceeded`. System prompt: *"finish with what you have."*
- Above monthly cap → tool errors with `MonthlyCapExceeded`. Terminal — run finishes.

This keeps the prompt simple and policy-independent. The LLM doesn't need to know whether a failure is a quota issue or a budget issue — it just knows the tool failed and gets guidance on what to do next.

### 11.5 Follow-up run after paid action approval

When the user approves a `pending_paid_action` via `POST /research/:id/paid-actions/:pa_id/approve`:

1. Server creates a **new** `research_runs` row (`kind='followup'`, `parent_id=original.id`).
2. The new run's `context` inherits the original's `context.subjects` (same snapshots, same `expected_version`). It does **not** inherit the original's findings or tool log — it starts with a clean slate.
3. The new run's prompt includes: the approved paid action's `tool`, `args`, and `reason`, plus a summary of what the original run already found (extracted from `findings`). The system prompt says: *"Execute the approved paid action, then integrate its results with the prior findings summary into your final output."*
4. Budget: the follow-up run draws from the user's current policy (not the original run's snapshot). The approved paid action's `estimated_cents` was already validated against the monthly cap at approval time.
5. The follow-up run appears in the UI as a child of the original, with a link back. The original run's `pending_paid_actions` entry is updated with `status='approved'` and `followup_run_id`.

If the user skips all pending paid actions, no follow-up run is created. If multiple actions are approved, they are batched into a single follow-up run.

### 11.6 Provider quotas

External providers bill in two ways, neither of which maps cleanly to "€X per call":

| Billing model  | Examples                                                             | What the user actually buys                |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| `monthly_plan` | Firecrawl ($19/mo Hobby, 3k credits), Exa (1k req/mo free), eInforma | N units/month included; resets each period |
| `pay_per_call` | Brave Search ($5/1k), Exa beyond free tier ($7/1k search)            | Each call billed at a fixed rate           |

Most providers are `monthly_plan` with a free or paid tier that includes N units/month. `pay_per_call` applies to providers with no subscription tier or once a plan's included units are exhausted (overage).

The resource budget (§11.1–11.3) is the **volume governor** — it limits how much a single run can consume regardless of billing model. Provider quotas are the **hard limits** — they track actual consumption in native units against the user's plan.

**`ProviderQuota` service:**

```ts
// apps/server/src/services/research/provider-quota.ts
export class ProviderQuota extends ServiceMap.Service<
  ProviderQuota,
  {
    readonly check: (provider: string, units: number) => Effect.Effect<void, QuotaExhausted>
    readonly consume: (provider: string, units: number) => Effect.Effect<void, QuotaExhausted>
    readonly remaining: (provider: string) => Effect.Effect<{ total: number; used: number; unit: string }>
    readonly sync: (provider: string) => Effect.Effect<void, ProviderError>
  }
>()('research/ProviderQuota') {}
```

`check` is a dry run (no side effects). `consume` atomically checks and decrements. `sync` fetches the current balance from the provider's API (for `sync_mode='api'` providers).

**Two sync modes:**

| `sync_mode` | How quota is tracked                                                           | Who maintains it  |
| ----------- | ------------------------------------------------------------------------------ | ----------------- |
| `api`       | System calls provider balance API, caches result (TTL 60s)                     | Automatic         |
| `manual`    | System tracks consumption locally in `provider_usage`; user sets `quota_total` | Admin in settings |

**`api` mode (Firecrawl, and any provider with a balance endpoint):** The system calls the provider's balance API to get remaining units. For Firecrawl: `GET /v2/team/credit-usage` → `{ remainingCredits, planCredits, billingPeriodStart, billingPeriodEnd }`. The response is cached in-memory (TTL 60s). `check` reads the cached balance; `consume` invalidates the cache. `provider_usage` is not used — the provider is the source of truth.

On first API key setup, the system auto-creates a `provider_quotas` row with `sync_mode='api'`, populating `quota_total`, `quota_unit`, `period_anchor` from the provider response. No manual config needed.

**`manual` mode (eInforma, providers without a balance API):** Admin enters their plan details in settings (quota total, unit, period). `check` and `consume` read/write the local `provider_usage` counter. Period resets are implicit: if `period_start` for the current period doesn't exist, the counter starts at 0 (no cron job).

**When no quota is configured.** If `provider_quotas` has no row for a (user, provider) pair, the quota check is skipped — the resource budget is the only gate. This means the system works out of the box without quota configuration; quotas are opt-in protection.

---

## 12. Budget enforcement

### 12.1 `Budget` service

```ts
// apps/server/src/services/research/budget.ts
export class Budget extends ServiceMap.Service<
  Budget,
  {
    readonly init: (cheapCents: number, paidCents: number) => Effect.Effect<void>
    readonly chargeCheap: (provider: string, cents: number) => Effect.Effect<void, BudgetExceeded>
    readonly chargePaid: (provider: string, cents: number) => Effect.Effect<void, BudgetExceeded | MonthlyCapExceeded>
    readonly snapshot: () => Effect.Effect<BudgetSnapshot>
  }
>()('research/Budget') {}
```

### 12.2 Provider instrumentation

Every provider call goes through two layers: **quota check → budget charge → provider call → quota consume**. Quota check fires first (hard limit), then budget (volume governor).

```ts
// firecrawl-scrape.ts (cheap tier)
const scrape = (input: ScrapeInput) =>
  Effect.gen(function* () {
    const quota = yield* ProviderQuota
    const budget = yield* Budget
    const estimatedUnits = estimateScrapeCredits(input)  // 1 credit per scrape, more for complex extracts
    const estimatedCents = estimatedUnits * centsPerCredit  // notional, from provider_quotas.cents_per_unit

    yield* quota.check('firecrawl', estimatedUnits)       // fail fast if quota exhausted (QuotaExhausted)
    yield* budget.chargeCheap('firecrawl', estimatedCents) // volume governor (BudgetExceeded)
    const result = yield* http.post('/v1/scrape', input)
    yield* quota.consume('firecrawl', result.creditsUsed)  // record actual units (may differ from estimate)
    return result
  })
```

Paid providers add idempotency to prevent double-charging on retry:

```ts
// einforma-report.ts (paid tier)
const fetchReport = (input: ReportInput) =>
  Effect.gen(function* () {
    const quota = yield* ProviderQuota
    const budget = yield* Budget
    const estimatedUnits = 1                               // 1 report
    const key = `${runId}:lookup_registry:${stableHash(input)}`

    yield* quota.check('einforma', estimatedUnits)         // fail fast if no reports left
    // chargePaid is atomic: advisory lock + INSERT with idempotency_key UNIQUE.
    // If the key already exists (retry after timeout), the INSERT is a no-op.
    yield* budget.chargePaid('einforma', estimateReportCents(input), key)
    const result = yield* http.post('/api/report', input)
    yield* quota.consume('einforma', 1)
    return result
  })
```

**Idempotency.** The `idempotency_key` on `research_paid_spend` (`'{research_id}:{tool}:{hash(args)}'`) ensures that if a fiber retries after a network timeout, the budget row already exists and the INSERT is a conflict no-op. The provider may still double-charge externally, but our budget accounting stays correct. For providers that support client-side idempotency keys (eInforma does not in v1), pass the same key to the provider API.

**Quota vs budget ordering.** Quota is checked first because it's a hard external limit — burning budget cents on a call that will fail due to quota exhaustion wastes the volume governor. If quota passes but budget fails, no quota units are consumed (the provider was never called).

### 12.3 Pre-run estimate

Before `Effect.fork(run())`, the handler estimates minimum cost based on:

- mode (always `deep` in v1)
- `context.subjects.length` (each anchors at least one scrape)
- `context.selector` expansion (how many subjects it yields)
- `schema_name` (registry-heavy schemas cost less than discovery-heavy)

If estimate > `budget_cents`, return `409 InsufficientBudget { estimated, available, shortfall }`. UI shows *"raise budget?"* before any credits burn.

### 12.4 Pre-run cost preview for fan-out

Selector-based fan-out with N subjects and ~K credits per leaf = N*K total. For N > threshold (e.g. 10), the handler returns a **dry run preview** with `requires_confirm: true` instead of starting the fibers. Frontend re-POSTs with `confirm: true` after user approval.

---

## 13. Lifecycle

### 13.1 Request → fiber → persist

```
POST /research
  ├── validate input, resolve policy from user prefs + env + body
  ├── estimate cost; fail fast on insufficient budget
  ├── write research_runs row (status='queued'), idempotency_key UNIQUE
  ├── write research_links rows for context.subjects (link_kind='input')
  ├── Effect.fork(ResearchService.run(id))
  └── return 202 { id, status: 'queued' }

ResearchService.run(id)
  ├── load row, hydrate snapshots (frozen, with expected_version)
  ├── update status='running', started_at
  ├── build LanguageModel prompt: system + context + subject snapshots + citation rule
  │
  │   Phase 1 — tool loop (streaming)
  ├── LanguageModel.streamText({
  │     model: anthropic('claude-opus-4-6'),
  │     toolkit: ResearchToolkit ∪ CrmReadToolkit ∪ SinkToolkit,
  │     maxIterations: 25,
  │   })
  ├── on each tool call → publish to PubSub + accumulate in Ref<ToolLogEntry[]>
  ├── on each tool result → publish to PubSub + accumulate in Ref<ToolLogEntry[]>
  │
  │   Phase 2 — structured output
  ├── LanguageModel.generateObject({
  │     model: anthropic('claude-opus-4-6'),
  │     schema: registry[schema_name],         // typed Effect Schema
  │     prompt: gathered context from phase 1,
  │   })
  ├── walk findings, verify all source_id references resolve
  │
  │   Phase 3 — brief + persist
  ├── LanguageModel.generateText({ model: haiku, prompt: findings → markdown })
  ├── write findings, brief_md, cost totals, tool_log, status='succeeded', completed_at
  └── publish run.completed to PubSub
```

### 13.2 SSE live streaming (in-memory PubSub, no replay)

`GET /research/:id/events` returns an SSE stream backed by Effect `PubSub`. Implementation:

1. `ResearchService` creates a `PubSub.unbounded<ResearchEvent>()` per active run, stored in a `Map<id, PubSub>`.
2. The SSE handler subscribes via `PubSub.subscribe(pubsub)` and pipes through `Sse.encode()`:

```ts
const stream = Stream.fromPubSub(pubsub).pipe(
  Stream.map((evt) => Sse.Event({ event: evt.type, data: JSON.stringify(evt) })),
  Stream.pipeThroughChannel(Sse.encode()),
)
return HttpServerResponse.stream(stream, { contentType: "text/event-stream" })
```

3. Events flow live while the client is connected.
4. Stream closes on `run.completed` / `run.failed` / `run.cancelled` or client disconnect.
5. **No replay**: if the user reloads mid-run, they see events from the reconnect point onward. The complete log is available via `research_runs.tool_log` after the run finishes.

This is deliberately simpler than a persisted event log. The trade-off: no mid-run resume on page reload. The `tool_log` jsonb column on `research_runs` gives full audit after completion.

### 13.3 Cancellation

`POST /research/:id/cancel`:

1. Look up the fiber (keep a `Map<id, Fiber>` in `ResearchService`).
2. `Fiber.interrupt(fiber)`.
3. Update row `status='cancelled'`.

Provider calls that need upstream cancellation wrap their long-running operations in `Effect.onInterrupt`:

```ts
// firecrawl-discover.ts
const discover = (input) => Effect.gen(function* () {
  const budget = yield* Budget
  yield* budget.chargeCheap('firecrawl', estimateStartCents(input))
  const { jobId } = yield* http.post('/v1/agent', input)

  return yield* pollUntilDone(jobId).pipe(
    Effect.onInterrupt(() => http.post(`/v1/agent/${jobId}/cancel`, {}).pipe(Effect.ignore))
  )
})
```

Effect's structured concurrency guarantees the cleanup runs on interrupt.

### 13.4 Failure handling

- Provider error → tool result with `{ error, recoverable }`. LLM decides whether to retry with different params, switch tools, or give up.
- Schema validation failure on final output → retry once with the validation errors fed back; fail if second attempt also invalid.
- Fiber crash → `status='failed'`, error captured to `findings.error`, event `run.failed` emitted.
- Server restart mid-run → **not survivable in v1**. `status='running'` rows older than N seconds on boot are marked `failed` by a startup sweeper. Durable execution is a future extension. However, paid call results are **write-ahead persisted**: each successful paid provider response is written to `research_paid_spend.result_hash` and to a `research_paid_results` jsonb column on the spend row immediately after the provider returns, before the fiber continues. On restart, the sweeper marks the run as failed but the paid results are recoverable — the UI shows them with a "run interrupted, partial paid results available" state, and the user can start a follow-up run that re-uses the cached results instead of re-purchasing.

---

## 14. HTTP API

```
POST   /research                              create + fork
  body: { query, mode?, context?, schema_name?, budget_cents?, paid_budget_cents?, auto_approve_paid_cents? }
  note: per-run budget overrides are clamped to the user's policy (§11.2), not the system ceiling
  → 202 { id, status: 'queued' }
  → 409 { error: 'InsufficientBudget', estimated, available, shortfall }
  → 409 { error: 'ConfirmRequired', estimated_cost_cents, preview }   (fan-out > threshold)

GET    /research/:id                          full row, findings, sources
GET    /research/:id/events                   SSE live stream (no replay)
POST   /research/:id/cancel                   interrupt + upstream cancel
POST   /research/:id/attach                   { subject_table, subject_id }  post-hoc link
DELETE /research/:id                          soft-delete (sets status='deleted'; content retained)

GET    /research                              list, filter, paginate
  query: ?created_by=&status=&subject_table=&subject_id=&since=

GET    /research/by-subject/:table/:id        all runs linked to a subject row

-- Paid action approval workflow (see §11.5 for follow-up mechanics)
POST   /research/:id/paid-actions/:pa_id/approve   → creates a followup run (§11.5), returns { followup_run_id }
POST   /research/:id/paid-actions/:pa_id/skip      → marks action as skipped, no follow-up

-- Proposed update workflow
GET    /research/:id/proposed-updates         list proposals
POST   /research/:id/proposed-updates/:pu_id/apply    (fires update_company with expected_version)
POST   /research/:id/proposed-updates/:pu_id/reject

-- Preferences
GET    /research/preferences                  current user
PUT    /research/policy                        { budget_cents, paid_budget_cents, auto_approve_paid_cents, paid_monthly_cap_cents }
```

All routes live in `apps/server/src/handlers/research.ts` and are declared in `@batuda/controllers` as an HttpApiGroup, following the existing pattern.

---

## 15. MCP surface

### 15.1 Tools (exposed to Claude Desktop, Claude Code, ChatGPT)

Same toolkit used by the research fiber, with two differences:

1. `**research_sync**` — synchronous variant of `/research`:

```ts
research_sync({ query, context?, schema_name?, max_wait_seconds?: 120 })
```

Runs the fiber to completion or deadline, returns full findings inline. Better UX for tool-calling LLM hosts that don't want to poll.
2. `**start_research**` and `**get_research**` — async pair for Claude Desktop users doing long-running research:

```ts
start_research({ query, context?, schema_name?, ... }) → { id }
get_research({ id }) → { status, findings, cost }
```

### 15.2 Prompts

Keep the existing `CompanyResearchPrompt` (`apps/server/src/mcp/prompts/company-research.ts:9`) — it's for Claude Desktop users who do their own synthesis over Batuda data. `/research` is for Batuda web app users who want one-click agent loops. They coexist.

Add:

- `ResearchDesignerPrompt` — helps a user phrase a research query, suggests `schema_name`, computes an estimated budget.

### 15.3 Resources

- `batuda://research/{id}` — returns the research run as an MCP resource (findings + brief + sources).

---

## 16. Scenarios

### 16.1 Scenario 1 — subject-anchored enrichment

**State before.** One company in Batuda, mostly empty:

```
id       01J9T0QH6A...
slug     cooperativa-olivera-vilanova
name     Cooperativa Olivera de Vilanova
website  https://olivera-vilanova.cat
status   lead
region   es-CT
industry NULL
```

**Request.**

```http
POST /research
Idempotency-Key: 01J9Z-submit-abc

{
  "query": "Enrich: industry, size, current tools, buying signals. Find 3 competitors in region. Find key contacts with role and public email.",
  "mode": "deep",
  "context": {
    "subjects": [{ "table": "companies", "id": "01J9T0QH6A..." }],
    "hints":    { "language": "ca", "recency_days": 365 }
  },
  "schema_name": "company_enrichment_v1"
}
```

**Response.** `202 Accepted { id: "01J9ZK8QYM...", status: "queued" }`.

**Fiber timeline.**

| T      | Tier | Step                                                                                                                                                                                         | Cost   |
| ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| +0ms   | —    | snapshot row (v5), init Budget(cheap=50, paid=0), status=running                                                                                                                             | —      |
| +400ms | 0    | `lookup_registry({country:'ES', query:'Cooperativa Olivera de Vilanova'})` → libreBORME: NIF F08234567, capital €450k, 2 admins (Jordi Pla, Marta Soler) since 2019                          | 0      |
| +800ms | 0    | `crm_lookup({table:'companies', query:'olivera'})` → finds L'Olivera SCCL already in DB                                                                                                      | 0      |
| +1.5s  | 1    | `web_read({url:'olivera-vilanova.cat'})` → homepage markdown                                                                                                                                 | 1 cr   |
| +3.5s  | 1    | `web_read({url:'olivera-vilanova.cat/memoria-2024.pdf'})` → annual report text                                                                                                               | 1 cr   |
| +5s    | 1    | `web_search({query:'cooperatives oli ecològic Bages', limit:10})`                                                                                                                            | 1 cr   |
| +6s    | 1    | 3× `web_read` on competitor homepages (parallel, `withConcurrency(3)`)                                                                                                                       | 3 cr   |
| +10s   | 0    | `attach_finding({subject_table:'companies', subject_id:'<L\'Olivera id>', kind:'already_in_db'})`                                                                                            | 0      |
| +11s   | 0    | `propose_update({ subject_table:'companies', subject_id:'01J9T0QH6A...', expected_version:5, fields:{...}, reason:'...', citations:[{source_id:'src_reg_1',...},{source_id:'src_2',...}] })` | 0      |
| +12s   | —    | final structured output emitted, validated against `company_enrichment_v1`, citation references resolved                                                                                     | —      |
| +13s   | —    | second LLM pass generates `brief_md` in Catalan                                                                                                                                              | ~€0.01 |
| +13.5s | —    | persist findings, brief_md, sources[8], cost_cents=~~3, tokens=~~15k, status=succeeded                                                                                                       | —      |

**Total cost:** ~6 Firecrawl credits (≈ €0.006) + ~€0.02 LLM tokens ≈ **€0.03**. No einforma call — libreBORME supplied the directors directly and authoritatively.

**UI.** Brief in Catalan (markdown), 3 proposal diff-chips with Apply/Reject, 3 competitors with "Add as lead", 2 contacts with "Add as contact", 8 clickable sources (each with archived snapshot), cost summary.

**Human commits.** User clicks Apply → frontend fires `update_company({ id, fields, expected_version:5 })`. OCC passes, row bumps to v6. User clicks "Add as lead" for Oliaire → new company row + `research_links(research_id, 'companies', new_id, 'finding')`. User clicks "Save as document" → documents row (type='research', content=Tiptap JSON from brief_md).

### 16.2 Scenario 2 — free-text exploratory

**Request.**

```http
POST /research

{
  "query": "Find Catalan agroecology cooperatives that publicly mention struggling with CRMs or spreadsheets in the last 6 months. For each, check if we already have them in Batuda.",
  "mode": "deep",
  "context": { "hints": { "language": "ca", "recency_days": 180 } },
  "schema_name": "prospect_scan_v1"
}
```

No subjects, no selector. The LLM:

1. `web_search({query: "..."})` → 10-15 URLs
2. `web_read` on top candidates in parallel
3. For each discovered cooperative name: `crm_lookup({table: 'companies', query: name})`
4. `lookup_registry` on the most promising ones to verify legal names and get NIFs
5. `attach_finding` for the ones already in DB (kind='already_in_db')
6. Final findings list new prospects with name, website, NIF, "why relevant," citations

Cost: mostly cheap-tier. No paid spend.

### 16.3 Scenario 3 — selector fan-out

**Request.**

```http
POST /research

{
  "query": "For each lead in Girona tagged restaurant, find recent news about hiring, openings, or funding",
  "mode": "deep",
  "context": {
    "selector": { "table": "companies", "filter": { "status": "lead", "region": "es-CT", "tags": ["restaurant"] } }
  }
}
```

Server:

1. Expands selector → 17 rows.
2. Estimated cost: 17 × ~6 cents = ~€1.02. Exceeds single-run budget → returns `409 ConfirmRequired { estimated, preview: 17 }`.
3. User confirms → server creates parent `research_runs(kind='group')` + 17 leaf rows (`kind='leaf', parent_id=parent.id`).
4. Each leaf runs as a subject-anchored research, concurrency-capped at 3.
5. Parent aggregates status (`running → succeeded` when all leaves done) and cost.

---

## 17. Provider recipes (v1 loadout)

### Spain-only starter (cheap)

```bash
RESEARCH_PROVIDER_SEARCH=brave              # free tier
RESEARCH_PROVIDER_SCRAPE=firecrawl
RESEARCH_PROVIDER_EXTRACT=firecrawl
RESEARCH_PROVIDER_DISCOVER=anthropic        # Claude's native web_search
RESEARCH_PROVIDER_REGISTRY_ES=librebor      # free, always on
RESEARCH_PROVIDER_REPORT_ES=einforma        # paid, gated
```

### Quality loadout with fallback

```bash
RESEARCH_PROVIDER_SEARCH=exa,brave          # Exa primary, Brave on ProviderError
RESEARCH_PROVIDER_SCRAPE=firecrawl
RESEARCH_PROVIDER_EXTRACT=firecrawl
RESEARCH_PROVIDER_DISCOVER=firecrawl
RESEARCH_PROVIDER_REGISTRY_ES=librebor
RESEARCH_PROVIDER_REPORT_ES=einforma
RESEARCH_API_KEY_SEARCH=exa_...             # slot 1 = Exa
RESEARCH_API_KEY_SEARCH_2=BSA...            # slot 2 = Brave
```

### Local dev (zero external cost)

```bash
RESEARCH_PROVIDER_SEARCH=brave              # free tier sufficient
RESEARCH_PROVIDER_SCRAPE=local              # Playwright headless
RESEARCH_PROVIDER_EXTRACT=local             # Playwright + prompt extract via LLM
RESEARCH_PROVIDER_DISCOVER=none             # disabled
RESEARCH_PROVIDER_REGISTRY_ES=librebor      # free
RESEARCH_PROVIDER_REPORT_ES=none            # disabled
```

### Notes on specific providers

- **libreBORME** — free Spanish company registry mirror. BORME = Boletín Oficial del Registro Mercantil. Returns legal name, NIF, capital, incorporation date, directors (admins), address, status. Always prefer over scraping for Spanish companies.
- **einforma** — paid commercial report, ~€1–5/call depending on depth. Financials, shareholders, risk score. Use only for due-diligence deep dives where libreBORME + web scraping are insufficient.
- **Firecrawl** — best all-rounder: scrape, search, extract, agent. Monthly credit plans (Hobby $19/mo = 3k credits, Standard $83/mo = 100k credits). Credits: 1/scrape, 2/search(10 results), 5/agent run. Credits reset monthly, don't roll over. Auto-recharge packs ($9/1k) carry forward. Balance API: `GET /v2/team/credit-usage` → auto-sync. Use as scrape/extract default; use agent (via `web_discover`) sparingly.
- **Exa** — best-in-class semantic search. $7/1k search requests, 1k/month free. Use as primary `SearchProvider` when quality matters more than free tier.
- **Brave Search** — free tier, workable for dev and for cost-sensitive production.
- **Anthropic web_search** — Claude's native tool, zero setup. Good fallback `DiscoverProvider`, but citations are model-maintained (no `content_ref` archive). Useful when budget is tight.
- **Playwright local** — dev fallback. Slow and flaky, but free and works offline.

### Provider landscape (researched April 2026)

These are the top providers per capability, sorted by relevance for B2B company research in Spain/EU. Not all will be implemented — this is a reference for choosing providers.

#### Search APIs (for `web_search`)

| Provider         | Pricing                  | Free tier              | Best for                                                           | TS SDK    |
| ---------------- | ------------------------ | ---------------------- | ------------------------------------------------------------------ | --------- |
| **Exa**          | $7/1k search             | 1k req/month           | Semantic search ("companies like X"), understands business context | Yes       |
| **Tavily**       | $0.008/credit            | 1k credits/month       | Citation-ready, built for RAG/agent workflows                      | Yes       |
| **Firecrawl**    | From $19/mo (3k credits) | 500 credits (one-time) | Integrated search+scrape in one API; 2 credits per search          | Yes       |
| **Brave Search** | $5/1k                    | None (very cheap)      | Privacy-focused, independent index, GDPR-compliant                 | REST only |
| **SerpAPI**      | $75/5k                   | 250/month              | Multi-engine SERP (40+ engines), enterprise reliability            | REST      |
| **Serper**       | $0.30/1k                 | None                   | Cheapest Google SERP option                                        | REST      |

#### Scrape APIs (for `web_read`)

| Provider        | Pricing                   | Best for                                                   | TS SDK |
| --------------- | ------------------------- | ---------------------------------------------------------- | ------ |
| **Firecrawl**   | Credit-based, from $16/mo | AI-native markdown, PDF parsing, JS sites, /agent endpoint | Yes    |
| **ScrapingBee** | $49/mo                    | Anti-bot evasion, headless Chrome, LLM-ready markdown      | Yes    |
| **Apify**       | $40/mo                    | 20k+ pre-built actors (LinkedIn, etc.), marketplace        | Yes    |
| **Browserbase** | Custom                    | Real browser sessions, interactive workflows               | Yes    |
| **Bright Data** | $250/mo                   | Enterprise proxy network, 150M+ IPs globally               | REST   |
| **Zyte**        | Pay-per-use               | Large-scale extraction, 15+ years experience               | REST   |

#### Company data / enrichment APIs (for registry + report providers)

| Provider             | Pricing                | EU/ES coverage              | Best for                                                  | TS SDK  |
| -------------------- | ---------------------- | --------------------------- | --------------------------------------------------------- | ------- |
| **libreBORME**       | Free                   | Spain (BORME official data) | Official registry: NIF, directors, capital, incorporation | REST    |
| **einforma**         | ~€1-5/report           | Spain (strong)              | Deep financials, risk scores, shareholders                | REST    |
| **Dropcontact**      | €29/mo                 | France/EU, GDPR-native      | EU email enrichment + SIREN/SIRET legal entity data       | REST    |
| **Cognism**          | Custom                 | Strong EMEA                 | Phone-verified contacts, intent data, GDPR compliant      | REST    |
| **Apollo.io**        | $49/user/mo, free tier | Yes                         | Affordable all-rounder, waterfall enrichment              | REST    |
| **Hunter.io**        | $0.01/lookup           | Yes                         | Email finder + verification, developer-friendly           | **Yes** |
| **Proxycurl**        | Credit-based           | Yes                         | LinkedIn company/employee lookup via API                  | REST    |
| **Crustdata**        | Credit-based           | Yes                         | Real-time company signals, webhook-based watchers         | REST    |
| **People Data Labs** | $0.02-0.08/record      | Moderate (US-centric)       | Largest dataset (3B+ persons, 60M+ companies)             | REST    |

**Notes on EU/Spanish market:** Most global enrichment providers (Clearbit, ZoomInfo, PDL) are US-centric and have poor coverage of Spanish cooperatives and SMBs. For our market, the hierarchy is: libreBORME (free, authoritative) > einforma (paid, comprehensive for ES) > web scraping (catches the long tail) > global enrichment APIs (supplementary at best). Dropcontact is worth adding when we expand to France.

---

## 18. Env vars (vendor-neutral, explicit)

Following the `feedback_env_var_naming` and `feedback_explicit_env_vars` rules in memory.

Role-first grammar. `RESEARCH_PROVIDER_<CAP>` accepts a comma list: slot 1 = primary, slot N = fallback chain triggered by `ProviderError`. API keys follow the same grammar (`RESEARCH_API_KEY_<CAP>`) with `_2`, `_3`, … suffixes when a capability has multiple slots. Registry and report add the ISO-3166-1 country code as suffix.

```bash
# --- Provider selection ---
RESEARCH_PROVIDER_SEARCH=                   # comma-list: exa | tavily | brave | firecrawl | stub
RESEARCH_PROVIDER_SCRAPE=                   # firecrawl | scrapingbee | local | stub
RESEARCH_PROVIDER_EXTRACT=                  # firecrawl | tavily | local | stub
RESEARCH_PROVIDER_DISCOVER=                 # firecrawl | anthropic | none | stub

# --- Country-specific providers ---
RESEARCH_PROVIDER_REGISTRY_ES=              # librebor | none | stub
RESEARCH_PROVIDER_REPORT_ES=                # einforma | none | stub

# --- LLM provider (for the agent loop) ---
RESEARCH_PROVIDER_LLM=                      # stub | groq | fireworks | nebius | together | sambanova | custom
RESEARCH_MODEL_LLM=                         # model id (e.g. qwen/qwen3-32b)
RESEARCH_BASE_URL_LLM=                      # only when RESEARCH_PROVIDER_LLM=custom

# --- API keys (parallel grammar) ---
# Slot 1 = unsuffixed; slot N = `_2`, `_3`, …
RESEARCH_API_KEY_SEARCH=
RESEARCH_API_KEY_SCRAPE=
RESEARCH_API_KEY_EXTRACT=
RESEARCH_API_KEY_DISCOVER=
RESEARCH_API_KEY_REGISTRY_ES=               # (librebor is free — leave unset)
RESEARCH_API_KEY_REPORT_ES=
RESEARCH_API_KEY_LLM=
# RESEARCH_API_KEY_SEARCH_2=                # only when SEARCH list has ≥2 vendors

# --- Budget defaults (system) ---
RESEARCH_DEFAULT_BUDGET_CENTS=100            # €1/run cheap tier
RESEARCH_DEFAULT_PAID_BUDGET_CENTS=500       # €5/run paid tier
RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS=200 # €2 auto-approve; first einforma call silent, second triggers propose_paid_action
RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS=2000 # €20/month per user
RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS=10000 # €100/month absolute system max

# --- Provider quota defaults (for new users; see §11.6) ---
# Firecrawl: sync_mode=api — auto-created on first API key setup, no manual config needed.
# System calls GET /v2/team/credit-usage to get plan details and remaining credits.
RESEARCH_QUOTA_FIRECRAWL_SYNC=api           # auto-sync from Firecrawl balance API
RESEARCH_QUOTA_FIRECRAWL_UNIT=credits
RESEARCH_QUOTA_FIRECRAWL_CENTS_PER_UNIT=1   # notional ~$0.01/credit (varies by plan)
# eInforma: sync_mode=manual — admin enters plan details in settings.
RESEARCH_QUOTA_EINFORMA_SYNC=manual
RESEARCH_QUOTA_EINFORMA_TOTAL=5             # reports/month (admin overrides in settings)
RESEARCH_QUOTA_EINFORMA_UNIT=reports
RESEARCH_QUOTA_EINFORMA_BILLING=monthly_plan
RESEARCH_QUOTA_EINFORMA_PERIOD_MONTHS=1
RESEARCH_QUOTA_EINFORMA_CENTS_PER_UNIT=300  # ~€3/report notional

# --- Concurrency and safety ---
RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL=3
RESEARCH_MAX_CONCURRENCY_FANOUT=3
RESEARCH_CONFIRM_THRESHOLD_FANOUT=10        # fan-out over this N triggers UI confirm
```

Boot fails loudly if any of the first six vars are unset.

---

## 19. Build checklist

Everything ships together as v1.

- Migrations: `research_runs` (incl. `tool_log`, `quota_breakdown` jsonb), `sources`, `research_run_sources`, `research_links`, `research_paid_spend` (incl. `idempotency_key`, `quota_units`, `quota_unit`), `user_research_policy`, `provider_quotas`, `provider_usage`.
- Tables on subject rows: add `version int NOT NULL DEFAULT 0` to `companies`, `contacts`.
- Decide and implement soft-delete vs triggers for polymorphic integrity (§17 open decisions).
- `SearchProvider`, `ScrapeProvider`, `ExtractProvider`, `DiscoverProvider` interfaces + Firecrawl impls + Brave impl + local Playwright impl.
- `RegistryProvider` + libreBORME impl (ES). `ReportProvider` + einforma impl (ES).
- `Budget` service: cheap + paid tiers. `MonthlyPaidSpend.chargeWithinCap` uses `pg_advisory_xact_lock` per user to serialize concurrent fibers. Paid calls use `idempotency_key` on `research_paid_spend` to prevent double-charge on retry.
- Policy resolution: system env → `user_research_policy` → per-run override (clamped to user policy, not system ceiling).
- Follow-up run mechanic: `POST /research/:id/paid-actions/:pa_id/approve` creates a `kind='followup'` run with the approved action's tool/args plus a findings summary from the parent (§11.5). Write-ahead persist paid results to `research_paid_spend` immediately after provider returns.
- `ProviderQuota` service: `check` / `consume` / `remaining` / `sync` against `provider_quotas` + `provider_usage`. Two sync modes: `api` (auto-sync from provider balance API, e.g., Firecrawl `GET /v2/team/credit-usage`) and `manual` (admin configures in settings, e.g., eInforma). Quota check fires before budget charge in provider instrumentation (§12.2).
- `QuotaExhausted` / `ApprovalRequired` / `BudgetExceeded` / `MonthlyCapExceeded` error types and LLM prompt rules.
- Schema registry: `freeform`, `company_enrichment_v1`, `competitor_scan_v1`, `contact_discovery_v1`, `prospect_scan_v1`.
- `ResearchService`: subject-anchored + selector fan-out (parent/leaf rows, concurrency cap, confirm threshold).
- Tools: `web_search`, `web_read`, `web_discover`, `lookup_registry`, `crm_lookup`, `propose_update`, `attach_finding`, `propose_paid_action` (8 total).
- `LanguageModel.streamText` + `LanguageModel.generateObject` wired via `@effect/ai-anthropic`.
- HTTP: `POST /research`, `GET /research/:id`, `GET /research/:id/events` (SSE live), `POST /research/:id/cancel`, paid-action approval, proposed-update apply/reject.
- In-memory PubSub for live SSE; `tool_log` jsonb for post-run audit.
- MCP tools: `start_research`, `get_research`, `research_sync`.
- UI: `/research` page in the Batuda web app (create + detail with findings + brief + sources + proposals panel), by-subject tab on company detail, spending policy in settings, paid action approval UI.
- Observability (§20).
- More country registries (UK Companies House, FR Pappers).

---

## 20. Observability

Additions to `docs/observability.md`:

### Events (fired from `WebhookService`)

| Event                              | When                             |
| ---------------------------------- | -------------------------------- |
| `research.created`                 | POST /research succeeds          |
| `research.started`                 | fiber begins                     |
| `research.tool_called`             | every tool invocation            |
| `research.budget_exceeded`         | cheap or paid budget error       |
| `research.approval_required`       | `propose_paid_action` triggered  |
| `research.succeeded`               | fiber completes                  |
| `research.failed`                  | fiber errors or validation fails |
| `research.cancelled`               | user cancels                     |
| `research.proposed_update_applied` | user clicks Apply on a proposal  |
| `research.paid_spend_recorded`     | any paid call (auto or approved) |
| `research.quota_exhausted`         | provider quota depleted          |
| `research.quota_warn`              | provider usage > warn_at_pct     |

### Metrics

- `research.run.count{status}`
- `research.run.duration_ms{status}`
- `research.tool.call_count{tool,provider}`
- `research.tool.error_count{tool,provider,error_kind}`
- `research.cost.cents{tier,provider}` (histogram)
- `research.paid_spend.monthly{user}` (gauge)
- `research.budget.exceeded_count{tier}`
- `research.quota.remaining{provider,unit}` (gauge)
- `research.quota.exhausted_count{provider}`

### Log annotations

Every span in a research fiber carries:

```
Effect.annotateLogs({ research_id, user_id, mode, schema_name })
```

so logs can be filtered per run. Follows the pattern in `apps/server/server.log` (see `reference_server_log` memory).

---

## 21. Open decisions

These must be resolved before v1 can ship. Listed here so they don't get lost.

### 21.1 Schema registry format

Where the compiled Effect Schemas live:

- **(a) In-code registry** (`apps/server/src/services/research/schemas/index.ts`): a `Record<string, Schema.Any>`. Type-safe, versioned via file names. Simple.
- **(b) Dynamic registry** (from a `research_schemas` table with stored JSON Schema, compiled at runtime): flexible, but loses type safety at the LLM boundary.

**Recommendation:** (a). Revisit only if users start needing custom schemas.

### 21.2 Durable execution

Server restart mid-run kills the fiber. v1 solution: on boot, mark `status='running'` rows older than N seconds as `failed`.

**Future:** persist LLM stream state every K tool calls to `research_runs.resume_state jsonb` and have a sweeper re-enqueue long-running runs on boot. Not needed for v1 but plan the column.

### 21.3 GDPR / data retention

Research stores contact emails and personal details discovered from public sources. EU cooperatives = GDPR applies.

- **Retention policy**: default expire `sources.content_ref` and `research_runs.findings` after N days unless the user pins a run.
- **DSAR support**: ability to purge all sources + findings referencing a specific email/name.
- **Consent record**: note in ToS that using research on a subject is a legitimate-interest processing activity.

**Recommendation:** document the policy before shipping (paid registry lookups pull personal data). Don't ship until this is in writing.

---

## 22. Future extensions (not v1)

Named so the v1 shape doesn't preclude them.

- **Internal corpus** (pgvector + embeddings over interactions/documents/emails). Slots in as a tier-0 `corpus_search` tool alongside `crm_lookup`. No schema changes.
- **Scheduled watchers** (`research_watchers` table, cron triggers, findings diff → webhook).
- **Knowledge graph of discovered entities** (`research_entities` table, entity dedup across runs, graph traversal). Lets subsequent runs skip re-discovery.
- **Per-provider trust** in `user_research_policy` as additional jsonb column (v2).
- **Multi-agent coordination**: coordinator + specialized sub-agents (web, registry, CRM, email). Only worth adding at ≥30 tools or long horizons.
- **MCP-as-the-abstraction**: let ops add research sources by configuring MCP servers instead of writing providers. Useful if the provider ecosystem matures further.
- **Email as research channel** via AgentMail: send a clarifying question to a prospect's public address and treat the reply as a source.
- **More countries**: UK Companies House, FR Pappers/Sirene, DE Handelsregister. Each is one `*-registry.ts` impl + a router branch.
- **Native web_search tools**: if Anthropic's or OpenAI's native search tools improve enough, make them first-class `DiscoverProvider` implementations.

---

## 23. Appendix — canonical row shapes

### 23.1 A completed `research_runs` row

```jsonc
{
  "id": "01J9ZK8QYM…",
  "parent_id": null,
  "kind": "leaf",
  "query": "Enrich: industry, size, current tools…",
  "mode": "deep",
  "schema_name": "company_enrichment_v1",
  "status": "succeeded",
  "context": {
    "subjects": [{
      "table": "companies",
      "id": "01J9T0QH6A…",
      "snapshot": { "name": "Cooperativa Olivera de Vilanova", "website": "…", "version": 5 }
    }],
    "hints": { "language": "ca", "recency_days": 365 }
  },
  "findings": {
    "enrichment": { "industry": "…", "size_range": "51-200", "citations": [ … ] },
    "competitors": [ … ],
    "contacts": [ … ],
    "proposed_updates": [ … ],
    "discovered_existing": [ … ],
    "pending_paid_actions": []
  },
  "brief_md": "## Cooperativa Olivera de Vilanova\n\nCooperativa de 1924 a…",
  "budget_cents": 50,
  "paid_budget_cents": 0,
  "cost_cents": 3,
  "paid_cost_cents": 0,
  "cost_breakdown": { "firecrawl": 3 },                               // notional cents (volume governor)
  "quota_breakdown": { "firecrawl": { "units": 6, "unit": "credits" } }, // actual provider units consumed
  "tokens_in": 12400,
  "tokens_out": 3100,
  "paid_policy": {
    "budget_cents": 100,
    "paid_budget_cents": 500,
    "auto_approve_paid_cents": 200,
    "paid_monthly_cap_cents": 2000,
    "resolved_at": "2026-04-09T14:32:10Z"
  },
  "tool_log": [
    { "seq": 1, "type": "tool.call", "tool": "lookup_registry", "at": "…" },
    { "seq": 2, "type": "tool.result", "tool": "lookup_registry", "cost_cents": 0, "at": "…" },
    { "seq": 3, "type": "tool.call", "tool": "web_read", "at": "…" },
    "… (full log of all tool calls/results)"
  ],
  "idempotency_key": "01J9Z-submit-abc",
  "created_by": "usr_…",
  "created_at": "2026-04-09T14:32:10Z",
  "started_at": "2026-04-09T14:32:10Z",
  "completed_at": "2026-04-09T14:32:34Z"
}
```

### 23.2 A `sources` row

```jsonc
{
  "id": "src_reg_1",
  "kind": "registry",
  "provider": "librebor",
  "url": "https://librebor.me/borme/company/F08234567/",
  "url_hash": "sha256:…",
  "domain": "librebor.me",
  "title": "libreBORME — Cooperativa Olivera de Vilanova",
  "first_fetched_at": "2026-04-09T14:32:10Z",
  "last_fetched_at": "2026-04-09T14:32:10Z",
  "content_hash": "sha256:…",
  "content_ref": "s3://batuda-sources/registry/librebor/F08234567.json",
  "language": "es"
}
```

### 23.3 A `research_runs.tool_log` value (written once at completion)

```jsonc
[
  {
    "seq": 1,
    "type": "tool.call",
    "tool": "web_search",
    "args": { "query": "Cooperativa Olivera de Vilanova", "count": 10 },
    "at": "2026-04-09T14:32:08.201Z"
  },
  {
    "seq": 2,
    "type": "tool.result",
    "tool": "web_search",
    "cost_cents": 1,
    "at": "2026-04-09T14:32:09.530Z"
  },
  {
    "seq": 3,
    "type": "tool.call",
    "tool": "web_read",
    "args": { "url": "https://olivera-vilanova.cat" },
    "at": "2026-04-09T14:32:12.103Z"
  },
  {
    "seq": 4,
    "type": "tool.result",
    "tool": "web_read",
    "cost_cents": 1,
    "at": "2026-04-09T14:32:14.887Z"
  }
]
```

### 23.4 A `research_paid_spend` row

```jsonc
{
  "id": "01J9ZS…",
  "research_id": "01J9ZK8QYM…",
  "user_id": "usr_…",
  "provider": "einforma",
  "tool": "lookup_registry",
  "idempotency_key": "01J9ZK8QYM:lookup_registry:a1b2c3d4",
  "amount_cents": 300,                                                    // notional (volume governor)
  "quota_units": 1,                                                        // native: 1 report consumed
  "quota_unit": "reports",
  "args": { "country": "ES", "tax_id": "F08234567", "depth": "financials" },
  "result_hash": "sha256:…",
  "result_data": { "…": "full provider response, write-ahead persisted" },
  "source_id": "src_rep_1",
  "auto_approved": true,
  "approved_by": null,
  "at": "2026-04-09T14:32:22Z"
}
```

---

## 24. Summary in one page

- `/research` is a cross-topic, first-class resource. Not tied to any table.
- Three input modes via `context`: free-text, subject-anchored, selector fan-out.
- One research mode in v1: `deep` (LLM drives a tool loop).
- Six capability providers (`Search`, `Scrape`, `Extract`, `Discover`, `Registry`, `Report`), selected per env var. Tech-agnostic.
- Four tool tiers by cost: 0 (free), 1 (cheap web), 2 (moderate), 3 (paid structured). Climb only when needed.
- Two-layer cost control: **resource budget** (notional cents, volume governor — limits how much a single run can consume) + **provider quotas** (native units — credits, reports, requests — tracks actual consumption against the user's plan). Layers are independent; a call can pass budget but fail quota or vice versa.
- Resource budget: four numbers per user (budget/run, paid budget/run, auto-approve threshold, monthly cap). Defaults: €5/run paid budget, €2 auto-approve (first einforma call silent, second triggers propose_paid_action), €20/month cap. Per-run overrides clamped to user policy.
- Provider quotas: per-provider plan config (total units, billing model, period). Opt-in — no quota row = budget-only gating.
- Links are first-class: `sources` table, content hashes, archived `content_ref` copies, inline citations per claim, citation-validation at run completion.
- Research never mutates domain rows. It writes `proposed_updates` that humans Apply via the existing update endpoints with OCC.
- Effect handles the agent loop (`LanguageModel.streamText` + `Toolkit`), structured concurrency (`Fiber`, `onInterrupt`), observability, and persistence. No external agentic framework.
- SSE live streaming via in-memory `PubSub`; `tool_log` jsonb on `research_runs` for post-run audit (no replay on reload).
- Monthly cap serialized via `pg_advisory_xact_lock` per user — no overshoot under concurrent fibers. Paid calls idempotent via `idempotency_key` on `research_paid_spend`.
- MCP surface exposes `research_sync` (synchronous) and `start_research` / `get_research` (async) for Claude Desktop parity.
- Output formats: jsonb for machine-facing data (`findings`, `sources`, events, policy), markdown text for human narrative (`brief_md`), Tiptap JSON only when saving to `documents.content`.
- Ships as one vertical slice (§19).
- Soft-delete on subject tables (§7.2). OCC via `version` column (§7.3). Three remaining open decisions (§21).
