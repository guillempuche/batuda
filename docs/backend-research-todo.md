# Backend Research — Implementation TODO

Tracks implementation progress for [backend-research.md](backend-research.md).

---

## Phase 1: Foundation (errors + migration)

- [x] **1.1** Add research error types to `packages/controllers/src/errors.ts`
  - `ProviderError`, `BudgetExceeded`, `MonthlyCapExceeded`, `QuotaExhausted`, `ApprovalRequired`, `InsufficientBudget`, `ConfirmRequired`
- [x] **1.2** Create migration `0003_research.ts`
  - `research_runs` (incl. `tool_log`, `quota_breakdown` jsonb, `paid_policy`)
  - `sources` (globally deduped by `url_hash`)
  - `research_run_sources` (many-to-many with `local_ref`)
  - `research_links` (polymorphic link to companies/contacts)
  - `research_paid_spend` (incl. `idempotency_key`, `quota_units`, `quota_unit`, `result_data`)
  - `user_research_policy` (per-user spending policy)
  - `provider_quotas` (per-user per-provider quota config)
  - `provider_usage` (consumption counter)
  - All indexes from §7
- [x] **1.3** Add `version int NOT NULL DEFAULT 0` to `companies` and `contacts`
- [x] **1.4** Add `deleted_at timestamptz` to `companies` and `contacts` (soft-delete, §7.2)

## Phase 2: Provider interfaces + env vars

- [x] **2.0** Create `packages/research` bounded context (domain/application/infrastructure layers)
- [x] **2.1** Create `packages/research/src/application/ports.ts` — `SearchProvider` interface
- [x] **2.2** `ScrapeProvider` interface (in ports.ts)
- [x] **2.3** `ExtractProvider` interface (in ports.ts)
- [x] **2.4** `DiscoverProvider` interface (in ports.ts)
- [x] **2.5** `RegistryRouter` interface (in ports.ts)
- [x] **2.6** `ReportRouter` interface (in ports.ts)
- [x] **2.7** Create shared types: `packages/research/src/domain/types.ts` + `domain/errors.ts`
- [x] **2.8** Add `RESEARCH_*` env vars to `apps/server/src/lib/env.ts` (§18)
- [x] **2.9** Create provider boot-time selection layer (§5.2) — `providers-live.ts` + `llm-live.ts`

## Phase 3: Budget + ProviderQuota services

- [x] **3.1** Create `packages/research/src/application/budget.ts` — `Budget` service (§12.1)
  - `init`, `chargeCheap`, `chargePaid`, `snapshot`
  - `MonthlyPaidSpend.chargeWithinCap` with `pg_advisory_xact_lock` (§11.3)
  - Idempotency via `research_paid_spend.idempotency_key` (§12.2)
- [x] **3.2** Create `packages/research/src/application/provider-quota.ts` — `ProviderQuota` service (§11.6)
  - `check`, `consume`, `remaining`, `sync`
  - Two sync modes: `api` (auto-sync from provider balance API) and `manual` (local counter)
- [x] **3.3** Create `packages/research/src/application/policy.ts` — policy resolution (§11.2)
  - System env defaults → user policy → per-run override (clamped to user policy)
  - Snapshot frozen on `research_runs.paid_policy`

## Phase 4: Schema registry + ResearchService core

- [x] **4.1** Create `packages/research/src/application/schemas/index.ts` — registry `Record<string, Schema.Any>`
- [x] **4.2** Create `freeform.ts`
- [x] **4.3** Create `company-enrichment-v1.ts`
- [x] **4.4** Create `competitor-scan-v1.ts`
- [x] **4.5** Create `contact-discovery-v1.ts`
- [x] **4.6** Create `prospect-scan-v1.ts`
- [x] **4.7** Create `packages/research/src/application/research-service.ts` — `ResearchService`
  - Subject snapshot freeze (§10.5)
  - Phase 1: `LanguageModel.streamText` tool loop (§13.1)
  - Phase 2: `LanguageModel.generateObject` structured output (§13.1)
  - Phase 3: brief generation via Haiku (§13.1)
  - In-memory `PubSub` per active run (§13.2)
  - In-memory `Map<id, Fiber>` for cancellation (§13.3)
  - Citation reference validation (§9.1)
  - Source lifecycle: hash, dedupe, archive to S3, link to run (§9.2)
  - Selector fan-out: parent/leaf rows, concurrency cap, confirm threshold (§3.3, §12.4)
  - Failure handling (§13.4): provider error → recoverable, schema retry once, startup sweeper

## Phase 5: Research tools (8 tools)

- [x] **5.1** Create `apps/server/src/mcp/tools/research-web.ts`
  - `web_search` — Readonly, OpenWorld, tier 1
  - `web_read` — Readonly, OpenWorld, tier 1 (scrape + extract merged)
  - `web_discover` — Readonly, OpenWorld, tier 2
- [x] **5.2** Create `apps/server/src/mcp/tools/research-registry.ts`
  - `lookup_registry` — Readonly, OpenWorld, tier 0 (basic) / tier 3 (financials|full)
- [x] **5.3** Create `apps/server/src/mcp/tools/research-crm.ts`
  - `crm_lookup` — Readonly, !OpenWorld, tier 0
- [x] **5.4** Create `apps/server/src/mcp/tools/research-sink.ts`
  - `propose_update` — !Destructive, !OpenWorld
  - `attach_finding` — !Destructive, Idempotent, !OpenWorld
  - `propose_paid_action` — !Destructive, !OpenWorld

## Phase 6: HTTP API routes + handlers

- [x] **6.1** Create `packages/controllers/src/routes/research.ts` — `ResearchGroup`
  - `POST /research` (create + fork) → 202
  - `GET /research/:id` (full row + findings + sources)
  - `GET /research/:id/events` (SSE live stream)
  - `POST /research/:id/cancel`
  - `POST /research/:id/attach` (post-hoc link)
  - `DELETE /research/:id` (soft-delete)
  - `GET /research` (list, filter, paginate)
  - `GET /research/by-subject/:table/:id`
  - Paid action: `POST /research/:id/paid-actions/:paId/approve`, `POST .../:paId/skip`
  - Proposed update: `GET /research/:id/proposed-updates`, `POST .../apply`, `POST .../reject`
  - Policy: `GET /research/preferences`, `PUT /research/policy`
- [x] **6.2** Register `ResearchGroup` in `packages/controllers/src/api.ts`
- [x] **6.3** Create `apps/server/src/handlers/research.ts` — handler implementation
- [x] **6.4** Register `ResearchLive` + `ResearchService.layer` in `apps/server/src/main.ts`

## Phase 7: MCP surface + observability

- [x] **7.1** Create MCP tools: `start_research`, `get_research`, `research_sync`
- [x] **7.2** Create `ResearchDesignerPrompt` (§15.2)
- [x] **7.3** Create MCP resource: `forja://research/{id}` (§15.3)
- [x] **7.4** Register research MCP tools/prompts/resources in `apps/server/src/mcp/server.ts`
- [x] **7.5** Add observability events to `WebhookService` (§20)
- [x] **7.6** Add metrics and log annotations (§20)

## Phase 8: Wire up + integration

- [x] **8.1** Wire `ResearchService.layer` into `ServicesLive` in `main.ts`
- [x] **8.2** Wire provider layers (`makeResearchProvidersLive` + `makeResearchLlmLive`) into `main.ts`
- [x] **8.3** Add startup sweeper for orphaned `status='running'` rows (§13.4)
- [x] **8.4** Type-check: `tsc --noEmit` passes for research, server, controllers
