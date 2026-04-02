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
│   └── migrate.ts            # CLI entry point for running migrations
├── main.ts                   # HTTP server entry point — imports db layers from ./db/
├── mcp-stdio.ts              # MCP stdio entry point (Claude Code)
├── api/
│   ├── specs/
│   │   └── api.ts            # Imports groups from @engranatge/controllers + server-only
│   └── live/                 # HttpApiBuilder.group() implementations
│       ├── api.ts            # ApiLive composing all handler layers
│       ├── companies.ts
│       ├── contacts.ts
│       ├── ...
│       └── health.ts
├── mcp/
│   ├── server.ts             # McpServer, tool + resource registration
│   ├── tools/                # one file per domain (incl. pages.ts)
│   └── resources/
├── middleware/
│   └── api-key.ts            # Live implementation of ApiKeyMiddleware
└── services/                 # business logic, called by both routes and MCP tools
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
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { HttpRouter } from 'effect/unstable/http'

const ApiLive = HttpApiBuilder.layer(ForjaApi).pipe(Layer.provide([...handlers]))
const ServicesLive = Layer.mergeAll(CompanyService.layer, PageService.layer, ...)

const program = HttpRouter.serve(ApiLive).pipe(
  Layer.provide(ServicesLive),
  Layer.provide(PgLive),
  Layer.provideMerge(ServerLive),
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

## MCP server

### Server setup

```typescript
// src/mcp/server.ts
import { McpServer } from "effect/unstable/ai"

export const ForjaMcpServer = McpServer.make({
  name: "forja",
  version: "1.0.0",
}).pipe(
  McpServer.addTool(SearchCompaniesTool),
  McpServer.addTool(GetCompanyTool),
  McpServer.addTool(CreateCompanyTool),
  McpServer.addTool(UpdateCompanyTool),
  McpServer.addTool(LogInteractionTool),
  McpServer.addTool(GetDocumentsTool),
  McpServer.addTool(GetDocumentTool),
  McpServer.addTool(CreateDocumentTool),
  McpServer.addTool(UpdateDocumentTool),
  McpServer.addTool(CreateTaskTool),
  McpServer.addTool(CompleteTaskTool),
  McpServer.addTool(GetPipelineTool),
  McpServer.addTool(GetNextStepsTool),
  McpServer.addTool(CreatePageTool),
  McpServer.addTool(UpdatePageTool),
  McpServer.addTool(PublishPageTool),
  McpServer.addTool(ListPagesTool),
  McpServer.addTool(GetPageTool),
  McpServer.addResource(CompanyResource),
  McpServer.addResource(PipelineResource)
)
```

### Tool definition pattern

```typescript
// src/mcp/tools/companies.ts
import { McpServer, Tool } from "effect/unstable/ai"
import { Schema } from "effect"

export const SearchCompaniesTool = Tool.make({
  name: "search_companies",
  description: "Filter companies by status, region, industry, priority, or product fit. Returns summaries only — call get_company for full details.",
  parameters: Schema.Struct({
    status: Schema.optional(Schema.String),
    region: Schema.optional(Schema.Literal("cat", "ara", "cv")),
    industry: Schema.optional(Schema.String),
    priority: Schema.optional(Schema.Int),
    product_fit: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int.pipe(Schema.between(1, 100)))
  }),
  handler: ({ status, region, industry, priority, product_fit, limit }) =>
    Effect.gen(function* () {
      const service = yield* CompanyService
      return yield* service.search({ status, region, industry, priority, product_fit, limit: limit ?? 20 })
    })
})
```

### Two MCP transports

**stdio** (Claude Code — local):

```typescript
// src/mcp-stdio.ts
import { NodeRuntime, NodeStdio } from "@effect/platform-node"

const ServerLayer = McpToolsLive.pipe(
  Layer.provide(McpServer.layerStdio({ name: 'forja', version: '1.0.0' })),
  Layer.provide(ServicesLive),
  Layer.provide(PgLive),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
)

Layer.launch(ServerLayer).pipe(NodeRuntime.runMain)
```

**HTTP/SSE** (Claude.ai, ChatGPT — remote):
Mounted at `/mcp` on the main HTTP server. Protected by `MCP_SECRET` env var as Bearer token.
Uses the SSE transport from `@effect/experimental`.

---

## API key middleware

```typescript
// src/middleware/api-key.ts
// Flow:
// 1. Read x-api-key header
// 2. SHA-256 hash the incoming key
// 3. Query api_keys table: WHERE key_hash = ? AND is_active = true
// 4. Check expiry if expires_at is set
// 5. Update last_used_at (fire-and-forget, don't block response)
// 6. Attach scopes to HttpServerRequest context
// 7. On failure: return 401 with no detail (don't leak existence)
```

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

1. Create or add to `src/mcp/tools/<domain>.ts`
2. Register in `src/mcp/server.ts` via `McpServer.addTool`
3. Document in `AGENTS.md` if it changes agent workflows

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
