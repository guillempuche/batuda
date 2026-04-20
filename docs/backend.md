# Backend

Effect v4 HTTP server + MCP server. Deployed on Unikraft.
For system context see [architecture.md](architecture.md).

---

## Project structure

```
docker/
└── postgres/
    └── docker-compose.yml   # Local Postgres 17 for development

packages/domain/src/          # Effect Schema types (no DB connection)
├── schema/
│   ├── companies.ts
│   ├── contacts.ts
│   ├── ...
│   └── index.ts
└── index.ts

packages/controllers/src/     # Shared HttpApiGroup specs
├── routes/
│   ├── research.ts           # ResearchGroup — /v1/research endpoints
│   └── ...

packages/research/src/        # Research bounded context
├── domain/
│   ├── errors.ts             # ProviderError, BudgetExceeded, QuotaExhausted, ...
│   └── types.ts              # SearchResult, ScrapedPage, RegistryRecord, ...
├── application/
│   ├── ports.ts              # 6 capability ports + Budget + ProviderQuota
│   ├── research-service.ts   # ResearchService — fiber-per-run agent loop
│   ├── budget.ts             # Per-run + monthly spending control
│   ├── provider-quota.ts     # Per-provider quota tracking
│   ├── policy.ts             # System → user → per-run policy resolution
│   └── schemas/              # Output schema registry
│       ├── index.ts           # schemaRegistry Record<string, Schema>
│       ├── freeform.ts
│       ├── company-enrichment-v1.ts
│       ├── competitor-scan-v1.ts
│       ├── contact-discovery-v1.ts
│       └── prospect-scan-v1.ts
├── infrastructure/
│   ├── _shared.ts            # disabledError, notYetImplementedError factories
│   ├── providers-live.ts     # Boot-time selection for 6 capability ports
│   ├── llm-live.ts           # Boot-time LLM provider selection
│   ├── cached-search.ts      # TTL cache wrapping SearchProvider
│   ├── stub/                 # Zero-cost deterministic fake data (local dev)
│   │   ├── search.ts
│   │   ├── scrape.ts
│   │   ├── extract.ts
│   │   ├── discover.ts
│   │   ├── registry-es.ts
│   │   ├── report-es.ts
│   │   └── llm.ts
│   └── brave/
│       └── search.ts         # Real Brave Search API (template for newcomers)
└── index.ts                  # Public exports

apps/server/src/
├── db/
│   ├── client.ts             # PgClient layer (from DATABASE_URL)
│   ├── migrator.ts           # PgMigrator layer (file system loader)
│   ├── migrations/           # Effect SQL migration files
│   │   ├── 0001_initial.ts
│   │   └── 0003_research.ts  # research_runs, sources, paid_spend, quotas
│   └── migrate.ts            # CRM + Better Auth migrations
├── main.ts                   # HTTP server entry point (REST API + MCP HTTP)
├── mcp-stdio.ts              # MCP stdio entry point (Claude Code local)
├── api.ts                    # BatudaApi — HttpApi groups composition
├── errors.ts                 # Domain error schemas (Unauthorized, NotFound, etc.)
├── routes/                   # HttpApiGroup definitions
│   ├── auth.ts               # /auth/* wildcard (Better Auth proxy)
│   ├── companies.ts
│   ├── contacts.ts
│   ├── ...
│   └── pages.ts              # Mixed: /v1/pages (protected) + /pages/:slug (public)
├── handlers/                 # HttpApiBuilder.group() implementations
│   ├── auth.ts               # Proxy to Better Auth handler
│   ├── companies.ts
│   ├── contacts.ts
│   ├── research.ts           # Research API handler
│   ├── ...
│   └── health.ts
├── lib/
│   ├── auth.ts               # Better Auth instance as ServiceMap.Service
│   └── env.ts                # EnvVars service (DATABASE_URL, RESEARCH_*, etc.)
├── mcp/
│   ├── server.ts             # McpToolsLive — toolkits + resources + prompts
│   ├── http.ts               # McpHttpLive — HTTP transport at /mcp
│   ├── current-user.ts       # CurrentUser context tag for auth-on-behalf-of
│   ├── tools/                # one file per domain
│   │   ├── companies.ts
│   │   ├── contacts.ts
│   │   ├── interactions.ts
│   │   ├── tasks.ts
│   │   ├── documents.ts
│   │   ├── pages.ts
│   │   ├── pipeline.ts
│   │   ├── research-web.ts   # web_search, web_read, web_discover
│   │   ├── research-registry.ts  # lookup_registry
│   │   ├── research-crm.ts  # crm_lookup
│   │   ├── research-sink.ts # propose_update, attach_finding, propose_paid_action
│   │   └── research-mcp.ts  # start_research, get_research, research_sync
│   ├── resources/
│   │   ├── company.ts        # batuda://company/{slug} (parameterized)
│   │   ├── pipeline.ts       # batuda://pipeline (static)
│   │   ├── document.ts       # batuda://document/{id} (parameterized)
│   │   └── research.ts       # batuda://research/{id} (parameterized)
│   └── prompts/
│       ├── _lang.ts           # LangParam + langDirective helper (ca/es/en)
│       ├── _completions.ts    # Shared auto-completion (company slugs)
│       ├── company-research.ts
│       ├── research-designer.ts  # Research plan design prompt
│       ├── daily-briefing.ts
│       ├── proposal-draft.ts
│       └── interaction-follow-up.ts
├── middleware/
│   └── session.ts            # SessionMiddleware — validates Better Auth sessions
├── types/
│   └── better-auth.d.ts      # Type declarations for Better Auth
└── services/                 # Business logic, called by both routes and MCP tools
    ├── companies.ts
    ├── email.ts              # AgentMail: send outbound + handle inbound replies
    ├── email-provider-live.ts # Boot-time email provider selection (Layer.unwrap)
    ├── pages.ts              # page CRUD, view tracking, publish/archive
    ├── recordings.ts
    ├── webhooks.ts
    └── pipeline.ts
```

---

## TypeScript config

All packages extend `/tsconfig.base.json`. Key settings that affect daily coding:

```
moduleResolution: bundler   → write imports WITHOUT .js extensions
                              import { foo } from '../foo'        ✓
                              import { foo } from '../foo.js'     ✗

verbatimModuleSyntax: true  → type-only imports MUST use `import type`
                              import type { Company } from '@batuda/domain'

noUncheckedIndexedAccess    → arr[0] is T | undefined, not T
                              always null-check array/object access

exactOptionalPropertyTypes  → optional props cannot be set to undefined explicitly
                              type A = { x?: string }
                              const a: A = { x: undefined }  ✗ — just omit x
```

---

## Local development

Use Docker Compose for local services. Start Postgres + MinIO before running the server:

```bash
pnpm db:up        # docker compose -f docker/docker-compose.yml up -d  (db + storage)
pnpm db:migrate   # runs Effect Migrator via apps/server/src/db/migrate.ts
pnpm dev:server   # starts the server (also runs migrations on startup)
```

For production, `DATABASE_URL` points to NeonDB (or any Postgres). The db layer works with any Postgres — local Docker or cloud.

---

## Database layer (`apps/server/src/db/`)

Effect Layers for Postgres + Migrations. Lives inside the server — the only consumer.

### Client layer (`@effect/sql-pg`)

```typescript
// apps/server/src/db/client.ts
import { PgClient } from '@effect/sql-pg'
import { Config } from 'effect'

export const PgLive = PgClient.layerConfig({
  url: Config.redacted('DATABASE_URL'),
  transformResultNames: Config.succeed((s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())),
  transformQueryNames: Config.succeed((s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)),
})
```

The transform functions handle snake_case ↔ camelCase mapping automatically — `sql.insert({ sizeRange: 'x' })` generates `INSERT INTO ... (size_range) VALUES ('x')`, and SELECT results map `size_range` → `sizeRange`.

### Migrator layer (`@effect/sql-pg/PgMigrator`)

```typescript
// apps/server/src/db/migrator.ts
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

### Migration files

```typescript
// apps/server/src/db/migrations/0001_initial.ts
import { SqlClient } from 'effect/unstable/sql'
import { Effect } from 'effect'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE companies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL UNIQUE,
      ...
    )
  `
})
```

### Server startup

```typescript
// apps/server/src/main.ts
import { makeResearchLlmLive, makeResearchProvidersLive, ResearchService } from '@batuda/research'

const ApiLive = HttpApiBuilder.layer(BatudaApi).pipe(
  Layer.provide([HealthLive, AuthHandlerLive, CompaniesLive, ResearchLive, ...]),
)

const ServicesLive = Layer.mergeAll(
  CompanyService.layer, PipelineService.layer, PageService.layer,
  EmailService.layer, RecordingService.layer, ResearchService.layer,
).pipe(Layer.provideMerge(WebhookService.layer))

// REST API + MCP HTTP + CORS + docs on the same router
const AppLive = Layer.mergeAll(ApiLive, McpHttpLive, CorsLive, DocsLive, OpenApiJsonLive)

const program = HttpRouter.serve(AppLive).pipe(
  Layer.provide(ServicesLive),
  Layer.provide(EmailProviderLive),
  Layer.provide(S3StorageProviderLive),
  Layer.provide(makeResearchProvidersLive),  // 6 capability ports (search, scrape, etc.)
  Layer.provide(makeResearchLlmLive),        // LanguageModel for agent loop
  Layer.provide(SessionMiddlewareLive),
  Layer.provide(Auth.layer),
  Layer.provide(EnvVars.layer),
  Layer.provide(PgLive),
  Layer.provideMerge(ServerLive),
  Layer.provide(LoggerLive),
  Layer.provide(OtlpObservability),
  Layer.launch,
)
```

---

## Effect v4 patterns

Follow only the patterns documented here — do not mix in patterns from older Effect versions or community examples targeting v2/v3.

### Layer composition

```typescript
import { Effect, Layer, ServiceMap } from "effect"
import { SqlClient } from 'effect/unstable/sql'
import type { Statement } from 'effect/unstable/sql'

// Service definition — uses Effect SQL template literals
class CompanyService extends ServiceMap.Service<CompanyService>()(
  "CompanyService",
  {
    make: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      return {
        findBySlug: (slug: string) =>
          Effect.gen(function* () {
            const rows = yield* sql`SELECT * FROM companies WHERE slug = ${slug} LIMIT 1`
            return rows[0]
          }),

        search: (filters: CompanyFilters) => {
          const conditions: Array<Statement.Fragment> = []
          if (filters.status) conditions.push(sql`status = ${filters.status}`)
          if (filters.region) conditions.push(sql`region = ${filters.region}`)
          return sql`
            SELECT * FROM companies
            WHERE ${sql.and(conditions)}
            ORDER BY priority, updated_at DESC
          `
        },
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
```

### HTTP routes

```typescript
import { HttpApiGroup, HttpApiEndpoint, HttpApiSchema } from "effect/unstable/httpapi"

export const CompaniesApi = HttpApiGroup.make("companies").add(
  HttpApiEndpoint.get("list", "/companies", {
    query: { status: Schema.optional(Schema.String) },
    success: Schema.Array(Schema.Unknown),
  }),
  HttpApiEndpoint.get("get", "/companies/:slug", {
    params: { slug: Schema.String },
    success: Schema.Unknown,
    error: NotFound.pipe(HttpApiSchema.status(404)),
  }),
  HttpApiEndpoint.post("create", "/companies", {
    payload: CreateCompanyInput,
    success: Schema.Unknown,
  }),
)
```

### Route handlers

```typescript
import { HttpApiBuilder } from "effect/unstable/httpapi"

export const CompaniesApiLive = HttpApiBuilder.group(
  BatudaApi,
  "companies",
  (handlers) =>
    handlers
      .handle("list", (_) =>
        Effect.gen(function* () {
          const service = yield* CompanyService
          return yield* service.search(_.query)
        })
      )
      .handle("get", (_) =>
        Effect.gen(function* () {
          const service = yield* CompanyService
          return yield* service.findBySlug(_.params.slug)
        })
      )
)
```

### Error handling

Define domain errors with Effect Schema:

```typescript
import { Schema } from "effect"

export class DatabaseError extends Schema.TaggedErrorClass<DatabaseError>()(
  "DatabaseError",
  { cause: Schema.Unknown }
) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  { entity: Schema.String, id: Schema.String }
) {}
```

Map to HTTP responses in the route definition via `HttpApiSchema.status()`.

### Effect Schema for validation

```typescript
import { Schema } from "effect"

export const CreateCompanyInput = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  slug: Schema.String.pipe(Schema.pattern(/^[a-z0-9-]+$/)),
  status: Schema.Literal("prospect", "contacted", "responded", "meeting", "proposal", "client", "closed", "dead"),
  region: Schema.optional(Schema.Literal("cat", "ara", "cv")),
  priority: Schema.optional(Schema.Int.pipe(Schema.between(1, 3))),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
})
```

---

## MCP server (Effect AI)

The MCP server uses `effect/unstable/ai` — tools, resources, prompts, and elicitation. Source reference: `docs/repos/effect/packages/effect/MCP.md`.

### Architecture

```
McpToolsLive (src/mcp/server.ts)
├── Toolkits: companies, contacts, interactions, tasks, documents, pages, pipeline
├── Resources: batuda://company/{slug}, batuda://pipeline, batuda://document/{id}
└── Prompts: company-research, daily-briefing, proposal-draft, interaction-follow-up
    │
    ├── stdio transport (mcp-stdio.ts) — local Claude Code
    └── HTTP transport (mcp/http.ts) — remote AI at /mcp on main server
```

`McpToolsLive` is transport-agnostic — shared between both transports.

### Tool definition pattern

Tools are defined with `Tool.make()`, grouped into `Toolkit.make()`, and registered via `McpServer.toolkit()`. Handlers are separate from definitions via `Toolkit.toLayer()`.

```typescript
// src/mcp/tools/companies.ts
import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

const SearchCompanies = Tool.make('search_companies', {
  description: 'Filter companies by status, region, industry, priority, or query.',
  parameters: Schema.Struct({
    status: Schema.optional(Schema.String),
    region: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Unknown,
}).annotate(Tool.Title, 'Search Companies')
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)    // default is true — must set false explicitly
  .annotate(Tool.OpenWorld, false)

export const CompanyTools = Toolkit.make(SearchCompanies, GetCompany, CreateCompany, UpdateCompany)

export const CompanyHandlersLive = CompanyTools.toLayer(
  Effect.gen(function* () {
    const service = yield* CompanyService
    return {
      search_companies: params =>
        service.search({ ...params }).pipe(Effect.orDie),
      // ...
    }
  }),
)
```

### Tool annotations

All tools MUST set `Tool.Destructive` explicitly — it defaults to `true`.

| Annotation         | Default    | Purpose                                            |
| ------------------ | ---------- | -------------------------------------------------- |
| `Tool.Title`       | —          | Human-readable display name                        |
| `Tool.Readonly`    | `false`    | Read-only, no side effects                         |
| `Tool.Destructive` | **`true`** | Destructive/write operation                        |
| `Tool.Idempotent`  | `false`    | Safe to call multiple times                        |
| `Tool.OpenWorld`   | `true`     | Can access external data (set `false` for DB-only) |
| `Tool.Meta`        | —          | Custom metadata for MCP clients                    |

### Resource definition pattern

Static resources use `McpServer.resource({...})`. Parameterized resources use template literals with `McpSchema.param()`:

```typescript
import { McpSchema, McpServer } from 'effect/unstable/ai'

const slugParam = McpSchema.param('slug', Schema.String)

export const CompanyResource = McpServer.resource`batuda://company/${slugParam}`({
  name: 'Company Profile',
  description: 'Full company profile with contacts and recent interactions.',
  mimeType: 'application/json',
  audience: ['assistant'],
  completion: {
    slug: (input) => Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql`SELECT slug FROM companies WHERE slug ILIKE ${input + '%'} LIMIT 10`
      return rows.map((r: any) => r.slug as string)
    }),
  },
  content: Effect.fn(function* (_uri, slug) {
    const service = yield* CompanyService
    return JSON.stringify(yield* service.getWithRelations(slug), null, 2)
  }),
})
```

### Prompt definition pattern

Prompts are parameterized templates with auto-completion. All prompts accept `lang: 'ca' | 'es' | 'en'` (default `en`) for multilingual output.

```typescript
import { McpServer } from 'effect/unstable/ai'
import { LangParam, langDirective } from './_lang'
import { completeCompanySlug } from './_completions'

export const CompanyResearchPrompt = McpServer.prompt({
  name: 'company-research',
  description: 'Build a research brief for a company.',
  parameters: { slug: Schema.String, lang: LangParam },
  completion: { slug: completeCompanySlug },
  content: ({ slug, lang }) => Effect.gen(function* () {
    const service = yield* CompanyService
    const data = yield* service.getWithRelations(slug)
    return `${langDirective(lang)}\n\n## Company: ${data.name}\n${JSON.stringify(data, null, 2)}\n\nProduce: overview, contacts, interaction trajectory, next steps.`
  }),
})
```

### Elicitation

Tool handlers can request user confirmation for destructive operations via `McpServer.elicit()`:

```typescript
publish_page: ({ id }) => Effect.gen(function* () {
  const page = yield* service.getById(id)
  const { confirm } = yield* McpServer.elicit({
    message: `Publish "${page.title}"? This makes it publicly visible.`,
    schema: Schema.Struct({ confirm: Schema.Literal('yes', 'no') }),
  }).pipe(Effect.catchTag('ElicitationDeclined', () => Effect.succeed({ confirm: 'no' as const })))
  if (confirm === 'no') return { status: 'cancelled' }
  return yield* service.publish(id)
}).pipe(Effect.orDie),
```

### Auth on behalf of user (CurrentUser)

MCP protocol has no built-in auth. A `CurrentUser` context tag bridges transport-level auth into tool handlers:

```typescript
// src/mcp/current-user.ts
export class CurrentUser extends Context.Tag('CurrentUser')<CurrentUser, {
  readonly userId: string
  readonly email: string
  readonly name: string
  readonly isAgent: boolean
}>() {}
```

- **HTTP transport**: middleware validates Better Auth session → provides `CurrentUser` per-request
- **Stdio transport**: static `CurrentUser` (trusted local user)
- Tool handlers: `const user = yield* CurrentUser` for audit/permissions

### Two transports

**stdio** (Claude Code — local):

```typescript
// src/mcp-stdio.ts
const ServerLayer = McpToolsLive.pipe(
  Layer.provide(McpServer.layerStdio({ name: 'batuda', version: '1.0.0' })),
  Layer.provide(ServicesLive),
  Layer.provide(PgLive),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(CurrentUser, { userId: 'local', ... })),
)
Layer.launch(ServerLayer).pipe(NodeRuntime.runMain)
```

**HTTP** (remote AI — Claude.ai, ChatGPT):

```typescript
// src/mcp/http.ts
export const McpHttpLive = McpToolsLive.pipe(
  Layer.provide(McpServer.layerHttp({ name: 'batuda', version: '1.0.0', path: '/mcp' })),
)

// In main.ts — merged with REST API on the same HttpRouter:
const AppLive = Layer.merge(ApiLive, McpHttpLive)
const program = HttpRouter.serve(AppLive).pipe(...)
```

### MCP server composition (src/mcp/server.ts)

```typescript
export const McpToolsLive = Layer.mergeAll(
  McpServer.toolkit(CompanyTools),
  McpServer.toolkit(ContactTools),
  McpServer.toolkit(InteractionTools),
  McpServer.toolkit(TaskTools),
  McpServer.toolkit(DocumentTools),
  McpServer.toolkit(PageTools),
  McpServer.toolkit(PipelineTools),
  CompanyResource,
  PipelineResource,
  DocumentResource,
  CompanyResearchPrompt,
  DailyBriefingPrompt,
  ProposalDraftPrompt,
  InteractionFollowUpPrompt,
).pipe(
  Layer.provide(CompanyHandlersLive),
  Layer.provide(ContactHandlersLive),
  // ... all handler layers
)
```

### Testing MCP locally

```bash
# MCP Inspector (interactive web UI)
npx @modelcontextprotocol/inspector -- pnpm --filter @batuda/server dev:mcp

# JSON-RPC pipe (smoke test)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{"elicitation":{}},"clientInfo":{"name":"test","version":"0.1"}}}' | pnpm --filter @batuda/server dev:mcp

# HTTP endpoint
curl -X POST http://localhost:3010/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'

# Claude Code — .mcp.json already configures the batuda stdio server
```

---

## Authentication (Better Auth)

Better Auth v1.5.6 handles all authentication. See [architecture.md](architecture.md) for the full auth section.

Key files:

- `src/lib/auth.ts` — Better Auth instance as `ServiceMap.Service`, with plugins: `openAPI`, `bearer`, `admin`, `apiKey`, `magicLink` (links are dispatched through `EmailProvider.sendMagicLink` — locally they land in `apps/server/.dev-inbox/` as `*sign-in-to-batuda*.md` files; in cloud they go through AgentMail)
- `src/lib/env.ts` — Centralized environment variables (DATABASE_URL, BETTER_AUTH_SECRET, etc.)
- `src/middleware/session.ts` — `SessionMiddleware` validates sessions via `auth.api.getSession()`, provides `SessionContext`
- `src/routes/auth.ts` — Wildcard `/auth/*` GET/POST routes
- `src/handlers/auth.ts` — Proxy: Effect request → fetch Request → Better Auth handler → Effect response

`SessionMiddleware` is applied to all `/v1/*` route groups. It works uniformly for cookies (team members), bearer tokens, and API keys (`enableSessionForAPIKeys: true`).

### Cross-origin policy

The Batuda web app lives on `:3000`, this API on `:3010`, and the tenant marketing site on `:3001` — every request is cross-origin. CORS is wired as a global `HttpRouter.middleware` in `src/main.ts` via `HttpMiddleware.cors({ allowedOrigins, credentials: true, ... })`, with `allowedOrigins` read from `ALLOWED_ORIGINS` env (comma-separated) and falling back to `http://localhost:3000,http://localhost:3001` in dev. The same env var is fed to Better-Auth as `trustedOrigins` in `src/lib/auth.ts` so both layers agree on what's legitimate. `credentials: true` is required for the browser to attach the `batuda.session_token` cookie on fetch calls that use `credentials: 'include'`.

### Invite-only signup

Public signup is disabled: `emailAndPassword.disableSignUp = true` in `src/lib/auth.ts`. The `/auth/sign-up/email` endpoint returns `400 Email and password sign up is not enabled` (see `sign-up.ts:181-187` in the vendored better-auth source). The browser has no path to create accounts on its own.

New users are created server-side via the admin plugin's `auth.api.createUser` endpoint, which bypasses the `disableSignUp` gate entirely. There are two ways to reach it:

1. **From an authenticated admin session** — a logged-in user with `role: 'admin'` calls `POST /auth/admin/create-user` from any client. This is how a future "invite teammate" UI will work.
2. **From a trusted server caller using an API key** — a script or MCP tool provisions an API key via `auth.api.createApiKey(...)`, then calls `auth.api.createUser({ body, headers: { 'x-api-key': <key> } })`. Because the `apiKey` plugin is configured with `enableSessionForAPIKeys: true`, an API key presented on a request opens a session carrying the owner's role — so the key must belong to a user with `role: 'admin'` for `createUser` to pass the admin plugin's access check.

**Reference implementation**: `apps/cli/src/commands/seed.ts` uses direct `auth.api.createUser` inside the seed (the CLI has the DB directly, no HTTP) to provision the dev user `admin@taller.cat`. This is the template to copy when writing the production invite flow — same `createUser` call, different caller context (HTTP with API key instead of in-process DB).

Sign-in is unaffected: `POST /auth/sign-in/email` still works for any existing user with `emailAndPassword` credentials. Only the `sign-up/email` path is closed.

---

## Email service (AgentMail + React Email v6)

Outbound email (outreach, follow-ups, replies) and inbound handling via [AgentMail](https://agentmail.to). Authoring on both ends — humans in the web app's compose form, AI agents via MCP — converges on a single typed block tree, rendered through shared primitives in `packages/email`. AgentMail carries the final MIME; Batuda owns the authoring surface and the rendering pipeline.

### Package layout — `packages/email`

Shared Node+browser library, consumed by `apps/server` (render at send time), `apps/internal` (compose + footer editors), and `packages/controllers` (HTTP schema).

- `schema.ts` — Effect `Schema` for `EmailBlock` and `EmailBlocks` (the block tree).
- `render.ts` — `renderBlocks(blocks, { preview, attachments })` → `{ html, text, resolvedAttachments }`. HTML via React Email's `render()`; plain text via `toPlainText()` with `>` prefixing on quoted subtrees.
- `sanitize.ts` — `sanitizeHtmlToBlocks` (parse5 server / DOMParser client) and `sanitizeTextToBlocks` for reply-quoting.
- `theme.ts` — `brandTheme = extendTheme('basic', …)` with MD3 palette mirrored from `packages/ui/src/tokens.css`. Fonts: Barlow Condensed (display), Barlow (body).
- `components/` — `EmailBody`, `SignOff`, `AgentEmail` (block-tree renderer).
- `editor/` — `EmailEditor` (shared `@react-email/editor` wrapper, `mode: 'compose' | 'footer'`) and `image-upload.ts` (staging integration).

### Block schema

```ts
type EmailBlock =
  | { type: 'paragraph'; spans: ReadonlyArray<Span> }
  | { type: 'heading'; level: 1 | 2 | 3; spans: ReadonlyArray<Span> }
  | { type: 'list'; ordered: boolean; items: ReadonlyArray<ReadonlyArray<Span>> }
  | { type: 'quote'; children: ReadonlyArray<EmailBlock> }     // recursive
  | { type: 'divider' }
  | {
      type: 'image'
      source:
        | { kind: 'staging'; stagingId: string }  // human upload in flight
        | { kind: 'cid';     cid: string       }  // already-linked (e.g. inherited from parent)
        | { kind: 'url';     href: string      }  // agents only, for assets we control
      alt: string
      width?: number
      height?: number
    }
```

At render time, `staging` resolves to a `cid` via `email_attachment_staging` + the outbound MIME part. `cid` blocks emit `<img src="cid:…">` as-is (so re-attached parent inline images resolve). `url` blocks emit a plain `<img src>`.

### Draft body shadow (`email_draft_bodies`)

AgentMail's draft API accepts only `{to, cc, bcc, subject, text, html, attachments, in_reply_to, send_at, client_id, labels}` — no metadata / JSON field. So a pure AgentMail round-trip would lose the block tree on every reload. The service keeps a local shadow keyed by provider `draft_id`:

```sql
CREATE TABLE email_draft_bodies (
  draft_id   TEXT PRIMARY KEY,
  inbox_id   UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  body_json  JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Writes happen on every draft upsert; reads `LEFT JOIN` so the editor re-hydrates losslessly. `draft_id` is `TEXT` because upstream providers own its shape (AgentMail string, local filename stem). The provider still owns `html`/`text`/`attachments` — the shadow only carries the authoring tree.

### Attachment staging (`email_attachment_staging`)

StorageProvider-backed (R2 / S3 / MinIO / local filesystem — same contract used by recordings and research-blob-storage). Bytes land at `email/staging/<inboxId>/<stagingId>`; preview URLs are short-lived signed URLs served to the WYSIWYG canvas.

```sql
CREATE TABLE email_attachment_staging (
  staging_id    TEXT PRIMARY KEY,
  inbox_id      UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  draft_id      TEXT,
  storage_key   TEXT NOT NULL,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  is_inline     BOOLEAN NOT NULL DEFAULT false,
  cid           TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
)
```

**Compression is email-domain-only.** Other `StorageProvider` consumers (`recordings.ts`, `research-blob-storage.ts`) store bytes verbatim — lossy compression would destroy fidelity. Email staging runs `compressEmailImage` (in `apps/server/src/services/email-asset-compression.ts`, `sharp`-backed) for images: max dimension 1600 px, JPEG q82 (photos) or PNG palette (graphics), HEIC/AVIF → JPEG for universal client rendering. PDFs, zips, docs — passed through byte-identical.

**Five cleanup triggers:**

1. User removes a chip from the compose tray → immediate `DELETE /v1/email/attachments/staging/:id`.
2. User deletes an inline image block in the editor → same DELETE fires once the ProseMirror node is gone.
3. Draft deleted → server sweeps every staging row referenced by `bodyJson` + the provider attachment list.
4. Send succeeds → `markSentAndCleanup` deletes the rows and storage keys for every materialized attachment.
5. Background TTL sweep (hourly cron) → deletes rows past `expires_at` whose draft no longer references them.

Because the backend is durable, a server restart no longer loses in-progress drafts.

### Reply flow

Client helper `apps/internal/src/components/emails/parent-to-quote-block.ts` takes the parent message `{ html, text, fromName, fromEmail, receivedAt, locale }` and returns `[<empty paragraph>, <attribution>, <quote>]`:

- Empty paragraph first so the editor cursor lands there (top-posting UX).
- Attribution paragraph — Lingui-localized `On <date>, <sender> wrote:` / `El <date>, <qui> va escriure:`.
- Quote wraps `sanitizeHtmlToBlocks(html, { client: true })` (native `DOMParser`) or `sanitizeTextToBlocks(text)` as fallback.

The sanitizer is **allowlist-mapping, not strip-in-place**: HTML is parsed, walked, and re-emitted as a typed `EmailBlock[]`. Anything not on the allowlist simply never appears in the output. This is a stronger guarantee than sanitize-html-style blocklists and avoids their transitive-dep footprint. Server-side uses [`parse5`](https://github.com/inikulin/parse5) — zero runtime deps, WHATWG-compliant, the same parser `jsdom` wraps. Client-side uses native `DOMParser`. See `feedback_minimal_dep_libraries.md`.

Inbound parent inline images (`<img src="cid:…">`) map to `{ type: 'image', source: { kind: 'cid', cid } }` so on reply-send the server re-attaches the parent's inline parts (fetched via `EmailProvider.streamAttachment`) with the same `Content-ID`. Those bytes **do not** flow through `email_attachment_staging` — they're re-forwarded straight from the provider. Non-inline parent attachments are not carried forward (matches Gmail / Apple Mail behavior).

Threading headers (`In-Reply-To`, `References`) are emitted by AgentMail when the server calls its reply endpoint with the parent's `thread_id` + `message_id`. No server-side header construction.

### Footer CRUD

`inbox_footers.body_json JSONB` (replacing the prior `html` + `text_fallback` columns). Authored in `FooterManageDialog` via the same `EmailEditor` used for compose, just with `mode="footer"` — narrower palette (no H1, no divider, no lists; paragraphs + inline formatting + `image` blocks for logo-in-signature). No structured author/city/brand fields; the user composes the signature freely. At send time, footer blocks are appended to the user's block tree before `renderBlocks` runs — a single render step yields consistent footer placement in both `html` and `text`.

### AgentMail inline-image semantics

`SendAttachmentInput` carries an explicit `disposition: 'inline' | 'attachment'`. Without it, AgentMail's MIME builder defaults to `attachment` and `<img src="cid:…">` in the body fails to resolve against the part. The server sets `disposition: 'inline'` whenever the staging row has `is_inline = true`; inbound parent inline parts are re-emitted the same way on reply.

### Env vars

```
EMAIL_PROVIDER=agentmail          # or `local` for the filesystem catcher in dev
AGENTMAIL_API_KEY=am_...
AGENTMAIL_WEBHOOK_SECRET=whsec_...
EMAIL_FROM=hello@taller.cat          # tenant's own verified sending domain
```

The `EMAIL_PROVIDER` gate is required — there's no auto/NODE_ENV fallback (see `feedback_explicit_env_vars.md`).

---

## Webhook fan-out

When a significant event occurs, fire webhooks asynchronously:

```typescript
// src/services/webhooks.ts
// Pattern: fire-and-forget, never block the response

const fireWebhooks = (event: string, payload: unknown) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const endpoints = yield* sql`
      SELECT * FROM webhook_endpoints
      WHERE ${event} = ANY(events) AND is_active = true
    `

    yield* Effect.forEach(endpoints, (endpoint) =>
      Effect.tryPromise(() =>
        fetch(endpoint['url'] as string, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Batuda-Event": event,
            "X-Batuda-Signature": hmacSign(endpoint['secret'] as string, payload)
          },
          body: JSON.stringify({ event, payload, timestamp: new Date().toISOString() })
        })
      ).pipe(Effect.ignore({ log: true })),
      { concurrency: "unbounded" }
    )
  }).pipe(Effect.forkDetach)   // never awaited
```

Events fired:

- `company.created`
- `company.status_changed` (include `from` and `to` in payload)
- `interaction.logged`
- `email.sent`
- `email.received` (inbound reply)
- `proposal.sent`
- `proposal.accepted`
- `task.completed`
- `page.published`
- `page.viewed` (fired on first view or milestone counts)

---

## Research bounded context (`packages/research`)

The research system lets AI agents autonomously gather and structure company intelligence. It runs as a fiber-per-research-run inside the server process, with SSE streaming and budget controls.

### Provider matrix

Each capability is backed by a swappable provider, selected at boot via env vars:

```
Search:    stub | brave | firecrawl
Scrape:    stub | firecrawl | local
Extract:   stub | firecrawl | local
Discover:  stub | firecrawl | anthropic | none
Registry:  stub | librebor | none
Report:    stub | einforma | none
LLM:       stub | groq | fireworks | nebius | together | sambanova | custom
```

`stub` = zero-cost deterministic fake data (default for local dev). `none` = capability disabled, fails with a clear error on call.

### Env vars

```bash
# Capability providers (role-first, vendor-neutral — comma list accepted
# for fallback chain on ProviderError). Boot fails on unset / unknown.
RESEARCH_PROVIDER_SEARCH=stub
RESEARCH_PROVIDER_SCRAPE=stub
RESEARCH_PROVIDER_EXTRACT=stub
RESEARCH_PROVIDER_DISCOVER=stub
RESEARCH_PROVIDER_REGISTRY_ES=stub
RESEARCH_PROVIDER_REPORT_ES=stub
RESEARCH_PROVIDER_LLM=stub

# API keys (parallel grammar). Slot 1 = unsuffixed, slot N = `_2`, `_3`, …
# Same key pasted across capabilities if one vendor covers several.
# RESEARCH_API_KEY_SEARCH=BSA...
# RESEARCH_API_KEY_SCRAPE=fc-...
# RESEARCH_API_KEY_EXTRACT=fc-...
# RESEARCH_API_KEY_DISCOVER=fc-...
# RESEARCH_API_KEY_REGISTRY_ES=
# RESEARCH_API_KEY_REPORT_ES=
# RESEARCH_API_KEY_LLM=gsk_...
# RESEARCH_API_KEY_SEARCH_2=      # only when SEARCH list has ≥2 vendors

# LLM-specific (only when RESEARCH_PROVIDER_LLM != stub)
# RESEARCH_MODEL_LLM=qwen/qwen3-32b
# RESEARCH_BASE_URL_LLM=          # only for custom provider

# Budget defaults (system-level, overridable per-user via user_research_policy)
RESEARCH_DEFAULT_BUDGET_CENTS=100
RESEARCH_DEFAULT_PAID_BUDGET_CENTS=500
RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS=200
RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS=2000
RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS=10000

# Concurrency
RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL=3
RESEARCH_MAX_CONCURRENCY_FANOUT=3
RESEARCH_CONFIRM_THRESHOLD_FANOUT=10
```

### Layer composition

```
                     main.ts (composition root)
                           │
           ┌───────────────┼──────────────────┐
           │               │                  │
    FetchHttpClient     PgLive            EnvVars
    (satisfies           (satisfies       (satisfies
     HttpClient)          SqlClient)       Config)
           │               │                  │
           └───────────────┼──────────────────┘
                   ┌───────┴───────┐
                   │               │
      makeResearchProvidersLive  makeResearchLlmLive
      (6x Layer.unwrap)         (1x Layer.unwrap)
                   │               │
      ┌────────┬───┘          ┌────┴────┐
      │        │              │         │
StubSearch BraveSearch   StubLlm  OpenAiCompat
R=never   R=HttpClient  R=never  R=HttpClient
```

Three kinds of provider layers:

1. **Stub** — `Layer.succeed`, zero deps (`R = never`), deterministic fake data
2. **Disabled** — `Layer.succeed`, zero deps, methods fail with `ProviderError`
3. **Real** — `Layer.effect`, declares `R = HttpClient + Config`, real API calls

### Research run lifecycle

```
POST /v1/research → create run row (status: queued) → fork fiber
  Fiber:
    Phase 1 — Tool loop (LLM calls tools: web_search, web_read, lookup_registry, ...)
    Phase 2 — Structured output (LLM.generateObject with run's schema)
    Phase 3 — Brief generation (markdown summary)
  → SSE events via GET /v1/research/:id/events
  → Findings persisted to research_runs.findings (jsonb)
  → Sources deduped and archived to sources table
```

Fan-out groups: a `kind='group'` parent creates N `kind='leaf'` children. Each leaf completion merges findings onto the parent (`pg_advisory_xact_lock` for serialization) and rolls up the parent status.

---

## Code quality — Biome

Biome runs at the repo root and covers all packages. Config in `/biome.json`.

```bash
pnpm lint       # check linting errors
pnpm format     # auto-format all files
pnpm check      # lint + format check (run in CI)
```

Rules enforced: `noUnusedImports`, `noUnusedVariables`, `noNonNullAssertion` (warn).
Style: 2-space indent, 100-char line width, single quotes, ES5 trailing commas, no semicolons.

---

## Adding a new route

1. Create `src/routes/<entity>.ts` with `HttpApiGroup`
2. Add group to `BatudaApi` in `src/main.ts`
3. Add handler implementation
4. Add Effect Schema in `packages/domain/src/schema/<entity>.ts`

## Adding a new MCP tool

1. Define tool with `Tool.make(name, { description, parameters, success })` in `src/mcp/tools/<domain>.ts`
2. Add annotations: `.annotate(Tool.Title, ...)`, `.annotate(Tool.Readonly, ...)`, `.annotate(Tool.Destructive, false)`, `.annotate(Tool.OpenWorld, false)`
3. Add to a `Toolkit.make(...)` and export both `*Tools` and `*HandlersLive`
4. Register in `src/mcp/server.ts` via `McpServer.toolkit(Tools)` + `Layer.provide(HandlersLive)`
5. Document in `AGENTS.md` if it changes agent workflows

## Adding a new MCP resource

1. Define in `src/mcp/resources/<name>.ts`
2. Static: `McpServer.resource({ uri, name, description, mimeType, audience, content })`
3. Parameterized: `McpServer.resource\`batuda://entity/${McpSchema.param('id', Schema.String)}\`({...})`
4. Add `completion` for parameterized resources
5. Add to `McpToolsLive` in `src/mcp/server.ts`

## Adding a new MCP prompt

1. Define in `src/mcp/prompts/<name>.ts`
2. Include `lang: LangParam` in parameters, prepend `langDirective(lang)` to output
3. Use `completeCompanySlug` from `_completions.ts` for slug auto-completion
4. Add to `McpToolsLive` in `src/mcp/server.ts`

## Adding a new research capability provider

Research capability providers implement one of the 6 ports in `packages/research/src/application/ports.ts`. Use `brave/search.ts` as a template.

1. Create `packages/research/src/infrastructure/{vendor}/{capability}.ts`
2. Use `Layer.effect(PortTag, Effect.gen(function* () { ... }))` pattern
3. `yield*` any services you need (`HttpClient.HttpClient`, `Config.redacted(...)`)
4. Return `PortTag.of({ methodName: (input) => Effect.gen(...) })`
5. Map all errors to `new ProviderError({ provider: 'name', message, recoverable: bool })`
6. Import in `providers-live.ts`, add the vendor literal to the capability's `*_VENDORS` tuple, and add a branch in the matching `*Instance(vendor, slot)` factory
7. If the vendor needs an API key, read it inside the factory with `Config.redacted(keyForSlot('RESEARCH_API_KEY_<CAP>', slot))`

The R type flows automatically — stubs have `R = never`, real providers declare `R = HttpClient` (or whatever they need), and the composition root in `main.ts` satisfies all requirements.

## Adding a new LLM inference provider

All inference providers (Groq, Nebius, Fireworks, Together, SambaNova) expose OpenAI-compatible APIs, so `@effect/ai-openai-compat` handles them with just a base URL.

1. Add the provider name + base URL to `LLM_BASE_URLS` in `packages/research/src/infrastructure/llm-live.ts`
2. That's the only edit — `RESEARCH_PROVIDER_LLM` is a free-form string and accepts any vendor present in `LLM_BASE_URLS` (plus `custom` + `stub`)

That's it — `OpenAiLanguageModel.model(name)` + `OpenAiClient.layer({ apiKey, apiUrl })` does the rest.

## Pages API

The pages API serves two use cases: public reads from tenant marketing sites, and internal management by Batuda admins:

### Public routes (no auth)

- `GET /pages/:slug?lang=ca` — returns published page content (Tiptap JSON + meta + available langs)
- `POST /pages/:slug/view` — increments view counter (fire-and-forget)

### Internal routes

- `GET /pages?company_id=&status=&lang=` — list pages with filters
- `POST /pages` — create page (draft)
- `PATCH /pages/:id` — update content, title, meta, status
- `PATCH /pages/:id/publish` — set status to published, set published_at
- `DELETE /pages/:id` — archive (soft delete: status → archived)

### Page content format

Content is stored as Tiptap JSON in a JSONB column. Custom block nodes are defined in `packages/ui/src/blocks/`:

- `hero` — heading, subheading, CTA button
- `cta` — heading, body, action buttons
- `valueProps` — feature/benefit grid
- `painPoints` — problem statement list
- `socialProof` — testimonials

Standard rich text (paragraphs, headings, lists) uses Tiptap's built-in StarterKit nodes.

---

## Changing the schema

1. Edit `packages/domain/src/schema/<table>.ts`
2. Write a new migration in `apps/server/src/db/migrations/`
3. `pnpm db:migrate` — applies via Effect Migrator
4. Update affected SQL queries in services
5. Update Effect Schema validators if needed
