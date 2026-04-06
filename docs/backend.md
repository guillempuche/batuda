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

packages/controllers/src/     # Shared HttpApiGroup specs (see TODO_BACKEND Phase 2b)

apps/server/src/
├── db/
│   ├── client.ts             # PgClient layer (from DATABASE_URL)
│   ├── migrator.ts           # PgMigrator layer (file system loader)
│   ├── migrations/           # Effect SQL migration files
│   │   └── 0001_initial.ts
│   └── migrate.ts            # CRM + Better Auth migrations
├── main.ts                   # HTTP server entry point (REST API + MCP HTTP)
├── mcp-stdio.ts              # MCP stdio entry point (Claude Code local)
├── api.ts                    # ForjaApi — HttpApi groups composition
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
│   ├── ...
│   └── health.ts
├── lib/
│   ├── auth.ts               # Better Auth instance as ServiceMap.Service
│   └── env.ts                # EnvVars service (DATABASE_URL, BETTER_AUTH_SECRET, etc.)
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
│   │   └── pipeline.ts
│   ├── resources/
│   │   ├── company.ts        # forja://company/{slug} (parameterized)
│   │   ├── pipeline.ts       # forja://pipeline (static)
│   │   └── document.ts       # forja://document/{id} (parameterized)
│   └── prompts/
│       ├── _lang.ts           # LangParam + langDirective helper (ca/es/en)
│       ├── _completions.ts    # Shared auto-completion (company slugs)
│       ├── company-research.ts
│       ├── daily-briefing.ts
│       ├── proposal-draft.ts
│       └── interaction-follow-up.ts
├── middleware/
│   └── session.ts            # SessionMiddleware — validates Better Auth sessions
├── types/
│   └── better-auth.d.ts      # Type declarations for Better Auth
└── services/                 # Business logic, called by both routes and MCP tools
    ├── companies.ts
    ├── email.ts              # Resend: send outbound + handle inbound replies
    ├── pages.ts              # page CRUD, view tracking, publish/archive
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
                              import type { Company } from '@engranatge/domain'

noUncheckedIndexedAccess    → arr[0] is T | undefined, not T
                              always null-check array/object access

exactOptionalPropertyTypes  → optional props cannot be set to undefined explicitly
                              type A = { x?: string }
                              const a: A = { x: undefined }  ✗ — just omit x
```

---

## Local development

Use Docker Compose for local services. Start Postgres before running the server:

```bash
pnpm db:up        # docker compose -f docker/postgres/docker-compose.yml up -d
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
const ApiLive = HttpApiBuilder.layer(ForjaApi).pipe(
  Layer.provide([HealthLive, AuthHandlerLive, CompaniesLive, ...]),
)

const ServicesLive = Layer.mergeAll(
  CompanyService.layer, PipelineService.layer, PageService.layer, WebhookService.layer,
)

// REST API + MCP HTTP on the same router
const AppLive = Layer.merge(ApiLive, McpHttpLive)

const program = HttpRouter.serve(AppLive).pipe(
  Layer.provide(ServicesLive),
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
  ForjaApi,
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
├── Resources: forja://company/{slug}, forja://pipeline, forja://document/{id}
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

export const CompanyResource = McpServer.resource`forja://company/${slugParam}`({
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
  Layer.provide(McpServer.layerStdio({ name: 'forja', version: '1.0.0' })),
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
  Layer.provide(McpServer.layerHttp({ name: 'forja', version: '1.0.0', path: '/mcp' })),
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
npx @modelcontextprotocol/inspector -- pnpm --filter @engranatge/server dev:mcp

# JSON-RPC pipe (smoke test)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{"elicitation":{}},"clientInfo":{"name":"test","version":"0.1"}}}' | pnpm --filter @engranatge/server dev:mcp

# HTTP endpoint
curl -X POST http://localhost:3010/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'

# Claude Code — .mcp.json already configures the forja stdio server
```

---

## Authentication (Better Auth)

Better Auth v1.5.6 handles all authentication. See [architecture.md](architecture.md) for the full auth section.

Key files:

- `src/lib/auth.ts` — Better Auth instance as `ServiceMap.Service`, with plugins: `openAPI`, `bearer`, `admin`, `apiKey`
- `src/lib/env.ts` — Centralized environment variables (DATABASE_URL, BETTER_AUTH_SECRET, etc.)
- `src/middleware/session.ts` — `SessionMiddleware` validates sessions via `auth.api.getSession()`, provides `SessionContext`
- `src/routes/auth.ts` — Wildcard `/auth/*` GET/POST routes
- `src/handlers/auth.ts` — Proxy: Effect request → fetch Request → Better Auth handler → Effect response

`SessionMiddleware` is applied to all `/v1/*` route groups. It works uniformly for cookies (team members), bearer tokens, and API keys (`enableSessionForAPIKeys: true`).

---

## Email service (Resend)

Outbound email (outreach, follow-ups) and inbound reply handling via [Resend](https://resend.com).

### Sending

```typescript
// src/services/email.ts
import { Resend } from "resend"
import { Effect, Layer, Context } from "effect"

export class EmailService extends ServiceMap.Service<EmailService>()(
  "EmailService",
  {
    make: Effect.gen(function* () {
      const apiKey = yield* Config.string("RESEND_API_KEY")
      const fromAddress = yield* Config.string("EMAIL_FROM")
      const resend = new Resend(apiKey)

    return {
      send: (to: string, subject: string, html: string, metadata: { companyId: string; contactId?: string }) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () => resend.emails.send({ from: fromAddress, to, subject, html }),
            catch: (e) => new EmailError({ cause: e })
          })
          // Auto-log as interaction
          const interactionService = yield* InteractionService
          yield* interactionService.create({
            company_id: metadata.companyId,
            contact_id: metadata.contactId,
            channel: "email",
            direction: "outbound",
            type: "email",
            summary: subject,
            outcome: "sent",
          })
          return result
        }),
    }
  }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
```

### Inbound replies (webhook)

Resend forwards inbound emails to `POST /webhooks/email/inbound`. The handler:

1. Parses the Resend webhook payload (verifies signature with `RESEND_WEBHOOK_SECRET`)
2. Matches reply to a company/contact by `from` address
3. Auto-creates an interaction with `channel: "email"`, `direction: "inbound"`
4. Fires `interaction.logged` webhook event

### Env vars

```
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
EMAIL_FROM=forja@guillempuche.com
```

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
            "X-Forja-Event": event,
            "X-Forja-Signature": hmacSign(endpoint['secret'] as string, payload)
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
2. Add group to `ForjaApi` in `src/main.ts`
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
3. Parameterized: `McpServer.resource\`forja://entity/${McpSchema.param('id', Schema.String)}\`({...})`
4. Add `completion` for parameterized resources
5. Add to `McpToolsLive` in `src/mcp/server.ts`

## Adding a new MCP prompt

1. Define in `src/mcp/prompts/<name>.ts`
2. Include `lang: LangParam` in parameters, prepend `langDirective(lang)` to output
3. Use `completeCompanySlug` from `_completions.ts` for slug auto-completion
4. Add to `McpToolsLive` in `src/mcp/server.ts`

## Pages API

The pages API serves both public (marketing site) and internal (management) use cases:

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
