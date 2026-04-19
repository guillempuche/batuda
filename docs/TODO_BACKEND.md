# TODO — Backend

Ordered implementation checklist for `apps/server` and `packages/domain`.
See [backend.md](backend.md) for patterns. See [architecture.md](architecture.md) for context.

---

## Phase 1 — Repo foundation

- [x] Init git repo, pnpm-workspace.yaml, root package.json
- [x] Add `.gitignore`, `.env.example`
- [x] Add `tsconfig.base.json` at root — `moduleResolution: bundler`, strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- [x] Add `biome.json` at root — run `pnpm add -D @biomejs/biome@latest`, then `biome init` and customise: spaces/2, lineWidth 100, single quotes, noUnusedImports error
- [x] Add `@biomejs/biome` devDependency to root `package.json` (pin to installed version)
- [x] Add root scripts: `lint`, `format`, `check` (all via `biome`)
- [x] Write `flake.nix` (Node 24 + pnpm + kraft) — fill kraft binary hash after nix-prefetch
- [x] Run `nix develop` and verify environment

### Local services — `docker/`

Docker Compose files for local development services. Each service gets its own directory.

- [x] Create `docker/docker-compose.yml`:
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
- [x] Add root script: `"db:up": "docker compose -f docker/docker-compose.yml up -d"`
- [x] Add root script: `"db:down": "docker compose -f docker/docker-compose.yml down"`
- [x] Add `DATABASE_URL=postgresql://engranatge:engranatge@localhost:5432/engranatge` to `.env.example`
- [x] Run `pnpm db:up` and verify Postgres accessible

## Phase 2 — packages/domain

Effect Schema types. No runtime DB connection — just definitions.

- [x] Create `packages/domain/package.json` — `@engranatge/domain`
  - [x] deps: `effect`
  - [x] devDeps: `tsdown`, `typescript`
- [x] Create `packages/domain/tsconfig.json` extending `../../tsconfig.base.json`, lib ESNext only (no DOM)
- [x] Write Effect Schema: `companies.ts`
- [x] Write Effect Schema: `contacts.ts`
- [x] Write Effect Schema: `interactions.ts`
- [x] Write Effect Schema: `tasks.ts`
- [x] Write Effect Schema: `products.ts`
- [x] Write Effect Schema: `proposals.ts`
- [x] Write Effect Schema: `documents.ts`
- [x] Write Effect Schema: `pages.ts`
- [x] Write Effect Schema: `api-keys.ts`
- [x] Write Effect Schema: `webhook-endpoints.ts`
- [x] Write Effect Schema: `email-thread-links.ts` — `id`, `provider` (text), `providerThreadId` (text, unique), `providerInboxId` (text), `companyId` (FK nullable), `contactId` (FK nullable), `status` (text: open|closed|archived, default open), `createdAt`, `updatedAt`
- [x] Write `schema/index.ts` re-exporting all tables
- [x] Write `src/index.ts` — re-exports schema + Effect Schema types

## Phase 2b — packages/controllers (shared API spec)

Shared `HttpApiGroup` definitions, request/response schemas, error types, and middleware specs.
Both server (live implementations) and frontend (derived client) import from this package.
Pattern: Xiroi `@xiroi/library-controllers`.

- [x] ~~Create `packages/controllers/package.json`~~ — co-located in `apps/server/src/routes/` instead
  - [x] ~~peerDeps~~ — server deps cover this
  - [x] ~~devDeps~~ — server devDeps cover this
- [x] ~~Create `packages/controllers/tsconfig.json`~~ — server tsconfig covers this
- [x] Create `src/errors.ts` — shared tagged error schemas:
  - [x] `Unauthorized` (401), `NotFound` (404), `BadRequest` (400)
- [x] Create `src/middleware.ts` — `SessionMiddleware` spec (provides authenticated session context)
- [x] Create endpoint group files — each with request/response schemas + `HttpApiEndpoint` definitions + `HttpApiGroup` class:
  - [x] `src/companies.ts` — `CompanyCreateRequest`, `CompanyUpdateRequest`, `CompanyListQuery`, `CompanyListResponse`, `ApiGroupCompanies`
  - [x] `src/contacts.ts` — `ContactCreateRequest`, `ContactUpdateRequest`, `ApiGroupContacts`
  - [x] `src/interactions.ts` — `InteractionCreateRequest`, `InteractionListQuery`, `ApiGroupInteractions`
  - [x] `src/tasks.ts` — `TaskCreateRequest`, `TaskUpdateRequest`, `TaskListQuery`, `ApiGroupTasks`
  - [x] `src/documents.ts` — `DocumentCreateRequest`, `DocumentUpdateRequest`, `DocumentListQuery`, `ApiGroupDocuments`
  - [x] `src/products.ts` — `ProductCreateRequest`, `ProductUpdateRequest`, `ApiGroupProducts`
  - [x] `src/proposals.ts` — `ProposalCreateRequest`, `ProposalUpdateRequest`, `ApiGroupProposals`
  - [x] `src/pages.ts` — `PageCreateRequest`, `PageUpdateRequest`, `ApiGroupPages` (public + internal endpoints)
  - [x] `src/webhooks.ts` — `WebhookEndpointCreateRequest`, `WebhookEndpointUpdateRequest`, `ApiGroupWebhooks`
  - [ ] `src/pipeline.ts` — `PipelineResponse`, `ApiGroupPipeline`
  - [x] ~~`src/emails.ts` — `EmailSendRequest` (includes `inboxId`), `EmailReplyRequest`, `EmailThreadListQuery` (filterable by `inboxId`, `companyId`), `EmailThreadResponse`, `EmailThreadDetailResponse`, `InboxResponse`, `ApiGroupEmails`~~ — co-located in `apps/server/src/routes/email.ts`
  - [x] ~~`src/email-webhooks.ts` — `AgentMailInboundPayload`, `ApiGroupEmailWebhooks` (no API key middleware — webhook auth only)~~ — co-located in `apps/server/src/routes/agentmail-webhook.ts`
- [x] Create `src/api.ts` — combined `EngranatgeApi` spec:
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
- [x] Create `src/index.ts` — re-exports all groups, schemas, errors, middleware, and `EngranatgeApi`
- [ ] Write schema validation tests for each request/response type (vitest)

## Phase 3 — apps/server setup

- [x] Create `apps/server/package.json`
  - [x] deps: `@engranatge/domain`, `@engranatge/controllers`, `effect`, `@effect/platform-node`, `@effect/sql-pg`, `agentmail`
  - [x] devDeps: `typescript`
- [x] Create `apps/server/tsconfig.json` extending `../../tsconfig.base.json`, lib ESNext only (no DOM)
- [x] Install Effect v4 dependencies — verify package names/versions on npm
- [x] Create `src/db/client.ts` — PgClient layer from `DATABASE_URL`:
  ```ts
  import { PgClient } from '@effect/sql-pg'
  import { Config } from 'effect'

  export const PgLive = PgClient.layerConfig({
    url: Config.redacted('DATABASE_URL'),
  })
  ```
- [x] ~~Create `src/db/drizzle.ts`~~ — removed, using Effect SQL directly via `SqlClient`
- [x] Create `src/db/migrator.ts` — Effect Migrator for PostgreSQL:
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
- [x] Create `src/db/migrations/` directory for Effect SQL migration files
- [x] Create initial migration `src/db/migrations/0001_initial.ts` — all tables from `@engranatge/domain`
- [x] Create `src/db/migrate.ts` — CLI entry point that runs `MigratorLive`
- [x] Add root script: `"db:migrate": "pnpm --filter @engranatge/server run migrate"`
- [x] Implement `src/main.ts` skeleton — Effect HTTP server using `PgLive` + `MigratorLive` from `./db/` (runs migrations on startup)
- [x] Run `pnpm db:up` then `pnpm db:migrate` — verify tables created in local Postgres
- [x] Verify server starts with `pnpm db:up && pnpm dev:server`

## Phase 4 — API key middleware

- [x] ~~Implement `src/middleware/api-key.ts`~~ — handled by `@better-auth/api-key` plugin + `bearer()` in `src/lib/auth.ts`
  - ~~Read `x-api-key` header~~ — bearer token via `Authorization` header
  - ~~SHA-256 hash and query `api_keys` table~~ — better-auth manages key storage/hashing
  - ~~Check `is_active`, check `expires_at`~~ — better-auth handles validation
  - ~~Fire-and-forget update of `last_used_at`~~ — `enableSessionForAPIKeys` tracks usage
  - ~~Return 401 on failure with no detail~~ — `SessionMiddleware` returns 401
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

- [x] Create `src/api/specs/api.ts` — imports `EngranatgeApi` groups + adds server-only groups (health)
- [x] Create `src/api/live/api.ts` — `ApiLive` composing all handler layers
- [x] `live/companies.ts` — handle listCompanies, getCompany, createCompany, updateCompany
- [x] `live/contacts.ts` — handle listContacts, createContact, updateContact, deleteContact
- [x] `live/interactions.ts` — handle listInteractions, createInteraction (+ auto-update last_contacted_at)
- [x] `live/tasks.ts` — handle listTasks, createTask, updateTask (complete)
- [x] `live/documents.ts` — handle listDocuments (no content), getDocument (with content), createDocument, updateDocument
- [x] `live/products.ts` — handle listProducts, createProduct, updateProduct
- [x] `live/proposals.ts` — handle listProposals, createProposal, updateProposal
- [x] `live/pages.ts` — handle getPageBySlug (public), viewPage (public), listPages (internal), createPage, updatePage, publishPage, deletePage
- [x] `live/webhooks.ts` — handle listWebhookEndpoints, createWebhookEndpoint, updateWebhookEndpoint, deleteWebhookEndpoint, testWebhookEndpoint
- [ ] `live/pipeline.ts` — handle getPipeline
- [x] `live/emails.ts` — handle listInboxes, sendEmail (from specific inbox), replyEmail, listThreads (filterable by inbox + company), getThread, listMessages, getMessage (updateThreadLink deferred)
- [x] `live/email-webhooks.ts` — handle AgentMail inbound webhook (`POST /webhooks/agentmail/inbound`, no API key middleware) plus `delivered`/`bounced`/`complained`/`rejected` lifecycle events
- [x] `live/health.ts` — server-only health check endpoint

## Phase 6 — Services

- [x] `services/companies.ts` — search (filters + pagination), findBySlug, create, update, updateStatus
- [x] `services/email-provider.ts` — abstract `EmailProvider` as `Context.Tag` (decoupled from AgentMail):
  - `send(inboxId, params)` → `Effect<{messageId, threadId}, EmailSendError>`
  - `reply(inboxId, messageId, params)` → `Effect<{messageId, threadId}, EmailSendError>`
  - `listThreads(inboxId, params?)` → `Effect<ThreadItem[], EmailError>`
  - `getThread(inboxId, threadId)` → `Effect<Thread, EmailError>`
  - `listMessages(inboxId, params?)` → `Effect<Message[], EmailError>`
  - `getMessage(inboxId, messageId)` → `Effect<Message, EmailError>`
  - `listInboxes()` → `Effect<Inbox[], EmailError>`
  - `createInbox(params)` → `Effect<Inbox, EmailError>`
  - `updateLabels(inboxId, messageId, add, remove)` → `Effect<void, EmailError>`
- [x] `services/agentmail-provider.ts` — `AgentMailProviderLive` layer implementing `EmailProvider`:
  - dep: `agentmail` npm package
  - Config: `EMAIL_API_KEY` via `Effect.Config` (vendor-neutral env var name; the file is the AgentMail-specific adapter)
  - Wraps SDK calls in `Effect.tryPromise`
  - Thin layer, no business logic — only maps SDK types to Effect
- [x] `services/email.ts` — `EmailService` (ServiceMap.Service) depends on `EmailProvider` (Tag) + `SqlClient`:
  - [x] `send(to, subject, html, companyId, contactId?)` — sends via provider, creates/updates `email_thread_links` row, creates interaction (channel:email, direction:outbound), updates company.lastContactedAt, tags with AgentMail label `crm:company:{id}`
  - [x] `reply(agentmailThreadId, messageId, html)` — replies via provider, creates interaction, updates company.lastContactedAt
  - [x] `handleInboundWebhook(payload)` — receives AgentMail `message.received` webhook, matches sender to contact by email, creates/updates thread link, creates interaction (channel:email, direction:inbound), updates company.lastContactedAt, fires internal webhook
  - [x] `getThread(agentmailThreadId)` — fetches from provider, enriches with company/contact from `email_thread_links`
  - [x] `listThreads(inboxId?, companyId?)` — if companyId, query thread_links first then fetch from provider; if inboxId, scope to that inbox; otherwise fetch all and join with links
  - [x] `listInboxes()` — returns all configured inboxes from provider
- [x] `services/webhooks.ts` — fireWebhooks(event, payload) fire-and-forget fan-out
- [x] `services/pages.ts` — create, update, publish, archive, getBySlug(slug, lang), list(filters), incrementView
- [x] `services/pipeline.ts` — getCounts(), getOverdue(), getNextSteps(limit)
- [ ] Wire webhook firing into: company status change, interaction created, email sent/received, proposal status change, task completed, page published
- [x] Add `EMAIL_API_KEY` to `.env.example` (vendor-neutral name; inboxes discovered via `listInboxes()`, no hardcoded IDs)

## Phase 6b — Email deliverability tracking

Per-message lifecycle mirror plus contact-level deliverability state, so the system stops sending to dead addresses and surfaces delivery state to UI/agents. Source of truth is AgentMail (server-side suppression); local state is a self-healing cache.

- [x] Extend `contacts.ts` schema with `email_status` (unknown|valid|bounced|complained), `email_status_reason`, `email_status_updated_at`, `email_soft_bounce_count`
- [x] Write Effect Schema: `email-messages.ts` — per-message lifecycle mirror (`sent`/`delivered`/`bounced`/`bounced_soft`/`complained`/`rejected`)
- [x] Add `email_messages` table to `0001_initial.ts` with indexes on `provider_thread_id` (renamed from `agentmail_thread_id` in migration 0004), `contact_id`, `status` and unique constraint on `provider_message_id`
- [x] Add `EmailSuppressed` tagged error and `EmailSendError.kind` discriminator (`suppressed`/`invalid_recipient`/`rate_limited`/`unknown`)
- [x] `services/agentmail-provider.ts` — classify SDK errors into `EmailSendErrorKind` at the boundary
- [x] `services/email.ts` — belt-and-suspenders suppression: cache-first contact check + provider self-heal on stale cache
- [x] `services/email.ts` — soft bounce counter promoted to hard at 3 consecutive failures (atomic SQL CASE)
- [x] `services/email.ts` — `markDelivered`, `markBounced`, `markComplained`, `markRejected` (idempotent UPDATE-by-message-id)
- [x] `services/email.ts` — inline `email_messages` INSERT on send/reply so the row exists immediately, before any webhook
- [x] Webhook dispatch for `message.delivered`, `message.bounced`, `message.complained`, `message.rejected`
- [x] HTTP `GET /v1/email/messages` and `GET /v1/email/messages/:messageId` endpoints
- [x] `EmailSuppressed` returns HTTP 409 from `/v1/email/send` and `/v1/email/reply`
- [x] MCP `list_email_messages` tool
- [x] MCP `send_email` / `reply_email` return tagged-union `{_tag: 'sent' | 'suppressed'}` instead of failing the tool
- [x] CLI `db reset` drops and recreates schema (was TRUNCATE) so migration changes apply on reset
- [x] Seed bounced contact fixture (Jordi Puig) for local end-to-end testing
- [ ] AgentMail dashboard: subscribe webhook to `message.delivered`, `message.bounced`, `message.complained`, `message.rejected` (manual setup step)
- [ ] End-to-end test: send to a known-bouncing address → verify `email_messages.status = 'bounced'` and `contacts.email_status = 'bounced'`; retry → expect 409 / suppressed
- [ ] Manual cache-staleness test: `UPDATE contacts SET email_status='unknown'` and retry send → expect provider rejection + cache self-heal back to `bounced`

**Out of scope (intentional):**

- Manual revival of bounced contacts — AgentMail blocks them permanently server-side; fix typos by adding a new contact
- Unsubscribe handling — needs template-layer support + legal compliance work
- Open/click tracking — not in AgentMail's event types
- Soft bounce auto-retry — count only, no requeue

## Phase 6c — Call recordings (storage only)

> **Iteration 1 status — shipped:** audio upload, S3-compatible storage, recording row linked to a `call` interaction (existing or auto-created), playback signed URL, soft-delete, MCP read tools.
>
> **Deferred to a later phase:** transcription, summary enrichment, retranscribe, speaker swap. The schema keeps `transcript_*` columns nullable so the future addition is one provider Layer + one service method, no migration. See the `### Deferred to a later phase` block below for the full list.

Voice calls captured by the salesperson on their phone (speakerphone + Voice Memos / Google Recorder) get uploaded to the server and auto-logged as a `call` interaction. Mirror the email pipeline: `services/email.ts` is the closest analogue. Provider abstraction → concrete adapter → service that combines provider + DB + webhooks.

**Storage:** Cloudflare R2 in prod (S3-compatible, zero egress, ~$0.015/GB/month), MinIO via docker compose in local dev. Both speak S3 — same code path. Wrapped behind a `StorageProvider` Tag so the implementation is swappable. Env vars are vendor-neutral (`STORAGE_*`, not `R2_*`) so swapping providers is just a config change.

**Recording → interaction link:** `POST /v1/recordings` accepts an optional `interactionId`. If present, the recording attaches to the existing `call` interaction (404 if missing, 409 on channel mismatch or duplicate). If absent, the service creates a fresh `interactions` row inside the same SQL transaction. Either side requires at least one of `{interactionId, companyId}` (400 if neither). Atomicity: SQL tx wraps interaction lookup/insert + recording insert + S3 put + companies last_contacted_at update; storage failure rolls back the row and the put never completed, so zero state is left behind. The `recording.uploaded` webhook fires only after commit.

### Local dev — MinIO

- [x] Add `storage` (MinIO) and `storage-init` (mc bucket creator) services to `docker/docker-compose.yml` — same compose project as `db`, so `pnpm cli services up` brings both
- [x] Bucket `engranatge-recordings` auto-created on first boot via the `storage-init` sidecar
- [x] Add `STORAGE_*` env vars to `.env.example` pointing at `http://localhost:9000`
- [x] Add `storageCheck` to `apps/cli/src/commands/doctor.ts` (HTTP GET `:9000/minio/health/live`)
- [x] Smoke-test: `pnpm cli services up && pnpm cli doctor` should show `Storage (MinIO): listening on :9000`
- [ ] Smoke-test: open `http://localhost:9001` in a browser, log in with `engranatge` / `engranatge-secret`, verify the bucket exists

### Schema — `packages/domain`

- [x] Write Effect Schema: `call-recordings.ts` — `CallRecording` (`Model.Class`), mirror `email-messages.ts`:
  - `id` (`Generated CallRecordingId`)
  - `interactionId` (string, FK, unique)
  - `storageKey` (string — S3 object key)
  - `mimeType` (string — e.g. `audio/m4a`)
  - `byteSize` (number)
  - `durationSec` (`NullOr` number)
  - **Transcript columns — all `NullOr`, no DEFAULT (steady state for this iteration is `transcript_status IS NULL` everywhere — populated when transcription ships):** `transcriptStatus` (`'pending'|'done'|'failed'|null`), `transcriptText`, `transcriptSegments` (JSONB), `detectedLanguages` (JSONB), `transcribedAt`, `transcriptError`, `provider`, `providerRequestId`, `callerSpeakerId`
  - `deletedAt` (`NullOr DateTimeUtcFromDate` — GDPR soft-delete)
  - `createdAt`, `updatedAt`
- [x] Add `CallRecording`, `CallRecordingId`, `TranscriptStatus` to `schema/index.ts` exports

### Migration — `apps/server/src/db/migrations/0002_call_recordings.ts`

- [x] Create new migration file. **All transcript columns are nullable with no DEFAULT** so the steady state for storage-only rows is unambiguous (`transcript_status IS NULL` ⇒ never attempted) and the future transcription phase needs zero schema changes. Includes `interaction_id UNIQUE FK` (one recording per interaction) and a partial `idx_call_recordings_active` on `deleted_at WHERE deleted_at IS NULL` for hot-path list queries.
- [x] Verify migration runs cleanly

### Errors — `apps/server/src/errors.ts`

- [x] Add `StorageErrorOperation` (`Schema.Literals(['put','get','delete','head','presign'])`) and `StorageError` (`TaggedErrorClass`, fields: `message`, `operation`, `key: NullOr String`)
- [x] Add `Conflict` (`TaggedErrorClass`, field: `message`) — needed for the recording-already-attached / wrong-channel cases on the upload path

### Env vars — `apps/server/src/lib/env.ts`

Vendor-neutral names so swapping providers is config-only. **No `R2_*` — the env layer must not leak vendor names.** All STORAGE_* vars are required (no defaults) so the dev consciously sets them; mirrors the `EMAIL_PROVIDER` explicit-only policy.

- [x] Add `STORAGE_ENDPOINT` (`Config.string`, required — e.g. `http://localhost:9000` in dev, `https://<account>.r2.cloudflarestorage.com` in prod)
- [x] Add `STORAGE_REGION` (`Config.string`, required — `us-east-1` for MinIO, `auto` for R2)
- [x] Add `STORAGE_ACCESS_KEY_ID` (`Config.string`, required)
- [x] Add `STORAGE_SECRET_ACCESS_KEY` (`Config.redacted`, required)
- [x] Add `STORAGE_BUCKET` (`Config.string`, required)
- [x] `.env.example` populated with local MinIO defaults

### Provider abstractions

Mirror the `email-provider.ts` + `agentmail-provider.ts` split exactly: abstract Tag in one file, concrete Layer in another.

- [x] `services/storage-provider.ts` — `StorageProvider` Tag with `put / get / delete / head / signedUrl`, all returning `Effect<*, StorageError>`
- [x] `services/s3-storage-provider.ts` — `S3StorageProviderLive` (`Layer.effect`):
  - deps: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
  - Reads `STORAGE_*` directly via `Config.*` (mirrors `agentmail-provider.ts` reading `EMAIL_API_KEY` directly)
  - Constructs `S3Client` with `endpoint: STORAGE_ENDPOINT`, `region: STORAGE_REGION`, `forcePathStyle: true` (required for MinIO; harmless for R2)
  - Same code path serves MinIO (dev) and Cloudflare R2 (prod) — only env vars differ
  - Wraps `PutObjectCommand`, `GetObjectCommand`, `DeleteObjectCommand`, `HeadObjectCommand`, `getSignedUrl` in `Effect.tryPromise`, classifies failures into `StorageError` at the boundary

### `RecordingService` — `services/recordings.ts`

Mirror `EmailService` shape (`ServiceMap.Service` with `make: Effect.gen` returning method bag, static `layer` field).

- [x] Implement `RecordingService` with deps: `StorageProvider`, `SqlClient`, `WebhookService`
- [x] Method `ingest({ audio, mimeType, byteSize, durationSec?, companyId?, contactId?, interactionId? })`:
  1. **Pre-flight:** require at least one of `{interactionId, companyId}`, return `BadRequest` (→400) if neither
  2. **Open SQL tx (`sql.withTransaction`)** — everything below atomic:
     - **If `interactionId` present:** SELECT row, return `NotFound` (→404) if missing, `Conflict` (→409) if `channel !== 'call'`, `Conflict` (→409) if a recording is already attached, `Conflict` (→409) if a `companyId` was also passed and it doesn't match. Derive `companyId` from the interaction.
     - **Else:** INSERT a new `interactions` row (`channel='call'`, `direction='outbound'`, `type='call'`, `summary='Call recording'`, `date=now()`)
     - Generate storage key: `recordings/${companyId}/${randomUUID()}.${ext(mimeType)}`
     - INSERT `call_recordings` row (transcript columns left NULL — see deferred section)
     - `storage.put({ key, body: audio, contentType: mimeType })` — failure rolls back the whole tx, no orphaned row, no orphaned object (the put never completed)
     - UPDATE `companies.last_contacted_at = now(), updated_at = now()`
  3. **After commit:** fire webhook `recording.uploaded` with `{ recordingId, interactionId, companyId }`
  4. Return `{ recordingId, interactionId }`
- [x] Method `listForCompany(companyId, limit?, offset?)` — JOIN `call_recordings` with `interactions`, scope by `company_id`, exclude `deleted_at IS NOT NULL`, ORDER BY `interactions.date DESC`
- [x] Method `getById(recordingId)` — full row, exclude soft-deleted
- [x] Method `getPlaybackUrl(recordingId)` — `storage.signedUrl(key, 600)` for the Forja UI's `<audio>` element
- [x] Method `softDelete(recordingId)` — UPDATE `deleted_at = now()` first, then best-effort `storage.delete(key)` so the audio is gone immediately (GDPR right to erasure). Storage delete failure logs and continues — the row is already soft-deleted; an orphaned object will be caught by a future cleanup cron. Reverse order would risk losing the storage_key reference if the DB write failed mid-flight.
- [x] Static `.layer` field

### Routes & handlers

The upload endpoint takes binary audio. Use `handlers.handleRaw` (same pattern as `handlers/agentmail-webhook.ts:86` for raw bodies).

- [x] `routes/recordings.ts` — `RecordingsGroup` (`HttpApiGroup`, `prefix('/v1')`, `middleware(SessionMiddleware)`):
  - `POST /recordings` — payload `Schema.Unknown` (raw multipart); success `Schema.Struct({ recordingId, interactionId })`; error union `BadRequest(400) | NotFound(404) | Conflict(409)` via `Schema.Union([...])`
  - `GET /recordings` — query `{ companyId, limit?, offset? }`
  - `GET /recordings/:id` — full recording row (no transcript yet)
  - `GET /recordings/:id/playback` — returns `{ url, expiresAt }` signed URL
  - `DELETE /recordings/:id` — soft-delete + audio purge
- [x] `handlers/recordings.ts` — `RecordingsLive` (`HttpApiBuilder.group(ForjaApi, 'recordings', ...)`)
  - `handleRaw('upload', ...)` — walk `request.multipartStream` via `Stream.runForEach`, accumulate Field strings + the `audio` File `contentEffect` bytes into a `UploadFields` object, call `RecordingService.ingest`. Inline error mapping to JSON responses (400/404/409) since `handleRaw` bypasses the route's error schema.
  - Other handlers are typed `handle(...)` calls into the service. `SqlError` / `StorageError` flow via `Effect.catchTag(..., e => Effect.die(e))`, matching `handlers/email.ts`

### MCP tools — `apps/server/src/mcp/tools/recordings.ts`

Audio binary is not feasible through MCP — agents only read recording metadata via these tools (no transcript yet — see deferred section).

- [x] Tool `list_call_recordings` (`Readonly`, `OpenWorld false`) — params `{ company_id, limit?, offset? }`
- [x] Tool `get_call_recording` (`Readonly`) — params `{ recording_id }`; returns metadata only
- [x] Export `RecordingTools` (Toolkit) and `RecordingHandlersLive`
- [x] Register in `mcp/server.ts`: `McpServer.toolkit(RecordingTools)` + `Layer.provide(RecordingHandlersLive)`

### Webhook fan-out events

- [x] `recording.uploaded` — fired by `RecordingService.ingest` after the SQL tx commits, never on rollback. `WebhookService.fire` takes a freeform event string (no allowlist), so this is a single call site, no service edits needed.

### Wiring

- [x] `api.ts` — add `.add(RecordingsGroup)`
- [x] `main.ts` — add `RecordingsLive` to `ApiLive`'s `Layer.provide([...])` array
- [x] `main.ts` — add `RecordingService.layer` to `ServicesLive` mergeAll
- [x] `main.ts` — add `Layer.provide(S3StorageProviderLive)` (sibling to `EmailProviderLive`)
- [x] `mcp/server.ts` — register `RecordingTools` toolkit + `RecordingHandlersLive`
- [x] `mcp-stdio.ts` — same wiring as `main.ts` so the stdio MCP can serve the new read tools (otherwise it boots but the layer requirements fail at runtime; the entry point has an `as unknown as` cast that silences the typecheck error)

### Manual end-to-end validation

- [ ] **Local dev:** `pnpm cli services up` (brings up `db` + `storage` + `storage-init`); `pnpm cli doctor` should show all green
- [ ] **Production:** create R2 bucket `engranatge-recordings` in the Cloudflare dashboard before first deploy (the S3 client does **not** auto-create the bucket — it assumes it exists); generate API token, set `STORAGE_*` to the R2 endpoint + credentials in the prod env
- [ ] **No-interactionId path:** `curl -X POST -F "audio=@sample.m4a" -F "companyId=<uuid>" http://localhost:3010/v1/recordings` → returns `{ recordingId, interactionId }` where `interactionId` is freshly created
- [ ] **With-interactionId path:** seed an `interactions` row first (`channel='call'`, no recording attached), then `curl -X POST -F "audio=@sample.m4a" -F "interactionId=<existing-id>" http://localhost:3010/v1/recordings` → returns `{ recordingId, interactionId }` with `interactionId` matching the input
- [ ] **Bad input (neither id):** `curl -X POST -F "audio=@sample.m4a" http://localhost:3010/v1/recordings` → 400
- [ ] **Conflict (interaction wrong channel):** seed an interaction with `channel='email'`, attempt upload with that interactionId → 409
- [ ] **Conflict (recording already attached):** upload twice with the same interactionId → second call → 409
- [ ] Verify the audio actually landed in MinIO: `http://localhost:9001` → bucket `engranatge-recordings` → object exists at `recordings/<companyId>/<uuid>.m4a`
- [ ] `psql` → `SELECT * FROM call_recordings` → row exists with `transcript_status IS NULL`
- [ ] Verify `companies.last_contacted_at` updated
- [ ] Verify webhook fan-out fires `recording.uploaded`
- [ ] `curl http://localhost:3010/v1/recordings/<id>/playback` → returns `{ url, expiresAt }`. Open the URL → audio plays.
- [ ] `curl -X DELETE http://localhost:3010/v1/recordings/<id>` → soft-delete; audio gone from MinIO immediately
- [ ] From Claude Code (MCP stdio), call `list_call_recordings` with the company id → returns the new recording metadata

### Deferred to a later phase

Transcription was originally bundled in Phase 6c but has been split out so the storage path can ship and be exercised by the Forja UI first. The schema is forward-compatible — every item below is one provider Layer + one service method away, no migration needed.

- **`TranscriptionProvider` Tag** — `services/transcription-provider.ts`. `transcribe(params) => Effect<TranscriptResult, TranscriptionError>`. Pluggable so we can pick ElevenLabs Scribe v2 (default candidate, ≤5% WER on Catalan/Spanish, voice-based diarization, ~$0.50/hr) or swap to Groq Whisper / WhisperX without touching the service.
- **`ElevenLabsProviderLive`** — `services/elevenlabs-provider.ts`. POSTs `multipart/form-data` to `https://api.elevenlabs.io/v1/speech-to-text` with `model_id=scribe_v2`, `diarize=true`, `num_speakers=2`, `timestamps_granularity=word` (omit `language_code` so auto-detect handles ca/es code-switching). File name is the only place "elevenlabs" appears — env vars stay vendor-neutral.
- **`TRANSCRIPTION_API_KEY`** env var (`Config.redacted`).
- **`TranscriptionError`** + `TranscriptionErrorKind` (`'provider_error' | 'invalid_audio' | 'too_long' | 'rate_limited' | 'unknown'`) in `errors.ts`.
- **`RecordingService.transcribe(recordingId)`** — runs detached via `Effect.forkDetach` from `ingest`, NOT in the HTTP critical path. SELECT row → `storage.get(key)` → `transcription.transcribe(...)` → UPDATE `transcript_status='done'`, populate `transcript_text` / `transcript_segments` / `detected_languages` / `provider_request_id` / `transcribed_at`. UPDATE the linked `interactions` row's `summary` to first 280 chars (placeholder until LLM enrichment) and `duration_min`. On failure: `transcript_status='failed'`, log error, fire `recording.failed`.
- **`RecordingService.retranscribe(recordingId)`** — same as `transcribe` but resets status to `pending` first (idempotent retry, e.g. after a provider outage).
- **`RecordingService.swapSpeakers(recordingId, callerSpeakerId)`** — UPDATE `caller_speaker_id` (one-click "I was speaker 1, not 0" fix from the UI).
- **`POST /v1/recordings/:id/retranscribe`** + **`PATCH /v1/recordings/:id`** route + handler (the latter takes `{ callerSpeakerId }`).
- **MCP tools** — `get_call_transcript` (`Readonly`, plain-text only, mirror `extractedText` for emails), `summarize_call` (loads transcript → calls Claude → produces summary ≤280 chars + outcome label + next-step task draft → UPDATE interaction), `swap_call_speakers` (`Destructive`, low-risk).
- **Webhook events** — `recording.transcribed`, `recording.failed`. Wire `interaction.logged` to fire after enrichment, not on initial pending insert.
- **LLM summary enrichment prompt** for `summarize_call` — first pass uses a generic Catalan/Spanish sales prompt; iterating is a separate task.

Trigger to revive: when the Forja UI's call-recording playback flow needs in-app transcript display, or when a sales workflow is bottlenecked on manual call summarization.

### Out of scope (intentional)

- **Phone-based call recording app** — out-of-band entirely. Salesperson uses speakerphone + Voice Memos / Google Recorder, then uploads. The server only ingests files.
- **Telegram bot upload UX** — covered separately. The HTTP endpoint is provider-agnostic and can also be hit from a PWA share-sheet, iOS Shortcut, or curl.
- **Real-time / streaming transcription** — Scribe is batch only and the UX is async-by-design. Streaming would need a different provider and a different storage flow.
- **Diarization on >2 speakers** — `num_speakers=2` is hardcoded for caller + responder. Conference calls would need a separate code path.
- **Cross-call speaker identity (voiceprint enrollment)** — distinguishing "the salesperson" by voice across all their calls requires enrollment; out of scope.
- **Stereo / multichannel uploads** — speakerphone recordings are mono. If a hardware adapter ever produces stereo, channel-based diarization is strictly more accurate but needs a separate code path.
- **GDPR retention scheduling** — `deleted_at` is the mechanism. The auto-purge policy (e.g. 90-day cron) is a later addition.

## Phase 7 — MCP server

- [x] Verify `@effect/experimental` exports `McpServer` in v4 (may be `@effect/mcp`)
- [x] Create `src/mcp/server.ts` — McpServer definition
      Context efficiency: all MCP tool responses are optimised for LLM context windows.
      All list tools accept `limit` (default 10) + `cursor` for pagination.
      Email tools return `extractedText` (reply-stripped plain text), never raw HTML.

- [x] Implement tool: `search_companies` (limit default 10)
- [ ] Implement tool: `get_company_brief` — compact ~500 token summary: company info + contact names + last 3 interaction one-liners + open task count + unread thread count. The default "what do I need to know" call.
- [x] Implement tool: `get_company` — full detail: company + contacts + last 5 interactions + open tasks (no documents, no email bodies)
- [x] Implement tool: `create_company`
- [x] Implement tool: `update_company`
- [x] Implement tool: `log_interaction` (creates interaction + updates company last_contacted_at + next_action)
- [x] Implement tool: `get_documents` (list only — type + title + date, no content; limit default 10)
- [x] Implement tool: `get_document` (full content)
- [x] Implement tool: `create_document`
- [x] Implement tool: `update_document`
- [x] Implement tool: `create_task`
- [x] Implement tool: `complete_task`
- [x] Implement tool: `get_pipeline`
- [x] Implement tool: `get_next_steps`
- [x] Implement tool: `create_page`
- [x] Implement tool: `update_page`
- [x] Implement tool: `publish_page`
- [x] Implement tool: `list_pages` (limit default 10)
- [x] Implement tool: `get_page`
- [x] Implement tool: `send_email` — send email to contact, auto-logs interaction
- [x] Implement tool: `reply_email` — reply to a thread
- [x] Implement tool: `list_email_threads` — subject + participants + date + message count, no bodies; filterable by inbox/company (limit default 10)
- [x] Implement tool: `get_email_thread` — full thread with messages as `extractedText` (reply-stripped plain text, not HTML)
- [x] Implement resource: `forja://company/{slug}`
- [x] Implement resource: `forja://pipeline`

## Phase 8 — MCP transports

- [x] Implement `src/mcp-stdio.ts` — stdio transport for Claude Code
- [x] Write `.mcp.json` pointing to `mcp-stdio.ts`
- [x] Test: open Claude Code, run `/mcp`, verify forja tools listed
- [x] Implement HTTP/SSE transport on `/mcp` route — Bearer token from `MCP_SECRET`
- [ ] Test remote MCP with a tunneled URL (Cloudflare Tunnel or ngrok)

## Phase 9 — Unikraft deployment

- [x] Write `apps/server/Kraftfile` — spec v0.6, `runtime: node:latest`, scale-to-zero labels, `rootfs: ./Dockerfile`, `cmd: ["/usr/bin/node", "/app/dist/main.js"]` (see PLAN.md § Kraftfile)
- [x] Write `apps/server/Dockerfile` — two-stage Node 24 alpine build, `NODE_OPTIONS=--no-network-family-autoselection`, corepack pnpm, copy monorepo, build domain+server, runtime stage copies only dist/ (see PLAN.md § Dockerfile)
- [ ] Run `kraft build` locally and verify image builds
- [ ] Run `kraft run` locally and verify HTTP server responds
- [ ] Deploy to Unikraft Cloud and verify
- [ ] Point `api.batuda.co` to deployed instance

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
- [ ] Create AgentMail webhook: `client.webhooks.create({ url: "https://api.batuda.co/webhooks/agentmail/inbound", eventTypes: ["message.received"] })`
- [ ] Store `EMAIL_API_KEY` in production env (and `EMAIL_WEBHOOK_SECRET` for AgentMail webhook signature verification)
- [ ] Test end-to-end: send email via MCP → verify delivered + thread link created
