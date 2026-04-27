# CRM competitor analysis — landscape for Batuda

Deep-read of the CRM products and open-source codebases referenced in
[`agency-workforce-platform.md`](./agency-workforce-platform.md) §8.5, compared
surface-by-surface against Batuda's current architecture
(`packages/domain`, `packages/controllers`, `apps/server/src/services`,
`apps/server/src/mcp`).

Not a buying guide. Purpose is to pressure-test our own design decisions —
where we already agree with the field, where we deliberately differ, and
where we're accidentally lagging and should reconsider.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Methodology and scope](#2-methodology-and-scope)
3. [Batuda architecture baseline](#3-batuda-architecture-baseline)
4. [Agent-native SaaS profiles](#4-agent-native-saas-profiles)
5. [Modern open-source profiles](#5-modern-open-source-profiles)
6. [Legacy / reference open-source profiles](#6-legacy--reference-open-source-profiles)
7. [Cross-cutting analysis](#7-cross-cutting-analysis)
8. [Surface-by-surface comparison](#8-surface-by-surface-comparison)
9. [Patterns worth porting into Batuda](#9-patterns-worth-porting-into-batuda)
10. [Patterns to explicitly reject](#10-patterns-to-explicitly-reject)
11. [Design decisions validated and questioned](#11-design-decisions-validated-and-questioned)
12. [Open research gaps](#12-open-research-gaps)
13. [Appendix — sources](#13-appendix--sources)

---

## 1. Executive summary

Batuda is a **relationship-first, MCP-first, single-tenant TypeScript/Effect
CRM** with a workshop register. The competitive landscape splits into three
bands:

- **Agent-native SaaS** ([Attio](https://attio.com), [Folk](https://folk.app),
  [Lightfield](https://lightfield.app), [Reevo](https://reevo.ai),
  [Aurasell](https://www.aurasell.ai), [Monaco](https://monaco.ai)) — where the
  differentiators are *tool shape for agents*, *implicit interaction capture*,
  and *code-executing assistants* over semi-structured history.
- **Modern open-source** ([Twenty](https://github.com/twentyhq/twenty),
  [Atomic CRM](https://github.com/marmelab/atomic-crm)) — mature codebases
  worth reading for patterns, wrong as bases (size, license, or stack).
- **Legacy / reference open-source** ([EspoCRM](https://github.com/espocrm/espocrm),
  [Krayin](https://github.com/krayin/laravel-crm),
  [SuiteCRM](https://github.com/salesagility/SuiteCRM),
  [OroCRM](https://github.com/oroinc/crm),
  [NocoBase](https://github.com/nocobase/nocobase),
  [NocoDB](https://github.com/nocodb/nocodb),
  [Monica](https://github.com/monicahq/monica)) — useful schemas and design
  patterns to steal from; uniformly a bad fit as a base (PHP, AGPL, or
  generic-engine).

The analysis yields **10 patterns worth porting** (OAuth 2.1 on MCP, Attio-style
interaction attributes, Twenty's `TimelineActivity`, Monica's typed relationship
edges, Atomic CRM's aggregate views, Folk's OpenAPI + community-MCP stance,
Twenty's meta-tool MCP pattern, a `ParticipantMatcher` service, Krayin's
fixed-schema AI intake, and SuiteCRM's workflow decomposition) and **10
patterns to reject** (dynamic schema engines, arbitrary-SQL MCP tools, SFDC
object soup, workflow-block AI, visual workflow builders, GraphQL-first APIs,
AI credits pricing, hardcoded pipeline stages, apps marketplaces, AGPL
licensing).

The single most actionable finding: **Batuda's MCP surface is competitive
today** — typed intent-level tools, 5 guided prompts, 4 slug-completion
resources, and discriminated-union results are all best-in-class. The gaps are
(a) OAuth 2.1 discovery for external clients (Claude Desktop, ChatGPT) and
(b) a polymorphic activity log to unify interactions/emails/documents/research.

---

## 2. Methodology and scope

**In scope.** Every CRM named in
[`agency-workforce-platform.md`](./agency-workforce-platform.md) §8.5
(proprietary and open-source), with enough depth to compare each to Batuda's
existing codebase along four surfaces: *domain*, *controllers*, *services*,
*MCP*.

**Out of scope.** The broader §8.1 / §8.2 / §8.3 / §8.4 categories (classical
PSA tooling, time tracking, AI orchestration frameworks, agent control
planes) — these are separate analyses.

**Sources.** Public product sites, developer documentation, GitHub repositories
(README, migrations/schemas, representative source files), and direct
`gh api` inspection of standard open-source CRM codebases. Where claims rest
on marketing rather than observable code or docs, they are flagged `[inf]`.

**Versioning.** All sources read in April 2026. GitHub links pin to `main`;
archive copies not produced. Recency matters — the AI-native category has
shipped major changes in Q1 2026 (Attio MCP, Twenty MCP, Lightfield code
execution, Monaco launch).

---

## 3. Batuda architecture baseline

For comparison to work, a terse map of what Batuda is today. File
references are clickable into the repo.

### 3.1 Domain — `packages/domain`

Effect-based schema layer; branded IDs via `Schema.brand`; aggregate roots via
`Model.Class`. No Drizzle, no oRPC. Schema source:

- [`companies.ts`](../packages/domain/src/schema/companies.ts) — `Company`
  entity (status `prospect | contacted | responded | meeting | proposal | client | closed | dead`,
  priority 1–5, `nextAction` + `nextActionAt` + `lastContactedAt`, geo,
  `metadata: Unknown`).
- [`contacts.ts`](../packages/domain/src/schema/contacts.ts) — `Contact`
  (decision-maker flag, `emailStatus: unknown | valid | bounced | complained`,
  soft-bounce counter).
- [`interactions.ts`](../packages/domain/src/schema/interactions.ts) —
  **immutable event log** (no `updatedAt`); channel × direction × type × outcome
  with side-effects onto `company.lastContactedAt` + `nextAction` on insert.
- [`proposals.ts`](../packages/domain/src/schema/proposals.ts) — `Proposal`
  with JSONB `lineItems`, totals, status machine.
- [`tasks.ts`](../packages/domain/src/schema/tasks.ts) — typed tasks (`call |
  visit | email | proposal | followup | other`), no delete (soft-complete via
  `completedAt`).
- [`documents.ts`](../packages/domain/src/schema/documents.ts) — markdown
  documents linkable to companies and interactions.
- [`pages.ts`](../packages/domain/src/schema/pages.ts) — Tiptap JSON pages
  (`lang: ca | es | en`, status, template, slug collision handling).
- [`call-recordings.ts`](../packages/domain/src/schema/call-recordings.ts) —
  1:1 with `Interaction`, transcript status pre-declared.
- [`email-messages.ts`](../packages/domain/src/schema/email-messages.ts) —
  provider-agnostic email tracking with bounce sub-type persistence.
- [`email-thread-links.ts`](../packages/domain/src/schema/email-thread-links.ts) —
  join table from provider thread to company/contact.
- [`products.ts`](../packages/domain/src/schema/products.ts) — lightweight SKU
  master for proposal line items.
- [`api-keys.ts`](../packages/domain/src/schema/api-keys.ts),
  [`webhook-endpoints.ts`](../packages/domain/src/schema/webhook-endpoints.ts)
  — platform plumbing.

Research lives outside `packages/domain` in its own package (see §3.3).

Migration source of truth:
[`0001_initial.ts`](../apps/server/src/db/migrations/0001_initial.ts) —
a single initial migration pre-production (schema changes rewrite `0001_initial.ts`, never add `0002_*.ts`).

### 3.2 Controllers — `packages/controllers`

[`api.ts`](../packages/controllers/src/api.ts) composes 16 route groups into a
`HttpApi` using [`effect/unstable/httpapi`](https://effect.website/) — OpenAPI-
first, typed errors. All `/v1/*` routes pass through
[`session.ts`](../packages/controllers/src/middleware/session.ts) for
[better-auth](https://www.better-auth.com/) session validation. Routes:

- CRM core: [`companies.ts`](../packages/controllers/src/routes/companies.ts),
  [`contacts.ts`](../packages/controllers/src/routes/contacts.ts),
  [`interactions.ts`](../packages/controllers/src/routes/interactions.ts),
  [`tasks.ts`](../packages/controllers/src/routes/tasks.ts),
  [`documents.ts`](../packages/controllers/src/routes/documents.ts).
- Pipeline: [`proposals.ts`](../packages/controllers/src/routes/proposals.ts),
  [`products.ts`](../packages/controllers/src/routes/products.ts).
- Content: [`pages.ts`](../packages/controllers/src/routes/pages.ts).
- Comms: [`email.ts`](../packages/controllers/src/routes/email.ts),
  [`calendar.ts`](../packages/controllers/src/routes/calendar.ts),
  [`calcom-webhook.ts`](../packages/controllers/src/routes/calcom-webhook.ts),
  [`recordings.ts`](../packages/controllers/src/routes/recordings.ts),
  [`research.ts`](../packages/controllers/src/routes/research.ts),
  [`webhooks.ts`](../packages/controllers/src/routes/webhooks.ts).
- Platform: [`auth.ts`](../packages/controllers/src/routes/auth.ts),
  [`health.ts`](../packages/controllers/src/routes/health.ts).

### 3.3 Services — `apps/server/src/services`

Effect `ServiceMap.Service<T>` layered instantiation with `SqlClient` injected
via the DI container. Two pluggable adapter interfaces:

- **Email** — [`mail-transport.ts`](../apps/server/src/services/mail-transport.ts)
  is the per-inbox IMAP+SMTP port (`imapflow` + `nodemailer` + `mailparser`).
  Credentials decrypt through
  [`credential-crypto.ts`](../apps/server/src/services/credential-crypto.ts)
  (AES-256-GCM, HKDF subkey per inbox).
  The thick service
  [`email.ts`](../apps/server/src/services/email.ts) orchestrates inbox CRUD,
  probe + grant_status updates, footer injection, thread linking, and draft
  staging. Inbound IDLE + persistence runs in [`apps/mail-worker`](../apps/mail-worker/);
  the worker writes as `app_service` (BYPASSRLS) and resolves
  `organization_id` from the inbox row.
  Attachments staged separately in
  [`email-attachment-staging.ts`](../apps/server/src/services/email-attachment-staging.ts).
- **Storage** — [`storage-provider.ts`](../apps/server/src/services/storage-provider.ts)
  / S3-compatible impl
  [`s3-storage-provider.ts`](../apps/server/src/services/s3-storage-provider.ts)
  (MinIO dev, Cloudflare R2 prod, path-style).

Core CRM services:
[`companies.ts`](../apps/server/src/services/companies.ts),
[`pipeline.ts`](../apps/server/src/services/pipeline.ts),
[`pages.ts`](../apps/server/src/services/pages.ts) (with
[`page-slug.ts`](../apps/server/src/services/page-slug.ts) collision handling),
[`recordings.ts`](../apps/server/src/services/recordings.ts),
[`geocoder.ts`](../apps/server/src/services/geocoder.ts) (Nominatim, 1 req/s),
[`webhooks.ts`](../apps/server/src/services/webhooks.ts) (async outbound with
retry), [`local-inbox-provider.ts`](../apps/server/src/services/local-inbox-provider.ts)
for dev.

### 3.4 MCP — `apps/server/src/mcp`

[`server.ts`](../apps/server/src/mcp/server.ts) composes `McpServer.toolkit`,
`McpServer.resource`, and `McpServer.prompt` layers. HTTP adapter at
[`http.ts`](../apps/server/src/mcp/http.ts) wraps every `/mcp` request with
`McpAuthMiddleware` — better-auth session validation per request, with
`isAgent` propagated via
[`current-user.ts`](../apps/server/src/mcp/current-user.ts).

**Tools** ([`tools/`](../apps/server/src/mcp/tools/)):
[`companies.ts`](../apps/server/src/mcp/tools/companies.ts) (`search_companies`,
`get_company`, `create_company`, `update_company`, `geocode_company`),
[`contacts.ts`](../apps/server/src/mcp/tools/contacts.ts),
[`interactions.ts`](../apps/server/src/mcp/tools/interactions.ts)
(`log_interaction` with auto-side-effects, `list_interactions`),
[`tasks.ts`](../apps/server/src/mcp/tools/tasks.ts),
[`documents.ts`](../apps/server/src/mcp/tools/documents.ts),
[`pages.ts`](../apps/server/src/mcp/tools/pages.ts),
[`email.ts`](../apps/server/src/mcp/tools/email.ts) (with discriminated-union
`SendEmailResult = { _tag: 'sent' } | { _tag: 'suppressed' }`),
[`recordings.ts`](../apps/server/src/mcp/tools/recordings.ts),
[`pipeline.ts`](../apps/server/src/mcp/tools/pipeline.ts), plus the research
suite
([`research-mcp.ts`](../apps/server/src/mcp/tools/research-mcp.ts),
[`research-crm.ts`](../apps/server/src/mcp/tools/research-crm.ts),
[`research-web.ts`](../apps/server/src/mcp/tools/research-web.ts),
[`research-registry.ts`](../apps/server/src/mcp/tools/research-registry.ts),
[`research-sink.ts`](../apps/server/src/mcp/tools/research-sink.ts)).

**Resources** ([`resources/`](../apps/server/src/mcp/resources/)):
[`company.ts`](../apps/server/src/mcp/resources/company.ts) (`batuda://company/{slug}`,
slug completion via ILIKE),
[`pipeline.ts`](../apps/server/src/mcp/resources/pipeline.ts) (`batuda://pipeline`),
[`document.ts`](../apps/server/src/mcp/resources/document.ts),
[`research.ts`](../apps/server/src/mcp/resources/research.ts).

**Prompts** ([`prompts/`](../apps/server/src/mcp/prompts/)):
[`daily-briefing.ts`](../apps/server/src/mcp/prompts/daily-briefing.ts),
[`company-research.ts`](../apps/server/src/mcp/prompts/company-research.ts),
[`proposal-draft.ts`](../apps/server/src/mcp/prompts/proposal-draft.ts),
[`interaction-follow-up.ts`](../apps/server/src/mcp/prompts/interaction-follow-up.ts),
[`research-designer.ts`](../apps/server/src/mcp/prompts/research-designer.ts).

### 3.5 Distinctive shape

1. **Company-first, not deal-first.** The primary entity is
   [`Company`](../packages/domain/src/schema/companies.ts), with pipeline
   expressed as `status` + `nextAction`, not as a separate `Deal` / `Opportunity`
   object.
2. **Immutable interaction log with side-effects on insert** — novel compared
   to most OSS CRMs, which treat interactions as updatable rows.
3. **Research as a first-class capability** with cost/quota tracking and
   hierarchical parent/child runs.
4. **MCP as the primary agent surface**, REST/HttpApi as plumbing.
5. **Discriminated-union tool results** for safe agent pattern-matching.
6. **Two pluggable provider interfaces** (Email + Storage), everything else
   concrete.
7. **Single-tenant per deployment** — not multi-workspace.

---

## 4. Agent-native SaaS profiles

All proprietary. Included for design inspiration and positioning — not as
adoption candidates.

### 4.1 Attio — [attio.com](https://attio.com)

**Positioning.** *"Ask more from CRM"* ([homepage meta](https://attio.com)). A
flexible, AI-native CRM ("the AI-native CRM for the next era of companies" —
[Series B post](https://attio.com/blog/attio-raises-52m-series-b)). Differentiator
language: **Universal Context** — semantic search over records plus emails,
calls, product usage, Granola notes, Slack threads
([attio.com/platform/ask](https://attio.com/platform/ask)).

**Data model.** Three primitives
([docs.attio.com/docs/objects-and-lists](https://docs.attio.com/docs/objects-and-lists)):

- **Objects** — schemas ("roughly tables / classes"). Defaults `people` and
  `companies`; optional standards `deals`, `users`, `workspaces`; workspaces
  can define **custom objects**.
- **Records** — instances of an object.
- **Lists** — named collections with their own **list-scoped attributes**. A
  record can appear in many lists; each appearance is a "list entry". Pipelines
  are Lists, not object status fields.

Seventeen attribute types
([docs.attio.com/docs/attribute-types/attribute-types](https://docs.attio.com/docs/attribute-types/attribute-types))
including `actor-reference`, `currency`, `domain`, `interaction`, `location`,
`personal-name`, `rating`, `record-reference`, `status`. Values carry bitemporal
`active_from` / `active_until` — historical values are queryable.

Standard `deals` object is intentionally minimal — only 5 writeable attributes
([docs.attio.com/docs/standard-objects/standard-objects-deals](https://docs.attio.com/docs/standard-objects/standard-objects-deals)):
`name`, `stage`, `owner`, `value`, `associated_people` + `associated_company`.

**Agent / AI surface.** **Ask Attio** is a chat-first interface ("Universal
Context") distributed in-app, in Slack, Claude, ChatGPT, Notion, and Raycast
([changelog](https://attio.com/changelog)). Runs on Claude Sonnet 4.6 and
Gemini 3.1 Pro as of Feb 2026.

**MCP server** at
[`mcp.attio.com/mcp`](https://mcp.attio.com/mcp) — OAuth only, one-click install
in Claude Desktop, Claude.ai, ChatGPT Apps, plus any MCP client
([docs.attio.com/mcp/overview](https://docs.attio.com/mcp/overview)). About 30
agent-tailored tools, not REST-mirrored. Full list:

- Records: `search-records`, `list-records`, `get-records-by-ids`,
  `create-record`, `upsert-record`, `update-record`, `list-attribute-definitions`.
- Lists: `list-lists`, `list-list-attribute-definitions`, `list-records-in-list`,
  `add-record-to-list`, `update-list`, `update-list-entry-by-id`,
  `update-list-entry-by-record-id`.
- Notes: `create-note`, `search-notes-by-metadata`, `semantic-search-notes`,
  `get-note-body`.
- Tasks: `list-tasks`, `create-task`, `update-task`.
- Comments: `create-comment`, `list-comments`, `list-comment-replies`,
  `delete-comment`.
- Meetings / calls: `search-meetings`, `search-call-recordings-by-metadata`,
  `semantic-search-call-recordings`, `get-call-recording`.
- Emails: `search-emails-by-metadata`, `semantic-search-emails`,
  `get-email-content`.
- Workspace: `list-workspace-members`, `list-workspace-teams`, `whoami`.
- Reporting: `run-basic-report`.

Design notes worth borrowing: **metadata-vs-semantic search split** per corpus;
**upsert / update-by-id / update-by-record-id** as separate entry points to
disambiguate agent intent; **`list-attribute-definitions`** so agents
self-discover schema before writing; **reads auto-approved, writes require
confirmation** via MCP safety annotations.

**Research Agent** — an agentic *workflow block*, not a separate product
([blog: Introducing Attio AI Research Agent](https://attio.com/blog/introducing-attio-ai-research-agent),
[block library](https://attio.com/help/reference/automations/workflows/workflows-block-library)).
Given a record and free-text questions, it browses the web and stores answers
on the record. Other agentic workflow blocks: `Classify record`, `Classify
text`, `Prompt completion`, `Summarize record`. AI output is never auto-persisted
— a chained `Update record` block writes the value back.

**Interaction capture.** Implicit. Email and calendar sync populate special
**Interaction** attributes on people/companies: `first_email_interaction`,
`last_email_interaction`, `first_calendar_interaction`,
`last_calendar_interaction`, `next_calendar_interaction`
([attribute-types-interaction](https://docs.attio.com/docs/attribute-types/attribute-types-interaction)).
Each value is a struct with `interaction_type` (`email` | `calendar-event`),
`interacted_at`, and `owner_actor`. **Read-only** — cannot be written via API.

**Extension surface.**
[REST API](https://docs.attio.com/rest-api/endpoint-reference/openapi) with
published OpenAPI, OAuth 2.0 or scoped API keys.
[App SDK](https://docs.attio.com/sdk/guides/creating-an-app) — TypeScript +
React apps embedded inside Attio's UI; every scaffold ships with `AGENTS.md`

- `CLAUDE.md` and a pre-wired `.mcp.json` pointing at a separate **docs MCP**
  for code-writing agents ([sdk/guides/ai](https://docs.attio.com/sdk/guides/ai)).
  [Webhooks V2](https://docs.attio.com/rest-api/guides/webhooks) — HMAC-SHA256
  signed, at-least-once with `Idempotency-Key`, exponential backoff over ~3 days,
  server-side filter DSL with `$and`/`$or` + `equals`/`not_equals` on any dotted
  payload path.

**Patterns to steal.**

- Agent-shaped MCP tools with intent-level names (`upsert-record`,
  `semantic-search-notes`, `update-list-entry-by-record-id`) and a dedicated
  `list-attribute-definitions` tool for schema self-discovery.
- Interaction attributes as a first-class read-only type, denormalised onto
  the record for single-filter queries.
- Lists with list-scoped attributes as pipeline primitives separate from the
  record.

**Not to copy.**

- Workflow-block AI (Classify / Summarize / Prompt nodes) — ceremony once
  agents orchestrate via MCP directly.
- Credit-metered AI pricing and gated enriched-data tiers.
- Visual canvas block library as the primary automation UX.

---

### 4.2 Folk — [folk.app](https://folk.app)

**Positioning.** *"The CRM that works for you"* / *"#1 CRM for Agencies"*
([folk.app/agency-crm](https://www.folk.app/agency-crm)). Target: agencies,
solo founders, partnerships, small sales teams. Relationship-first with pipelines
bolted on — "a CRM that doesn't destroy your soul".

**Data model.** Four first-class entities: **People**, **Companies**, **Deals**,
**Groups** (segments/lists), with customizable fields
([developer.folk.app/llms.txt](https://developer.folk.app/llms.txt)). Hybrid
relationship-first + deal-pipeline model — closer to a rolodex with pipelines
than an account-based opportunity tracker.

**Agent / AI surface.** Four named **Assistants**:

1. **Follow-up Assistant** — scans email + WhatsApp for stalled threads,
   drafts personalised replies.
2. **Recap Assistant** — summarises threads/meetings, configurable to
   MEDDIC/BANT.
3. **Research Assistant** — web-scans to enrich company data and produce
   research notes.
4. **Workflow Assistant** — trigger-based email automation with personalisation.

**Public REST API** at
[`api.folk.app/v1`](https://developer.folk.app/api-reference/overview) —
Bearer auth, OpenAPI published, webhooks for workspace events, covering
People / Companies / Deals / Notes / Interactions / Reminders / Groups /
Users / Webhooks. **No first-party MCP server**, but community wrappers exist:
[`NimbleBrainInc/mcp-folk`](https://github.com/NimbleBrainInc/mcp-folk),
[`joshuayoes/folk-crm-mcp`](https://github.com/joshuayoes/folk-crm-mcp),
[Composio toolkit](https://composio.dev/toolkits/folk). Folk is positioning
for an agent ecosystem rather than shipping agents — the API + webhooks surface
is the product.

**Interaction capture.** Implicit across Gmail / Outlook (auto-sync), Google
Calendar, **WhatsApp**, **LinkedIn + Sales Navigator** via the
**[folkX Chrome extension](https://www.folk.app/crm-for-x/lp/folkx-linkedin)**
(20k+ downloads, 4.8★). folkX is the distinguishing capture surface. Zapier
bridges 6000+ more sources. Calls are not a core modality.

**Differentiator.** **LinkedIn-native capture via folkX** + agency/solo
workflow fit. Multi-channel inbox where LinkedIn and WhatsApp are peers to
email, unusual among AI-CRMs.

**Patterns to steal.**

- Public OpenAPI + webhooks as the agent surface — let community MCPs wrap it.
- Multi-channel peer capture (LinkedIn + WhatsApp + email) via browser
  extension, not Zapier afterthoughts.
- The four-assistant framing (follow-up, recap, research, workflow) as the
  real jobs to be done — mirrors our existing MCP prompts.

---

### 4.3 Reevo — [reevo.ai](https://reevo.ai)

**Positioning.** *"One Platform. From First Touch to Closed Won."* / *"Going
Stackless."* Target: founders and sales leaders at startups/SMBs. $80M seed
(Khosla + Kleiner Perkins); founded by David Zhu (ex-Head of Engineering,
LinkedIn). Explicit **replacement**, not overlay: "Prospect-to-close in a
single tab. More functionality. Less complexity."

**Data model.** Deal-pipeline-first. **Accounts, Contacts, Opportunities,
Custom Objects** ([reevoai.mintlify.app](https://reevoai.mintlify.app/CRM-configurations/Custom-Objects)).
Standard SFDC-shaped schema — the most classical of the agent-native five.

**Agent / AI surface.** **Ask Reevo** — NL co-pilot for cross-data reasoning.
Meeting intelligence, smart email composer, smart task logging, automated
activity logging, stage gating. Lead scoring + intent signals marked "Soon".
**No MCP mention anywhere on the site.**

**Interaction capture.** Implicit — meeting recordings, call intelligence,
email capture, CRM-integrated activity. Most unusual: **"Domain & inbox
purchase"** + **"inbox warming"** — Reevo provisions sending infrastructure
inside the CRM.

**Differentiator.** **Bundled outbound infrastructure** (domains, warmed
inboxes, dialer). Others integrate with Apollo/Smartlead; Reevo owns the stack
layer.

**Patterns to steal.** Limited for our shape — Reevo's differentiators are
enterprise sales infra that does not fit solo-agency register.

---

### 4.4 Lightfield — [lightfield.app](https://lightfield.app)

**Positioning.** *"CRM that remembers everything and does the work for you."*
/ *"the first AI-native CRM with complete customer memory."* Founder-led sales
through ~50 employees, $36/user/month, $81M at $300M valuation; 2,500
companies / 100+ YC startups in three months
([SaaStr list](https://www.saastr.com/which-crm-should-you-use-in-2026-2027-follow-the-agents/)).

**Data model.** **Relationship-first / schema-less**. "A world model of your
business" — a context graph of Accounts, Opportunities, Contacts with raw
interactions (emails, meeting transcripts, calls) as the **source of truth**;
structured fields are derived views, not primary. Add a field at any time and
the system backfills it from historical conversations. Attributes carry
natural-language definitions of what they mean and how to populate them.

**Agent / AI surface.** The most ambitious agent story of the set:

- **Auto-Capture CRM** — zero data entry; 5-minute setup from inbox.
- **Agentic chat** over full customer memory with citations.
- **Code execution** (launched Feb 2026): the agent writes and runs Python
  against customer memory — plans, codes, runs, evaluates, iterates. Produces
  artifacts (battle cards, rep scorecards, board-ready pipeline reports), not
  just answers
  ([blog: Code execution in Lightfield](https://lightfield.app/blog/code-execution-in-lightfield)).
- **REST API in public beta** with TypeScript + Python SDKs; **MCP support
  explicitly listed** as an access method
  ([docs.lightfield.app](https://docs.lightfield.app/)). API "emits events that
  trigger autonomous agent behaviors." MCP connectors shipped for Notion,
  Linear, Granola.

**Interaction capture.** Fully implicit — email, meeting transcripts, built-in
call recorder (no Fathom/Fireflies needed), notes. No LinkedIn/WhatsApp
emphasis.

**Differentiator.** **Code-executing agent over a semi-structured world
model**. While everyone else ships NL chat over structured rows, Lightfield's
agent writes code against raw history. Closest in spirit to what Batuda
could become with Effect-powered composable actions.

**Patterns to steal.**

- Schema-less backfill — let users add a field any time; agent populates it
  historically from the raw interaction log. Tiptap JSON + Effect pipelines
  map naturally onto "raw first, structured-on-demand".
- Code-executing agent over interaction history — Lightfield's Python path
  validates the primitive; Batuda's research runtime could host the same
  shape.

---

### 4.5 Aurasell — [aurasell.ai](https://www.aurasell.ai)

**Positioning.** *"Make Everyone An Elite Operator"* — AI-native GTM OS that
either replaces CRM or overlays existing Salesforce/HubSpot. Mid-market /
enterprise with tool sprawl or legacy-CRM lock-in. $30M seed (Menlo, Unusual);
ex-Harness CRO + CTO. **Pricing**: starts at $15k/year + 3M AI credits
(startup tier, no per-seat) ([pricing](https://www.aurasell.ai/pricing)).

**Data model.** Standard sales-ops: **Accounts / Opportunities / Contacts**
plus a built-in 850M contacts / 85M accounts prospect database. Value-driver
objects (products, competitors, positioning) attached to accounts — more
structured than Lightfield, more opinionated than Folk.

**Agent / AI surface.** Claims to replace 15+ tools: AI personalised emails,
call prep, opportunity management, automated coaching, conversational
intelligence, AI-powered CPQ, ICP-fit sourcing, persona intelligence.
*"Human-in-the-loop automation across all conversations and signals"* — the
framing is workflow automation rather than autonomous agents. **No mention of
MCP** in any marketing page reviewed. 220+ integrations listed.

**Differentiator.** **Runs on top of legacy CRM or replaces it** — the only
platform here with a genuine overlay path. Plus bundled 850M-contact database
and AI credits pricing.

**Patterns to steal.** AI credits pricing is an anti-pattern for a solo
workshop; the overlay positioning is interesting conceptually but wrong for
our target.

---

### 4.6 Monaco — [monaco.ai](https://monaco.ai) ([inf] domain)

**Positioning.** *"AI-native CRM + prospect database + AI agents, all
supervised by experienced human salespeople Monaco employs."* $35M from
Founders Fund + Collisons + Garry Tan + Neil Mehta; Sam Blond (ex-CRO Brex).
Public beta since Feb 2026. Target: outbound-first seed/Series A without a
seasoned VP of Sales yet — you're "renting" a sales team, not just software.

**Data model.** `[inf]` Accounts / Contacts / Opportunities with built-in
prospect DB. **No public docs site** or dev portal surfaced in search — least
documented of the AI-native cluster. No API, no MCP, no integration list.

**Agent / AI surface.** AI agents run outbound on autopilot; forward-deployed
AEs monitor quality and take the actual meetings. Differentiator claim: agents
"do not pretend to be a sales rep" — identified as AI, not human-avatar SDRs
(contra 11x/Artisan).

**Interaction capture.** "Every interaction (emails, calls, meeting
recordings, LinkedIn messages) gets automatically captured, summarized, and
turned into structured records." Implicit capture + human review.

**Differentiator.** **Hybrid AI + human service model** — the only one selling
a managed outcome (booked meetings) rather than a self-serve tool. Closer to
an agency with software than a software product.

**Gaps.** No independent G2 / metrics, no public API, no MCP, no pricing.
Scalability of embedded-AE model is an open question.

---

## 5. Modern open-source profiles

Source-readable. Included both as reference codebases and as adoption
candidates — the conclusion is that neither fits as a base.

### 5.1 Twenty — [twentyhq/twenty](https://github.com/twentyhq/twenty)

**Tagline.** *"The #1 Open-Source CRM — a modern alternative to Salesforce"*.
44,588 stars, 6,066 forks, last commit same day as this analysis, weekly
releases (latest `v1.22.4` 2026-04-17). License = `NOASSERTION` (custom
copyleft/source-available).

**Tech stack.** Yarn (Berry) + Nx monorepo, 19 packages, 16,432 TS/TSX files
(~55.8 MB / ~1.6M lines [inf]). Backend: **NestJS 11 + Apollo GraphQL 12 +
TypeORM 0.3.20 (patched) on Postgres 8.12**, BullMQ 5 + Redis queues,
[`@ai-sdk/openai`](https://sdk.vercel.ai/) + Vercel AI SDK v6, Sentry, zod 4.1.
Frontend: React + Vite + React Router v6 + **Apollo Client v4 + Jotai 2.17**,
Emotion, Tiptap 3, [`@xyflow/react 12`](https://reactflow.dev/) for workflow
diagrams, Lingui 5. **Multi-tenancy = schema-per-workspace in Postgres**
([`workspace-datasource.service.ts`](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/workspace-datasource/workspace-datasource.service.ts)).

**Data model.** Meta-objects live in the `core` schema; records live in the
per-workspace schema. The
[`objectMetadata`](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/metadata-modules/object-metadata/object-metadata.entity.ts)
and
[`fieldMetadata`](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/metadata-modules/field-metadata/field-metadata.entity.ts)
tables describe real Postgres tables per tenant — creating a custom object
issues `CREATE TABLE` against the workspace schema via their own `twenty-orm`
layer ([engine/twenty-orm](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/engine/twenty-orm)).
**Not JSONB document storage**.

Twenty-eight standard objects:
Company, Person, Opportunity, Task, Note, NoteTarget, TaskTarget, Attachment,
Blocklist, ConnectedAccount, Dashboard, Message, MessageChannel, MessageFolder,
MessageParticipant, MessageThread, MessageChannelMessageAssociation,
CalendarEvent, CalendarChannel, CalendarEventParticipant,
CalendarChannelEventAssociation,
[**TimelineActivity**](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/modules/timeline/standard-objects/timeline-activity.workspace-entity.ts),
Workflow, WorkflowVersion, WorkflowRun, WorkflowAutomatedTrigger,
WorkspaceMember.

`TimelineActivity` is a **polymorphic log** — `happensAt`, `name`, JSONB
`properties`, plus `targetPerson / targetCompany / targetOpportunity /
targetNote / targetTask / targetWorkflow / targetDashboard / targetCustom`
nullable FKs. One table captures "what changed when, pointing at any object".

Relations support `RELATION | MORPH_RELATION`; morph-relations allow one field
to point at multiple object types. Views
([`engine/metadata-modules/view`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/engine/metadata-modules/view))
are first-class: `type: TABLE | KANBAN | CALENDAR` with `viewField`,
`viewFilter`, `viewSort`, `viewGroup` sibling tables.

**Agent / AI surface.** [MCP server](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/engine/api/mcp)
at `POST /mcp` with SSE streaming, API-key or user JWT auth
([`mcp-core.controller.ts`](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/api/mcp/controllers/mcp-core.controller.ts)).
Capabilities: `tools`, `resources`, `prompts`
([`mcp-protocol.service.ts`](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/api/mcp/services/mcp-protocol.service.ts)).

**The meta-tool pattern.** Preloaded tools: `get-tool-catalog`, `learn-tools`,
`load-skill`, `execute-tool`. All other tools are gated behind `learn` /
`execute` — the LLM queries the catalog, loads only the tools it needs, then
executes. Keeps context usage low and scales to hundreds of tenant-specific
tools.

Tool providers
([`engine/core-modules/tool-provider/providers`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/engine/core-modules/tool-provider/providers)):
`action-tool`, `dashboard-tool`, `database-tool`, `logic-function-tool`,
`metadata-tool`, `native-model-tool`, `view-field-tool`, `view-tool`,
`workflow-tool`. Built-in agent tools: `code-interpreter`, `email`, `http`,
`navigate`, `search-help-center`, `send-email`, `web-search`. Skills
([`skill.entity.ts`](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/metadata-modules/skill/entities/skill.entity.ts))
are reusable instruction blocks — `name`, `label`, `content: text`, `isActive`.

Workflow actions include
[`ai-agent`](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/modules/workflow/workflow-executor/workflow-actions/ai-agent/ai-agent.workflow-action.ts)
— run an agent as a step, consuming `AiBillingService` credits.

**Interaction capture.** First-class module
([`modules/messaging`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/modules/messaging)

- `modules/calendar`) with drivers: `gmail/`, `imap/`, `microsoft/`, `smtp/`
  ([message-import-manager/drivers](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/modules/messaging/message-import-manager/drivers)).
  Gmail via Google OAuth; Microsoft via MSAL. Inbound mail lands in `Message`,
  `MessageThread`, `MessageChannelMessageAssociation`, with `MessageParticipant`
  matched to `Person` via a dedicated `match-participant` module.

**Extension surface.** Visual workflow builder in
[`twenty-front/src/modules/workflow/workflow-diagram`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-front/src/modules/workflow/workflow-diagram)
(React Flow). Triggers: `DatabaseEventTriggerSettings` (event + watched fields)
and `CronTriggerSettings`. Actions: `ai-agent`, `code`, `delay`, `empty`,
`filter`, `form`, `http-request`, `if-else`, `iterator`, `logic-function`,
`mail-sender`, `record-crud`, `tool-executor`. Versioned via `WorkflowVersion`;
runs persisted in `WorkflowRun`.

Webhooks: [`webhook.entity.ts`](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/metadata-modules/webhook/entities/webhook.entity.ts)
with `targetUrl`, `operations: string[]` (object.operation glob), HMAC
`secret`. API keys ([`core-modules/api-key`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/engine/core-modules/api-key))
bind to roles. Full Zapier app at [`packages/twenty-zapier`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-zapier).
Apps marketplace in
[`packages/twenty-apps/community`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-apps/community)
ships Apollo enrichment, Mailchimp sync, Stripe sync, Fireflies, LinkedIn
browser extension, etc.

**Patterns to steal.**

- **Schema-per-workspace + metadata-driven DDL.** Real Postgres tables per
  tenant with real FKs and indexes, at the cost of DDL complexity.
- **MCP meta-tool pattern** (`learn-tools` + `execute-tool`) — keeps context
  small when the catalog is huge.
- **`TimelineActivity` polymorphic log** — one table for the unified activity
  feed.

**Not to copy.**

- The metadata engine's scale. `flat-*` module family is tens of kLOC of
  metadata diffing — wrong scale for a solo workshop.
- NestJS + TypeORM + Apollo stack — has required patching TypeORM 0.3.20 and
  NestJS GraphQL 12.1.1 to make work.
- Marketplace / Zapier app / apps SDK / visual workflow builder — significant
  maintenance load.

---

### 5.2 Atomic CRM — [marmelab/atomic-crm](https://github.com/marmelab/atomic-crm)

**Positioning.** *"A full-featured CRM built with React, shadcn/ui, and
Supabase"* — **a template, not a product**. MIT license; distributed via
shadcn registry (`npx shadcn add https://marmelab.com/atomic-crm/r/atomic-crm.json`).
Marmelab's commercial angle is react-admin consulting; this is a lead magnet +
reference implementation.

**Stack.** React 19 + Vite 7 + TypeScript 5.8, React Router v7, TanStack
Query. Not vanilla shadcn — they wrap
[`ra-core`](https://marmelab.com/react-admin/) (react-admin's headless core) +
shadcn-admin-kit so the shadcn tree is form-binding aware
([`src/components/admin/`](https://github.com/marmelab/atomic-crm/tree/main/src/components/admin)).
Supabase features: Postgres + PostgREST + Auth (OAuth OIDC via
Google/Azure/Keycloak/Auth0) + Storage + **Edge Functions (Deno)**. No
Realtime. **RLS on every table**
([`supabase/schemas/05_policies.sql`](https://github.com/marmelab/atomic-crm/blob/main/supabase/schemas/05_policies.sql)).

The "~15 kLOC" line refers to
[`src/components/atomic-crm/`](https://github.com/marmelab/atomic-crm/tree/main/src/components/atomic-crm)
only — 231 files, ~724 KB. The whole repo is ~12 MB of blobs; TypeScript source
is 1.34 MB. The 15 k number is the CRM logic you're meant to fork. The app
entry [`src/App.tsx`](https://github.com/marmelab/atomic-crm/blob/main/src/App.tsx)
is 18 lines — renders `<CRM />` with domain props.

**Data model.** Entities in
[`supabase/schemas/01_tables.sql`](https://github.com/marmelab/atomic-crm/blob/main/supabase/schemas/01_tables.sql):
`companies`, `contacts`, `contact_notes`, `deals`, `deal_notes`, `sales`
(users), `tags`, `tasks`, `configuration` (singleton),
`favicons_excluded_domains`. Contacts store `email_jsonb` and `phone_jsonb` as
JSONB arrays (migrated in
[`20250109152531_email_jsonb.sql`](https://github.com/marmelab/atomic-crm/blob/main/supabase/migrations/20250109152531_email_jsonb.sql),
[`20250113132531_phone_jsonb.sql`](https://github.com/marmelab/atomic-crm/blob/main/supabase/migrations/20250113132531_phone_jsonb.sql)).
Deals have `contact_ids bigint[]` (array FK, not a join table) and `stage text`
(free string, no FK).

**Schema workflow is unusual**: `supabase/schemas/*.sql` is the declarative
source of truth; `supabase/migrations/` is auto-generated via `npx supabase db
diff --local -f <name>`. Pipeline stages are **hardcoded** in
[`defaultConfiguration.ts`](https://github.com/marmelab/atomic-crm/blob/main/src/components/atomic-crm/root/defaultConfiguration.ts)
(`opportunity | proposal-sent | in-negociation | won | lost | delayed`) —
override at fork-time via `<CRM dealStages={...}>` props.

Three aggregate views in
[`03_views.sql`](https://github.com/marmelab/atomic-crm/blob/main/supabase/schemas/03_views.sql):
`contacts_summary`, `companies_summary`, `activity_log`. The `activity_log`
view is a 5-way `UNION ALL` synthesising events from raw rows (`company.created`,
`contact.created`, `contactNote.created`, `deal.created`, `dealNote.created`)
— it's a query, not an events table.

**MCP server.** Location:
[`supabase/functions/mcp/index.ts`](https://github.com/marmelab/atomic-crm/blob/main/supabase/functions/mcp/index.ts)
— a Supabase Edge Function (Deno, ~450 LOC). SDK:
`npm:@modelcontextprotocol/sdk@1.28.0` with `WebStandardStreamableHTTPServerTransport`,
stateless.

**Auth.** Supabase JWT via **OAuth 2.1 with
[RFC 9728 protected-resource metadata](https://datatracker.ietf.org/doc/html/rfc9728)**.
AI client hits `/mcp`, gets 401 with
`WWW-Authenticate: Bearer resource_metadata="..."`, then OAuths against
`${SUPABASE_URL}/auth/v1`. JWT verified via JWKS. After auth, the raw user JWT
is injected into each SQL transaction via `set_config('request.jwt.claims', $1,
true)` + `set_config('role', 'authenticated', true)` — **RLS is enforced
automatically**. The MCP server is essentially a thin SQL proxy inheriting the
same RLS policies as the web app.

**Tools exposed — only 5:**

| Tool                | Description                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `get_schema`        | Dumps all `public` tables/views/columns/FKs from `information_schema`; LLM must call this first                   |
| `query`             | Arbitrary SQL `SELECT` / `WITH`, validated via [`pgsql-ast-parser`](https://github.com/oguimbal/pgsql-ast-parser) |
| `mutate`            | `INSERT` / `UPDATE` / `DELETE` / `WITH`, validated write; `sales_id` set by trigger, never client                 |
| `display_task_list` | **MCP App** — interactive HTML guest widget rendering tasks with check-off buttons                                |
| `complete_task`     | Ticks one task done; used by the widget and directly by the model                                                 |

Plus one MCP resource: `task-list-ui` (`text/html;profile=mcp-app`), served
from [`taskListUi.ts`](https://github.com/marmelab/atomic-crm/blob/main/supabase/functions/mcp/taskListUi.ts),
with `__CRM_BASE_URL__` injected so contact names become deep-links.

The validator is the entire safety layer. RLS in Postgres is what actually
keeps users from touching each other's data. The MCP server does **not** wrap
the same service layer as the web app — the web app uses PostgREST via
[`ra-supabase-core`](https://github.com/marmelab/ra-supabase); the MCP server
opens a raw `postgres` Pool.

**CLAUDE.md / AGENTS.md.** [`CLAUDE.md`](https://github.com/marmelab/atomic-crm/blob/main/CLAUDE.md)
is literally one line: `@AGENTS.md`. Everything lives in
[`AGENTS.md`](https://github.com/marmelab/atomic-crm/blob/main/AGENTS.md) (~8
KB). Two skills in
[`.claude/skills/`](https://github.com/marmelab/atomic-crm/tree/main/.claude/skills):

- `backend-dev` — decision tree for "do I need backend at all?" → prefer custom
  dataProvider → view > edge function > RPC.
- `frontend-dev` — ra-core + shadcn-admin-kit conventions.

One hook: `.claude/settings.json` runs `bash .claude/hooks/format-file.sh` as
`PostToolUse` on `Edit|Write|NotebookEdit`. SKILL.md files are short (30–50
lines) and **decision-oriented**, not comprehensive.

**Inbound email.**
[`supabase/functions/postmark/index.ts`](https://github.com/marmelab/atomic-crm/blob/main/supabase/functions/postmark/index.ts)
— Postmark webhook. IP-allowlisted via `x-forwarded-for` +
`POSTMARK_WEBHOOK_AUTHORIZED_IPS`, plus HTTP Basic auth. Two reception modes:
**direct** (CC the contact + a catch-all) and **forwarded** (sales forwards to
a `VITE_INBOUND_EMAIL` alias; a regex over `TextBody` finds the original
recipient, strips `Fwd:` prefix, extracts via
[`forwardedParser.ts`](https://github.com/marmelab/atomic-crm/blob/main/supabase/functions/postmark/forwardedParser.ts)).
Contact lookup by `.contains('email_jsonb', [{email}])` (JSONB containment over
the array). Company lookup by `website OR name OR domain`, skipping generic
mail providers. Email body stored as a `contact_notes` row; attachments
uploaded to Supabase Storage.

**Patterns to steal.**

- `CLAUDE.md` as a single `@AGENTS.md` marker + skill files for **decision
  trees**, not documentation.
- **Aggregate views** (`contacts_summary`, `companies_summary`, `activity_log`)
  to pre-join for list/search endpoints.
- **MCP auth via OAuth 2.1 + RFC 9728 + transparent RLS.** 450 LOC MCP server
  because RLS does the heavy lifting. For Batuda, keep MCP tools narrowly
  scoped, push auth into the data layer, let MCP inherit. Borrow the
  `WWW-Authenticate` + `/.well-known/oauth-protected-resource` dance for
  Claude/ChatGPT auto-discovery.

**Not to copy.**

- **Arbitrary-SQL MCP tools** (`query` / `mutate`). The safety surface is an
  AST parser + RLS. Batuda's typed per-verb tools are safer, more
  discoverable, and don't require the model to first `get_schema`.
- **Deep Supabase lock-in.** Auth, storage, edge functions, RLS intertwined;
  Edge Functions run Deno (different runtime than the app).
- **Hardcoded-in-code pipeline stages.** `defaultConfiguration.ts` bakes
  stages as source; we use data.

---

## 6. Legacy / reference open-source profiles

PHP-heavy, license-hostile, or generic-engine. Read the schemas; don't fork.

### 6.1 EspoCRM — [espocrm/espocrm](https://github.com/espocrm/espocrm)

AGPLv3, PHP 8.3+, MySQL/MariaDB, jQuery/Backbone-ish SPA frontend. The
[**Entity Manager**](https://docs.espocrm.com/administration/entity-manager/)
is metadata-driven: admins create entity types (Base, Base-Plus, Event, Person,
Company) and fields through a UI. Customisations land in `custom/Espo/Custom`
as JSON — no migrations, no restart. All definitions JSON-Schema-described
([`Resources/metadata/entityDefs`](https://github.com/espocrm/espocrm/tree/master/application/Espo/Modules/Crm/Resources/metadata/entityDefs)).
Custom entities get a `c` prefix to avoid future-version collisions.

**Audit via Stream + per-field `audited: true`**
([fields docs](https://docs.espocrm.com/administration/fields/)). The Stream
is the audit log surface: every `audited` field writes a change record.
Retention configurable (`cleanupAuditPeriod`, default 3 months); entities can
opt into `preserveAuditLog` to disable cleanup.

**RBAC**: Roles × Scope (entity type) × Action (create/read/edit/delete/stream)
× Level (yes/all/team/own/no)
([roles](https://docs.espocrm.com/administration/roles-management/)). Multiple
roles merge most-permissive-wins. Teams inherit roles.

**One pattern to steal.** JSON-Schema-described entity metadata with a `c_`
prefix convention for user-added fields, so the built-in data model can evolve
without colliding with customer customisations.

---

### 6.2 Krayin — [krayin/laravel-crm](https://github.com/krayin/laravel-crm)

MIT, Laravel + Vue. "Marketing automation" is thin — two tables
(`marketing_events`, `marketing_campaigns`), list-segmentation plus email
blasts.

**Magic AI Lead Creation** — the "image-to-contact" feature
([v2.1 release notes](https://krayincrm.com/whats-new-in-krayin-2-1-0/),
[dev docs](https://devdocs.krayincrm.com/2.1/advanced/ai-powered-lead-generation.html)).
Flow: upload PDF/image → `smalot/pdfparser` extracts text + embedded images →
`MagicAIService` sends structured prompt to OpenRouter
(OpenAI/Gemini/Deepseek/Grok/Llama configurable) → AI returns a fixed JSON
shape `{status, title, lead_value, person: {name, emails, contact_numbers}}` →
lead row is created. Re-entrancy flag to block recursion, token-budget
truncation, temp-file cleanup.

Custom fields = classic EAV:
[`attributes`](https://github.com/krayin/laravel-crm/tree/master/packages/Webkul/Attribute/src/Database/Migrations)
(code, type, entity_type, is_required, is_unique) + `attribute_options` +
`attribute_values` with typed columns `text_value/boolean_value/integer_value/
float_value/datetime_value/date_value/json_value`. Works, queries poorly at
scale.

**One pattern to steal.** AI-intake service with a **fixed output schema +
fallback defaults + pluggable model** (OpenRouter-style) as the primitive for
image/PDF-to-record flows.

---

### 6.3 SuiteCRM — [salesagility/SuiteCRM](https://github.com/salesagility/SuiteCRM)

AGPL, PHP (SugarCRM fork). Directory listing speaks for itself:
`AOW_WorkFlow`, `AOR_Reports`, `AOS_Quotes`, `AOK_KnowledgeBase`, `AOD_Index`,
`AOBH_BusinessHours`. The "AO*" (Advanced Open) prefix is decade-old
archaeology. Codebase still uses `vardefs.php`, `language/` directories,
`BeanDictionary.php` — 2004 architecture.

**The workflow engine (AOW_WorkFlow)** is genuinely complete
([docs](https://docs.suitecrm.com/user/advanced-modules/workflow/)): trigger
(on-save / on-scheduler / always) × scope (new / modified / all records) ×
repeated-runs toggle × conditions (value/field/multi/date-relative-to-Now) ×
actions (Create Record, Modify Record, Send Email, Calculate Fields).
Round-robin / least-busy / random assignment built in. Process Audit panel
shows every historical trigger.

**One pattern to steal.** Workflow decomposition — `trigger × scope ×
repeated-runs × conditions × actions` with a Process Audit sub-panel — as a
design-reference shape before building any rule engine.

---

### 6.4 OroCRM — [oroinc/crm](https://github.com/oroinc/crm)

Symfony + Doctrine + Twig + bundle-per-feature. Enterprise DDD: 15+ bundles,
compiler passes, YAML everywhere.

Distinctive model = **Channel + Customer-Identity split**
([`ChannelBundle/README.md`](https://github.com/oroinc/crm/blob/master/src/Oro/Bundle/ChannelBundle/README.md)).
`ChannelBundle` defines a "source of customer data" (a CRM channel, an
eCommerce channel, etc.); `SalesBundle` has `B2bCustomer` (the account-like
entity distinct from Lead/Opportunity). Bundles: `AccountBundle`, `ContactBundle`,
`SalesBundle` (Lead, Opportunity, B2bCustomer), `CaseBundle`, `ChannelBundle`,
`AnalyticsBundle`, `ActivityContactBundle`.

**One pattern to steal.** The **Channel abstraction** (account × acquisition
source × channel config) for agency-style "where did this client come from"
reporting. One company can be reached through multiple channels, each carrying
its own config.

---

### 6.5 NocoBase & NocoDB — [nocobase/nocobase](https://github.com/nocobase/nocobase), [nocodb/nocodb](https://github.com/nocodb/nocodb)

**NocoBase** — plugin microkernel. Relevant plugins: `plugin-data-source-main`,
`plugin-data-source-manager`, `plugin-audit-logs`, `plugin-acl`. The
[CRM 2.0 solution](https://docs.nocobase.com/solution/crm) is explicit: **a
template** — pre-configured Collections, Workflows, dashboards, 37 email
templates restored via NocoBase's migration feature. Modules: Customer,
Opportunity, Lead, Quotation, Order, Product, Email. Toggle-on-toggle-off;
"minimum viable = Customer + Opportunity". AI employees (Viz/Ellis/Lexi/Dara/Orin)
scoped to pages.

**NocoDB** — even less CRM-shaped. NestJS backend around generic `meta`,
`models`, `controllers`, `db`. Airtable-style views over any SQL schema.

**The generic-model trap.** Once every entity is user-configurable, the product
stops being opinionated about *how an agency actually works* — proposals,
deliveries, retainers, the client's approval loop. The whole point of a
small-agency-specific CRM is that the data model encodes the workflow. The
canvas is always tempting as "phase 2 extensibility," but starting there kills
the narrative.

**One pattern to steal.** The **trim-down** principle — ship the full model,
but present a "lite = 2 modules" and "standard = 5 modules" onboarding path.

---

### 6.6 Monica — [monicahq/monica](https://github.com/monicahq/monica)

PHP/Laravel/Eloquent/Vue personal CRM (friends, family, relationships). The
entity list is the single most useful reference schema in this whole analysis.
From `database/migrations/`:

- `relationship_types` + `relationship_group_types` + `relationships` — typed,
  grouped, with **reverse-relationship naming** (`name_reverse_relationship`:
  parent ↔ child). Contact-to-contact graph, not contact-to-company.
- `contact_reminders` (day/month/year optional — supports "every year on this
  day" without a fixed year), `user_notification_channels`,
  `contact_reminder_scheduled`, `user_notification_sent` — a proper
  reminder-delivery pipeline with channel verification.
- `life_event_categories → life_event_types → life_events`, attached to
  `timeline_events` with `life_event_participants` and optional `emotion`,
  `costs`, `currency`, `paid_by_contact_id`, `duration_in_minutes`,
  `from_place` / `to_place`.
- `contact_tasks`, `gifts` (with `gift_occasions`, `gift_states`,
  received/given/bought dates), `contact_feed`, `labels`, `notes`, `calls`,
  `journal`, `slices_of_life`, `mood_tracking`, `life_metrics`,
  `vault_quick_facts_template`.

The primary object is a **relationship + its history**, not a pipeline stage.
Reminders are first-class with their own delivery channel entity. Activities
are rich (calls, life events, journal, mood) and participation is many-to-many
across contacts. **Vaults** (Monica's multi-tenant boundary) scope every config
table, including type dictionaries — every workspace owns its own taxonomy.

**One pattern to steal.** Typed, grouped, **reverse-named** relationship edges

- a reminder-with-delivery-channel pipeline as a proper entity
  (`reminder → scheduled → sent`), not a cron job that fires emails.

---

## 7. Cross-cutting analysis

### 7.1 Where the field agrees

- **Implicit capture is table stakes.** All AI-native SaaS CRMs auto-ingest
  email + calendar; most auto-ingest meeting transcripts. Twenty, Atomic CRM,
  and Folk all do implicit ingest on the OSS side.
- **NL chat over CRM data.** Attio (Ask Attio), Folk (Assistants), Reevo (Ask
  Reevo), Lightfield (agentic chat), Aurasell (conversational intelligence),
  Monaco (human-supervised agents) — everyone ships this.
- **Enrichment bundled in.** Prospect databases, email-finding, firmographics
  treated as core, not Apollo/ZoomInfo add-ons.
- **MCP shifts from curiosity to expected.** Attio, Twenty, Atomic CRM,
  Lightfield all ship first-party. Folk has community MCPs thriving on top of
  its public API. Reevo/Aurasell/Monaco are the hold-outs.

### 7.2 Where the field disagrees

| Dimension                 | Camp A                                    | Camp B                                                                |
| ------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| **Data model philosophy** | Schema-less / world model (Lightfield)    | Typed / schema-first (Attio, Twenty, Batuda)                          |
| **Pipeline framing**      | Relationship-first (Folk, Monica, Batuda) | Deal-first (Reevo, Aurasell, Monaco, Twenty)                          |
| **Pipeline primitive**    | List-with-list-attrs (Attio)              | Status field on entity (Batuda, Atomic CRM) / Deal row (Twenty, Folk) |
| **MCP shape**             | Tiny + generic + RLS (Atomic CRM)         | Typed per-verb (Attio, Batuda)                                        |
| **Multi-channel inbox**   | Email + LinkedIn + WhatsApp peers (Folk)  | Email + calls primarily (most)                                        |
| **Build vs rent**         | Software (most)                           | Managed outcome (Monaco)                                              |
| **Extension surface**     | Visual workflow builder (Twenty, Attio)   | Code-defined + webhooks (Batuda, Folk, Lightfield)                    |

### 7.3 Hype vs substance

**Substance.** Lightfield's code-execution agent (observable demo + launch
post), Folk's public OpenAPI + community MCPs (you can verify the endpoints
exist), Monaco's booked-meetings claim (validated by an independent SaaStr
customer). Attio's MCP tool list is concrete and documented.

**Hype.** Reevo's "Soon" tags on lead scoring + intent signals (most-funded,
not most-shipped). Aurasell's "850M contacts / 85M accounts" figure (impossible
to distinguish from Apollo/ZoomInfo reselling). Broad "replaces 15+ tools"
claims without enumeration.

**Thin spots.** Monaco has no public docs or API. Reevo has no MCP despite the
$80M. Aurasell's "overlay Salesforce + replace Salesforce" tries to have it
both ways.

---

## 8. Surface-by-surface comparison

### 8.1 Domain layer

| CRM                           | Core entities                                                                                                    | Schema shape                                                    | Pipeline stance                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------ |
| **Batuda**                    | Company, Contact, Interaction, Proposal, Task, Document, Page, CallRecording, EmailMessage, Product, ResearchRun | Static Effect `Model.Class` + branded IDs + `metadata: Unknown` | Company-centric (`status` field)     |
| **Attio**                     | Objects + Records + Lists, 17 attribute types                                                                    | Dynamic via `list-attribute-definitions`; bitemporal values     | Lists-with-list-scoped-attrs         |
| **Twenty**                    | 28 standard objects + custom                                                                                     | Dynamic metadata → real Postgres tables per workspace schema    | Opportunity as first-class object    |
| **Atomic CRM**                | companies, contacts, deals, tasks, notes, tags, sales                                                            | Declarative SQL → auto-diff migrations                          | Stages hardcoded in source           |
| **Folk**                      | People, Companies, Deals, Groups + custom fields                                                                 | Static + custom fields                                          | Deals alongside People, not dominant |
| **Lightfield**                | Accounts, Opportunities, Contacts + raw interactions                                                             | Schema-less world model; fields backfilled                      | Derived view over raw history        |
| **Reevo / Aurasell / Monaco** | Accounts / Contacts / Opportunities (+ custom)                                                                   | SFDC-shaped                                                     | Deal-pipeline-first                  |
| **EspoCRM**                   | Base / Base-Plus / Event / Person / Company + custom                                                             | JSON-metadata; `c_` prefix for custom                           | Pipeline as entity                   |
| **Krayin**                    | Lead / Contact / Organization / Quote                                                                            | EAV (`attributes` + `attribute_values`)                         | Lead-funnel                          |
| **SuiteCRM**                  | Account / Contact / Lead / Opportunity + `AOW_*`                                                                 | Sugar `vardefs.php` beans                                       | Opportunity pipeline                 |
| **OroCRM**                    | Account / Contact / Lead / B2bCustomer + Channel                                                                 | Symfony + Doctrine                                              | B2B-channel-first                    |
| **NocoBase / NocoDB**         | Generic collections                                                                                              | Generic engine                                                  | Per-instance                         |
| **Monica**                    | Contact + typed `relationships`, `life_events`, `gifts`, `contact_reminders`                                     | Typed graph edges with reverse names                            | Not a pipeline — a timeline          |

**Batuda's distinctive domain moves.**

- [`ResearchRun`](https://github.com/twentyhq/twenty) with cost/quota tracking
  and hierarchical `parent_id` — no OSS CRM has this as a first-class entity.
- [`InboxFooter`](../packages/domain/src/schema/) as a DB entity with outbound
  auto-injection.
- [`CallRecording`](../packages/domain/src/schema/call-recordings.ts) 1:1 with
  `Interaction`, transcript status pre-declared before provider exists.
- `metadata: Unknown` as forward-compat on every aggregate.

**Batuda's gaps vs the field.**

- No polymorphic activity log (Twenty's `TimelineActivity`).
- No typed Contact↔Contact or Company↔Company edges (Monica's relationship
  graph).
- No denormalised `lastEmailInteractionAt` / `nextCalendarEventAt` columns
  (Attio's interaction attribute type).
- No `Deal` separate from `Proposal` — conflates the pipeline row with the
  document (Folk, Attio split them).

### 8.2 Controllers layer

| CRM                             | Primary API                                                                                                      | Secondary                                                                                                          | Extension surface                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| **Batuda**                      | HttpApi (`effect/unstable/httpapi`), 16 route groups, session middleware                                         | —                                                                                                                  | `WebhookService` fires on events             |
| **Attio**                       | REST + published OpenAPI                                                                                         | [App SDK](https://docs.attio.com/sdk/guides/creating-an-app) (TS + React in-app)                                   | Webhooks V2 with server-side filter DSL      |
| **Twenty**                      | [GraphQL (Apollo 4)](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/engine/api/graphql) | [REST + OpenAPI](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/engine/api/rest) co-equal | API keys with role binding; Zapier app       |
| **Atomic CRM**                  | PostgREST via Supabase                                                                                           | —                                                                                                                  | Edge functions (Deno), RLS for auth          |
| **Folk**                        | REST + OpenAPI + webhooks                                                                                        | —                                                                                                                  | Community MCPs wrap the API                  |
| **Lightfield**                  | REST (beta) + TS/Python SDKs                                                                                     | MCP                                                                                                                | Webhooks trigger autonomous agent behaviours |
| **Reevo / Aurasell / Monaco**   | Proprietary                                                                                                      | —                                                                                                                  | Limited / none                               |
| **EspoCRM / SuiteCRM / OroCRM** | REST + SOAP (legacy)                                                                                             | RBAC-gated                                                                                                         | Workflow engines                             |

**Batuda's distinctive controller moves.**

- OpenAPI-first at [`api.ts`](../packages/controllers/src/api.ts), matching
  Attio and Folk's stance.
- Typed `NotFound` with `HttpApiSchema.status(404)` — type-safe error mapping.
- Session middleware as a single layer, applied uniformly.

**Batuda's gaps.**

- **No webhook filter DSL.** Today
  [`WebhookService`](../apps/server/src/services/webhooks.ts) fires on all
  events. Attio's filter DSL (`$and`/`$or` over payload paths) lets subscribers
  define scope server-side.
- **No API keys with role binding.** Session-token-only today. Twenty's
  `api-key` module binds to a role; needed if external clients ever consume
  our API without a human session.
- **No public OpenAPI export.** We have the schema internally; we don't
  publish it. Folk's ecosystem exists because third parties can build MCPs
  from the spec.

### 8.3 Services layer

| CRM            | Email ingest                                                                                                                                                                  | Driver abstraction                                                                                                  | Enrichment                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Batuda**     | `apps/mail-worker` IMAP IDLE per inbox → `email_messages` + `email_thread_links`; company/contact matched by recipient; DSN parser flips `status='bounced'`; footer injection | Generic IMAP+SMTP transport per `inboxes` row (BYO mailbox); `StorageProvider` (S3/R2) for raw RFC822 + attachments | Geocoder (Nominatim, 1 req/s); ResearchRun integrated + cost-gated |
| **Attio**      | Implicit via sync; `last_email_interaction` as read-only column                                                                                                               | Single proprietary pipeline                                                                                         | Research Agent as workflow block; AI attributes compute-on-read    |
| **Twenty**     | `messaging/drivers/` — gmail, imap, microsoft, smtp + `match-participant` module                                                                                              | Per-channel polymorphic `MessageChannel`                                                                            | Apollo / Mailchimp / Stripe / Fireflies in `twenty-apps/community` |
| **Atomic CRM** | Postmark webhook with forwarded-mode regex + direct-CC mode; company lookup by `website OR name OR domain`; attachments to Supabase Storage                                   | One provider (Postmark)                                                                                             | None native                                                        |
| **Folk**       | Gmail/Outlook + Google Calendar + **WhatsApp** + **LinkedIn via folkX extension**                                                                                             | Multi-channel peers, including browser extension                                                                    | Web research via Research Assistant                                |
| **Lightfield** | Email + meeting transcripts + built-in call recorder (no Fathom)                                                                                                              | Single opinionated pipeline                                                                                         | Agent-driven backfill                                              |
| **Reevo**      | Email + calls + bundled domain purchase + inbox warming                                                                                                                       | Vertically integrated                                                                                               | Sales-infra bundled                                                |

**Batuda's distinctive service moves.**

- BYO-mailbox model — each `(organization_id, owner_user_id)` connects its
  own IMAP/SMTP credentials (Infomaniak, Fastmail, M365, Proton Bridge,
  Gmail Workspace, etc.). No Batuda-hosted mail, no DNS work, no vendor
  lock-in. Closer to Apple Mail / Thunderbird than to a SaaS email bus.
- IDLE-driven inbound (long-lived IMAP IDLE in `apps/mail-worker`) — push
  semantics without webhooks; faster than Twenty's polling, no provider
  webhook surface to authenticate.
- Draft `clientId` encoding
  ([`email.ts`](../apps/server/src/services/email.ts)) —
  `batuda:draft;companyId=X;contactId=Y;…` lets agents stage drafts without
  persisting, then send atomically. Not observed in any of the compared
  CRMs.

**Batuda's gaps.**

- **No native OAuth path yet.** Gmail / M365 users can connect via app
  password (Workspace) or IMAP basic auth (M365), but native OAuth XOAUTH2
  is deferred to v1.1 (designed in plan Appendix A). Until then the
  preset list documents the per-provider gotchas.
- **No LinkedIn / WhatsApp capture.** Folk's folkX extension is the defining
  UX for a solo/agency operator.
- **No `match-participant` as explicit service.** Atomic CRM's `addNoteToContact`
  flow (company by domain, contact by JSONB containment, create-if-missing) is
  the same shape we need. Today it's split between
  [`email.ts`](../apps/server/src/services/email.ts) and direct SQL.

### 8.4 MCP surface

| CRM                           | Auth                                                                                          | Tools                                                                                                                                                                                                                                               | Resources                                                                                                                        | Prompts                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Batuda**                    | Better-auth session via [`McpAuthMiddleware`](../apps/server/src/mcp/http.ts)                 | ~30 typed tools across 10 toolkits; [discriminated-union results](../apps/server/src/mcp/tools/email.ts)                                                                                                                                            | 4 (`batuda://company/{slug}`, `batuda://pipeline`, `batuda://document/{id}`, `batuda://research/{id}`) with slug auto-completion | 5 guided (daily-briefing, company-research, proposal-draft, interaction-followup, research-designer) |
| **Attio**                     | [OAuth 2.1](https://attio.com/mcp) (one-click Claude/ChatGPT install)                         | ~30 agent-tailored tools — split by intent (`upsert-record`, `update-list-entry-by-id`, `semantic-search-notes` vs `search-notes-by-metadata`); schema discovery via `list-attribute-definitions`; reads auto-approved, writes require confirmation | Via tools; no separate resources channel                                                                                         | User-authored custom prompts (Daily brief, Deal brief, QBR prep), shareable                          |
| **Twenty**                    | API key **or** user JWT; `McpAuthGuard` + `WorkspaceAuthGuard`                                | **4 meta-tools**: `get-tool-catalog`, `learn-tools`, `load-skill`, `execute-tool` — agent self-loads only what it needs                                                                                                                             | Declared in capabilities                                                                                                         | Declared in capabilities                                                                             |
| **Atomic CRM**                | OAuth 2.1 via **RFC 9728** protected-resource metadata; JWT injected into SQL session for RLS | **5 generic tools**: `get_schema`, `query`, `mutate`, `display_task_list`, `complete_task`; safety via pgsql-ast-parser + RLS                                                                                                                       | 1: `task-list-ui` (HTML widget with deep-links)                                                                                  | —                                                                                                    |
| **Folk**                      | None first-party; community MCPs wrap REST                                                    | ~10–15 in community wrappers                                                                                                                                                                                                                        | —                                                                                                                                | —                                                                                                    |
| **Lightfield**                | First-party MCP declared; tool list not public                                                | —                                                                                                                                                                                                                                                   | —                                                                                                                                | —                                                                                                    |
| **Reevo / Aurasell / Monaco** | No MCP                                                                                        | —                                                                                                                                                                                                                                                   | —                                                                                                                                | —                                                                                                    |

**Three archetypes of MCP design.**

1. **Generic + RLS-gated** (Atomic CRM). Tiny surface, universal power, safety
   is substrate. Agent must call `get_schema` first.
2. **Meta-tool expanding** (Twenty). Four stable tools; others discovered/loaded
   on demand. Keeps context small when the catalog is huge.
3. **Typed + intent-level** (Attio, Batuda). One tool per verb, agent-shaped
   naming, schema-discovery as a dedicated tool.

**Batuda sits closest to Attio's shape**, with three unique extras:

- **5 guided prompts** — nobody else ships these; they're all user-authored
  in Attio.
- **4 resources with slug completion** — Atomic CRM has 1 resource, Attio has
  none.
- **Discriminated-union tool results** — `_tag: 'sent' | 'suppressed'`,
  pattern-matchable by agents without string parsing. Strictly better than
  any observed OSS.

**Batuda's gaps.**

- **No `describe_schema` / `list_attribute_definitions` tool.** Fine for 30
  tools; won't scale if we add page templates or custom fields.
- **No OAuth-2.1 protected-resource metadata.** Claude Desktop and ChatGPT
  Apps want the `WWW-Authenticate: Bearer resource_metadata=…` dance for
  one-click install. Our session-cookie auth works for the Batuda web app but not for
  external connectors.
- **No meta-tool pattern.** Not blocking today; worth holding in mind past 50
  tools.
- **No interactive HTML widget resources.** Atomic CRM's `display_task_list`
  with embedded HTML UI is experimental but powerful for daily-briefing or
  pipeline views.

---

## 9. Patterns worth porting into Batuda

Each pattern maps to specific files in our repo and a priority.

### 9.1 High priority

1. **OAuth 2.1 protected-resource metadata on `/mcp`** — for Claude Desktop
   and ChatGPT one-click install.
   *Source*: [Atomic CRM MCP index](https://github.com/marmelab/atomic-crm/blob/main/supabase/functions/mcp/index.ts).
   *Target*: extend [`http.ts`](../apps/server/src/mcp/http.ts); add
   `/.well-known/oauth-protected-resource` endpoint; handle Bearer token
   exchange alongside existing session auth.
   *Why*: unlocks external agent clients without breaking the Batuda web app's cookie auth.

2. **Denormalised Interaction attributes** — `lastEmailInteractionAt`,
   `lastCallAt`, `nextCalendarEventAt` on `companies` and `contacts`, updated
   in email/calendar ingest.
   *Source*: [Attio interaction attribute type](https://docs.attio.com/docs/attribute-types/attribute-types-interaction).
   *Target*: extend [`companies.ts`](../packages/domain/src/schema/companies.ts)
   - [`contacts.ts`](../packages/domain/src/schema/contacts.ts); wire into
     [`email.ts`](../apps/server/src/services/email.ts); update
     [`0001_initial.ts`](../apps/server/src/db/migrations/0001_initial.ts) (pre-prod).
     *Why*: "people I haven't emailed in 30 days" becomes a one-filter query;
     agents pattern-match without joining threads. Cheap, high-leverage.

### 9.2 Medium priority

3. **Polymorphic `TimelineActivity` table** — unifies interactions, emails,
   documents, research as one audit/feed log.
   *Source*: [Twenty `TimelineActivity`](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/modules/timeline/standard-objects/timeline-activity.workspace-entity.ts).
   *Target*: new `packages/domain/src/schema/timeline-activity.ts`; migration;
   new MCP resource `batuda://timeline/{companyId}` in
   [`resources/`](../apps/server/src/mcp/resources/).
   *Why*: reduces feed-code duplication; matches Effect event-sourcing
   instincts.

4. **`ParticipantMatcher` service** — unified "find company by domain / contact
   by email, create-if-missing" path.
   *Source*: [Atomic CRM `addNoteToContact` + `extractMailContactData`](https://github.com/marmelab/atomic-crm/blob/main/supabase/functions/postmark/addNoteToContact.ts).
   *Target*: extract from [`email.ts`](../apps/server/src/services/email.ts)
   into new `apps/server/src/services/participant-matcher.ts`.
   *Why*: prep for LinkedIn/WhatsApp ingest; DRY current logic.

5. **Aggregate Postgres views** — `companies_summary`, `activity_log`
   (5-way `UNION ALL`) for list endpoints.
   *Source*: [Atomic CRM `03_views.sql`](https://github.com/marmelab/atomic-crm/blob/main/supabase/schemas/03_views.sql).
   *Target*: migration; simplify
   [`companies.ts`](../apps/server/src/services/companies.ts) and
   [`companies.ts`](../packages/controllers/src/routes/companies.ts) to read
   from views.
   *Why*: compresses join logic DB-side; agent queries become `SELECT * FROM
   companies_summary WHERE …`.

6. **Twenty's MCP meta-tool pattern** — add `list_tool_catalog` + `learn_tools`
   to our MCP.
   *Source*: [Twenty `mcp-protocol.service.ts`](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/api/mcp/services/mcp-protocol.service.ts).
   *Target*: [`server.ts`](../apps/server/src/mcp/server.ts); new
   `apps/server/src/mcp/tools/catalog.ts`.
   *Why*: pre-emptive; when we grow past 30 tools (page templates per company,
   per-client research profiles) context cost dominates.

7. **Folk's OpenAPI + community-MCP stance** — publish our HttpApi OpenAPI
   export publicly.
   *Source*: [Folk developer portal](https://developer.folk.app/api-reference/overview).
   *Target*: expose OpenAPI schema from
   [`api.ts`](../packages/controllers/src/api.ts) at a stable URL; document
   it; encourage community MCPs.
   *Why*: we don't need to ship every integration ourselves.

### 9.3 Lower priority / longer-term

8. **Monica's typed relationship edges with reverse names** — for Contact↔Contact
   (spouse, manager, mentor) and Company↔Company (subsidiary, partner, vendor).
   *Source*: [Monica `relationship_types` migration](https://github.com/monicahq/monica/tree/master/database/migrations).
   *Target*: new `packages/domain/src/schema/relationships.ts`; migration.
   *Why*: when agency work grows, "introduce Bob (CMO at X) to Carol (ex-CEO at
   Y via Bob)" needs a real graph edge, not a free-text notes field.

9. **Krayin's AI-intake pattern** — fixed output schema + pluggable model via
   OpenRouter.
   *Source*: [Krayin Magic AI Lead Creation](https://devdocs.krayincrm.com/2.1/advanced/ai-powered-lead-generation.html).
   *Target*: new `apps/server/src/services/ai-ingest.ts` for image/PDF →
   Company/Contact.
   *Why*: research already hits OpenRouter; same pattern for ingestion.

10. **SuiteCRM's workflow decomposition** (`trigger × scope × conditions ×
    actions`) — as a mental model for designing eventual task-automation UX.
    *Source*: [SuiteCRM AOW_WorkFlow docs](https://docs.suitecrm.com/user/advanced-modules/workflow/).
    *Target*: design reference only — no immediate code changes.
    *Why*: before building any rule engine, study the decomposition.

---

## 10. Patterns to explicitly reject

1. **Dynamic schema / user-defined objects** (Twenty, EspoCRM, NocoBase). Keep
   fixed schemas + `metadata: Unknown`. Twenty's `flat-*` module family is
   tens of kLOC of metadata diffing — wrong scale.

2. **Arbitrary-SQL MCP tools** (Atomic CRM `query` / `mutate`). Our typed
   per-verb tools are safer and more agent-discoverable. `SendEmailResult`
   discriminated union is strictly better than "parse SQL result".

3. **SFDC-shaped Account/Opportunity/Contact** (Reevo, Aurasell, Monaco). Our
   Company-first framing matches the agency register. Proposals stay as
   documents, not pipeline rows.

4. **Workflow-block AI** (Attio's Classify / Summarize / Prompt nodes). Agents
   orchestrate via MCP directly; block libraries are ceremony.

5. **Visual workflow builder** (Twenty's React Flow canvas, Attio's block
   library). Ship code-defined workflows + webhooks first; visual builders
   are a huge surface area with niche payoff for solo operators.

6. **GraphQL-first** (Twenty). Our HttpApi + MCP combo avoids Apollo + codegen
   tax. Twenty has had to patch TypeORM 0.3.20 and NestJS GraphQL 12.1.1 to
   make their stack work — a warning sign.

7. **AI credits pricing** (Aurasell $15k + 3M credits, Attio credit currency).
   Don't invent a credit unit; pass through LLM cost transparently (aligns
   with existing `research_paid_spend` model).

8. **Hardcoded pipeline stages in source** (Atomic CRM
   `defaultConfiguration.ts`). We're already ahead — `company.status` is data;
   don't regress.

9. **Marketplace / Zapier app / apps SDK** (Twenty). Publish OpenAPI + webhooks
   and let integrations be someone else's problem until paying customers ask.

10. **AGPL / source-available licensing** (Twenty, EspoCRM, SuiteCRM, NocoBase
    AGPL equivalents). Incompatible with a commercial workshop.

---

## 11. Design decisions validated and questioned

### 11.1 Validated (multiple CRMs converge here)

- **Relationship-first over deal-first** — Folk, Attio, Monica, Lightfield
  all converge here.
- **MCP as a primary agent surface** — Attio, Twenty, Atomic CRM, Lightfield
  all ship first-party.
- **Generic IMAP/SMTP transport for email; pluggable provider for storage**
  — bring-your-own mailbox (Infomaniak / Fastmail / M365 / Proton Bridge /
  Gmail Workspace) with a single transport, plus `StorageProvider` (S3/R2)
  for raw RFC822 + attachments.
- **Typed MCP tool results** — nobody does this as well as our `SendEmailResult`
  discriminated union.
- **Multi-tenant single deployment with RLS** — `app.current_org_id`
  GUC + Postgres RLS isolates orgs without Twenty's schema-per-workspace
  complexity.
- **HttpApi / OpenAPI-first** — aligns with Attio, Folk.
- **Company as primary entity** — contrasts with SFDC-shape CRMs; aligns with
  Folk and the agency register.

### 11.2 Questioned (deferred)

- **Split `Proposal` into `Deal` + `ProposalDocument`?** Deferred until the
  first v1 → v2 revision case appears in production. Until then, the split
  is speculative and adds a join to every proposal read.

- **Add a `Group` / `List` entity (Folk-style)?** Deferred.
  [`company.tags`](../packages/domain/src/schema/companies.ts) already covers
  ad-hoc segmentation. Revisit only when groups need first-class metadata
  (owner, shared-with, rules).

Resolved elsewhere: session-cookie MCP auth is folded into pattern #1
(§9.1) — cookies stay for the Batuda web app, OAuth 2.1 gets bolted on for external
clients. `MessageParticipant` and `ResearchRun` fold are moved into §11.3.

### 11.3 Decided (implementation scheduled)

Five patterns ship together in one cycle:

1. **Polymorphic `TimelineActivity`** — single event log for email, call,
   document, proposal, research, system events. Becomes the source of truth;
   [`interactions.ts`](../packages/domain/src/schema/interactions.ts) rows
   become system-derived summaries on top of the event log (preference: log
   everything, let the system project interactions).
2. **Fold `ResearchRun` into the timeline** — research emits
   `TimelineActivity` rows; cost data stays in `research_paid_spend` and
   `research_runs`. Timeline carries the event; research tables keep the
   economics.
3. **Explicit `MessageParticipant` entity** — one row per
   `(message, email_address, role)`. Preserves unknown CC'd senders and
   prepares LinkedIn / WhatsApp ingest.
4. **Denormalised interaction attributes** — `lastEmailAt`, `lastCallAt`,
   `lastMeetingAt`, `nextCalendarEventAt` on
   [`companies`](../packages/domain/src/schema/companies.ts) and
   [`contacts`](../packages/domain/src/schema/contacts.ts). Updated
   atomically with every `TimelineActivity` insert.
5. **`ParticipantMatcher` service** — discriminated-union result
   (`MatchedContact | MatchedCompanyOnly | CreatedContact | CreatedBoth |
   Ambiguous | NoMatch`) extracted from
   [`email.ts`](../apps/server/src/services/email.ts). Single entry point
   for all ingest channels.

---

## 12. Open research gaps

- **Lightfield's code-executing agent.** Docs are thin; pattern worth watching
  but not enough public detail to port. Revisit Q3 2026.
- **Monaco.** No public API / docs; evaluation based on marketing only.
- **Reevo's domain/inbox warming.** Infra bundling, not a code pattern we can
  lift directly.
- **Twenty's `flat-*` metadata diffing engine.** Impressive at scale; deliberately
  out of scope for a static-schema CRM.
- **MCP App / interactive HTML widgets.** Atomic CRM's `display_task_list` is
  the only live example. Experimental; worth prototyping a `display_pipeline`
  widget if browser-side interactivity in Claude Desktop matures.
- **Attio workflow block billing economics.** Their credit-metered model is
  public but the actual utility vs cost isn't clear from marketing.

---

## 13. Appendix — sources

### 13.1 Agent-native SaaS

**Attio** — [attio.com](https://attio.com) ·
[platform/ask](https://attio.com/platform/ask) ·
[platform/workflows](https://attio.com/platform/workflows) ·
[docs.attio.com/docs/overview](https://docs.attio.com/docs/overview) ·
[docs.attio.com/mcp/overview](https://docs.attio.com/mcp/overview) ·
[docs.attio.com/sdk/guides/creating-an-app](https://docs.attio.com/sdk/guides/creating-an-app) ·
[docs.attio.com/sdk/guides/ai](https://docs.attio.com/sdk/guides/ai) ·
[docs.attio.com/rest-api/guides/webhooks](https://docs.attio.com/rest-api/guides/webhooks) ·
[docs.attio.com/rest-api/endpoint-reference/openapi](https://docs.attio.com/rest-api/endpoint-reference/openapi) ·
[changelog](https://attio.com/changelog) ·
[blog: Introducing Attio AI Research Agent](https://attio.com/blog/introducing-attio-ai-research-agent) ·
[blog: Series B raise](https://attio.com/blog/attio-raises-52m-series-b) ·
[help: workflow block library](https://attio.com/help/reference/automations/workflows/workflows-block-library).

**Folk** — [folk.app](https://folk.app) ·
[folk.app/agency-crm](https://www.folk.app/agency-crm) ·
[folk.app/pipelines-management](https://www.folk.app/pipelines-management) ·
[folk.app/crm-for-x/lp/folkx-linkedin](https://www.folk.app/crm-for-x/lp/folkx-linkedin) ·
[developer.folk.app](https://developer.folk.app/api-reference/overview) ·
[developer.folk.app/llms.txt](https://developer.folk.app/llms.txt) ·
[NimbleBrainInc/mcp-folk](https://github.com/NimbleBrainInc/mcp-folk) ·
[joshuayoes/folk-crm-mcp](https://github.com/joshuayoes/folk-crm-mcp) ·
[Composio Folk toolkit](https://composio.dev/toolkits/folk).

**Reevo** — [reevo.ai](https://reevo.ai) ·
[reevo.ai/blog/ai-native-crm-guide](https://reevo.ai/blog/ai-native-crm-guide) ·
[reevoai.mintlify.app](https://reevoai.mintlify.app/CRM-configurations/Custom-Objects).

**Lightfield** — [lightfield.app](https://lightfield.app) ·
[docs.lightfield.app](https://docs.lightfield.app/) ·
[blog: Code execution in Lightfield](https://lightfield.app/blog/code-execution-in-lightfield) ·
[blog: Day AI review](https://lightfield.app/blog/day-ai-review) ·
[blog: Why we built Lightfield](https://lightfield.app/blog/why-we-built-lightfield).

**Aurasell** — [aurasell.ai](https://www.aurasell.ai) ·
[pricing](https://www.aurasell.ai/pricing) ·
[use-case/sell](https://www.aurasell.ai/use-case/sell) ·
[use-case/manage](https://www.aurasell.ai/use-case/manage).

**Monaco** — [SaaStr: follow the agents](https://www.saastr.com/which-crm-should-you-use-in-2026-2027-follow-the-agents/) ·
[paperclipped.de review](https://www.paperclipped.de/en/blog/monaco-ai-native-crm-sales-platform/).

**SaaStr category reference** —
[Which CRM should you use in 2026–2027? Follow the agents](https://www.saastr.com/which-crm-should-you-use-in-2026-2027-follow-the-agents/) ·
[Meet the leaders of the agentic CRM revolution](https://www.saastr.com/meet-the-leaders-of-the-agentic-crm-revolution-at-saastr-ai-annual-2026/).

### 13.2 Modern open-source

**Twenty** — [github.com/twentyhq/twenty](https://github.com/twentyhq/twenty) ·
[twenty.com](https://twenty.com) ·
[developers docs](https://twenty.com/developers) ·
[twenty-server](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server) ·
[object-metadata entity](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/metadata-modules/object-metadata/object-metadata.entity.ts) ·
[field-metadata entity](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/metadata-modules/field-metadata/field-metadata.entity.ts) ·
[workspace-datasource.service](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/workspace-datasource/workspace-datasource.service.ts) ·
[MCP controller](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/api/mcp/controllers/mcp-core.controller.ts) ·
[MCP protocol service](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/api/mcp/services/mcp-protocol.service.ts) ·
[Skill entity](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/metadata-modules/skill/entities/skill.entity.ts) ·
[TimelineActivity](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/modules/timeline/standard-objects/timeline-activity.workspace-entity.ts) ·
[Workflow AI agent action](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/modules/workflow/workflow-executor/workflow-actions/ai-agent/ai-agent.workflow-action.ts) ·
[Automated trigger settings](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/modules/workflow/workflow-trigger/automated-trigger/constants/automated-trigger-settings.ts) ·
[Zapier app](https://github.com/twentyhq/twenty/tree/main/packages/twenty-zapier) ·
[Community apps](https://github.com/twentyhq/twenty/tree/main/packages/twenty-apps/community).

**Atomic CRM** — [github.com/marmelab/atomic-crm](https://github.com/marmelab/atomic-crm) ·
[marmelab.com/atomic-crm](https://marmelab.com/atomic-crm/) ·
[AGENTS.md](https://github.com/marmelab/atomic-crm/blob/main/AGENTS.md) ·
[CLAUDE.md](https://github.com/marmelab/atomic-crm/blob/main/CLAUDE.md) ·
[App.tsx](https://github.com/marmelab/atomic-crm/blob/main/src/App.tsx) ·
[defaultConfiguration.ts](https://github.com/marmelab/atomic-crm/blob/main/src/components/atomic-crm/root/defaultConfiguration.ts) ·
[01_tables.sql](https://github.com/marmelab/atomic-crm/blob/main/supabase/schemas/01_tables.sql) ·
[03_views.sql](https://github.com/marmelab/atomic-crm/blob/main/supabase/schemas/03_views.sql) ·
[05_policies.sql](https://github.com/marmelab/atomic-crm/blob/main/supabase/schemas/05_policies.sql) ·
[MCP function](https://github.com/marmelab/atomic-crm/blob/main/supabase/functions/mcp/index.ts) ·
[Postmark function](https://github.com/marmelab/atomic-crm/blob/main/supabase/functions/postmark/index.ts) ·
[mcp-server docs page](https://github.com/marmelab/atomic-crm/blob/main/doc/src/content/docs/users/mcp-server.mdx).

### 13.3 Legacy / reference open-source

**EspoCRM** — [github.com/espocrm/espocrm](https://github.com/espocrm/espocrm) ·
[entity-manager docs](https://docs.espocrm.com/administration/entity-manager/) ·
[fields docs](https://docs.espocrm.com/administration/fields/) ·
[roles-management](https://docs.espocrm.com/administration/roles-management/) ·
[entity defs](https://github.com/espocrm/espocrm/tree/master/application/Espo/Modules/Crm/Resources/metadata/entityDefs).

**Krayin** — [github.com/krayin/laravel-crm](https://github.com/krayin/laravel-crm) ·
[Attribute migrations](https://github.com/krayin/laravel-crm/tree/master/packages/Webkul/Attribute/src/Database/Migrations) ·
[AI lead-gen dev docs](https://devdocs.krayincrm.com/2.1/advanced/ai-powered-lead-generation.html) ·
[v2.1 release notes](https://krayincrm.com/whats-new-in-krayin-2-1-0/).

**SuiteCRM** — [github.com/salesagility/SuiteCRM](https://github.com/salesagility/SuiteCRM) ·
[modules listing](https://github.com/salesagility/SuiteCRM/tree/master/modules) ·
[Workflow docs (AOW_WorkFlow)](https://docs.suitecrm.com/user/advanced-modules/workflow/).

**OroCRM** — [github.com/oroinc/crm](https://github.com/oroinc/crm) ·
[ChannelBundle README](https://github.com/oroinc/crm/blob/master/src/Oro/Bundle/ChannelBundle/README.md) ·
[src/Oro/Bundle listing](https://github.com/oroinc/crm/tree/master/src/Oro/Bundle).

**NocoBase** — [github.com/nocobase/nocobase](https://github.com/nocobase/nocobase) ·
[CRM 2.0 solution](https://docs.nocobase.com/solution/crm).

**NocoDB** — [github.com/nocodb/nocodb](https://github.com/nocodb/nocodb).

**Monica** — [github.com/monicahq/monica](https://github.com/monicahq/monica) ·
[database/migrations](https://github.com/monicahq/monica/tree/master/database/migrations).

### 13.4 Batuda code references (internal)

Domain: [`packages/domain/src/schema/`](../packages/domain/src/schema/) —
[`companies.ts`](../packages/domain/src/schema/companies.ts) ·
[`contacts.ts`](../packages/domain/src/schema/contacts.ts) ·
[`interactions.ts`](../packages/domain/src/schema/interactions.ts) ·
[`proposals.ts`](../packages/domain/src/schema/proposals.ts) ·
[`tasks.ts`](../packages/domain/src/schema/tasks.ts) ·
[`documents.ts`](../packages/domain/src/schema/documents.ts) ·
[`pages.ts`](../packages/domain/src/schema/pages.ts) ·
[`call-recordings.ts`](../packages/domain/src/schema/call-recordings.ts) ·
[`email-messages.ts`](../packages/domain/src/schema/email-messages.ts) ·
[`email-thread-links.ts`](../packages/domain/src/schema/email-thread-links.ts) ·
[`products.ts`](../packages/domain/src/schema/products.ts) ·
[`api-keys.ts`](../packages/domain/src/schema/api-keys.ts) ·
[`webhook-endpoints.ts`](../packages/domain/src/schema/webhook-endpoints.ts).

Controllers: [`packages/controllers/src/`](../packages/controllers/src/) —
[`api.ts`](../packages/controllers/src/api.ts) ·
[`middleware/session.ts`](../packages/controllers/src/middleware/session.ts) ·
[`routes/`](../packages/controllers/src/routes/).

Services: [`apps/server/src/services/`](../apps/server/src/services/) —
[`companies.ts`](../apps/server/src/services/companies.ts) ·
[`pipeline.ts`](../apps/server/src/services/pipeline.ts) ·
[`email.ts`](../apps/server/src/services/email.ts) ·
[`mail-transport.ts`](../apps/server/src/services/mail-transport.ts) ·
[`credential-crypto.ts`](../apps/server/src/services/credential-crypto.ts) ·
[`email-attachment-staging.ts`](../apps/server/src/services/email-attachment-staging.ts) ·
[`storage-provider.ts`](../apps/server/src/services/storage-provider.ts) ·
[`s3-storage-provider.ts`](../apps/server/src/services/s3-storage-provider.ts) ·
[`pages.ts`](../apps/server/src/services/pages.ts) ·
[`page-slug.ts`](../apps/server/src/services/page-slug.ts) ·
[`recordings.ts`](../apps/server/src/services/recordings.ts) ·
[`geocoder.ts`](../apps/server/src/services/geocoder.ts) ·
[`webhooks.ts`](../apps/server/src/services/webhooks.ts) ·
[`local-inbox-provider.ts`](../apps/server/src/services/local-inbox-provider.ts).

MCP: [`apps/server/src/mcp/`](../apps/server/src/mcp/) —
[`server.ts`](../apps/server/src/mcp/server.ts) ·
[`http.ts`](../apps/server/src/mcp/http.ts) ·
[`current-user.ts`](../apps/server/src/mcp/current-user.ts) ·
[`tools/`](../apps/server/src/mcp/tools/) ·
[`resources/`](../apps/server/src/mcp/resources/) ·
[`prompts/`](../apps/server/src/mcp/prompts/).

Database: [`apps/server/src/db/migrations/0001_initial.ts`](../apps/server/src/db/migrations/0001_initial.ts).

---

*Last updated: 2026-04-18. Status: research note, not scheduled.*
