# Observability & Analytics Guide

<https://loggingsucks.com/>

Practical observability for a small team building a CRM. Focus on what helps you ship faster and debug production issues.

## The Three Pillars

| Pillar      | What It Captures             | When to Use                                        | Example                                           |
| ----------- | ---------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| **Logs**    | Discrete events with context | Always - primary debugging tool                    | `company:abc status changed prospect → contacted` |
| **Metrics** | Aggregated numbers over time | When you need dashboards or alerts                 | `interactions_total{channel="email"}: 47`         |
| **Traces**  | Request flow across services | When debugging slow/failing multi-service requests | `API → email service → webhook fan-out (234ms)`   |

## Pillar 1: Structured Logging

**This is your foundation.** Good logs make metrics and traces optional for MVP.

### Log Levels

| Level   | When to Use                     | Example                            |
| ------- | ------------------------------- | ---------------------------------- |
| `error` | Something failed that shouldn't | Webhook delivery failed            |
| `warn`  | Degraded but working            | Resend API key not set             |
| `info`  | Business events worth tracking  | Interaction logged, page published |
| `debug` | Development details             | SQL query executed, cache hit/miss |

### Required Context Fields

Every log entry should include:

```typescript
{
  // WHO
  companyId: "uuid",            // Which company (if known)

  // WHAT
  event: "interaction.logged",  // Dot-notation event name

  // WHERE
  service: "server",            // server | internal

  // WHEN
  timestamp: "ISO-8601",        // Automatic in most loggers

  // HOW
  traceId: "uuid",              // Request correlation ID
}
```

### Event Naming Convention

Use dot-notation for consistent filtering:

```
{domain}.{action}[.{result}]
```

**Examples:**

| Event                    | Description                      |
| ------------------------ | -------------------------------- |
| `company.created`        | New company added to CRM         |
| `company.status_changed` | Pipeline status transition       |
| `interaction.logged`     | Interaction recorded             |
| `document.created`       | Research/notes document added    |
| `email.sent`             | Outbound email via Resend        |
| `email.received`         | Inbound reply via Resend webhook |
| `email.failed`           | Email delivery failed            |
| `webhook.fired`          | Webhook fan-out triggered        |
| `webhook.failed`         | Webhook delivery failed          |
| `page.published`         | Sales page made public           |
| `page.viewed`            | Prospect viewed a sales page     |
| `task.completed`         | CRM task marked done             |
| `proposal.sent`          | Proposal delivered to prospect   |
| `mcp.tool_called`        | MCP tool invoked by agent        |

### Structured Log Examples

**Good - Structured with context:**

```typescript
logger.info({
  event: "interaction.logged",
  companyId: "abc-123",
  channel: "visit",
  direction: "outbound",
  outcome: "interested",
  latencyMs: 45,
})
```

**Bad - Unstructured string:**

```typescript
logger.info("Logged visit interaction for company abc-123, outcome interested in 45ms")
```

### Effect Logging

The project uses Effect's built-in logging. Key patterns:

```typescript
import { Effect } from "effect"

// Simple info log
Effect.log("Company created")

// With annotations (adds context to all logs in scope)
Effect.logInfo("Interaction logged").pipe(
  Effect.annotateLogs({
    companyId: company.id,
    channel: "email",
    direction: "outbound",
  })
)

// Error with cause
Effect.logError("Webhook delivery failed").pipe(
  Effect.annotateLogs({ endpointUrl: endpoint.url, error: error.message })
)

// Duration tracking with log spans
Effect.logInfo("Webhook fan-out complete").pipe(
  Effect.withLogSpan("webhook-fanout")
)
```

### Logger Configuration

Effect v4 provides structured logger formatters:

```typescript
import { Logger } from "effect"

// Structured JSON output (recommended for production)
Logger.formatStructured

// Batched logging (reduces I/O)
Logger.batched(Logger.formatStructured, {
  window: "1 second",
  flush: Effect.fn(function*(batch) {
    // Send batch to log aggregator
  })
})

// Pretty output for development
Logger.consolePretty()
```

## Pillar 2: Metrics

**Add metrics when you need to answer aggregate questions.** Don't add metrics speculatively.

### When to Add a Metric

| Question Type           | Metric Type | Example                        |
| ----------------------- | ----------- | ------------------------------ |
| "How many X happened?"  | Counter     | `interactions_total`           |
| "What's the current X?" | Gauge       | `pipeline_companies_by_status` |
| "How long does X take?" | Histogram   | `api_request_duration_seconds` |

### MVP Metrics (Start Here)

Only track what directly impacts product success:

**Business Metrics (most important):**

| Metric               | Type    | Labels                 | Why                          |
| -------------------- | ------- | ---------------------- | ---------------------------- |
| `companies_total`    | Counter | `source`, `status`     | Are we adding prospects?     |
| `interactions_total` | Counter | `channel`, `direction` | Are we engaging?             |
| `pages_published`    | Counter | `lang`                 | Are we creating sales pages? |
| `emails_total`       | Counter | `direction`, `status`  | Email activity               |

**System Health:**

| Metric                         | Type      | Labels               | Why                |
| ------------------------------ | --------- | -------------------- | ------------------ |
| `api_request_duration_seconds` | Histogram | `endpoint`, `status` | API performance    |
| `webhook_delivery_total`       | Counter   | `event`, `status`    | Webhook health     |
| `mcp_tool_duration_seconds`    | Histogram | `tool`               | MCP responsiveness |

### Metric Naming Convention

Follow Prometheus conventions:

```
{namespace}_{name}_{unit}
```

**Examples:**

- `batuda_interactions_total`
- `batuda_api_request_duration_seconds`
- `batuda_webhook_delivery_total`

### Implementation Options

**Option 1: Log-based metrics (MVP recommended)**

Extract metrics from structured logs using your log aggregator (Loki, CloudWatch, etc.):

```
count_over_time({event="interaction.logged"}[1h])
```

Pros: No additional code, single source of truth
Cons: Less efficient for high-cardinality queries

**Option 2: Native metrics (when needed)**

Use Effect's Metrics module:

```typescript
import { Metric } from "effect"

const interactionsLogged = Metric.counter("interactions_total", {
  description: "Total interactions logged"
})

// Record a value
Effect.succeed(interaction).pipe(
  Effect.tap(() => Metric.update(interactionsLogged, 1))
)

// With attributes (labels)
const emailsSent = Metric.counter("emails_total")
yield* Metric.update(
  Metric.withAttributes(emailsSent, {
    direction: "outbound",
    status: "sent",
  }),
  1
)

// Histogram for latency
const apiLatency = Metric.histogram("api_request_duration_seconds", {
  description: "API request duration",
  boundaries: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
})

// Prometheus export
import { PrometheusMetrics } from "effect/unstable/observability"
const formatted = yield* PrometheusMetrics.format({ prefix: "batuda" })
```

## Pillar 3: Distributed Tracing

**For MVP, correlation IDs in logs are usually sufficient.** Add full tracing when:

- Requests regularly span 3+ services
- You can't debug performance issues with logs alone
- You need flame graphs for optimization

### Correlation IDs (MVP Approach)

Pass a `traceId` through the entire request:

```typescript
// API receives request
const traceId = crypto.randomUUID()

// Pass through Effect context
Effect.provideService(TraceId, traceId)

// All logs include traceId
logger.info({ traceId, event: "company.created" })
```

This lets you grep all logs for a single request:

```bash
grep "traceId=abc-123" logs.json
```

### Effect Spans (Built-in Tracing)

Effect has built-in span support. Use `Effect.withSpan` to create named spans:

```typescript
const processWebhook = Effect.fn("Webhooks.process")(function*(event, payload) {
  yield* Effect.logInfo("Processing webhook")

  yield* deliverToEndpoints(payload).pipe(
    Effect.withSpan("webhook.deliver"),
    Effect.annotateSpans({
      "webhook.event": event,
      "webhook.endpoint_count": endpoints.length,
    })
  )
})
```

Spans nest automatically — child spans inherit parent context. Use `Effect.currentSpan` to access the active span for adding attributes mid-flight.

### Full Tracing (Later)

When you need it, Effect v4 has built-in OTLP export (see Implementation Details):

- **Honeycomb** — excellent for wide events and exploration
- **Jaeger/Zipkin** — open source trace visualization
- **Grafana Tempo** — integrates with Loki and Prometheus

## What to Track: Batuda-Specific

### Critical Paths to Instrument

| Flow                     | Key Events                             | Why Critical               |
| ------------------------ | -------------------------------------- | -------------------------- |
| **Pipeline Progression** | `company.status_changed`               | Core business flow         |
| **Interaction Logging**  | `interaction.logged`, `task.created`   | Drives daily work          |
| **Email Outbound**       | `email.sent`, `email.failed`           | Primary outreach channel   |
| **Email Inbound**        | `email.received`, `interaction.logged` | Reply tracking             |
| **Webhook Fan-out**      | `webhook.fired`, `webhook.failed`      | Integration reliability    |
| **Page Publishing**      | `page.published`, `page.viewed`        | Sales page effectiveness   |
| **MCP Tool Calls**       | `mcp.tool_called`                      | Agent workflow reliability |

### Error Tracking

Track every error with enough context to debug:

```typescript
Effect.logError("Webhook delivery failed").pipe(
  Effect.annotateLogs({
    event: "webhook.failed",
    endpointId: endpoint.id,
    endpointUrl: endpoint.url,
    webhookEvent: "company.status_changed",
    httpStatus: response.status,
    retryCount: 2,
  })
)
```

### Performance Tracking

Track latency for user-facing operations:

| Operation          | Target      | Alert Threshold |
| ------------------ | ----------- | --------------- |
| API response       | < 200ms p95 | > 500ms         |
| MCP tool execution | < 500ms p95 | > 2s            |
| Email send         | < 2s p95    | > 10s           |
| Webhook delivery   | < 1s p95    | > 5s            |
| Page render (SSR)  | < 300ms p95 | > 1s            |

## Alerting Strategy

**Start with few, high-signal alerts.** Alert fatigue is worse than no alerts.

### MVP Alerts (5 maximum)

| Alert                | Condition                             | Severity |
| -------------------- | ------------------------------------- | -------- |
| **API Down**         | Health check fails for > 2 min        | Critical |
| **High Error Rate**  | > 10% API 5xx responses in 15 min     | High     |
| **Email Failures**   | > 5 consecutive email send failures   | High     |
| **Webhook Failures** | > 20% webhook 5xx responses in 15 min | High     |

### Alert Design Principles

1. **Alert on symptoms, not causes** — "API returning errors" > "Database connection failed"
2. **Include runbook link** — What to do when this fires
3. **Test your alerts** — Trigger them intentionally
4. **Review monthly** — Delete alerts that never fire or always fire

## Monitoring Philosophy: The Four Golden Signals

Follow Google's **Four Golden Signals** from the [Site Reliability Engineering](https://sre.google/sre-book/monitoring-distributed-systems/) book. These are the minimum signals you need to know if a system is healthy:

| Signal         | Question                 | Batuda Example                                    |
| -------------- | ------------------------ | ------------------------------------------------- |
| **Traffic**    | Are requests flowing?    | Request rate by route, MCP tool call count        |
| **Errors**     | Is anything failing?     | HTTP 4xx/5xx rate, webhook/email errors           |
| **Latency**    | Is it fast enough?       | API P95, MCP tool duration, SSR render time       |
| **Saturation** | Is anything at capacity? | Effect fiber health (proxy for resource pressure) |

### Why Four Signals, Not Dozens of Graphs

As a small team, you don't have an on-call rotation or a war room. You need boards that answer two questions:

1. **"Is everything working?"** → Key Metrics board (daily glance)
2. **"What exactly is broken?"** → Deep Dive board (investigation)

The Key Metrics board maps directly to the Four Golden Signals. If a signal looks wrong, drill into the Deep Dive board which breaks down by product layer (pipeline, interactions, email), infrastructure layer (webhooks, MCP, DB), and runtime (Effect fibers, logs).

### Targets

| Signal          | Target  | Expected Exception                             |
| --------------- | ------- | ---------------------------------------------- |
| API P95 latency | < 200ms | Scale-to-zero cold starts on Unikraft (~500ms) |
| Error rate      | < 1%    | Expect occasional webhook endpoint failures    |
| Email success   | > 95%   | Invalid addresses are expected, not failures   |

## Analytics vs Observability

| Aspect        | Observability           | Analytics                       |
| ------------- | ----------------------- | ------------------------------- |
| **Purpose**   | Debug production issues | Understand user behavior        |
| **Audience**  | Engineers               | Product/Business                |
| **Latency**   | Real-time               | Can be delayed                  |
| **Retention** | Days to weeks           | Months to years                 |
| **Examples**  | Error rates, latency    | Pipeline conversion, page views |

### Product Analytics (Separate Concern)

For business behavior tracking, consider dedicated tools:

| Tool          | Use Case                     | Cost               |
| ------------- | ---------------------------- | ------------------ |
| **PostHog**   | Full-featured, self-hostable | Free tier, then $$ |
| **Plausible** | Privacy-focused, simple      | $9/mo              |
| **Custom**    | Log events, query later      | Free (your time)   |

**MVP recommendation:** Start with structured logs. Extract analytics later.

## Tool Recommendations

### Small Team, Low Budget

| Need                | Recommendation       | Why                              |
| ------------------- | -------------------- | -------------------------------- |
| **Log aggregation** | Loki + Grafana       | Free, powerful, good with Effect |
| **Metrics**         | Log-based initially  | No additional infra              |
| **Alerting**        | Grafana alerts       | Integrated with logs             |
| **Error tracking**  | Sentry (free tier)   | Great DX, source maps            |
| **Uptime**          | Better Uptime (free) | Simple, reliable                 |

### Hosting Options

| Provider          | Logs     | Metrics    | Alerts  | Cost               |
| ----------------- | -------- | ---------- | ------- | ------------------ |
| **Grafana Cloud** | Loki     | Prometheus | Yes     | Free tier generous |
| **Honeycomb**     | Built-in | Built-in   | Yes     | Free tier generous |
| **Self-hosted**   | Loki     | Prometheus | Grafana | Your infra         |

## Quick Reference

### Log This

```typescript
// Business events
Effect.logInfo("Company created").pipe(
  Effect.annotateLogs({ companyId, source: "firecrawl", slug })
)

// Interactions
Effect.logInfo("Interaction logged").pipe(
  Effect.annotateLogs({ companyId, channel: "visit", direction: "outbound", outcome: "interested" })
)

// Errors (always with context)
Effect.logError("Email send failed").pipe(
  Effect.annotateLogs({
    companyId,
    contactEmail: email.slice(0, 3) + "***", // Partial only
    error: error.message,
    resendErrorCode: code,
  })
)
```

### Don't Log This

- API keys, tokens, or secrets
- Full email addresses (partial or use contactId)
- Document content (only type and length)
- Database credentials
- Full webhook secrets (use endpointId)
- High-frequency debug logs in production
- Success logs for every DB query

## Privacy in Observability

### What We Collect

| Data Type             | Collected | Purpose                          |
| --------------------- | --------- | -------------------------------- |
| Company ID (UUID)     | Yes       | Correlate events across sessions |
| Event type/channel    | Yes       | Debug workflow issues            |
| Request traces/timing | Yes       | Performance monitoring           |
| Error stack traces    | Yes       | Debug crashes                    |
| Company names         | **No**    | Business data, not for logs      |
| Email addresses       | **No**    | Privacy - use contactId only     |
| Document content      | **No**    | Business data                    |
| Page content          | **No**    | Business data                    |

### Safe Logging Patterns

**Good - Privacy preserved:**

```typescript
// Metadata instead of content
span.attribute('document.type', 'research')
span.attribute('document.content_length', content.length)

// Partial email for debugging
span.attribute('contact.email_domain', email.split('@')[1])

// Company by ID, not name
Effect.annotateLogs({ companyId: company.id })
```

**Bad - Business data exposed:**

```typescript
// NO: Company details in logs
span.attribute('company.name', company.name)

// NO: Full email
span.attribute('contact.email', contact.email)

// NO: Document content
span.attribute('document.content', content)
```

## Implementation Details

### Server: Effect v4 Built-in OTLP

Effect v4 includes OTLP export in `effect/unstable/observability` — no separate `@effect/opentelemetry` package needed:

```typescript
// apps/server/src/lib/observability.ts
import { Otlp, OtlpTracer, OtlpLogger, OtlpMetrics, OtlpSerialization } from "effect/unstable/observability"
import { FetchHttpClient } from "@effect/platform"
import { Duration, Layer } from "effect"

export const buildMeta = {
  version: process.env.npm_package_version ?? process.env.SERVICE_VERSION ?? 'unknown',
  commit: process.env.GIT_SHA ?? 'unknown',
  commitShort: (process.env.GIT_SHA ?? 'unknown').slice(0, 7),
  region: process.env.REGION ?? 'local',
}

// Combined layer — traces, logs, and metrics in one
export const OtlpObservability = Otlp.layer({
  baseUrl: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  resource: {
    serviceName: 'batuda-server',
    serviceVersion: buildMeta.version,
    attributes: {
      'deployment.environment': environment,
      'vcs.revision': buildMeta.commit,
      'cloud.region': buildMeta.region,
    },
  },
  tracerExportInterval: Duration.seconds(5),
  loggerExportInterval: Duration.seconds(1),
  metricsExportInterval: Duration.seconds(60),
  metricsTemporality: "cumulative",
}).pipe(
  Layer.provide(OtlpSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer)
)
```

Individual layers are also available for granular control:

```typescript
// Traces only
OtlpTracer.layer({ url: "http://localhost:4318/v1/traces", resource, exportInterval: Duration.seconds(5) })

// Logs only
OtlpLogger.layer({ url: "http://localhost:4318/v1/logs", resource, exportInterval: Duration.seconds(1) })

// Metrics only
OtlpMetrics.layer({ url: "http://localhost:4318/v1/metrics", resource, temporality: "cumulative" })
```

**Configuration:**

- `OTEL_EXPORTER_OTLP_HEADERS` — comma-separated key=value pairs (e.g. `x-honeycomb-team=KEY`)
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP endpoint base URL
- `SERVICE_VERSION` — CalVer version (injected by CI)
- `GIT_SHA` — full commit SHA (short SHA derived at runtime)
- `REGION` — Unikraft metro / deployment region

When headers are not set, export is disabled (local development).

### Wide Events Pattern

Effect spans accumulate context throughout the request lifecycle:

```typescript
const span = yield* Effect.currentSpan
span.attribute('company.id', companyId)
span.attribute('interaction.channel', channel)
span.attribute('interaction.direction', direction)
span.event('interaction.logged', DateTime.unsafeNow(), { outcome: "interested" })
```

This produces a single rich event with all business context — ideal for exploration in Honeycomb or similar tools.

### Health Endpoint

Add a `/health` endpoint for Unikraft health checks:

| Endpoint  | Purpose                       | Response                                                                |
| --------- | ----------------------------- | ----------------------------------------------------------------------- |
| `/health` | Health check + build metadata | `{ message: "OK", version: "1.0.0", commit: "a3b2b23", region: "fra" }` |

**Security note:** Only expose CalVer version (no framework/dependency versions), short commit SHA, and region. No secrets, no internal paths, no stack traces.

### Self-Documenting Errors

The project uses Effect's `TaggedErrorClass` for typed errors:

```typescript
// apps/server/src/errors.ts
export class NotFound extends Schema.TaggedErrorClass<NotFound>()('NotFound', {
  entity: Schema.String,
  id: Schema.String,
}) {}
```

Enrich error logs with enough context to debug without reproduction:

```typescript
Effect.logError("Company not found").pipe(
  Effect.annotateLogs({
    entity: "company",
    lookupKey: slug,
    route: "/companies/:slug",
  })
)
```

## Summary

| Priority | Action                       | Effort |
| -------- | ---------------------------- | ------ |
| **1**    | Structured logs with context | Low    |
| **2**    | Health endpoint              | Low    |
| **3**    | Correlation IDs              | Low    |
| **4**    | Basic alerts (4 max)         | Medium |
| **5**    | Log aggregation              | Medium |
| **6**    | Dashboard                    | Medium |
| **7**    | Native metrics               | High   |
| **8**    | Distributed tracing          | High   |

**Remember:** The best observability system is the one you actually use. Start simple, add complexity when you feel pain.
