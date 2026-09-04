# Observability & Analytics Guide

Further reading: <https://loggingsucks.com/> and [All you need is wide events](https://isburmistrov.substack.com/p/all-you-need-is-wide-events-not-metrics).

Practical observability for a small team building a CRM. Focus on what helps you ship faster and debug production issues.

This guide holds the **rules and the reasons**. It deliberately does not mirror the code: file names and function signatures drift, so where something is implemented is a pointer, not a copy.

## One record per unit of work

The unit of observability is **one wide record per piece of work** — carrying every fact known about it on a single line.

Two kinds of work open a record today: an **HTTP request**, closed by `http.request` / `http.server_error` / `http.defect` / `http.not_found`, and a **research run**, closed by `research.run` with what it spent split by model, provider and kind of work. A run is not part of any request — it keeps working on a forked fiber long after the request that asked for it returned — so it opens a record of its own rather than borrowing one.

Everything else is a view over those records:

| View        | What it really is                                       |
| ----------- | ------------------------------------------------------- |
| **Logs**    | The records themselves                                  |
| **Traces**  | Records that carry a trace id, parent id and a duration |
| **Metrics** | Records counted up at query time                        |

The reason to keep them together is that **a question can only be answered from facts that share a line**. "How long did it take, split by how the caller signed in" needs the duration and the sign-in method on the same record. If the duration is on one line and the sign-in method on another, both facts were written down and the question is still unanswerable.

So the rule is: when work learns something, it puts that fact on the work's record rather than on a line of its own.

### What every record carries

| Field               | Why                                               |
| ------------------- | ------------------------------------------------- |
| `request.id`        | Ties everything from one request together         |
| `event`             | Dot-notation name, so records filter by kind      |
| `http.path_pattern` | The route, with ids collapsed — never the raw URL |
| `org.id`            | Which tenant, once resolved                       |
| `service`           | Which process emitted it                          |

Timestamps and trace ids are added by the framework.

### Event names

`{domain}.{action}[.{result}]` — so a filter on one prefix gets a whole area.

| Event                          | Description                                                |
| ------------------------------ | ---------------------------------------------------------- |
| `http.request`                 | A request completed                                        |
| `http.server_error`            | A request ended 5xx                                        |
| `http.defect`                  | A request died without producing a response                |
| `http.not_found`               | A request asked for a route that does not exist            |
| `company.created`              | New company added to CRM                                   |
| `company.status_changed`       | Pipeline status transition                                 |
| `interaction.logged`           | Interaction recorded                                       |
| `document.created`             | Research/notes document added                              |
| `email.sent`                   | Outbound email                                             |
| `email.received`               | Inbound reply                                              |
| `email.failed`                 | Email delivery failed                                      |
| `inbox.created`                | A mailbox was connected                                    |
| `inbox.probed`                 | A mailbox check that did not pass (a clean one is `debug`) |
| `inbox.probe_unrecorded`       | A mailbox was checked but the answer could not be stored   |
| `webhook.fired`                | Webhook fan-out triggered                                  |
| `webhook.failed`               | Webhook delivery failed                                    |
| `page.published`               | Sales page made public                                     |
| `page.viewed`                  | Prospect viewed a sales page                               |
| `task.created`                 | CRM task raised                                            |
| `research.run`                 | A research run finished, with what it spent                |
| `mcp.auth.rejected`            | An MCP call was refused, and why                           |
| `mcp.protocol_version.refused` | A call named a protocol revision this server does not know |
| `otlp.export.failing`          | This process has stopped being able to export, and why     |
| `otlp.export.recovered`        | Exporting works again                                      |
| `otlp.export.health`           | Whether this process is exporting, repeated on a timer     |
| `otlp.clock.skewed`            | This process and the backend disagree about the time       |
| `otlp.clock.agreed`            | This process and the backend agree again                   |

The `otlp.*` lines are the exception to one record per unit of work: they report on the reporting itself, so they belong to the process rather than to any piece of work it did. See [When export itself fails](#when-export-itself-fails).

A request leaves exactly one of `http.request`, `http.server_error`, `http.defect` or `http.not_found`. "Every request that ended badly" is the middle two: a route that does not exist is the caller's mistake rather than a fault of ours, and it is kept out of the error channel on purpose — recorded as a crash, every bot probing for `/robots.txt` leaves a stack trace at error level and buries the failures that matter.

A refused MCP tool call is the case that makes the rule concrete: the refusal travels as a JSON-RPC error inside a perfectly successful HTTP response, so the request's own line reads `http.status: 200` and a tool that turned the caller away is indistinguishable from one that answered. So the tool's name and how the call went ride on that same record as `mcp.tool` and `mcp.tool.outcome` (`ok` / `refused` / `failed`) rather than on a line of their own — recorded once, where every tool call already funnels through `apps/server/src/mcp/safe-toolkit.ts`. A refusal is the tool answering and a fault is nobody's intention, which is why the two are told apart rather than counted together. This matters more here than elsewhere because an MCP client shows a refusal as a silent retry rather than a visible error, so the record is the only place it surfaces at all.

A request also leaves exactly **one span**, not two. The platform opens that span itself, so the server passes no tracer of its own when it starts serving; passing one as well used to open a second span per request, and every count taken from the traces read double until 2026-08-18. A trace older than that carries the twins.

### Levels

| Level   | When to Use                     |
| ------- | ------------------------------- |
| `error` | Something failed that shouldn't |
| `warn`  | Degraded but working            |
| `info`  | Business events worth tracking  |
| `debug` | Development details             |

`MIN_LOG_LEVEL` sets the floor per process. In production it comes from `config.production.json`, which is copied into the image — so changing it means a rebuild and a redeploy, not a live switch. Worth knowing before an incident, when the instinct is to turn the detail up and read more.

That floor is not only ours to spend. A library can report something important at `debug` and have it dropped before any logger sees it — which is how the exporter reports that it has stopped sending anything at all. Anything a library says that we would want during an incident has to be re-said at a level production keeps.

## Counters: the narrow exception

A counter is a running total. Bumping one throws away everything about the thing being counted, which is why almost nothing here is a counter.

**The rule:** a counter may carry only tags with a handful of possible values. The store keeps a separate total for every combination of tags, so tagging by organization, run or query grows without limit. Anything per-tenant or per-request belongs on a record or in the database instead.

In practice that leaves counters for money — tokens and spend, where a running total is exactly the question — and nothing else. Business questions ("how many companies did we add?") are answered by counting records at query time, and by the database, which is the real source of truth for business facts anyway.

Do not add a counter speculatively. A counter added "so we have the number later" is a dimension deleted in advance.

## How much to keep

Records are cheap and detail is expensive, so the two are thinned differently.

- **Every unit of work keeps its record.** One line per request is small and it is the thing you search. Never sample these away.
- **Except a poll that went fine.** A successful `/health` check and a successful permission check (the `OPTIONS` a browser sends before a cross-origin call) drop to `debug`, so they are gone at the production level. Between them they can outnumber the requests a person actually made, and they say only that the poller is still polling. A failing one stays at its usual level — that is the moment they exist for.
- **Traces can be thinned.** `OTEL_TRACES_KEEP_RATE` (0..1, default 1) keeps a share of traces. The decision is made once, when the trace starts, and every span below inherits it — so a trace is kept or dropped whole, never half-exported.

Because the decision happens at the start, it cannot preferentially keep the traces that went on to fail. Keeping every failure means holding spans until the work ends and deciding then, which is a job for a collector in front of the vendor, not for the app. Until traffic justifies that, keep everything.

Routes whose URL itself carries a secret are exempt from tracing entirely rather than sampled — see Privacy.

## What to track

### Critical paths

| Flow                     | Key Events                                                            | Why Critical               |
| ------------------------ | --------------------------------------------------------------------- | -------------------------- |
| **Pipeline Progression** | `company.status_changed`                                              | Core business flow         |
| **Interaction Logging**  | `interaction.logged`, `task.created`                                  | Drives daily work          |
| **Email Outbound**       | `email.sent`, `email.failed`                                          | Primary outreach channel   |
| **Email Inbound**        | `email.received`, `interaction.logged`                                | Reply tracking             |
| **Webhook Fan-out**      | `webhook.fired`, `webhook.failed`                                     | Integration reliability    |
| **Page Publishing**      | `page.published`, `page.viewed`                                       | Sales page effectiveness   |
| **MCP Tool Calls**       | `mcp.auth.rejected`; the tool and its outcome on the request's record | Agent workflow reliability |

### Errors

Every error carries enough context to debug without reproducing it: what was being looked up, on which route, for which tenant, and the full cause with its stack. An error whose record says only that something failed costs a reproduction.

### Performance targets

| Operation          | Target      | Alert Threshold |
| ------------------ | ----------- | --------------- |
| API response       | < 200ms p95 | > 500ms         |
| MCP tool execution | < 500ms p95 | > 2s            |
| Email send         | < 2s p95    | > 10s           |
| Webhook delivery   | < 1s p95    | > 5s            |
| Page render (SSR)  | < 300ms p95 | > 1s            |

## Monitoring philosophy: the four golden signals

Follow Google's **Four Golden Signals** from the [Site Reliability Engineering](https://sre.google/sre-book/monitoring-distributed-systems/) book — the minimum set that says whether a system is healthy:

| Signal         | Question                 | Batuda Example                                    |
| -------------- | ------------------------ | ------------------------------------------------- |
| **Traffic**    | Are requests flowing?    | Request rate by route, MCP tool call count        |
| **Errors**     | Is anything failing?     | HTTP 4xx/5xx rate, webhook/email errors           |
| **Latency**    | Is it fast enough?       | API P95, MCP tool duration, SSR render time       |
| **Saturation** | Is anything at capacity? | Effect fiber health (proxy for resource pressure) |

As a solo operation there is no on-call rotation or war room. Two questions matter: *"is everything working?"* (a daily glance) and *"what exactly is broken?"* (an investigation). The golden signals answer the first. The second is answered by filtering and grouping records, not by a board built in advance — a board can only show the question someone already thought to ask.

### Targets

| Signal          | Target  | Expected Exception                             |
| --------------- | ------- | ---------------------------------------------- |
| API P95 latency | < 200ms | Scale-to-zero cold starts on Unikraft (~500ms) |
| Error rate      | < 1%    | Expect occasional webhook endpoint failures    |
| Email success   | > 95%   | Invalid addresses are expected, not failures   |

## Alerting

**Start with few, high-signal alerts.** Alert fatigue is worse than no alerts.

| Alert                | Condition                                  | Severity |
| -------------------- | ------------------------------------------ | -------- |
| **API Down**         | Health check fails for > 2 min             | Critical |
| **Telemetry Silent** | No spans from any prod dataset over 15 min | Critical |
| **High Error Rate**  | > 10% API 5xx responses in 15 min          | High     |
| **Email Failures**   | > 5 consecutive email send failures        | High     |
| **Webhook Failures** | > 20% webhook 5xx responses in 15 min      | High     |

**Telemetry Silent is the one alert that cannot be raised from inside.** Every other row above is a question asked of the records, so it needs the records to be arriving. This one has to be evaluated by the vendor, environment-wide, so it still fires when the services are stopped or cut off and cannot report for themselves — the gap that let the 2026-08-31 outage run seven hours unnoticed while `/health` answered 200 throughout. Note the consequence: once it fires it stays fired until export is restored, so it cannot warn about a second outage in the meantime.

1. **Alert on symptoms, not causes** — "API returning errors" > "Database connection failed"
2. **Include runbook link** — What to do when this fires
3. **Test your alerts** — Trigger them intentionally
4. **Review monthly** — Delete alerts that never fire or always fire

## Privacy in observability

This is a CRM holding other people's customer data, so what never gets written down is a hard rule rather than a preference. The trade is real: a problem can only be found in facts that were kept. The answer is to record **more harmless** facts — plan tier, feature flag, provider, model, retry count, cache hit — not more personal ones.

### What we collect

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

### Never record

- API keys, tokens, or secrets
- Full email addresses (use contactId, or the domain alone)
- Document, page or message content (only type and length)
- Database credentials
- Full webhook secrets (use endpointId)

### Three rules that are easy to get wrong

**Raw URLs never get recorded.** A URL can carry a single-use secret — a magic-link token in the query, a reset-password token in the path. Records carry a sanitized route with ids collapsed instead. Routes whose URL is itself a credential are exempt from tracing altogether, because the tracer records the full URL unredacted (headers like `authorization` and `cookie` are redacted by default; the URL is not).

**Whole argument bags are scrubbed, not the fields that look sensitive.** Tool-call arguments are recorded verbatim by the AI toolkit and include mailbox passwords and whole attached files. Any list of sensitive-looking field names holds only until someone adds a field nobody thought to name — and that field would be secret exactly when it mattered. So the whole value goes, and anything worth tracing gets its own deliberate attribute.

**Scrubbing happens centrally, on the way out — on both routes out.** The recording happens inside third-party libraries, so it is caught centrally rather than at each call site. There are two ways out of the process, and both are filtered: span attributes, via the wrapped tracer, and facts gathered onto a record, which leave on a log line instead. Filtering only the first would leave the second as a way around it.

**Error text is the one accepted exception.** A crash's cause is the most useful thing it leaves behind, so it is logged in full rather than summarised — and a database error can name business data incidentally, in a failing statement or a constraint violation. The cause is bounded in size so a failure cannot ship a whole payload, but not in content. This is why observability retention is days-to-weeks rather than months.

### Safe patterns

```typescript
// Metadata instead of content
{ 'document.type': 'research', 'document.content_length': content.length }

// Domain instead of address
{ 'contact.email_domain': domain }

// Tenant by id, never by name
{ 'org.id': org.id }
```

## Analytics vs observability

| Aspect        | Observability           | Analytics                       |
| ------------- | ----------------------- | ------------------------------- |
| **Purpose**   | Debug production issues | Understand user behavior        |
| **Audience**  | Engineers               | Product/Business                |
| **Latency**   | Real-time               | Can be delayed                  |
| **Retention** | Days to weeks           | Months to years                 |
| **Examples**  | Error rates, latency    | Pipeline conversion, page views |

For business behaviour, the database is the source of truth, not the telemetry. Records are for debugging what the system did; the CRM tables are for what the business did. If a product question needs a dedicated tool later, PostHog (self-hostable) or Plausible (privacy-focused) are the candidates.

## Local development with otel-tui

The Nix flake provides [`otel-tui`](https://github.com/ymtdzzz/otel-tui) — a terminal OpenTelemetry receiver + viewer. It listens on the standard OTLP ports (`:4317` gRPC, `:4318` HTTP/JSON) and renders traces, logs, and metrics inline, so you can inspect them without running Jaeger/Grafana/Honeycomb locally.

```bash
# Terminal 1 — start the viewer (empty until traffic arrives)
pnpm dev:otel

# Terminal 2 — start the server; it will POST OTLP/JSON to localhost:4318
pnpm dev:server
```

Swapping environments is a pure env-var change:

| Environment      | `OTEL_EXPORTER_OTLP_ENDPOINT`               | `OTEL_EXPORTER_OTLP_HEADERS` |
| ---------------- | ------------------------------------------- | ---------------------------- |
| Local (otel-tui) | `http://localhost:4318`                     | *(empty)*                    |
| Honeycomb        | `https://api.honeycomb.io`                  | `x-honeycomb-team=KEY`       |
| Grafana Cloud    | `https://otlp-gateway-....grafana.net/otlp` | `Authorization=Basic ...`    |

## Configuration

| Variable                      | Meaning                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base URL. **Also the on/off switch** — unset means no export at all.                                          |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Comma-separated `key=value`. Carries the vendor key, so it's a secret.                                        |
| `OTEL_TRACES_KEEP_RATE`       | Share of traces to keep, 0..1. Default 1. An unusable value falls back to 1 rather than stopping the process. |
| `MIN_LOG_LEVEL`               | Level floor per process.                                                                                      |
| `SERVICE_VERSION`             | CalVer version, injected by CI.                                                                               |
| `GIT_SHA`                     | Full commit SHA; short SHA derived at runtime.                                                                |
| `REGION`                      | Deployment region.                                                                                            |

The endpoint is non-secret, so it lives in each app's `config.production.json` alongside the other endpoints — not a CI secret. It is deliberately left out until a vendor is set up, so export stays dark by default — quietly outside production, and at `error` inside it, where its absence means the image was built wrong.

The headers are the half that does not ship in the image: they carry the vendor key, so they arrive as `-e` on the boot command line and live only in whatever the platform kept for that instance. The two halves can therefore disagree — the endpoint is always present, so export always switches itself on, whether or not a key came with it. Export enabled with no key is a 401 on every batch, which now says so rather than going quiet.

**Per-service datasets.** Traces route to a Honeycomb dataset named after `service.name`, so each process separates on its own. Logs and metrics route by the `x-honeycomb-dataset` header instead, so each deploy workflow appends its own dataset name to the shared team-key secret. One environment-scoped API key covers every process.

A process only reports if it **merges** the observability layer into the layer it runs on. Provided without merging, it boots, says export is enabled, runs the exporter's own flushers — and sends none of its own lines, because the logger and tracer the exporter installs never reach the code that writes them. The mail-worker ran that way until 2026-08-18: alive, logging, and absent from the vendor. `packages/observability/src/otlp.test.ts` holds that line.

Note the consequence: logs and traces from the same request land in different datasets. That is the vendor's routing, not a choice — it is why the per-request record has to be self-sufficient rather than something you assemble by joining a log to a trace.

## When export itself fails

A process that cannot export looks exactly like a healthy one. It serves traffic, writes its lines, and the vendor simply has nothing — which reads as a quiet night rather than a fault. Prod ran that way for seven hours on 2026-08-31 before anyone noticed, and the reason nothing surfaced is worth stating plainly: the exporter reports a refused batch at `debug` and disables itself for sixty seconds, and both deployed services run at `info`, so the runtime discarded the only diagnostic before a logger saw it. That was the entire failure report.

So the export path reports on itself, on the one channel that still works when export does not — the process's own console. It says `otlp.export.failing` once when export breaks and `otlp.export.recovered` once when it comes back, rather than on every attempt, because a backend that is down produces a failure every interval and repeating it buries the console it is trying to reach. And it repeats `otlp.export.health` every few minutes regardless, because the platform hands back the end of an instance's console log rather than the beginning: a line written once at start-up has scrolled away by the time anyone asks, which is what made the 2026-08-31 outage undiagnosable without a restart. A line that comes back is always in the part you can still read.

Deliberately not sent to the backend. A report that export is broken is worth nothing if it goes out the way that is broken.

**Silence is not failure.** The alarm asks whether the last attempt failed and has kept failing — never whether something arrived recently. Logs and traces skip a batch with nothing in it, so a quiet service legitimately posts neither, and a staleness test would call every overnight service broken. What keeps a genuinely dead channel from hiding behind a quiet one is metrics, which posts on every interval whether or not it has anything to say.

**A missing endpoint is loud in production, but never fatal.** In production the endpoint ships inside the image, so its absence is a broken build and is said at `error`. It still does not stop the process: telemetry is not needed to serve a request, and refusing to boot over a monitoring setting would turn being unable to watch production into being unable to run it. Outside production, export being off is ordinary and stays at `info`.

**The three signals are tracked apart.** A backend can take our logs and refuse our traces, so one "is export working" flag would read healthy while traces were being dropped.

### A wrong clock is the failure none of that catches

Everything above asks whether a batch was refused. A machine with a wrong clock refuses nothing: every span and log is sent, accepted, and stored — at the wrong moment. Nothing fails, nothing retries, and the only symptom is that questions about a recent window come back empty, which reads as a quiet service rather than a broken one. Production spent a day like that on 2026-08-31, and the export watchdog would have called it healthy throughout.

So the export path also compares its own clock against the backend's. Every HTTP reply carries a `Date`, and we are already talking to that backend constantly, so this costs no extra request and no extra dependency — the difference is read off replies we were making anyway. Only off accepted ones: a proxy or an error page is not the backend, and its idea of the time proves nothing. `otlp.clock.skewed` is said the first time the difference passes a two-minute tolerance — generous, because a reply's clock has one-second resolution and the round trip adds more. What it is looking for is not drift but a clock that stopped.

The cause worth knowing: a stopped machine keeps the time it went to sleep with. Restarting a stopped instance resumes it hours behind, while **deploying a fresh one gets a correct clock** — so redeploy, do not start.

## Health endpoint

`/health` returns build metadata for uptime checks and deploy verification — CalVer version, short commit SHA, region — plus whether this instance is still reaching the telemetry backend.

The telemetry block is there because of the failure above: the console of a deployed instance is not always reachable, and an instance that cannot export cannot report that through the thing it exports to. One unauthenticated request answers it from anywhere, which is the point.

It also carries how far the instance's clock sits from the backend's, in seconds, negative when behind — absent until a reply has been read, because absent means unknown rather than zero.

**Security note:** those, and nothing more. No framework or dependency versions, no internal paths, no stack traces — and from the telemetry block, no backend host, no vendor wording and no status line: only a closed set of reasons (`unauthorized`, `rate_limited`, `rejected`, `unreachable`), enough to tell a rejected key from a quota from a dead route. The reason is a fixed set rather than whatever the backend said on purpose: the backend's wording is derived from our request, and our request carries the API key in a header.

It is also exempt from tracing — an uptime checker polls it constantly and would drown the real traces.

## Where this lives in the code

Pointers, not copies — read the files for detail.

| Concern                                                       | Where                                              |
| ------------------------------------------------------------- | -------------------------------------------------- |
| Shared exporter, sampling, span scrubbing, cause bounding     | `packages/observability`                           |
| Export health: per-signal outcomes, the watchdog, the report  | `packages/observability/src/export-health.ts`      |
| Per-request record, route sanitizing, catch-all error logging | `apps/server/src/lib/observability-middleware.ts`  |
| Logger set and level                                          | `apps/server/src/lib/logger.ts`                    |
| Tracing exemptions for secret-carrying routes                 | `apps/server/src/main.ts`                          |
| Spend counters                                                | `packages/research/src/application/usage-meter.ts` |

Three structural notes worth knowing before changing any of it:

**Effect's annotations flow downward, not upward.** An annotation set at the edge reaches every log written inside the request, which is why request id and route ride along for free. But a fact learned deep inside does *not* flow back out to the closing line — that is what the work record exists for.

**The built-in request logger is deliberately disabled.** It annotates the raw request URL, which would export magic-link and reset tokens verbatim. The middleware emits a sanitized completion line in its place. Re-enabling it would reintroduce that leak.

**Better Auth's errors need a bridge to be seen at all.** Better Auth runs its callbacks outside the Effect fiber, so its internal failures — adapter errors, OAuth/OIDC problems — reach the console and nothing else. They are forwarded onto the Effect runtime deliberately; without that they never export, and an auth outage looks like silence rather than errors.

**Two auth surfaces are instrumented on purpose, not by blanket rule.** The MCP sign-in path and the OAuth token endpoint each carry extra facts because of one bug class: an MCP client shows a refused or expired credential as a silent retry loop, never a visible error. So how the caller signed in, which org they resolved to, and the grant outcome are recorded — enough to tell a dropped connection from a rejected one without reproducing it. Facts elsewhere are added where a question actually needs them, not across every endpoint.

**Telemetry has to be handed out of a layer, not just used inside it.** A layer can pass a service down to the layers it builds, or hand it back to whoever builds on top; those are two different things and they look the same to the compiler. The mail worker's loop is handed its layer from outside, so telemetry passed only downward reached the layers named in the stack and never the loop that writes every line. The worker started up, said exporting was enabled, and sent nothing — for months. Its dataset was never created, so the only sign was a gap nobody was watching.

Nothing catches this on its own. The exporter's own type is erased by the branch that turns exporting off, so both spellings typecheck identically, and the process looks healthy either way. The guard is the mail worker's layer test, which builds the real layer and checks a logger and a tracer are among what comes out. It needs a database, because building the real layer means building all of it — so it lives in the integration suite and does not run under `pnpm test`.

**Global middleware order has to be stated, not assumed.** Router-wide middleware wraps a request in reverse registration order, and registration order is layer build order — which `Layer.mergeAll` performs concurrently. Left in a merge list, the observability middleware lands wherever the build happens to put it, and that position can change without anyone editing it.

It has to be outermost, because a middleware that answers a caller itself — the MCP sign-in check refusing a connection — hides everything registered after it. Registered later, the observability middleware would never run for a refusal, and a refused MCP connection would leave no record of the request at all. That is the case an MCP client shows as a silent retry loop rather than a visible error, so it is the one that most needs a record.

So it is *provided* to the rest of the app rather than merged alongside it, which states the order as a dependency the build has to respect. The regression guard is the middleware-order test, which drives a real server through a refusing middleware and fails if the two are registered the other way round.
