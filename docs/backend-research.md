# Backend Research

Generic, cross-topic research feature for Forja. An LLM-driven agent loop that consumes the external web (and structured data APIs) via pluggable capability providers, produces verifiable findings with inline citations, and never mutates domain rows directly.

For system context see [architecture.md](architecture.md). For backend structure see [backend.md](backend.md).

> Status: design doc, v0. Not yet implemented. We'll improve it later on.

---

## 1. Overview

`/research` is a **first-class resource**, not a subroute of `/companies` or any other table. A research run is a standalone artifact: query, structured findings, human-readable brief, sources, citations, cost. It may optionally be *anchored* to domain rows (companies, contacts, documents) but its existence does not depend on them.

```
┌──────────────────────────────────────────────────────────────────┐
│  /research (HTTP + MCP)                                          │
│                                                                   │
│  POST /research         → creates a row, forks a fiber           │
│  GET  /research/:id     → current state + findings               │
│  GET  /research/:id/events  → SSE tail (from persisted log)      │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ResearchService (fiber)                                   │  │
│  │   resolve context → build prompt → LLM tool loop           │  │
│  │   ↓ streams tool calls to research_run_events              │  │
│  │   ↓ writes findings, brief_md, sources incrementally       │  │
│  └────────────────────────────────────────────────────────────┘  │
│           │                                                       │
│           ▼                                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Toolkit (shared by LLM loop and MCP)                      │  │
│  │   web_search / web_scrape / web_extract / web_discover     │  │
│  │   lookup_company_registry / lookup_company_report          │  │
│  │   search_companies / get_company / search_contacts  (read) │  │
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

The LLM sees capability tools (`web_scrape`, not `firecrawl_scrape`). Providers are swapped at boot via env vars. The same toolkit is exposed to Claude Desktop through MCP.

---

## 2. Goals and non-goals

### Goals

- **Cross-topic**: one endpoint handles "enrich this company," "find leads matching a description," "find competitors of X," "check registry data for a NIF." No per-topic routes.
- **Tech-agnostic**: every external capability is an interface. Firecrawl, Exa, Tavily, Brave, libreBORME, einforma, Claude's native web_search are *implementations*.
- **Links as source of truth**: every claim carries inline citations pointing at sources with content hashes and archived copies. A user can always answer "where did this come from?" and "is it still true?"
- **Cost-aware**: tiered tools; per-run and per-day budget enforcement at the runtime level, not just in prompts. Default = strict, no paid spend without opt-in.
- **Safety rails**: research never mutates domain rows directly. It proposes updates that humans accept.
- **Frontend-friendly**: users interact via the Forja UI; the server runs the agent loop, the browser streams tool calls via SSE.
- **MCP parity**: Claude Desktop users reach the same capabilities via MCP tools + prompts.

### Non-goals (v1)

- **No internal corpus**: no pgvector, no embeddings over Forja's own data, no RAG on interactions/documents/emails. Research is about pulling from the outside. CRM-read tools (`search_companies`, `get_company`, ...) stay because they are relational lookups, not corpus search.
- **No multi-agent orchestration**: one LLM loop with a broad toolkit. No coordinator/sub-agent split.
- **No agentic framework**: no LangChain, Mastra, LangGraph. Effect's `LanguageModel` + `Toolkit` + `Stream` is the whole loop.
- **No scheduled watchers** (v1). Added in a later phase.
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
    subjects?: Array<{                   // anchor the run to known rows
      table: 'companies' | 'contacts' | 'documents'
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

No subjects, no selector. The LLM runs `web_search` → `web_scrape` → `search_companies` (to dedupe against Forja) → produces a list of new prospects. Findings live standalone; user imports matches.

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

Server expands the filter into N rows, creates a **parent** `research_runs` row (`kind='group'`) and N **leaf** rows (`kind='leaf'`, `parent_id=parent.id`). Each leaf is a subject-anchored run. Parent aggregates cost and status. Fan-out is bounded by `Effect.withConcurrency(n)` and by `paid_daily_cap_cents`.

---

## 4. Cost tiers

### 4.1 Tier matrix

| Tier  | Name            | Cost/call     | Examples                                                                                                              | Gating                                                                                                     |
| ----- | --------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **0** | Free / internal | 0             | `lookup_company_registry` (libreBORME), `search_companies`, `get_company`, `wayback_snapshot`, Brave free-tier search | no gate                                                                                                    |
| **1** | Cheap web       | ~€0.001–0.005 | `web_search` (Exa), `web_scrape` (Firecrawl markdown), `web_extract` (Firecrawl JSON)                                 | debited from `budget_cents`, fails with `BudgetExceeded`                                                   |
| **2** | Moderate        | ~€0.01–0.05   | `web_discover` (Firecrawl agent, Claude web_search)                                                                   | debited from `budget_cents`; LLM sees warning when >50% consumed                                           |
| **3** | Paid structured | €1–5          | `lookup_company_report` (einforma)                                                                                    | debited from **separate** `paid_budget_cents`; above `auto_approve_paid_cents`, uses `propose_paid_action` |

The rule: **climb tiers only when a lower one cannot answer the question.** libreBORME before web_scrape. web_scrape before einforma. Enforced by a prompt rule (soft) and by budget errors (hard).

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

Each interface is an Effect `Context.Tag` with a small method surface:

```ts
// search-provider.ts
export class SearchProvider extends Context.Tag('research/SearchProvider')<
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
>() {}

// scrape-provider.ts
export class ScrapeProvider extends Context.Tag('research/ScrapeProvider')<
  ScrapeProvider,
  {
    readonly scrape: (input: {
      url: string
      formats?: ('markdown' | 'html' | 'links' | 'screenshot')[]
      waitForSelector?: string
      location?: string
    }) => Effect.Effect<ScrapedPage, ProviderError>
  }
>() {}

// extract-provider.ts
export class ExtractProvider extends Context.Tag('research/ExtractProvider')<
  ExtractProvider,
  {
    readonly extract: <A, I>(input: {
      url: string
      schema: Schema.Schema<A, I>
      prompt?: string
    }) => Effect.Effect<A, ProviderError>
  }
>() {}

// discover-provider.ts
export class DiscoverProvider extends Context.Tag('research/DiscoverProvider')<
  DiscoverProvider,
  {
    readonly discover: <A, I>(input: {
      prompt: string
      urls?: string[]
      schema?: Schema.Schema<A, I>
      maxCostCents?: number
    }) => Effect.Effect<DiscoverResult<A>, ProviderError>
    readonly cancel: (jobRef: ExternalJobRef) => Effect.Effect<void, ProviderError>
  }
>() {}

// registry-provider.ts — country-routed
export class RegistryRouter extends Context.Tag('research/RegistryRouter')<
  RegistryRouter,
  {
    readonly lookup: (input: {
      country: 'ES'                       // v1: ES only
      query?: string
      tax_id?: string
    }) => Effect.Effect<RegistryRecord, ProviderError>
  }
>() {}

// report-provider.ts — country-routed, paid
export class ReportRouter extends Context.Tag('research/ReportRouter')<
  ReportRouter,
  {
    readonly report: (input: {
      country: 'ES'
      tax_id: string
      depth: 'basic' | 'financials' | 'full'
    }) => Effect.Effect<CompanyReport, ProviderError>
  }
>() {}
```

### 5.2 Boot-time selection

Follows the existing `email-provider.ts` / `EMAIL_PROVIDER` pattern (see `apps/server/src/main.ts:79`). No `auto`, no fallback chains, explicit-only per the `feedback_explicit_env_vars` rule.

```ts
// apps/server/src/services/research/providers.ts
const SearchProviderLive = Layer.unwrap(
  Effect.gen(function* () {
    const p = yield* Config.schema(
      Schema.Literals(['exa', 'tavily', 'brave', 'firecrawl']),
      'RESEARCH_SEARCH_PROVIDER',
    )
    yield* Effect.logInfo(`research search provider: ${p}`)
    switch (p) {
      case 'exa':       return ExaSearchLive
      case 'tavily':    return TavilySearchLive
      case 'brave':     return BraveSearchLive
      case 'firecrawl': return FirecrawlSearchLive
    }
  }),
)
```

Same shape for the other five capabilities.

---

## 6. Tool surface

Tools are named by **capability**, not vendor. Each is defined once as an Effect `Tool.make` and annotated with the existing `Tool.Readonly` / `Tool.Destructive` / `Tool.OpenWorld` pattern (see `apps/server/src/mcp/tools/companies.ts:105`).

### 6.1 Research tools

```ts
// apps/server/src/mcp/tools/research-web.ts
web_search({ query, limit?, recency_days?, location?, languages? })
  → Readonly, OpenWorld, tier 1
web_scrape({ url, formats?, wait_for_selector?, location? })
  → Readonly, OpenWorld, tier 1
web_extract({ url, schema_name, prompt? })
  → Readonly, OpenWorld, tier 1
web_discover({ prompt, urls?, schema_name?, max_cost_cents? })
  → Readonly, OpenWorld, tier 2

// apps/server/src/mcp/tools/research-registry.ts
lookup_company_registry({ country, query?, tax_id? })
  → Readonly, OpenWorld, tier 0
lookup_company_report({ country, tax_id, depth })
  → Readonly, OpenWorld, tier 3

// apps/server/src/mcp/tools/research-archive.ts
wayback_snapshot({ url, at? })
  → Readonly, OpenWorld, tier 0
```

### 6.2 CRM-read tools (reused)

`search_companies`, `get_company`, `search_contacts`, `get_contact`, `get_document`, `search_pipeline` — already exist (`apps/server/src/mcp/tools/companies.ts`, etc.). Added to the research fiber's toolkit verbatim, read-only.

### 6.3 Sink tools (research writes)

```ts
// apps/server/src/mcp/tools/research-sink.ts

propose_update({
  subject_table: 'companies' | 'contacts' | 'documents',
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
  tool: string,                 // 'lookup_company_report'
  args: unknown,
  estimated_cents: int,
  reason: string,
  blocking: boolean
})
  → writes to research_runs.findings.pending_paid_actions[]
  → !Destructive, !OpenWorld
```

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
  kind                    text NOT NULL CHECK (kind IN ('leaf','group')) DEFAULT 'leaf',

  query                   text NOT NULL,
  mode                    text NOT NULL DEFAULT 'deep',       -- v1: only 'deep'
  schema_name             text,                                -- §8

  status                  text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  context                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {subjects?, selector?, hints?}

  findings                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- structured output (§8)
  brief_md                text,                                -- human narrative (§8)

  -- Budget / cost
  budget_cents            int NOT NULL DEFAULT 0,
  paid_budget_cents       int NOT NULL DEFAULT 0,
  cost_cents              int NOT NULL DEFAULT 0,
  paid_cost_cents         int NOT NULL DEFAULT 0,
  cost_breakdown          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { provider: cents, ... }
  tokens_in               int NOT NULL DEFAULT 0,
  tokens_out              int NOT NULL DEFAULT 0,
  paid_policy             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- resolved policy snapshot

  -- Audit
  idempotency_key         text UNIQUE,
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  started_at              timestamptz,
  completed_at            timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX research_runs_status_idx ON research_runs(status) WHERE status IN ('queued','running');
CREATE INDEX research_runs_parent_idx ON research_runs(parent_id);
CREATE INDEX research_runs_created_by_idx ON research_runs(created_by);

--
-- Event log (SSE backlog + audit)
--
CREATE TABLE research_run_events (
  research_id   uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  seq           int NOT NULL,
  type          text NOT NULL,                                 -- 'tool.call'|'tool.result'|'tool.error'|'run.phase'|'run.completed'|'run.failed'
  payload       jsonb NOT NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (research_id, seq)
);

--
-- Sources (globally deduped by url_hash)
--
CREATE TABLE sources (
  id                text PRIMARY KEY,                          -- 'src_' + ulid
  kind              text NOT NULL CHECK (kind IN ('web','registry','archive','report')),
  provider          text NOT NULL,                             -- 'firecrawl','librebor','wayback','einforma',...
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
  archive_url       text                                       -- web.archive.org snapshot URL if pushed
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
-- Polymorphic link between a run and a subject row (companies/contacts/documents)
--
CREATE TABLE research_links (
  research_id    uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  subject_table  text NOT NULL CHECK (subject_table IN ('companies','contacts','documents')),
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
  id             uuid PRIMARY KEY,
  research_id    uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  provider       text NOT NULL,
  tool           text NOT NULL,
  amount_cents   int NOT NULL,
  args           jsonb NOT NULL,                               -- redacted of secrets
  result_hash    text,                                         -- sha256 of normalized response
  source_id      text REFERENCES sources(id),
  auto_approved  boolean NOT NULL,
  approved_by    uuid,                                         -- if manual
  at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX research_paid_spend_user_at_idx ON research_paid_spend(user_id, at DESC);

--
-- User-level research preferences
--
CREATE TABLE user_research_preferences (
  user_id                    uuid PRIMARY KEY,                 -- → users(id)
  mode                       text NOT NULL DEFAULT 'strict' CHECK (mode IN ('strict','custom')),
  default_budget_cents       int NOT NULL DEFAULT 50,
  default_paid_budget_cents  int NOT NULL DEFAULT 0,
  auto_approve_paid_cents    int NOT NULL DEFAULT 0,
  paid_daily_cap_cents       int NOT NULL DEFAULT 0,
  overrides                  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- reserved for per-provider rules (v2)
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
```

### 7.2 Polymorphic FK integrity

`research_links.subject_id` is not a hard FK — Postgres doesn't support polymorphic references. Integrity is application-side. **Open decision**: soft-delete vs. triggers (see §17).

### 7.3 OCC on subject rows

`propose_update` carries `expected_version`. Applying a proposal runs `update_company({ id, fields, expected_version })` which fails if the row changed. **Requires a `version int NOT NULL DEFAULT 0` column on `companies`/`contacts`/`documents`.** Not present today — see §17.

---

## 8. Output formats per field

| Field                                                          | Format              | Why                                                                                     |
| -------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `research_runs.query`                                          | `text`              | user free text                                                                          |
| `research_runs.mode`                                           | `text`              | enum, v1='deep' only                                                                    |
| `research_runs.schema_name`                                    | `text`              | registry key (see §8.1)                                                                 |
| `research_runs.context`                                        | `jsonb`             | `{subjects?, selector?, hints?}`                                                        |
| `research_runs.findings`                                       | `**jsonb`**         | structured, schema-valid, queryable, drives UI                                          |
| `research_runs.brief_md`                                       | `**text**` markdown | human synthesis, regenerable per language                                               |
| `research_runs.cost_breakdown`                                 | `jsonb`             | per-provider cent counts                                                                |
| `research_runs.paid_policy`                                    | `jsonb`             | resolved policy snapshot for audit                                                      |
| `research_run_events.payload`                                  | `jsonb`             | per-event, feeds SSE replay + audit                                                     |
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

Versioned (`_v1`, `_v2`) so schemas can evolve without breaking old runs. Callers pass `schema_name: 'company_enrichment_v1'`; the service resolves it and uses it for `LanguageModel.generateText`'s structured output.

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
3. **Archive to S3.** Use existing `S3StorageProviderLive`. Write the normalized content to `s3://forja-sources/<content_hash>.md` (or `.json` for registry). Store the path in `content_ref`.
4. **Push to Wayback (optional, fire-and-forget).** For web sources, `POST https://web.archive.org/save/<url>` and store the returned snapshot URL in `archive_url`. Best-effort, never blocks the run.
5. **Link to the run.** Insert `research_run_sources(research_id, source_id, local_ref)` with `local_ref = 'src_1'`, `'src_2'`, ... — stable within the run so citations stay readable.
6. **LLM cites.** Every claim references `source_id = 'src_reg_1'` etc.

### 9.3 Content drift detection

Re-scraping an existing source compares `content_hash`. If changed:

- Keep the old `content_ref` (immutable history).
- Write a new `content_ref` for the new hash.
- Update `last_fetched_at`.
- The `/research/:id` UI marks citations pointing at the old hash as *"source has changed since cited"*.

### 9.4 UI treatment

- Every claim in the findings panel gets a `[1]`, `[2]` badge.
- Clicking opens a side panel with the source's title, URL, archived snapshot link, and the exact quote highlighted.
- Dead links (404) still resolve to the archived copy via `content_ref`.
- Source list is sortable by domain, provider, cost, fetched_at.

---

## 10. Safety rules

Collected here so they can be copy-pasted into the system prompt and into review.

### 10.1 No direct domain mutation

The research agent **never** calls `update_company`, `create_company`, `delete_company`, `update_contact`, etc. Domain mutations are exclusively human-driven via the "Apply" button in the research UI, which fires the existing domain endpoints with OCC.

The agent writes only to:

- `research_runs.findings` (including `proposed_updates`, `pending_paid_actions`)
- `research_run_events` (via the service, not a tool)
- `research_run_sources` (via the service)
- `research_links` (via `attach_finding`, `link_kind='finding'` only)

### 10.2 Citations are mandatory

See §9.1. No unsourced claims.

### 10.3 Cost discipline

- Try tier 0 first. Registry before scrape.
- Never exceed `paid_budget_cents` without `propose_paid_action`.
- `BudgetExceeded` errors are terminal for the exhausted tier — the agent should either finish with what it has or propose more budget.

### 10.4 Subject snapshot freeze

When a run starts, the current version of every subject row is captured into `context.subjects[i].snapshot` with `expected_version`. The agent reasons from the snapshot; if the underlying row changes mid-run, `propose_update` still references the old version and OCC blocks silent overwrites.

### 10.5 Human-in-the-loop gates

| Action                                                | Gate                                  |
| ----------------------------------------------------- | ------------------------------------- |
| Write to Forja domain rows                            | Always human via "Apply"              |
| Call tier-3 paid tool above `auto_approve_paid_cents` | `propose_paid_action` → human approve |
| Fan-out over `paid_daily_cap_cents`                   | Hard block, no override               |
| Exceed system hard ceiling                            | Hard block, not overridable per-run   |

---

## 11. Policy modes

Two modes only: **Strict** (default) and **Custom**.

### 11.1 Mode definitions

| Mode                 | `default_budget_cents` | `default_paid_budget_cents` | `auto_approve_paid_cents` | `paid_daily_cap_cents`             |
| -------------------- | ---------------------- | --------------------------- | ------------------------- | ---------------------------------- |
| **Strict** (default) | system env             | 0                           | 0                         | 0                                  |
| **Custom**           | user-set               | user-set                    | user-set                  | user-set (bounded by hard ceiling) |

**Strict** = the agent can spend cheap-tier budget freely (scraping, searching) within the per-run `default_budget_cents`, but **zero paid spend** without explicit per-run allocation *and* per-call approval. This is the safe default.

**Custom** = the user sets all four numbers themselves. Enables pre-authorization:

```jsonc
// A power user who wants frictionless paid research
{
  "mode": "custom",
  "default_budget_cents": 100,
  "default_paid_budget_cents": 500,         // €5/run allocated by default
  "auto_approve_paid_cents": 500,           // auto-approve anything within the run budget
  "paid_daily_cap_cents": 2000              // hard cap: €20/day across all runs
}
```

### 11.2 Layered resolution

```
system env defaults
  → user preferences (research.mode + fields)
    → per-run POST body overrides
      → resolved policy snapshot → research_runs.paid_policy (captured for audit)
```

Per-run wins over user, user wins over env. The snapshot is frozen on the row so "what policy was in effect for this run" is always answerable.

### 11.3 The daily cap is the only non-overridable rail

```ts
chargePaid: (provider, cents) => Effect.gen(function* () {
  const runBudget = yield* Ref.get(paidRef)
  if (runBudget.remaining < cents)
    return yield* new BudgetExceeded({ tier: 'paid-run', needed: cents, remaining: runBudget.remaining })

  const dailySpent = yield* DailyPaidSpend.getFor(userId, 'today')
  const systemCeiling = yield* Config.integer('RESEARCH_DAILY_CAP_HARD_CEILING_CENTS')
  const effectiveCap = Math.min(policy.paidDailyCapCents ?? 0, systemCeiling)

  if (dailySpent + cents > effectiveCap)
    return yield* new DailyCapExceeded({ dailySpent, cap: effectiveCap, needed: cents })

  yield* Ref.update(paidRef, b => ({ ...b, remaining: b.remaining - cents, spent: b.spent + cents }))
  yield* DailyPaidSpend.add(userId, cents, runId, provider)
  yield* ResearchPaidSpend.record({ ... })     // audit row
})
```

- `RESEARCH_DAILY_CAP_HARD_CEILING_CENTS` (env) is the absolute max. A user's `paid_daily_cap_cents` can only go *up to* but never past it.
- Even Custom-mode users can't exceed the system ceiling. Prompt injection / runaway loops stop at the cap.

### 11.4 First-time consent

Switching from Strict → Custom for the first time pops a confirm:

> **Enable Custom mode?** You're authorizing the agent to spend money on paid APIs (e.g. einforma at €3/call) according to the limits you set. Every paid action is logged on the research detail page. You can switch back to Strict anytime.

One-time, explicit consent. Same shape as Claude Code's elevated permission modes.

### 11.5 How the LLM experiences policy

The LLM does **not** read the policy. It learns from tool errors:

- Within budget & threshold → tool runs silently, charges budget.
- Above threshold → tool errors with `ApprovalRequired`. System prompt: *"if you receive ApprovalRequired, call `propose_paid_action` instead."*
- Above run budget → tool errors with `BudgetExceeded`. System prompt: *"finish with what you have or propose more budget."*
- Above daily cap → tool errors with `DailyCapExceeded`. Terminal — run finishes.

This keeps the prompt simple and policy-independent.

---

## 12. Budget enforcement

### 12.1 `Budget` service

```ts
// apps/server/src/services/research/budget.ts
export class Budget extends Effect.Service<Budget>()('research/Budget', {
  effect: Effect.gen(function* () {
    const cheap = yield* Ref.make({ remaining: 0, spent: 0, breakdown: {} as Record<string, number> })
    const paid  = yield* Ref.make({ remaining: 0, spent: 0, breakdown: {} as Record<string, number> })

    return {
      init: (cheapCents: number, paidCents: number) =>
        Effect.all([
          Ref.set(cheap, { remaining: cheapCents, spent: 0, breakdown: {} }),
          Ref.set(paid,  { remaining: paidCents,  spent: 0, breakdown: {} }),
        ]),

      chargeCheap: (provider: string, cents: number) => /* see §11.3 */,
      chargePaid:  (provider: string, cents: number) => /* see §11.3 */,

      snapshot: () =>
        Effect.all({ cheap: Ref.get(cheap), paid: Ref.get(paid) }),
    } as const
  }),
}) {}
```

### 12.2 Provider instrumentation

Every provider wraps its call:

```ts
// firecrawl-scrape.ts
const scrape = (input: ScrapeInput) =>
  Effect.gen(function* () {
    const budget = yield* Budget
    const estimate = estimateScrapeCents(input)        // fmt + JSON extract etc.
    yield* budget.chargeCheap('firecrawl', estimate)
    const result = yield* http.post('/v1/scrape', input)
    return result
  })
```

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
  ├── build LanguageModel prompt: system + context + subject snapshots + schema + citation rule
  ├── LanguageModel.streamText({
  │     model: anthropic('claude-opus-4-6'),
  │     toolkit: ResearchToolkit ∪ CrmReadToolkit ∪ SinkToolkit,
  │     maxIterations: 25,
  │   })
  ├── on each tool call → write research_run_events(seq, 'tool.call', payload)
  ├── on each tool result → write research_run_events(seq, 'tool.result', payload)
  ├── on final → validate structured output against schema_name
  ├── walk findings, verify all source_id references resolve
  ├── generate brief_md via second LLM pass (cheap model)
  ├── write findings, brief_md, cost totals, status='succeeded', completed_at
  └── emit run.completed event
```

### 13.2 SSE event streaming with replay

`GET /research/:id/events?since=<seq>` returns an SSE stream. Implementation:

1. Read persisted events from `research_run_events` where `seq > since`. Emit each.
2. Subscribe to a Postgres `LISTEN research_run_<id>` channel (or in-memory `PubSub`) for new events.
3. Emit as they arrive.
4. Close on `run.completed` / `run.failed` / `run.cancelled` event or client disconnect.

This makes the stream **resumable**. User reloads the page mid-run, UI passes `since=<last seen seq>`, gets backlog + live tail. Events are the source of truth; SSE is just a tail mechanism.

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
- Server restart mid-run → **not survivable in v1**. `status='running'` rows older than N seconds on boot are marked `failed` by a startup sweeper. Durable execution is a future extension.

---

## 14. HTTP API

```
POST   /research                              create + fork
  body: { query, mode?, context?, schema_name?, budget_cents?, paid_budget_cents?, auto_approve_paid_cents? }
  → 202 { id, status: 'queued' }
  → 409 { error: 'InsufficientBudget', estimated, available, shortfall }
  → 409 { error: 'ConfirmRequired', estimated_cost_cents, preview }   (fan-out > threshold)

GET    /research/:id                          full row, findings, sources
GET    /research/:id/events?since=<seq>       SSE tail, replayable
POST   /research/:id/cancel                   interrupt + upstream cancel
POST   /research/:id/attach                   { subject_table, subject_id }  post-hoc link
DELETE /research/:id                          soft-delete (sets status='deleted'; content retained)

GET    /research                              list, filter, paginate
  query: ?created_by=&status=&subject_table=&subject_id=&since=

GET    /research/by-subject/:table/:id        all runs linked to a subject row

-- Paid action approval workflow
POST   /research/:id/paid-actions/:pa_id/approve
POST   /research/:id/paid-actions/:pa_id/skip

-- Proposed update workflow
GET    /research/:id/proposed-updates         list proposals
POST   /research/:id/proposed-updates/:pu_id/apply    (fires update_company with expected_version)
POST   /research/:id/proposed-updates/:pu_id/reject

-- Preferences
GET    /research/preferences                  current user
PUT    /research/preferences                  { mode: 'strict'|'custom', ...fields }
```

All routes live in `apps/server/src/handlers/research.ts` and are declared in `@engranatge/controllers` as an HttpApiGroup, following the existing pattern.

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

Keep the existing `CompanyResearchPrompt` (`apps/server/src/mcp/prompts/company-research.ts:9`) — it's for Claude Desktop users who do their own synthesis over Forja data. `/research` is for Forja UI users who want one-click agent loops. They coexist.

Add:

- `ResearchDesignerPrompt` — helps a user phrase a research query, suggests `schema_name`, computes an estimated budget.

### 15.3 Resources

- `forja://research/{id}` — returns the research run as an MCP resource (findings + brief + sources).

---

## 16. Scenarios

### 16.1 Scenario 1 — subject-anchored enrichment

**State before.** One company in Forja, mostly empty:

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
| +400ms | 0    | `lookup_company_registry({country:'ES', query:'Cooperativa Olivera de Vilanova'})` → libreBORME: NIF F08234567, capital €450k, 2 admins (Jordi Pla, Marta Soler) since 2019                  | 0      |
| +800ms | 0    | `search_companies({query:'olivera', region:'es-CT'})` → finds L'Olivera SCCL already in DB                                                                                                   | 0      |
| +1.5s  | 1    | `web_scrape({url:'olivera-vilanova.cat'})` → homepage markdown                                                                                                                               | 1 cr   |
| +3.5s  | 1    | `web_scrape({url:'olivera-vilanova.cat/memoria-2024.pdf'})` → annual report text                                                                                                             | 1 cr   |
| +5s    | 1    | `web_search({query:'cooperatives oli ecològic Bages', limit:10})`                                                                                                                            | 1 cr   |
| +6s    | 1    | 3× `web_scrape` on competitor homepages (parallel, `withConcurrency(3)`)                                                                                                                     | 3 cr   |
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
  "query": "Find Catalan agroecology cooperatives that publicly mention struggling with CRMs or spreadsheets in the last 6 months. For each, check if we already have them in Forja.",
  "mode": "deep",
  "context": { "hints": { "language": "ca", "recency_days": 180 } },
  "schema_name": "prospect_scan_v1"
}
```

No subjects, no selector. The LLM:

1. `web_search({query: "..."})` → 10-15 URLs
2. `web_scrape` on top candidates in parallel
3. For each discovered cooperative name: `search_companies({query: name})`
4. `lookup_company_registry` on the most promising ones to verify legal names and get NIFs
5. `attach_finding` for the ones already in DB (kind='already_in_db')
6. Final findings list new prospects with name, website, NIF, "why relevant," citations

Cost: mostly cheap-tier. No paid spend.

### 16.3 Scenario 3 — selector fan-out (phase 2)

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
RESEARCH_SEARCH_PROVIDER=brave              # free tier
RESEARCH_SCRAPE_PROVIDER=firecrawl
RESEARCH_EXTRACT_PROVIDER=firecrawl
RESEARCH_DISCOVER_PROVIDER=anthropic        # Claude's native web_search
RESEARCH_REGISTRY_PROVIDER_ES=librebor      # free, always on
RESEARCH_REPORT_PROVIDER_ES=einforma        # paid, gated
```

### Quality loadout

```bash
RESEARCH_SEARCH_PROVIDER=exa                # best semantic search
RESEARCH_SCRAPE_PROVIDER=firecrawl
RESEARCH_EXTRACT_PROVIDER=firecrawl
RESEARCH_DISCOVER_PROVIDER=firecrawl
RESEARCH_REGISTRY_PROVIDER_ES=librebor
RESEARCH_REPORT_PROVIDER_ES=einforma
```

### Local dev (zero external cost)

```bash
RESEARCH_SEARCH_PROVIDER=brave              # free tier sufficient
RESEARCH_SCRAPE_PROVIDER=local              # Playwright headless
RESEARCH_EXTRACT_PROVIDER=local             # Playwright + prompt extract via LLM
RESEARCH_DISCOVER_PROVIDER=none             # disabled
RESEARCH_REGISTRY_PROVIDER_ES=librebor      # free
RESEARCH_REPORT_PROVIDER_ES=none            # disabled
```

### Notes on specific providers

- **libreBORME** — free Spanish company registry mirror. BORME = Boletín Oficial del Registro Mercantil. Returns legal name, NIF, capital, incorporation date, directors (admins), address, status. Always prefer over scraping for Spanish companies.
- **einforma** — paid commercial report, ~€1–5/call depending on depth. Financials, shareholders, risk score. Use only for due-diligence deep dives where libreBORME + web scraping are insufficient.
- **Firecrawl** — best all-rounder: scrape, search, extract, agent. Credit-based. Use as scrape/extract default; use agent (via `web_discover`) sparingly.
- **Exa** — best-in-class semantic search. Use as primary `SearchProvider` when quality matters more than free tier.
- **Brave Search** — free tier, workable for dev and for cost-sensitive production.
- **Anthropic web_search** — Claude's native tool, zero setup. Good fallback `DiscoverProvider`, but citations are model-maintained (no `content_ref` archive). Useful when budget is tight.
- **Playwright local** — dev fallback. Slow and flaky, but free and works offline.

---

## 18. Env vars (vendor-neutral, explicit)

Following the `feedback_env_var_naming` and `feedback_explicit_env_vars` rules in memory.

```bash
# --- Capability providers (one per capability, no auto/fallback) ---
RESEARCH_SEARCH_PROVIDER=                   # exa | tavily | brave | firecrawl
RESEARCH_SCRAPE_PROVIDER=                   # firecrawl | scrapingbee | local
RESEARCH_EXTRACT_PROVIDER=                  # firecrawl | tavily | local
RESEARCH_DISCOVER_PROVIDER=                 # firecrawl | anthropic | none

# --- Country-specific providers ---
RESEARCH_REGISTRY_PROVIDER_ES=              # librebor | none
RESEARCH_REPORT_PROVIDER_ES=                # einforma | axesor | iberinform | none

# --- LLM provider (for the agent loop) ---
RESEARCH_LLM_PROVIDER=                      # anthropic (only option v1)
RESEARCH_LLM_MODEL=claude-opus-4-6          # used for the agent loop
RESEARCH_BRIEF_MODEL=claude-haiku-4-5       # used for the second-pass brief_md

# --- Budget defaults (system) ---
RESEARCH_DEFAULT_BUDGET_CENTS=50            # €0.50 per run cheap budget
RESEARCH_DEFAULT_PAID_BUDGET_CENTS=0        # opt-in per run
RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS=0  # opt-in per run
RESEARCH_DEFAULT_PAID_DAILY_CAP_CENTS=0     # opt-in per user (Custom mode)
RESEARCH_DAILY_CAP_HARD_CEILING_CENTS=10000 # €100/day absolute system max

# --- Concurrency and safety ---
RESEARCH_MAX_CONCURRENT_FIBERS_PER_USER=3
RESEARCH_MAX_CONCURRENCY_FANOUT=3
RESEARCH_CONFIRM_THRESHOLD_FANOUT=10        # fan-out over this N triggers UI confirm

# --- Provider API keys (per-vendor, secrets) ---
FIRECRAWL_API_KEY=
EXA_API_KEY=
TAVILY_API_KEY=
BRAVE_SEARCH_API_KEY=
EINFORMA_API_KEY=
# librebor has a public API — no key
```

Boot fails loudly if any of the first six vars are unset. Strict mode works with zero paid providers configured.

---

## 19. Phased build

Three vertical slices. Each ships end-to-end.

### Phase 1 — skeleton + tier 0/1 web

- Migrations: `research_runs`, `research_run_events`, `sources`, `research_run_sources`, `research_links`, `research_paid_spend`, `user_research_preferences`.
- Tables on subject rows: add `version int NOT NULL DEFAULT 0` to `companies`, `contacts`, `documents`.
- Decide and implement soft-delete vs triggers for polymorphic integrity (§17 open decisions).
- `SearchProvider`, `ScrapeProvider` interfaces + Firecrawl impls + Brave impl + local Playwright impl.
- `Budget` service (cheap tier only).
- Schema registry with `freeform` + `company_enrichment_v1`.
- `ResearchService` with subject-anchored mode only (no selector fan-out).
- Tools: `web_search`, `web_scrape`, `search_companies`, `get_company`, `propose_update`, `attach_finding`.
- `LanguageModel.streamText` wired via `@effect/ai-anthropic`.
- `POST /research`, `GET /research/:id`, `GET /research/:id/events` (SSE with replay), `POST /research/:id/cancel`.
- UI: `/forja/research` create page, detail page with findings + brief + sources + proposals panel, by-subject tab on company detail.
- Event log + SSE replay.
- Basic observability (§20).

**Ships:** a usable subject-anchored research flow for cheap web work. No paid spend, no fan-out, no registry.

### Phase 2 — registry + paid tier + policy

- `RegistryProvider` + libreBORME impl (ES).
- `ReportProvider` + einforma impl (ES).
- Tools: `lookup_company_registry`, `lookup_company_report`, `propose_paid_action`.
- Budget service: paid tier, `DailyPaidSpend` counter.
- Policy resolution: system env → `user_research_preferences` → per-run override.
- Two modes: Strict (default), Custom. Settings UI with first-time consent dialog.
- `ApprovalRequired` / `BudgetExceeded` / `DailyCapExceeded` error types and LLM prompt rules.
- Paid action approval UI.
- Audit log (`research_paid_spend`) and spend summaries.
- MCP tools: `start_research`, `get_research`, `research_sync`.

**Ships:** full cost-tier system with gated paid spend. Spain-market viable.

### Phase 3 — fan-out + more providers + watchers

- Selector-based input mode (parent/leaf rows).
- Fan-out concurrency + confirm threshold + dry-run preview.
- `ExtractProvider` + `DiscoverProvider` impls (Firecrawl, Tavily, Anthropic).
- Tools: `web_extract`, `web_discover`, `wayback_snapshot`.
- More schemas: `competitor_scan_v1`, `contact_discovery_v1`, `prospect_scan_v1`.
- `research_watchers` table + cron-based scheduled re-runs with findings diffs and webhook events.
- `sources` Wayback push integration.
- More country registries (UK Companies House, FR Pappers).

**Ships:** the full v1 feature set.

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

### Metrics

- `research.run.count{status}`
- `research.run.duration_ms{status}`
- `research.tool.call_count{tool,provider}`
- `research.tool.error_count{tool,provider,error_kind}`
- `research.cost.cents{tier,provider}` (histogram)
- `research.paid_spend.daily{user}` (gauge)
- `research.budget.exceeded_count{tier}`

### Log annotations

Every span in a research fiber carries:

```
Effect.annotateLogs({ research_id, user_id, mode, schema_name })
```

so logs can be filtered per run. Follows the pattern in `apps/server/server.log` (see `reference_server_log` memory).

---

## 21. Open decisions

These must be resolved before Phase 1 can ship. Listed here so they don't get lost.

### 21.1 Soft-delete vs triggers for polymorphic FK integrity

`research_links.subject_id` has no hard FK because Postgres doesn't support polymorphic references. Two options:

- **(a) Soft-delete on `companies`, `contacts`, `documents`.** Add `deleted_at timestamptz` to each; filter everywhere. Research queries just naturally exclude soft-deleted subjects.
- **(b) Postgres triggers per subject table.** On delete, cascade into `research_links`. More brittle, cleaner data.

Engranatge doesn't have an established soft-delete pattern today. **Recommendation:** pick (a). Add `deleted_at` to subject tables as part of Phase 1.

### 21.2 OCC column on subject rows

`propose_update` carries `expected_version`. Requires `version int NOT NULL DEFAULT 0` on every table the research agent can propose updates for: at minimum `companies`, `contacts`, `documents`. Bumped on every update.

**Recommendation:** add it. It's a ~10-line migration + 1-line change per update handler. Prevents the worst failure mode (silent clobbers).

### 21.3 Schema registry format

Where the compiled Effect Schemas live:

- **(a) In-code registry** (`apps/server/src/services/research/schemas/index.ts`): a `Record<string, Schema.Any>`. Type-safe, versioned via file names. Simple.
- **(b) Dynamic registry** (from a `research_schemas` table with stored JSON Schema, compiled at runtime): flexible, but loses type safety at the LLM boundary.

**Recommendation:** (a). Revisit only if users start needing custom schemas.

### 21.4 Durable execution

Server restart mid-run kills the fiber. v1 solution: on boot, mark `status='running'` rows older than N seconds as `failed`.

**Future:** persist LLM stream state every K tool calls to `research_runs.resume_state jsonb` and have a sweeper re-enqueue long-running runs on boot. Not needed for v1 but plan the column.

### 21.5 GDPR / data retention

Research stores contact emails and personal details discovered from public sources. EU cooperatives = GDPR applies.

- **Retention policy**: default expire `sources.content_ref` and `research_runs.findings` after N days unless the user pins a run.
- **DSAR support**: ability to purge all sources + findings referencing a specific email/name.
- **Consent record**: note in ToS that using research on a subject is a legitimate-interest processing activity.

**Recommendation:** document the policy before shipping Phase 2 (when paid registry lookups start pulling more personal data). Don't ship Phase 2 until this is in writing.

### 21.6 First-run consent copy for Custom mode

Exact wording of the elevation dialog needs review by whoever owns legal/product messaging. Placeholder in §11.4.

---

## 22. Future extensions (not v1)

Named so the v1 shape doesn't preclude them.

- **Internal corpus** (pgvector + embeddings over interactions/documents/emails). Slots in as a tier-0 `corpus_search` tool alongside `search_companies`. No schema changes.
- **Scheduled watchers** (`research_watchers` table, cron triggers, findings diff → webhook). Phase 3.
- **Knowledge graph of discovered entities** (`research_entities` table, entity dedup across runs, graph traversal). Lets subsequent runs skip re-discovery.
- **Per-provider trust** in `user_research_preferences.overrides` (v2). Already reserved as a `jsonb` column.
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
  "cost_breakdown": { "firecrawl": 3 },
  "tokens_in": 12400,
  "tokens_out": 3100,
  "paid_policy": {
    "mode": "strict",
    "default_budget_cents": 50,
    "default_paid_budget_cents": 0,
    "auto_approve_paid_cents": 0,
    "paid_daily_cap_cents": 0,
    "resolved_at": "2026-04-09T14:32:10Z"
  },
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
  "content_ref": "s3://forja-sources/registry/librebor/F08234567.json",
  "archive_url": null,
  "language": "es"
}
```

### 23.3 A `research_run_events` row

```jsonc
{
  "research_id": "01J9ZK8QYM…",
  "seq": 4,
  "type": "tool.call",
  "payload": {
    "tool": "web_scrape",
    "args": { "url": "https://olivera-vilanova.cat", "formats": ["markdown","links"] }
  },
  "at": "2026-04-09T14:32:12.103Z"
}
```

### 23.4 A `research_paid_spend` row

```jsonc
{
  "id": "01J9ZS…",
  "research_id": "01J9ZK8QYM…",
  "user_id": "usr_…",
  "provider": "einforma",
  "tool": "lookup_company_report",
  "amount_cents": 300,
  "args": { "country": "ES", "tax_id": "F08234567", "depth": "financials" },
  "result_hash": "sha256:…",
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
- Two policy modes: **Strict** (default, no paid spend without explicit per-run opt-in and approval) and **Custom** (user sets all four knobs). Custom mode enables pre-authorizing paid actions.
- Links are first-class: `sources` table, content hashes, archived `content_ref` copies, optional Wayback snapshots, inline citations per claim, citation-validation at run completion.
- Research never mutates domain rows. It writes `proposed_updates` that humans Apply via the existing update endpoints with OCC.
- Effect handles the agent loop (`LanguageModel.streamText` + `Toolkit`), structured concurrency (`Fiber`, `onInterrupt`), observability, and persistence. No external agentic framework.
- SSE event streaming is backed by a persisted log (`research_run_events`) so reloads replay cleanly.
- Budget enforcement at the runtime level via `Ref`; daily cap is the only non-overridable rail.
- MCP surface exposes `research_sync` (synchronous) and `start_research` / `get_research` (async) for Claude Desktop parity.
- Output formats: jsonb for machine-facing data (`findings`, `sources`, events, policy), markdown text for human narrative (`brief_md`), Tiptap JSON only when saving to `documents.content`.
- Phased in three slices: skeleton + cheap web → registry + paid + policy → fan-out + more providers + watchers.
- Six open decisions need resolution before Phase 1 ships; the two cross-cutting ones are subject-table soft-delete and OCC `version` columns.
