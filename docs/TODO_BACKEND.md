# TODO — Backend

Ordered implementation checklist for `apps/server` and `packages/domain`.
See [backend.md](backend.md) for patterns. See [architecture.md](architecture.md) for context.

---

## Phase 1 — Repo foundation

- [ ] Init git repo, pnpm-workspace.yaml, root package.json
- [ ] Add `.gitignore`, `.env.example`
- [ ] Add `tsconfig.base.json` at root — `moduleResolution: bundler`, strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- [ ] Add `biome.json` at root — run `pnpm add -D @biomejs/biome@latest`, then `biome init` and customise: spaces/2, lineWidth 100, single quotes, noUnusedImports error
- [ ] Add `@biomejs/biome` devDependency to root `package.json` (pin to installed version)
- [ ] Add root scripts: `lint`, `format`, `check` (all via `biome`)
- [ ] Write `flake.nix` (Node 24 + pnpm + kraft) — fill kraft binary hash after nix-prefetch
- [ ] Run `nix develop` and verify environment

### Local services — `docker/`

Docker Compose files for local development services. Each service gets its own directory.

- [ ] Create `docker/postgres/docker-compose.yml`:
  ```yaml
  services:
    postgres:
      image: postgres:17-alpine
      ports: ["5432:5432"]
      environment:
        POSTGRES_DB: engranatge
        POSTGRES_USER: engranatge
        POSTGRES_PASSWORD: engranatge
      volumes:
        - postgres-data:/var/lib/postgresql/data
  volumes:
    postgres-data:
  ```
- [ ] Add root script: `"db:up": "docker compose -f docker/postgres/docker-compose.yml up -d"`
- [ ] Add root script: `"db:down": "docker compose -f docker/postgres/docker-compose.yml down"`
- [ ] Add `DATABASE_URL=postgresql://engranatge:engranatge@localhost:5432/engranatge` to `.env.example`
- [ ] Run `pnpm db:up` and verify Postgres accessible

## Phase 2 — packages/domain

Effect Schema types. No runtime DB connection — just definitions.

- [ ] Create `packages/domain/package.json` — `@engranatge/domain`
  - [ ] deps: `effect`
  - [ ] devDeps: `tsdown`, `typescript`
- [ ] Create `packages/domain/tsconfig.json` extending `../../tsconfig.base.json`, lib ESNext only (no DOM)
- [ ] Write Effect Schema: `companies.ts`
- [ ] Write Effect Schema: `contacts.ts`
- [ ] Write Effect Schema: `interactions.ts`
- [ ] Write Effect Schema: `tasks.ts`
- [ ] Write Effect Schema: `products.ts`
- [ ] Write Effect Schema: `proposals.ts`
- [ ] Write Effect Schema: `documents.ts`
- [ ] Write Effect Schema: `pages.ts`
- [ ] Write Effect Schema: `api-keys.ts`
- [ ] Write Effect Schema: `webhook-endpoints.ts`
- [ ] Write Effect Schema: `email-thread-links.ts` — `id`, `agentmailThreadId` (text, unique), `agentmailInboxId` (text), `companyId` (FK nullable), `contactId` (FK nullable), `status` (text: open|closed|archived, default open), `createdAt`, `updatedAt`
- [ ] Write `schema/index.ts` re-exporting all tables
- [ ] Write `src/index.ts` — re-exports schema + Effect Schema types

## Phase 2b — packages/controllers (shared API spec)

Shared `HttpApiGroup` definitions, request/response schemas, error types, and middleware specs.
Both server (live implementations) and frontend (derived client) import from this package.
Pattern: Xiroi `@xiroi/library-controllers`.

- [ ] Create `packages/controllers/package.json` — `@engranatge/controllers`
  - [ ] peerDeps: `@effect/platform`, `@engranatge/domain`, `effect`
  - [ ] devDeps: `tsdown`, `typescript`, `vitest`
- [ ] Create `packages/controllers/tsconfig.json` extending `../../tsconfig.base.json`, lib ESNext only (no DOM)
- [ ] Create `src/errors.ts` — shared tagged error schemas:
  - [ ] `Unauthorized` (401), `Forbidden` (403), `NotFound` (404), `BadRequest` (400), `InternalServerError` (500)
- [ ] Create `src/middleware.ts` — `ApiKeyMiddleware` spec (provides authenticated API key context)
- [ ] Create endpoint group files — each with request/response schemas + `HttpApiEndpoint` definitions + `HttpApiGroup` class:
  - [ ] `src/companies.ts` — `CompanyCreateRequest`, `CompanyUpdateRequest`, `CompanyListQuery`, `CompanyListResponse`, `ApiGroupCompanies`
  - [ ] `src/contacts.ts` — `ContactCreateRequest`, `ContactUpdateRequest`, `ApiGroupContacts`
  - [ ] `src/interactions.ts` — `InteractionCreateRequest`, `InteractionListQuery`, `ApiGroupInteractions`
  - [ ] `src/tasks.ts` — `TaskCreateRequest`, `TaskUpdateRequest`, `TaskListQuery`, `ApiGroupTasks`
  - [ ] `src/documents.ts` — `DocumentCreateRequest`, `DocumentUpdateRequest`, `DocumentListQuery`, `ApiGroupDocuments`
  - [ ] `src/products.ts` — `ProductCreateRequest`, `ProductUpdateRequest`, `ApiGroupProducts`
  - [ ] `src/proposals.ts` — `ProposalCreateRequest`, `ProposalUpdateRequest`, `ApiGroupProposals`
  - [ ] `src/pages.ts` — `PageCreateRequest`, `PageUpdateRequest`, `ApiGroupPages` (public + internal endpoints)
  - [ ] `src/webhooks.ts` — `WebhookEndpointCreateRequest`, `WebhookEndpointUpdateRequest`, `ApiGroupWebhooks`
  - [ ] `src/pipeline.ts` — `PipelineResponse`, `ApiGroupPipeline`
  - [ ] `src/emails.ts` — `EmailSendRequest` (includes `inboxId`), `EmailReplyRequest`, `EmailThreadListQuery` (filterable by `inboxId`, `companyId`), `EmailThreadResponse`, `EmailThreadDetailResponse`, `InboxResponse`, `ApiGroupEmails`
  - [ ] `src/email-webhooks.ts` — `AgentMailInboundPayload`, `ApiGroupEmailWebhooks` (no API key middleware — webhook auth only)
- [ ] Create `src/api.ts` — combined `EngranatgeApi` spec:
  ```ts
  export const EngranatgeApi = HttpApi.make('EngranatgeApi')
    .add(ApiGroupCompanies)
    .add(ApiGroupContacts)
    .add(ApiGroupInteractions)
    .add(ApiGroupEmails)
    // ... all groups
    .middleware(ApiKeyMiddleware)
    .annotate(OpenApi.Title, 'Engranatge API')
  ```
- [ ] Create `src/index.ts` — re-exports all groups, schemas, errors, middleware, and `EngranatgeApi`
- [ ] Write schema validation tests for each request/response type (vitest)

## Phase 3 — apps/server setup

- [ ] Create `apps/server/package.json`
  - [ ] deps: `@engranatge/domain`, `@engranatge/controllers`, `effect`, `@effect/platform-node`, `@effect/sql-pg`, `agentmail`
  - [ ] devDeps: `typescript`
- [ ] Create `apps/server/tsconfig.json` extending `../../tsconfig.base.json`, lib ESNext only (no DOM)
- [ ] Install Effect v4 dependencies — verify package names/versions on npm
- [ ] Create `src/db/client.ts` — PgClient layer from `DATABASE_URL`:
  ```ts
  import { PgClient } from '@effect/sql-pg'
  import { Config } from 'effect'

  export const PgLive = PgClient.layerConfig({
    url: Config.redacted('DATABASE_URL'),
  })
  ```
- [x] ~~Create `src/db/drizzle.ts`~~ — removed, using Effect SQL directly via `SqlClient`
- [ ] Create `src/db/migrator.ts` — Effect Migrator for PostgreSQL:
  ```ts
  import * as PgMigrator from '@effect/sql-pg/PgMigrator'
  import { Layer } from 'effect'
  import { fileURLToPath } from 'node:url'
  import { PgLive } from './client'

  export const MigratorLive = PgMigrator.layer({
    loader: PgMigrator.fromFileSystem(
      fileURLToPath(new URL('migrations', import.meta.url))
    ),
  }).pipe(Layer.provide(PgLive))
  ```
- [ ] Create `src/db/migrations/` directory for Effect SQL migration files
- [ ] Create initial migration `src/db/migrations/0001_initial.ts` — all tables from `@engranatge/domain`
- [ ] Create `src/db/migrate.ts` — CLI entry point that runs `MigratorLive`
- [ ] Add root script: `"db:migrate": "pnpm --filter @engranatge/server run migrate"`
- [ ] Implement `src/main.ts` skeleton — Effect HTTP server using `PgLive` + `MigratorLive` from `./db/` (runs migrations on startup)
- [ ] Run `pnpm db:up` then `pnpm db:migrate` — verify tables created in local Postgres
- [ ] Verify server starts with `pnpm db:up && pnpm dev:server`

## Phase 4 — API key middleware

- [ ] Implement `src/middleware/api-key.ts` — live implementation of `ApiKeyMiddleware` from `@engranatge/controllers`
  - Read `x-api-key` header
  - SHA-256 hash and query `api_keys` table
  - Check `is_active`, check `expires_at`
  - Fire-and-forget update of `last_used_at`
  - Return 401 on failure with no detail
- [ ] Seed one API key in DB manually for testing
- [ ] Test middleware rejects missing/wrong key, accepts correct key

## Phase 5 — Live API handlers

Specs (schemas, endpoints, groups) live in `@engranatge/controllers`.
Server provides live implementations via `HttpApiBuilder.group()`.

For each entity:

1. Import the group from `@engranatge/controllers`
2. Implement service (business logic + Effect SQL queries)
3. Implement live handler with `HttpApiBuilder.group(ApiSpec, 'GroupName', handlers => ...)`
4. Register in `ApiLive` layer

```
src/api/
  specs/api.ts        — imports groups from @engranatge/controllers + server-only groups (health)
  live/api.ts          — ApiLive = HttpApiBuilder.api(ApiSpec).pipe(Layer.provide(...))
  live/companies.ts    — CompaniesLive = HttpApiBuilder.group(ApiSpec, 'Companies', ...)
  live/contacts.ts     — ContactsLive
  ...
```

- [ ] Create `src/api/specs/api.ts` — imports `EngranatgeApi` groups + adds server-only groups (health)
- [ ] Create `src/api/live/api.ts` — `ApiLive` composing all handler layers
- [ ] `live/companies.ts` — handle listCompanies, getCompany, createCompany, updateCompany
- [ ] `live/contacts.ts` — handle listContacts, createContact, updateContact, deleteContact
- [ ] `live/interactions.ts` — handle listInteractions, createInteraction (+ auto-update last_contacted_at)
- [ ] `live/tasks.ts` — handle listTasks, createTask, updateTask (complete)
- [ ] `live/documents.ts` — handle listDocuments (no content), getDocument (with content), createDocument, updateDocument
- [ ] `live/products.ts` — handle listProducts, createProduct, updateProduct
- [ ] `live/proposals.ts` — handle listProposals, createProposal, updateProposal
- [ ] `live/pages.ts` — handle getPageBySlug (public), viewPage (public), listPages (internal), createPage, updatePage, publishPage, deletePage
- [ ] `live/webhooks.ts` — handle listWebhookEndpoints, createWebhookEndpoint, updateWebhookEndpoint, deleteWebhookEndpoint, testWebhookEndpoint
- [ ] `live/pipeline.ts` — handle getPipeline
- [ ] `live/emails.ts` — handle listInboxes, sendEmail (from specific inbox), replyEmail, listThreads (filterable by inbox + company), getThread, updateThreadLink
- [ ] `live/email-webhooks.ts` — handle AgentMail inbound webhook (`POST /webhooks/agentmail/inbound`, no API key middleware)
- [ ] `live/health.ts` — server-only health check endpoint

## Phase 6 — Services

- [ ] `services/companies.ts` — search (filters + pagination), findBySlug, create, update, updateStatus
- [ ] `services/email-provider.ts` — abstract `EmailProvider` as `Context.Tag` (decoupled from AgentMail):
  - `send(inboxId, params)` → `Effect<{messageId, threadId}, EmailSendError>`
  - `reply(inboxId, messageId, params)` → `Effect<{messageId, threadId}, EmailSendError>`
  - `listThreads(inboxId, params?)` → `Effect<ThreadItem[], EmailError>`
  - `getThread(inboxId, threadId)` → `Effect<Thread, EmailError>`
  - `listMessages(inboxId, params?)` → `Effect<Message[], EmailError>`
  - `getMessage(inboxId, messageId)` → `Effect<Message, EmailError>`
  - `listInboxes()` → `Effect<Inbox[], EmailError>`
  - `createInbox(params)` → `Effect<Inbox, EmailError>`
  - `updateLabels(inboxId, messageId, add, remove)` → `Effect<void, EmailError>`
- [ ] `services/agentmail-provider.ts` — `AgentMailProviderLive` layer implementing `EmailProvider`:
  - dep: `agentmail` npm package
  - Config: `AGENTMAIL_API_KEY` via `Effect.Config`
  - Wraps SDK calls in `Effect.tryPromise`
  - Thin layer, no business logic — only maps SDK types to Effect
- [ ] `services/email.ts` — `EmailService` (ServiceMap.Service) depends on `EmailProvider` (Tag) + `SqlClient`:
  - [ ] `send(to, subject, html, companyId, contactId?)` — sends via provider, creates/updates `email_thread_links` row, creates interaction (channel:email, direction:outbound), updates company.lastContactedAt, tags with AgentMail label `crm:company:{id}`
  - [ ] `reply(agentmailThreadId, messageId, html)` — replies via provider, creates interaction, updates company.lastContactedAt
  - [ ] `handleInboundWebhook(payload)` — receives AgentMail `message.received` webhook, matches sender to contact by email, creates/updates thread link, creates interaction (channel:email, direction:inbound), updates company.lastContactedAt, fires internal webhook
  - [ ] `getThread(agentmailThreadId)` — fetches from provider, enriches with company/contact from `email_thread_links`
  - [ ] `listThreads(inboxId?, companyId?)` — if companyId, query thread_links first then fetch from provider; if inboxId, scope to that inbox; otherwise fetch all and join with links
  - [ ] `listInboxes()` — returns all configured inboxes from provider
- [ ] `services/webhooks.ts` — fireWebhooks(event, payload) fire-and-forget fan-out
- [ ] `services/pages.ts` — create, update, publish, archive, getBySlug(slug, lang), list(filters), incrementView
- [ ] `services/pipeline.ts` — getCounts(), getOverdue(), getNextSteps(limit)
- [ ] Wire webhook firing into: company status change, interaction created, email sent/received, proposal status change, task completed, page published
- [ ] Add `AGENTMAIL_API_KEY` to `.env.example` (inboxes discovered via `listInboxes()`, no hardcoded IDs)

## Phase 7 — MCP server

- [ ] Verify `@effect/experimental` exports `McpServer` in v4 (may be `@effect/mcp`)
- [ ] Create `src/mcp/server.ts` — McpServer definition
      Context efficiency: all MCP tool responses are optimised for LLM context windows.
      All list tools accept `limit` (default 10) + `cursor` for pagination.
      Email tools return `extractedText` (reply-stripped plain text), never raw HTML.

- [ ] Implement tool: `search_companies` (limit default 10)
- [ ] Implement tool: `get_company_brief` — compact ~500 token summary: company info + contact names + last 3 interaction one-liners + open task count + unread thread count. The default "what do I need to know" call.
- [ ] Implement tool: `get_company` — full detail: company + contacts + last 5 interactions + open tasks (no documents, no email bodies)
- [ ] Implement tool: `create_company`
- [ ] Implement tool: `update_company`
- [ ] Implement tool: `log_interaction` (creates interaction + updates company last_contacted_at + next_action)
- [ ] Implement tool: `get_documents` (list only — type + title + date, no content; limit default 10)
- [ ] Implement tool: `get_document` (full content)
- [ ] Implement tool: `create_document`
- [ ] Implement tool: `update_document`
- [ ] Implement tool: `create_task`
- [ ] Implement tool: `complete_task`
- [ ] Implement tool: `get_pipeline`
- [ ] Implement tool: `get_next_steps`
- [ ] Implement tool: `create_page`
- [ ] Implement tool: `update_page`
- [ ] Implement tool: `publish_page`
- [ ] Implement tool: `list_pages` (limit default 10)
- [ ] Implement tool: `get_page`
- [ ] Implement tool: `send_email` — send email to contact, auto-logs interaction
- [ ] Implement tool: `reply_email` — reply to a thread
- [ ] Implement tool: `list_email_threads` — subject + participants + date + message count, no bodies; filterable by inbox/company (limit default 10)
- [ ] Implement tool: `get_email_thread` — full thread with messages as `extractedText` (reply-stripped plain text, not HTML)
- [ ] Implement resource: `batuda://company/{slug}`
- [ ] Implement resource: `batuda://pipeline`

## Phase 8 — MCP transports

- [ ] Implement `src/mcp-stdio.ts` — stdio transport for Claude Code
- [ ] Write `.mcp.json` pointing to `mcp-stdio.ts`
- [ ] Test: open Claude Code, run `/mcp`, verify batuda tools listed
- [ ] Implement HTTP/SSE transport on `/mcp` route — Bearer token from `MCP_SECRET`
- [ ] Test remote MCP with a tunneled URL (Cloudflare Tunnel or ngrok)

## Phase 9 — Unikraft deployment

- [ ] Write `apps/server/Kraftfile` — spec v0.6, `runtime: node:latest`, scale-to-zero labels, `rootfs: ./Dockerfile`, `cmd: ["/usr/bin/node", "/app/dist/main.js"]` (see PLAN.md § Kraftfile)
- [ ] Write `apps/server/Dockerfile` — two-stage Node 24 alpine build, `NODE_OPTIONS=--no-network-family-autoselection`, corepack pnpm, copy monorepo, build domain+server, runtime stage copies only dist/ (see PLAN.md § Dockerfile)
- [ ] Run `kraft build` locally and verify image builds
- [ ] Run `kraft run` locally and verify HTTP server responds
- [ ] Deploy to Unikraft Cloud and verify
- [ ] Point `api.engranatge.com` to deployed instance

## Phase 10 — Seed data

- [ ] Create at least one `products` row: delivery notes automation
- [ ] Create one `api_keys` row for local n8n testing
- [ ] Create one `webhook_endpoints` row pointing to local n8n
- [ ] Test end-to-end: create company via MCP → verify webhook fires to n8n

## Phase 10b — AgentMail setup

- [ ] Sign up for AgentMail, get API key
- [ ] Add `engranatge.com` domain via `client.domains.create({ domain: "engranatge.com" })`
- [ ] Configure DNS at Spaceship — MX, SPF, DKIM records from `client.domains.get(domainId).records`
  ```
  engranatge.com  MX    → (from AgentMail domain verification)
  engranatge.com  TXT   → SPF (from AgentMail)
  engranatge.com  CNAME → DKIM (from AgentMail)
  engranatge.com  TXT   → DMARC v=DMARC1; p=quarantine
  ```
- [ ] Verify domain via `client.domains.verify(domainId)`
- [ ] Create inboxes:
  - `client.inboxes.create({ username: "guillem", domain: "engranatge.com" })` → `guillem@engranatge.com` (personal)
  - `client.inboxes.create({ username: "info", domain: "engranatge.com" })` → `info@engranatge.com` (system/CRM)
- [ ] Create AgentMail webhook: `client.webhooks.create({ url: "https://api.engranatge.com/webhooks/agentmail/inbound", eventTypes: ["message.received"] })`
- [ ] Store `AGENTMAIL_API_KEY` in production env
- [ ] Test end-to-end: send email via MCP → verify delivered + thread link created
