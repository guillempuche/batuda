# Backend

Effect v4 HTTP server + MCP server. Deployed on Unikraft.
For system context see [architecture.md](architecture.md).

---

## Project structure

```
apps/server/src/
├── main.ts               # HTTP server entry point
├── mcp-stdio.ts          # MCP stdio entry point (Claude Code)
├── db/
│   └── client.ts         # Drizzle + NeonDB
├── routes/               # HttpApiGroup per entity
│   ├── companies.ts
│   ├── contacts.ts
│   ├── interactions.ts
│   ├── tasks.ts
│   ├── products.ts
│   ├── proposals.ts
│   ├── documents.ts
│   └── webhooks.ts
├── mcp/
│   ├── server.ts         # McpServer, tool + resource registration
│   ├── tools/            # one file per domain
│   └── resources/
├── middleware/
│   └── api-key.ts
└── services/             # business logic, called by both routes and MCP tools
    ├── companies.ts
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

## Effect v4 patterns

### Layer composition

```typescript
import { Effect, Layer } from "effect"

// Service definition
class CompanyService extends Effect.Service<CompanyService>()("CompanyService", {
  effect: Effect.gen(function* () {
    const db = yield* DbClient

    return {
      findBySlug: (slug: string) =>
        Effect.tryPromise({
          try: () => db.query.companies.findFirst({ where: eq(schema.companies.slug, slug) }),
          catch: (e) => new DatabaseError({ cause: e })
        }),

      search: (filters: CompanyFilters) =>
        Effect.tryPromise({ ... })
    }
  }),
  dependencies: [DbClient.Default]
}) {}
```

### HTTP routes

```typescript
import { HttpApiGroup, HttpApiEndpoint, HttpApiSchema } from "@effect/platform"

export const CompaniesApi = HttpApiGroup.make("companies").pipe(
  HttpApiGroup.add(
    HttpApiEndpoint.get("list", "/companies").pipe(
      HttpApiEndpoint.setSuccess(Schema.Array(CompanySummary)),
      HttpApiEndpoint.addError(HttpApiError.NotFound)
    )
  ),
  HttpApiGroup.add(
    HttpApiEndpoint.get("get", "/companies/:slug").pipe(
      HttpApiEndpoint.setSuccess(CompanyDetail),
      HttpApiEndpoint.addError(HttpApiError.NotFound)
    )
  ),
  HttpApiGroup.add(
    HttpApiEndpoint.post("create", "/companies").pipe(
      HttpApiEndpoint.setPayload(CreateCompanyInput),
      HttpApiEndpoint.setSuccess(Company)
    )
  )
)
```

### Route handlers

```typescript
import { HttpApiBuilder } from "@effect/platform"

export const CompaniesApiLive = HttpApiBuilder.group(
  BatudaApi,
  "companies",
  (handlers) =>
    handlers
      .handle("list", ({ urlParams }) =>
        Effect.gen(function* () {
          const service = yield* CompanyService
          return yield* service.search(urlParams)
        })
      )
      .handle("get", ({ path }) =>
        Effect.gen(function* () {
          const service = yield* CompanyService
          const company = yield* service.findBySlug(path.slug)
          if (!company) return yield* Effect.fail(new HttpApiError.NotFound())
          return company
        })
      )
)
```

### Error handling

Define domain errors with Effect Schema:

```typescript
import { Schema } from "effect"

export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
  "DatabaseError",
  { cause: Schema.Unknown }
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { entity: Schema.String, id: Schema.String }
) {}
```

Map to HTTP responses in the route definition via `HttpApiEndpoint.addError`.

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

## Database client

```typescript
// src/db/client.ts
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "@batuda/domain"
import { Effect, Layer, Context } from "effect"

export class DbClient extends Context.Tag("DbClient")<
  DbClient,
  ReturnType<typeof drizzle>
>() {
  static readonly Default = Layer.effect(
    DbClient,
    Effect.gen(function* () {
      const url = yield* Effect.config(Config.string("DATABASE_URL"))
      return drizzle(neon(url), { schema })
    })
  )
}
```

---

## MCP server

### Server setup

```typescript
// src/mcp/server.ts
import { McpServer } from "@effect/experimental/McpServer"
// Note: verify import path for Effect v4 — may be @effect/mcp

export const BatudaMcpServer = McpServer.make({
  name: "batuda",
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
  McpServer.addResource(CompanyResource),
  McpServer.addResource(PipelineResource)
)
```

### Tool definition pattern

```typescript
// src/mcp/tools/companies.ts
import { McpServer } from "@effect/experimental/McpServer"
import { Schema } from "effect"

export const SearchCompaniesTool = McpServer.tool({
  name: "search_companies",
  description: "Filter companies by status, region, industry, priority, or product fit. Returns summaries only — call get_company for full details.",
  input: Schema.Struct({
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
import { McpServer } from "@effect/experimental/McpServer"
import { NodeRuntime } from "@effect/platform-node"

BatudaMcpServer.pipe(
  McpServer.serveStdio,
  NodeRuntime.runMain
)
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

## Webhook fan-out

When a significant event occurs, fire webhooks asynchronously:

```typescript
// src/services/webhooks.ts
// Pattern: fire-and-forget, never block the response

const fireWebhooks = (event: string, payload: unknown) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const endpoints = yield* Effect.tryPromise(() =>
      db.query.webhookEndpoints.findMany({
        where: and(
          arrayContains(schema.webhookEndpoints.events, [event]),
          eq(schema.webhookEndpoints.isActive, true)
        )
      })
    )

    yield* Effect.forEach(endpoints, (endpoint) =>
      Effect.tryPromise(() =>
        fetch(endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Batuda-Event": event,
            "X-Batuda-Signature": hmacSign(endpoint.secret, payload)
          },
          body: JSON.stringify({ event, payload, timestamp: new Date().toISOString() })
        })
      ).pipe(Effect.ignoreLogged),
      { concurrency: "unbounded" }
    )
  }).pipe(Effect.forkDaemon)   // never awaited
```

Events fired:
- `company.created`
- `company.status_changed` (include `from` and `to` in payload)
- `interaction.logged`
- `proposal.sent`
- `proposal.accepted`
- `task.completed`

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

1. Create or add to `src/mcp/tools/<domain>.ts`
2. Register in `src/mcp/server.ts` via `McpServer.addTool`
3. Document in `AGENTS.md` if it changes agent workflows

## Changing the schema

1. Edit `packages/domain/src/schema/<table>.ts`
2. `pnpm db:generate` — creates migration file in `packages/domain/migrations/`
3. `pnpm db:migrate` — applies to NeonDB
4. Update affected Drizzle queries in services
5. Update Effect Schema validators if needed
