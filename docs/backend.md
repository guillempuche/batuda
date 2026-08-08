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
│   ├── ports.ts              # 8 capability ports + Budget + ProviderQuota
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
│   ├── providers-live.ts     # Boot-time selection for 8 capability ports
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
│   ├── auth.ts               # Better Auth instance as Context.Service
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
│   │   ├── research-registry.ts  # lookup_registry
│   │   ├── research-crm.ts  # crm_lookup
│   │   ├── research-sink.ts # propose_update, attach_finding, propose_paid_action
│   │   └── research-mcp.ts  # start_research, get_research, research_sync
│   ├── resources/
│   │   ├── company.ts        # batuda://company/{slug} (parameterized)
│   │   ├── pipeline.ts       # batuda://pipeline (static)
│   │   ├── document.ts       # batuda://document/{id} (parameterized)
│   │   ├── instructions.ts   # batuda://instructions/{agent} (parameterized)
│   │   └── research.ts       # batuda://research/{id} (parameterized)
│   └── prompts/
│       ├── _lang.ts           # LangParam + langDirective helper (ca/es/en)
│       ├── _completions.ts    # Shared auto-completion (company slugs)
│       ├── company-research.ts
│       ├── research-designer.ts  # Research plan design prompt
│       ├── daily-briefing.ts
│       ├── proposal-draft.ts
│       ├── interaction-follow-up.ts
│       └── instructions.ts    # apply-instruction, save-instruction
├── middleware/
│   └── session.ts            # SessionMiddleware — validates Better Auth sessions
├── types/
│   └── better-auth.d.ts      # Type declarations for Better Auth
└── services/                 # Business logic, called by both routes and MCP tools
    ├── companies.ts
    ├── email.ts              # send outbound (SMTP) + handle inbound replies
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

For how environment variables and secrets are sourced across local dev and the deployed cloud — the `.env` baseline, `infisical run` for real dev keys, and the Infisical → GitHub Actions sync that feeds the deploy — see [architecture.md → Environment variables & secrets](architecture.md#environment-variables--secrets).

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

**This result mapping applies to *every* query, raw `` sql`…` `` template literals included** — not just the `sql.insert`/query-builder helpers. A `SELECT foo_bar` column comes back on the row as `fooBar`, **not** `foo_bar`. So read result columns in camelCase and type your `` sql<{ … }>` `` row shapes in camelCase, even though the SQL text itself — column names, `WHERE`, `INSERT`/`UPDATE` targets — stays snake_case. The trap: reading a snake_case key that the transform renamed (`row.foo_bar`) returns `undefined` with no type error and no runtime error, so the miss reads as an empty/missing value and slips through silently.

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
  Layer.provide(makeResearchProvidersLive),  // 8 capability ports (search, scrape, etc.)
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
import { Context, Effect, Layer } from "effect"
import { SqlClient } from 'effect/unstable/sql'
import type { Statement } from 'effect/unstable/sql'

// Service definition — uses Effect SQL template literals
class CompanyService extends Context.Service<CompanyService>()(
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
          if (filters.country) conditions.push(sql`country = ${filters.country}`)
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

import { COMPANY_STATUSES } from '@batuda/domain'

export const CreateCompanyInput = Schema.Struct({
  name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  slug: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9-]+$/))),
  // A closed set lives in `packages/domain` and is read from there, so the
  // browser, the agent tools and the research apply path cannot disagree about
  // which words are allowed.
  status: Schema.optional(Schema.Literals(COMPANY_STATUSES)),
  country: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z]{2}$/)))),
  priority: Schema.optional(Schema.Literals([1, 2, 3])),
  // Finite, not Number: a plain number also publishes "NaN" and "Infinity" as
  // alternatives, which becomes a choice inside a choice once it is nullable —
  // a shape some model providers refuse to read.
  latitude: Schema.optional(Schema.Finite.pipe(Schema.check(Schema.isBetween({ minimum: -90, maximum: 90 })))),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
})
```

### Where a rule about a value lives

Write the rule in TypeScript, in `packages/domain`, and read it from every way in — the HTTP input schemas, the agent tool parameters, and the research apply path. A value refused at one door and accepted at another is how the two answers quietly drift apart.

Two things belong in the database instead, and only these. A **unique index** is a race guard: two writers asking for the same new row at the same moment end with one, and the loser re-reads it. A **CHECK on a closed vocabulary** is a backstop, added only after the existing rows have been put right — `companies_status_chk` and `companies_latlng_chk` are the shape. A two-letter country code is *not* a closed vocabulary: that is the shape of a code, not a list of the countries that exist.

Nothing else. No generated column, no trigger, no expression that decides something the application also decides — a rule written twice is a rule that will disagree with itself, and the copy in SQL is the one nobody reads. Where a migration genuinely has to fold a whole existing table, pin the two against each other with a test (`company-industries-fold.integration.test.ts` is the example) and say in the migration that the application's version is the one that wins.

### When a tool cannot find the thing it was asked for

A read answers with nothing: `success: Schema.NullOr(...)`. An action says what it could not find: `dieNotFound(entity, id)`.

Two traps. `Effect.orDie` maps the whole error channel to `never`, so catching an error and re-failing it *before* an `orDie` puts it straight back and kills it — the endpoint answers 500 while type-checking perfectly. Write `Effect.catch(e => e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e))` with no trailing `orDie`. And wrapping a success in `NullOr` makes the flat-result rule in `_annotations.test.ts` pass vacuously unless it looks through the null branch, because the top level stops being an object.

### Ways of reaching a company, a branch or a person

They all live in one `channels` table, named by `subject_table` + `subject_id`. One key cannot point at two tables, so there is no foreign key — which means nothing cascades, and a subject's channels are deleted by hand when the subject goes. `deleteSubjectChannels` is that hand. Left behind, the rows outlive whoever they belonged to and keep answering: the send gate looks a bounced address up across the whole organisation without asking whose it is.

A bulk write (`channels[]` on create/update contact, and the research apply path) only ever adds or refreshes. Correcting or removing one goes through `manage_contact_channels` / `manage_company_channels`, and both scope every edit to the subject as well as the id — an id alone only proves a row exists, not whose it is. Renaming an address onto one the subject already holds is refused rather than merged, because merging would delete a row the caller never named; the refusal is a `BadRequest` mapped from the unique violation, raised inside its own transaction so it does not poison the request it arrived on.

Exactly one channel of each kind is the primary, and removing the one holding it hands it to the oldest left rather than leaving the kind headless — otherwise the readers disagree about which address is "the" one, and disagree differently on the next page load.

`verification` is what a deliverability check found, and only `deliverable` lets the send path through unremarked — no verdict at all also passes, because there is no evidence against the address. So a write that says nothing about a verdict keeps the one on file rather than clearing it. The vocabulary lives in `packages/domain`; callers may only ever lower a verdict, since saying an address is good is something only a mailbox probe finds out. The suppression `status` is a separate axis, written by the bounce handler and never by a caller.

### How a list endpoint answers

A list endpoint answers with the same envelope, built by `PaginatedList` in `packages/controllers/src/pagination.ts`. Not every list has been moved onto it yet — several short ones (an org's API keys, an inbox's footers, the instruction templates) still answer with a bare array — but any list that grows with the business belongs on the envelope, and a new one should start there.

```typescript
{ items, total, limit, offset, hasMore }
```

Spread `pageQuery` into the endpoint's `query` block to accept the three parameters that go with it: `limit`, `offset` and `count`.

```typescript
HttpApiEndpoint.get('list', '/companies', {
  query: { status: Schema.optional(Schema.String), ...pageQuery },
  success: PaginatedList(Company.json),
})
```

No request may ask for more than `MAX_PAGE_LIMIT` rows, and asking for more is refused with a 400 rather than quietly shrunk — a caller that receives fewer rows than it asked for, with no way to tell, reports them as the whole answer.

`hasMore` says whether asking again would bring anything, and is always filled in. It costs one spare row: the query asks for `limit + 1` and `takePage` (in `apps/server/src/lib/sql-pagination.ts`) drops the extra before anything else sees it. Run `takePage` before decoding, or the caller is handed one row more than it asked for and nothing catches it.

`total` is only computed when the caller passes `count=exact`, and is `null` otherwise — which means "not counted", not "none matched". Counting means looking at every matching row, so ask for it only where a screen states a number. A list that simply keeps scrolling reads `hasMore` and never pays for a count.

An agent tool that takes a `limit` must return `hasMore` too, through `PageResult` or `TruncatableResult` in `apps/server/src/mcp/tools/_result.ts`. Without it an assistant reads twenty-five rows, cannot tell a short list from a long one cut short, and answers "you have twenty-five" when three hundred match. Where one `limit` caps several lists at once — `get_next_steps` caps three — say it once per list instead, with a `…Truncated` flag each, since a single `hasMore` could not say which list it meant. A test in `_annotations.test.ts` fails if a tool offers neither. Those results carry no `total`: a field that is usually absent has to describe itself as "a number or nothing", which some model providers refuse to read.

---

## MCP server (Effect AI)

The MCP server uses `effect/unstable/ai` — tools, resources, prompts, and elicitation. Source reference: `docs/repos/effect/packages/effect/MCP.md`.

### Architecture

```
McpToolsLive (src/mcp/server.ts)
├── Toolkits: companies, contacts, interactions, tasks, documents, pages, pipeline
├── Resources: batuda://company/{slug}, batuda://pipeline, batuda://document/{id}, batuda://research/{id}, batuda://instructions/{agent}
└── Prompts: company-research, research-designer, daily-briefing, proposal-draft, interaction-follow-up, apply-instruction, save-instruction
    │
    ├── stdio transport (mcp-stdio.ts) — local Claude Code
    └── HTTP transport (mcp/http.ts) — remote AI at /mcp on main server
```

`McpToolsLive` is transport-agnostic — shared between both transports.

### Tool definition pattern

Tools are defined with `Tool.make()`, grouped into `Toolkit.make()`, and registered via `mcpToolkitSafe()`. Handlers are separate from definitions via `Toolkit.toLayer()`.

```typescript
// src/mcp/tools/companies.ts
import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

const SearchCompanies = Tool.make('search_companies', {
  description: 'Filter companies by status, country, industry, priority, or query.',
  parameters: Schema.Struct({
    status: Schema.optional(Schema.String),
    country: Schema.optional(Schema.String),
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

Prompts are parameterized templates with auto-completion. The synthesis prompts (company-research, daily-briefing, proposal-draft, interaction-follow-up, research-designer) accept `lang: 'ca' | 'es' | 'en'` (default `en`) for multilingual output; the action prompts (apply-instruction, save-instruction) emit a directive in the caller's language instead.

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

### Asking a person before acting

A tool that spends money, writes to somebody's records, or cannot be undone asks first, through `requireApproval` in `apps/server/src/mcp/tools/_elicit.ts`. It answers one of three things, and the third is the one that matters: **`unaskable` is not a no.**

```typescript
publish_page: ({ id }) => Effect.gen(function* () {
  const page = yield* service.getById(id)
  const answer = yield* requireApproval(
    `Publish "${page.title}"? This makes it publicly visible.`,
  )
  if (answer === 'unaskable')
    return { status: 'cancelled', reason: 'this client cannot ask anyone; publish it from the app instead' }
  if (answer === 'declined')
    return { status: 'cancelled', reason: 'the answer was no' }
  return yield* service.publish(id)
}).pipe(Effect.orDie),
```

The tool must list `McpSchema.McpServerClient` in its `dependencies`, and its `success` schema must be able to carry the refusal — a closed `Schema.Struct` cannot, and the refusal then fails to encode.

Two things not to do. Do not call `McpServer.elicit()` without asking `canElicit` first: a client that cannot show a question answers the request with a refusal, and reading that as "the person said no" reports a decision nobody made. Neither Claude.ai nor ChatGPT can show one today, so on those clients every such question used to answer itself. And do not use `Tool.make`'s `needsApproval` field — Effect reads it only in its AI client loop, never in the MCP server, so a tool declaring it runs anyway while its description promises otherwise. A test in `_annotations.test.ts` fails if one reappears.

### Auth on behalf of user (CurrentUser)

MCP protocol has no built-in auth. A `CurrentUser` context tag bridges transport-level auth into tool handlers:

```typescript
// src/mcp/current-user.ts
export class CurrentUser extends Context.Service<CurrentUser>()('CurrentUser', {
  // `Context.Tag` belongs to Effect v2/v3 and does not exist here.
}) {}
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
  mcpToolkitSafe(CompanyTools),
  mcpToolkitSafe(ContactTools),
  mcpToolkitSafe(InteractionTools),
  mcpToolkitSafe(TaskTools),
  mcpToolkitSafe(DocumentTools),
  mcpToolkitSafe(PageTools),
  mcpToolkitSafe(PipelineTools),
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
curl -X POST -k https://api.batuda.localhost:$(cat ~/.portless/proxy.port 2>/dev/null || echo 443)/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'

# Claude Code — .mcp.json already configures the batuda stdio server
```

---

## Authentication (Better Auth)

Better Auth v1.5.6 handles all authentication. See [architecture.md](architecture.md) for the full auth section.

Key files:

- `src/lib/auth.ts` — Better Auth instance as `Context.Service`, with plugins: `openAPI`, `bearer`, `admin`, `apiKey`, `magicLink` (links are dispatched through `EmailProvider.sendMagicLink` — locally they land in `apps/server/.dev-inbox/` as `*sign-in-to-batuda*.md` files; in cloud they go through the transactional email provider, Resend)
- `src/lib/env.ts` — Centralized environment variables (DATABASE_URL, BETTER_AUTH_SECRET, etc.)
- `src/middleware/session.ts` — `SessionMiddleware` validates sessions via `auth.api.getSession()`, provides `SessionContext`
- `src/routes/auth.ts` — Wildcard `/auth/*` GET/POST routes
- `src/handlers/auth.ts` — Proxy: Effect request → fetch Request → Better Auth handler → Effect response

`SessionMiddleware` is applied to all `/v1/*` route groups. It works uniformly for cookies (team members), bearer tokens, and API keys (`enableSessionForAPIKeys: true`).

### Cross-origin policy

The web app and the API are different origins. In dev, portless serves the app at `https://batuda.localhost` and the API at `https://api.batuda.localhost` — binding 443 when it can, otherwise a non-privileged port like `:1355`, which it prints on startup; in prod the app (Cloudflare Workers, `batuda.co`) and API (Unikraft, `api.batuda.co`) split the same way. The browser fetches `/auth/*` same-origin (the Vite dev proxy / Worker forwards them to the API, so the session cookie lands on the app host) and `/v1/*` cross-origin to the API host — that is what `apiBaseUrl()` (`apps/internal/src/lib/api-base.ts`) returns in prod. Dev is the exception: there it returns the app's own origin, so a `/v1/*` call goes through the Vite proxy instead. Both the dev proxy and the Worker (`apps/internal/src/worker.ts`) forward `/v1/*` as well as `/auth/*`, so a relative `/v1/…` works in either.

**A URL baked into an `<a href>` has to respect that split.** SSR renders the markup, so the URL is chosen on the server and then used by the browser: in dev `apiBaseUrl()` is a loopback address that would ship inside the HTML and be refused (the browser will not send a `Secure` cookie there), while a relative path resolves against the page's own origin, whose `/v1/*` the dev server forwards. In prod it is the real API origin, reached directly like every other call. `downloadUrlFor` (`apps/internal/src/lib/email-attachments.ts`) and `documentOpenUrl` (`apps/internal/src/lib/document-links.ts`) are the two places that do this, and both pick the base the same way. Such a link works on the session cookie alone: a top-level navigation sends no `Origin`, so CORS does not apply, and nothing on `/v1/*` checks `Origin`, `Referer` or a CSRF token.

CORS is a global `HttpRouter.middleware` in `src/main.ts` via `HttpMiddleware.cors({ allowedOrigins, credentials: true, ... })`; `allowedOrigins` comes from the **required** `ALLOWED_ORIGINS` env — comma-separated **literal** origins matched exactly, with no wildcards (any `*` fails boot) and no dev fallback (boot fails if unset). The same array is fed to Better-Auth as `trustedOrigins` (`src/lib/auth.ts`) so CORS and CSRF agree, and `credentials: true` lets the browser attach the `__Secure-batuda.session_token` cookie on `credentials: 'include'` fetches. A git-worktree dev stack needs no per-worktree origin config: the server derives the worktree's `<branch>.batuda.localhost` origin from `PORTLESS_URL` and merges it into the trusted set (see the `worktrees` skill).

### Object storage and who can read a stored file

Some things are too big, or too file-shaped, to sit in a database column: call recordings, the research scrape cache, and the body of a document saved as a web page. Those go to object storage — MinIO locally, Cloudflare R2 in production (`STORAGE_ENDPOINT`, `STORAGE_BUCKET` in `config.production.json`; the two keys arrive as deploy secrets). One provider-agnostic port, `StorageProvider` (`apps/server/src/services/storage-provider.ts`), with `S3StorageProviderLive` as the only adapter today.

**The bucket is private.** Nothing in it is reachable without a credential, so every read is either a presigned URL or bytes the server streams itself.

A document makes the trade-off visible, because it has both kinds of body:

- **Markdown** stays in `documents.content`. It is small, edited in place, and has to be searchable.
- **A web page** goes to storage under `documents/<org>/<document>.html`, and the row keeps only the key plus `search_text` — the page's plain words, so a search still reaches it. `content` is empty, and the `documents_body_matches_format` constraint keeps the two shapes from mixing. `search_text` is never shown to anyone; what a reader opens is the stored page.

Storing a page rather than rendering it is a deliberate boundary. The HTML was written by an agent or scraped from somewhere, and serving it from the app's own address would put markup nobody vetted next to the signed-in session. From the storage address the browser treats it as the separate place it is.

**Two link shapes, for two kinds of caller:**

|                | `GET /v1/documents/:id/open`                           | A presigned URL                                                                                        |
| -------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Lives for      | ever — the address never changes                       | `HTML_URL_TTL_SECONDS`, 10 minutes                                                                     |
| Checked        | on every open, by session + organisation               | once, when it is minted                                                                                |
| Who can use it | a signed-in member of the owning organisation          | anyone holding it, until it expires                                                                    |
| Used by        | the web app, and anything a person pastes or bookmarks | the agent tools (`get_document`'s `bodyUrl`), which authenticate with a key and have no browser cookie |

`/open` answers a `302` to a freshly minted presigned URL, with `Cache-Control: no-store` — a remembered redirect would send the next visit to a link that has already expired. It answers `404` for a markdown document, which has no stored file.

**A presigned URL cannot be made permanent.** The signing scheme R2 implements caps validity at seven days, so a link that never dies is not reachable by lengthening the window — and every extra hour widens the blast radius of one that leaks. That is why the permanent address is a checked endpoint rather than a longer signature.

**Writes and deletes touch both places.** Creating a page writes the bytes *before* the row, because a stored file with no row is invisible and costs a little space, while a row pointing at a file that was never written is a document that opens to nothing. Editing one rewrites the stored file and refreshes `search_text`; putting new HTML on the row instead would leave the page serving the old bytes with no error. Deleting one removes the file too, best-effort — an unreachable file is worth less than a document somebody cannot get rid of. All three live in `apps/server/src/services/documents.ts`, so the HTTP handler and the agent tools share one copy of the rules rather than each keeping its own.

Not handled, deliberately: nothing reclaims a file orphaned by a crash between the storage write and the row insert. The write order makes that the cheap failure, and a sweep is its own job.

### Invite-only signup

Public signup is disabled: `emailAndPassword.disableSignUp = true` in `src/lib/auth.ts`. The `/auth/sign-up/email` endpoint returns `400 Email and password sign up is not enabled` (see `sign-up.ts:181-187` in the vendored better-auth source). The browser has no path to create accounts on its own.

New users are created server-side via the admin plugin's `auth.api.createUser` endpoint, which bypasses the `disableSignUp` gate entirely. Batuda reaches it from in-process server code only, and always **headerless**.

That last detail is load-bearing. `createUser` belongs to the admin plugin: given a request context it demands a session whose *platform* role is in `adminRoles` (`['admin', 'app_service']`). Org owners and admins hold the platform role `user`, so forwarding a caller's headers makes the call fail for exactly the people who should be allowed to add someone. Passing an empty `Headers()` fails too — the guard fires on the header object being present at all. Called with no request context, both guards are skipped, which is correct because the caller has already decided. See `apps/server/src/services/api-keys.ts` and `apps/server/src/services/members.ts` for the two places that do this.

**How people join an organization.** An owner or admin adds them from Settings → Organization → Members, which posts to `POST /v1/members` (`packages/controllers/src/routes/members.ts` → `apps/server/src/handlers/members.ts` → `MemberService`). The handler resolves the organization from `OrgMiddleware` — never from the request body — checks the caller is an `owner` or `admin` of it, creates the account passwordless if it does not exist, and adds the membership. **That role check is the only authorization on the path**: Better Auth's `addMember` performs none of its own and is safe upstream only because it is declared without a path, so `better-call` never registers it as a route.

There is no invitation and nothing to accept. The person is a member the moment the form is submitted, and the email they receive carries no link that signs them in — they go to `/login` and request their own short-lived link. That keeps the only credential-bearing email one the recipient asked for seconds earlier.

**Reference implementation**: `apps/cli/src/commands/seed.ts` uses direct `auth.api.createUser` inside the seed (the CLI has the DB directly, no HTTP) to provision the dev user `admin@taller.cat`.

Sign-in is unaffected: `POST /auth/sign-in/email` still works for any existing user with `emailAndPassword` credentials. Only the `sign-up/email` path is closed.

---

## Email service (generic IMAP/SMTP + React Email v6)

Outbound email (outreach, follow-ups, replies) goes through a bring-your-own IMAP/SMTP mailbox — `nodemailer` over SMTP for the send, then an IMAP `APPEND` into the Sent folder. Inbound + bounce handling runs in `apps/mail-worker` (one IMAP `IDLE` per inbox); per-inbox credentials are AES-256-GCM-encrypted on the `inboxes` row. Authoring on both ends — humans in the web app's compose form, AI agents via MCP — converges on a single typed block tree, rendered through shared primitives in `packages/email`. SMTP carries the final MIME; Batuda owns the authoring surface and the rendering pipeline.

The send path stores the rendered `text` and `html` on the `email_messages` row alongside the wire bytes it puts in object storage. It has to: SMTP is one-way, so a message whose body is only in the recipient's mailbox cannot be read back here, and the thread view would show an empty card. `pnpm cli email backfill-bodies` fills in messages sent before this was true, reading each one back from storage.

The worker syncs two folders per inbox, and which one a message came from decides its direction — inbox means it arrived, sent folder means we sent it. Folders are matched on the IMAP special-use flags the server reports (`\Inbox`, `\Sent`) rather than their names, because Gmail calls its sent folder `[Gmail]/Sent Mail` and Outlook `Sent Items`; matching by name syncs no sent mail at all on either. `resolveTrackedFolders` in `apps/mail-worker/src/inbox-session.ts` settles this once per session and hands the answer down, so nothing lower has to re-derive it from a folder name. Only mail that arrived is written to a company's history — what we send is recorded where it is sent from.

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

SMTP/IMAP carry only the final rendered MIME — there is no metadata field to round-trip the authoring block tree, so a draft that lived only as sent-mail bytes would lose its block tree on every reload. The service keeps a local shadow keyed by `draft_id`:

```sql
CREATE TABLE email_draft_bodies (
  draft_id   TEXT PRIMARY KEY,
  inbox_id   UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  body_json  JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Writes happen on every draft upsert; reads `LEFT JOIN` so the editor re-hydrates losslessly. `draft_id` is `TEXT` because its shape is owned by where the draft lives (a server-minted id, or the local filename stem in dev). The rendered `html`/`text`/`attachments` are derived at send time — the shadow only carries the authoring tree.

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

Threading headers (`In-Reply-To`, `References`) are set by the server when it builds the reply MIME, from the parent message's `Message-ID` (and the inherited `References` chain), so the reply stitches into the thread in the recipient's client.

### Footer CRUD

`inbox_footers.body_json JSONB` (replacing the prior `html` + `text_fallback` columns). Authored in `FooterManageDialog` via the same `EmailEditor` used for compose, just with `mode="footer"` — narrower palette (no H1, no divider, no lists; paragraphs + inline formatting + `image` blocks for logo-in-signature). No structured author/city/brand fields; the user composes the signature freely. At send time, footer blocks are appended to the user's block tree before `renderBlocks` runs — a single render step yields consistent footer placement in both `html` and `text`.

### Inline-image semantics

`SendAttachmentInput` carries an explicit `disposition: 'inline' | 'attachment'`. Without it, the MIME builder defaults to `attachment` and `<img src="cid:…">` in the body fails to resolve against the part. The server sets `disposition: 'inline'` whenever the staging row has `is_inline = true`; inbound parent inline parts are re-emitted the same way on reply.

### Env vars

```
EMAIL_PROVIDER=local-inbox            # dev filesystem catcher; real per-inbox IMAP/SMTP transport runs in the mail-worker
EMAIL_PROVIDER_TRANSACTIONAL=local    # magic links / resets; `resend` in cloud (+ EMAIL_API_KEY_TRANSACTIONAL, EMAIL_FROM_TRANSACTIONAL)
EMAIL_CREDENTIAL_KEY=<base64 32 bytes> # AES-256-GCM master key; a per-inbox HKDF subkey encrypts each inbox's IMAP/SMTP password
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

The research system runs a server-side AI agent loop that gathers and structures company intelligence, with pluggable capability providers, budget and quota controls, mandatory citations, and SSE streaming. Its architecture and flows — capabilities, input modes, the run lifecycle, contact discovery, cost rails, surfaces, data model, and the data-sourcing strategy — live in [architecture.md → §Research](architecture.md#research).

What stays here is the code-facing detail. Providers are selected at boot by `RESEARCH_PROVIDER_*` env vars with a comma-list fallback chain; `brave/search.ts` is the template adapter and [Adding a new research capability provider](#adding-a-new-research-capability-provider) below is the recipe. The eval harness runs from the CLI, never in production — `pnpm cli research eval` reports grounding accuracy, field precision and recall, and the wrong-company and empty rates, and `pnpm cli research probe` checks which candidate LLMs support the forced tool-calling and strict-JSON output the tiers need; see [../eval/README.md](../eval/README.md).

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
4. Register in `src/mcp/server.ts` via `mcpToolkitSafe(Tools)` + `Layer.provide(HandlersLive)`
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

Research capability providers implement one of the 8 ports in `packages/research/src/application/ports.ts`. Use `brave/search.ts` as a template.

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
