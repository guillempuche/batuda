# Batuda server-side agent platform — design & build-vs-buy

Status: **Direction set (Guillem, 2026-07-05).** Batuda will host multiple specialized niche server-side agents — research is the first, not the only — because generic external AI can't handle Batuda's domain-specific agentic work. Decision: **build a shared Effect-native** `AgentRuntime` (in-fiber, RLS-safe) rather than adopt Mastra. Ship the research loop on `effect/unstable/ai` now ([#125](https://github.com/guillempuche/batuda/issues/125)) as the reference agent; let the shared runtime fall out as agents #2/#3 land; revisit Mastra only for a future DB-light agent, behind an out-of-process boundary.

For system context see [architecture.md](../architecture.md) and [backend.md](../backend.md); this note assumes the intelligence-locus split (external MCP-client AI is primary for general generation; Batuda hosts specialized server-side intelligence).

---

## Context

The most important intelligence stays external — the MCP-client AI the human talks to does the bulk of general generation. What changed on 2026-07-05 is the *server-side* slice: it broadens from just `research` to a set of **niche agents** whose domain work the generic external AI does poorly. That makes a dedicated agent framework/layer proportionate — the earlier "disproportionate to one loop" caveat no longer applies.

"Dedicated framework: yes" is the decision. "Which framework" is build-vs-buy, and the rest of this doc works it: the agent taxonomy, the four concrete agents, the shared Effect-native runtime, whether Effect has the primitives, and why not Mastra.

---

## Agent taxonomy — the distinction that sizes the platform

In Batuda "agent" means two different things, and which bucket each falls into is the whole decision:

- **Server-side agent** — runs a bounded tool loop *server-side*, autonomously or on request, because **no external brain is in the loop at trigger time**. Needs the runtime (budget, providers, RLS, dispatch). Research is this.
- **Advisory surface** — the *external* MCP-client AI composes, reading Batuda's context (a lens resource) + the instruction stack. The server provides memory + tools + house method; it does **not** generate. Negotiation/email/chat are deliberately this (see the timeline-spine note).

The axis that sorts them: **event-triggered & autonomous → server-side agent; on-demand with a human present → advisory surface.** An agent can have both modes (autonomous draft on a trigger + advisory refine in chat).

---

## The four agents

| Agent                 | Trigger                              | Who composes     | Bucket                           |
| --------------------- | ------------------------------------ | ---------------- | -------------------------------- |
| **research**          | `start_research` request             | server-side loop | server-side agent (exists, #125) |
| **pre-meeting**       | calendar `meeting_scheduled` (spine) | *the fork below* | server-side agent if autonomous  |
| **post-meeting**      | meeting ends / recording lands       | *the fork below* | server-side agent if autonomous  |
| **negotiation brief** | human in the client                  | external brain   | advisory surface                 |

This diverges deliberately from timeline-spine Slice H, which chose *advisory* for pre-meeting (*"keep authoring on the client… the server seeds the artifact and the trigger, not the prose"*), leaving open "auto-create the prenotes doc, or just nudge?". Treating pre/post-meeting as **agents** answers that: make them autonomous server-side, not nudges.

**The fork to settle:** for pre/post-meeting, autonomous server-side vs advisory nudge is a product call. Autonomous = a calendar event fires at 7am, the agent assembles prep (negotiation lens + latest research + open tasks + house-method stack) and the prenotes brief is ready before you open the app — proactive, and consistent with intelligence-locus (no human is prompting the external brain at 7am, so this is work the external brain can't do, not "generation moved server-side to enforce"). Advisory nudge = Slice H as written; the external model composes, but only when you next engage. Pre-meeting is where proactive value is highest. Negotiation-brief authoring stays advisory — open-ended strategy the external brain does best.

**How the timeline spine grounds it.** The spine is the passive memory; the agents are the active layer on top:

- **Triggers** — `meeting_scheduled` / recording-ready events (via `TimelineActivityService.record` / `services/calendar.ts`) enqueue an agent run. Kept as a few *named event→agent bindings*, not a general bus — consistent with the spine doc's "why not an event bus" stance.
- **Context** — `batuda://negotiation/{slug}` (contacts + event feed + brief refs) and prior research are the agents' read tools.
- **Output sink** — agents write `prenotes`/`postnotes` documents, emit `document_created` on the spine, and create follow-up tasks — the artifacts the spine doc already defines.
- **Instruction tier** — a server-side pre-meeting agent would *enforce* the `negotiation` stack at generation (like research), where Slice D wired it advisory. Going server-side flips that tier.

All three server-side agents (research, pre/post-meeting) are **RLS- and DB-write-heavy** — they read the org's CRM under RLS and write documents, spine events, tasks, proposed-updates. That profile is what fits in-fiber/native and fights an out-of-process framework; none is the DB-light, orchestration-heavy agent that would suit Mastra out-of-process better.

---

## Start simple — the layered path

The platform is not one build, and it is emphatically not "adopt a framework." It is a sequence of four layers of increasing sophistication, three of which are the *same* native Effect substrate at growing maturity, and the fourth a different substrate reserved for one narrow case. The governing discipline is **graduate on pain, not on principle**: you start at Layer 0 and move up only when a concrete, felt need forces it — never because a higher layer exists or looks tidy. Most of Batuda's near-term agents live comfortably at Layer 0 or Layer 1; Layer 2 and the Mastra axis are things you may never reach.

The mental model that matters: Layers 0–2 are **increasing sophistication of one native stack** (Effect fibers + `effect/unstable/ai` + Postgres/RLS), so moving between them is refactoring and opt-in machinery, never a runtime change. The Mastra axis is a **different substrate** (a Promise framework, a second runtime) — so it is not "Layer 3," it is a fork you take only for an agent that does not fit the native stack.

### Layer 0 — the in-fiber loop

This is the simple approach, and it is the recommendation for the near term. Today's `research-service` is *already* fiber-per-run: each run is a forked Effect fiber that executes under `enterOrgScope`, on the RLS-pinned connection, gated by a per-user concurrency semaphore, with a dispatch queue, per-run budget, SSE streaming, heartbeat, orphan sweep, and checkpoint/resume all in place. Layer 0 changes exactly one thing: it replaces Phase 1's single non-reflective model call with a **bounded reflect-and-retry loop inside that same fiber** — a hand-rolled loop over `effect/unstable/ai`'s `LanguageModel` + `Toolkit` that iterates (search → judge → scrape → extract) until it has grounded evidence or hits a step/budget cap, then feeds the looped transcript to structured extraction. That is [#125](https://github.com/guillempuche/batuda/issues/125) (plus [#145](https://github.com/guillempuche/batuda/issues/145) contacts and the [#193](https://github.com/guillempuche/batuda/issues/193) grounding guard).

What Layer 0 explicitly does **not** add: no shared `AgentRuntime` abstraction, no `unstable/workflow` or `cluster`, no durable-execution engine, no Mastra, no second runtime, no second host, no second schema system, no new hosting of any kind. It is a loop in a file, running on machinery that already exists and already works.

Why it is the right first move on the merits, not just as a stepping stone. It is the urgent fix — production is currently shipping confident, fabricated findings, and this is what stops it. It is roughly one file of new logic. It stays one hundred percent native, so it inherits typed errors, structured cancellation via `Fiber.interrupt`, layer-provided dependencies, the OTLP → Honeycomb trace export, and — the property the whole doc turns on — tenant isolation that is correct *by construction* because the tools run in-fiber on the org-scoped connection. And it is the reference implementation: building it teaches you concretely what a "server-side agent" in Batuda actually needs (which tools, which budget shape, which output sink, which failure modes) before you generalize a single line.

What it costs, honestly: if you add a second or third agent while still at Layer 0, that agent will copy some of `research-service`'s wiring — its dispatch hand-off, its budget setup, its output-write path. That duplication is acceptable for one more agent, and it is precisely the *signal* that tells you when Layer 1 has earned its place. You do not pre-empt it.

When Layer 0 is enough: possibly for months, possibly longer than you expect. If your server-side agents stay few and share a shape, Layer 0 plus a little copy-paste is a legitimate resting point, not a deficiency. Do not leave it until the copy-paste actually hurts.

### Layer 1 — extract the shared `AgentRuntime` (when agents #2/#3 land)

When pre-meeting and post-meeting agents arrive, you will see the same machinery repeated across three services: dispatch, fiber-per-run, per-run budget, RLS scoping, provider tiers, checkpointing, SSE, heartbeat. Layer 1 is the act of **extracting that repeated machinery** out of `research-service` into a reusable runtime, against which each agent supplies only what is genuinely agent-specific — its trigger source, its toolkit, its instruction tier, its output sink, its budget policy — and inherits everything else.

The crucial framing is that this is *extraction*, not a framework build. You are generalizing code that already works and has been proven by at least two, ideally three, real agents — not designing an abstraction on speculation. This is the anti-"not-invented-here" discipline stated as a rule: the abstraction is *discovered* from real repetition, not invented up front. Extract on the third occurrence, not the first; a runtime generalized from one agent is a guess, a runtime generalized from three is a pattern.

What triggers the graduation is the concrete friction of the second (and especially the third) agent — when copy-pasting the runtime wiring becomes annoying and, worse, error-prone (a subtly different budget setup or a missed RLS scope in the copy is exactly the kind of bug this removes). What it buys is that each subsequent niche agent becomes cheap to add, that budget/RLS/observability bugs are fixed in one place instead of three, and that you accumulate a reusable asset you own. What it costs is the extraction refactor itself and the ongoing discipline of keeping the runtime agent-agnostic rather than letting one agent's quirks leak into it.

And it is still Layer 0 underneath: the extracted runtime is the same plain fibers, the same `effect/unstable/ai`, the same Postgres dispatch. Layer 1 is a refactor of Layer 0's *shape* into something reusable — not a new runtime, not new infrastructure.

### Layer 2 — durable execution via `unstable/workflow` (only if a long agent needs it)

Durability today is hand-rolled: `research-service` writes its phase, research text, and findings after each phase, and on restart it skips the phases that already completed. That is enough for short runs. Layer 2 replaces the hand-rolled checkpointing with Effect's `unstable/workflow` engine on a single-node `SingleRunner`, which provides **automatic** suspend and resume — a long, multi-step agent survives a process restart mid-step without you writing any checkpoint logic — plus durable timers and signals (`DurableClock`, `DurableDeferred`) for agents that need to *wait* durably, for example to pause for a human approval, to retry after a delay, or to continue on a schedule.

Hosting, verified earlier in this doc, is the key reassurance: Layer 2 needs **no new infrastructure**. `SingleRunner` is a SQL-backed single-node cluster that runs in the existing process against Neon and binds no socket; the only additions are a few cluster tables and the machinery running in-process. The genuine costs are that you take on a pre-stable (`unstable/`) subsystem with thinner docs and API churn, and that there is more machinery inside your process.

When to graduate: when an agent's runs become long and multi-step enough that losing progress to a mid-run crash actually hurts, or when an agent needs to durably *wait* — approval gates, delayed retries, scheduled continuations — which hand-rolled checkpoints handle awkwardly. Short loops like research today do not need it, and many agents never will. Layer 2 is a per-agent (or platform-wide) choice that is independent of Layers 0 and 1; you can run some agents durably and others not.

### Separate axis — Mastra out-of-process (only for a future DB-light agent)

This is not a layer on top of 0–2; it is a different substrate, and it belongs on its own axis. Mastra is a Promise framework — a second runtime — and the RLS spike showed why it does not fit Batuda's DB-heavy agents: its tools run outside the fiber and fail *open* across tenants unless you rebuild the whole out-of-process apparatus around them. So it is never the default and never a graduation of the native path.

It earns consideration for exactly one profile: a hypothetical *future* agent that is orchestration-heavy and genuinely DB-light — one that barely touches the org's RLS-scoped CRM and instead mostly reasons over external tools and returns synthesized text (a pure web-research or outreach agent might qualify). For that narrow case, Mastra's batteries can earn their keep and the RLS impedance is minimal, and it would always run behind the out-of-process (Sketch B) boundary so it never touches the Effect server, RLS, or data directly. When: only if such an agent actually appears, and only after the four spike-first questions (below) pass. Not now, and not for any of the four agents on the table today.

### Applying the ladder to today's agents

Research is Layer 0 now (that is #125). Pre-meeting and post-meeting begin at Layer 0 and are the agents that will pull you to Layer 1 by their repetition. None of the three obviously needs Layer 2 yet — their loops are short and do not wait durably — though a post-meeting agent that waits for a recording to be transcribed, or a pre-meeting agent scheduled hours ahead, is the kind of thing that could later justify it. The Mastra axis is reserved and, on the current inventory, unused. The whole platform, in other words, is Layer 0 today, drifting to Layer 1 as the second and third agents land — which is the minimal-just-in-time-scope stance made concrete.

---

## The shared Effect-native `AgentRuntime`

Generalize `research-service`'s machinery so each agent plugs in five things, and nothing else:

1. **Trigger source** — request (research) | spine event (pre-meeting: `meeting_scheduled`) | recording-ready (post-meeting).
2. **Toolkit** — per-agent `Tool.make` handlers (all in-fiber → RLS-native).
3. **Instruction tier** — enforced (research, autonomous pre/post-meeting) or advisory.
4. **Output sink** — findings + proposed-updates (research) | prenotes/postnotes document + spine event + tasks (meetings).
5. **Budget policy** — per-run cheap/paid caps.

Everything else is shared and already exists in `research-service`: dispatch queue + reconcile, fiber-per-run + per-user concurrency gate, per-run budget + monthly cap, provider tiers + fallback + caching, `enterOrgScope`/RLS, heartbeat + orphan sweep, SSE pubsub, checkpoint/resume, fan-out. Building the runtime is **extraction**, not greenfield. Research is instance #1; pre/post-meeting are #2/#3 on the same runtime.

Guidance: don't build `AgentRuntime` upfront. Ship #125 as a normal service; let the shared runtime *fall out* as #2/#3 land and the real repetition shows — avoids the not-invented-here over-build.

---

## Does Effect have the primitives? (audit)

`effect/unstable/ai` ships: `LanguageModel`, `Chat`, `Tool`, `Toolkit`, `Prompt`, `Response`, `EmbeddingModel`, `Tokenizer`, `Model`, `McpServer`/`McpSchema`, `Telemetry`, `{Anthropic,OpenAi}StructuredOutput`, `AiError`. The adjacent `effect/unstable/` subsystems ship: `workflow`, `cluster`, `persistence`, `eventlog`, `rpc`, `reactivity`, `sql`, `http`/`httpapi`, `observability`, `workers`.

| AgentRuntime need                            | Provided by                                                                     | Status                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| LLM call + tool-calling                      | `LanguageModel.generateText({ toolkit })`                                       | have (single-round)                                                    |
| Bounded reflect loop (`maxSteps`/`stopWhen`) | hand-roll over `Chat` + `Toolkit` (~1 file, #125)                               | **build (small)**                                                      |
| Tool defs + typed handlers                   | `Tool.make` + `Toolkit` + `toLayer` (in-fiber, RLS-native)                      | have                                                                   |
| Structured output                            | `LanguageModel.generateObject({ schema })`                                      | have                                                                   |
| Conversation history                         | `Chat` / `Prompt.concat` + `Prompt.fromResponseParts`                           | have                                                                   |
| Streaming                                    | `LanguageModel.streamText` / `Stream`                                           | have                                                                   |
| Embeddings / semantic-memory substrate       | `EmbeddingModel` + `sql` (pgvector)                                             | have (assemble)                                                        |
| Token counting                               | `Tokenizer`                                                                     | have                                                                   |
| Per-run budget + monthly cap                 | `research-service/budget.ts` (`makeBudgetLayer`)                                | Batuda has                                                             |
| Provider tiers + fallback + caching          | `llm-live` / `cached-llm` / `_fallback`                                         | Batuda has                                                             |
| Dispatch / queue                             | Effect `Queue` + Postgres `SKIP LOCKED`                                         | have                                                                   |
| Fiber-per-run + concurrency gate             | `Fiber` + `PartitionedSemaphore`                                                | have                                                                   |
| Cancellation                                 | `Fiber.interrupt` (structured)                                                  | have                                                                   |
| Scheduling / retries / backoff               | `Schedule` + `Effect.retry`                                                     | have                                                                   |
| Durable / resumable runs                     | hand-rolled checkpoint (Batuda has) **or** `unstable/workflow` + `SingleRunner` | have (two options — see below)                                         |
| Event-sourced triggers                       | timeline spine `record()` + `unstable/eventlog`                                 | Batuda has                                                             |
| Per-run / shared state                       | `Ref` / `FiberRef` / `SubscriptionRef`                                          | have                                                                   |
| SSE / pub-sub                                | `PubSub` + `Stream.fromPubSub`                                                  | Batuda has                                                             |
| Typed errors                                 | `Schema.TaggedError`                                                            | have                                                                   |
| Tracing / observability                      | Effect tracing → OTLP → Honeycomb                                               | Batuda has                                                             |
| RLS / org scope                              | `enterOrgScope` + `effect/unstable/sql` (in-fiber = native)                     | Batuda has                                                             |
| MCP server (expose tools)                    | `effect/unstable/ai` `McpServer`                                                | Batuda has                                                             |
| Instruction stacks (enforced/advisory)       | `packages/instructions`                                                         | Batuda has                                                             |
| Output → documents / spine / tasks           | Batuda services                                                                 | Batuda has                                                             |
| Evals / scorers                              | none native                                                                     | **gap** — build, or graft `@mastra/evals` (Apache-2.0) at arm's length |
| Dev inspection UI (Studio)                   | none; use Honeycomb traces                                                      | **gap (DX)**                                                           |
| Provider catalog (turnkey)                   | wire providers explicitly (Nebius wired)                                        | minor gap                                                              |
| MCP client (consume external MCP tools)      | not evident in `unstable/ai` (server only)                                      | **gap** if ever needed                                                 |

Verdict: Effect gives you **unassembled bricks, not batteries** — and at the *runtime* layer the bricks are a superset of Mastra's (fiber, scope, DI, queue, schedule, plus `workflow`/`cluster`/`eventlog` for durable/distributed execution, which Mastra lacks). The genuine gaps — a prebuilt loop (you build it), evals, Studio, provider catalog, MCP client — are things your three agents don't need on day one (evals is the one you'd most want, and it's graftable). The real cost is **assembly effort + that** `ai` **/** `workflow` **/** `cluster` **are** `unstable/` (pre-stable, thin docs, API churn) — a maturity risk, not a capability gap.

---

## Durability & hosting (verified)

Do `workflow`/`cluster` need different hosting? **No — not for what Batuda would use.** Verified against the vendored source:

- `SingleRunner.layer` is, in its own words, *"a sql backed single-node cluster, that can be used for running durable entities and workflows."* Its only requirement is `SqlClient` — the Postgres you already have (Neon).
- It composes `Runners.layerNoop` (no inter-node client) + SQL message/runner storage + `RunnerHealth.layerNoop`. It imports **no** `RunnerServer` / `SocketRunner` / `HttpRunner`, and `Sharding.layer` requires no `RunnerServer` — so **nothing binds a socket**. Shard coordination happens by reading/writing `RunnerStorage` rows (SQL), not over the network. The default `localhost:34431` in `ShardingConfig` is a node *identity* written to a storage row, not a bound port.
- Confirmed: only `RunnerServer`, `SocketRunner`, `HttpRunner`, `EntityProxy` open listeners, and single-node uses none of them.

So durable, resumable agent runs (`unstable/workflow`, with `DurableClock`/`DurableDeferred` for timers/signals) run **in the existing process, on the current Unikraft instance + Neon, with no new infrastructure and no socket.** The multi-node distributed mode (multiple runners, HTTP/socket transport, K8s discovery) is opt-in and only needed to scale *out* — that would be new hosting, later, if one node can't keep up.

The real choice is therefore not infra but **durability approach**: `research-service` already does resumable runs with hand-rolled checkpoints + Postgres dispatch; `unstable/workflow` buys *automatic* suspend/resume so a long multi-step agent survives a restart mid-step without hand-rolled checkpointing. Worth it for long/complex agents; overkill for short loops. Either way: no new host.

---

## Build-vs-buy: the Mastra evaluation

### What Mastra is

Mastra (`@mastra/core` 1.49, YC W25, Apache-2.0 core) is a TypeScript agent framework built **on the Vercel AI SDK**, Zod-native. It ships a built-in tool loop (`maxSteps`/`stopWhen`), structured output (`jsonPromptInjection` handy for Nebius), memory, workflows, RAG, evals, a Studio UI, model routing/fallbacks, MCP client + server. Genuinely production-grade, but fast-moving (a minor every few days) and it rides AI SDK v5/v6/v7 at once — pinning + codemod discipline mandatory. Nebius plugs in cleanly (`model: { id: 'custom/…', url: '…/v1', apiKey }`).

### Licensing & vendor risk

Open-core: the runtime you'd embed is Apache-2.0 (free, closed-source-commercial-safe, patent grant, no copyleft); premium features live in nested `ee/` directories under a separate paid, source-available Enterprise License. Enumerated from the repo tree (2026-07-05, not truncated), the `ee/` set is: enterprise **auth/RBAC** (`core/src/auth/ee`, `_internals/auth/src/ee`), the **agent-builder** (`core/src/agent-builder/ee`), and **Studio/Playground/editor UI** (`playground-ui/src/ee`, `editor/src/ee`, `playground/src/ee`). Everything else — agent loop, tools, workflows, memory, RAG, **evals**, model routing, MCP, structured output — is Apache-2.0.

For Batuda that's reassuring: the features we'd touch are all free core; the paid `ee/` set is auth/RBAC (we have Better Auth + RLS), Studio polish (dev-time), and agent-builder (unused). The residual risk is *trajectory*: a YC open-core company has monetisation pressure to (a) migrate more features into `ee/` over time and (b) possibly relicence the core later (Redis/Elastic/HashiCorp/Mongo pattern). Mitigant: Apache-2.0 is irrevocable for released versions — a relicence means forking the last permissive version, not being trapped. For a solo-founder foundation this weighs toward the in-house option; and if Mastra is adopted, the out-of-process boundary doubles as vendor insurance (swap the brain without touching Effect/RLS/data). EU note: even the core ships `posthog-node` telemetry (disable via `MASTRA_TELEMETRY_DISABLED`); the enterprise build adds license-validation telemetry.

### The RLS impedance + spike (the decisive finding)

Batuda's tenant isolation is connection-pinned: `enterOrgScope` runs `SET LOCAL ROLE app_user` + `set_config('app.current_org_id', …, true)` inside one transaction on the fiber's connection. Effect-AI tools run **in-fiber**, so they inherit it for free. Mastra's tools run as plain async functions **outside** the fiber; they grab a different pooled connection with no scope — and the pool's login role is a `BYPASSRLS` superuser, so losing the scope **fails open**, not closed.

Live spike (2026-07-05, throwaway worktree, `@mastra/core@1.49.0`, mock OpenAI endpoint driving a real `Agent` under the real `enterOrgScope`, seeded orgs `taller` + `restaurant`):

| Experiment                                           | Result                                              | Read                          |
| ---------------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| **E1** Effect-native tool (control), taller scope    | `role=app_user, org=taller, taller=2, restaurant=0` | ✅ isolation correct          |
| **E2** Mastra tool, naive bridge                     | `role=batuda, org=null, taller=2, restaurant=1`     | 🚨 **cross-org leak**         |
| **E2b** Mastra tool re-enters `enterOrgScope` itself | `role=app_user, org=taller, restaurant=0`           | ✅ but by hand, separate tx   |
| **E3** `Fiber.interrupt` mid-tool                    | `toolSawAbortSignal=true`, stopped in ~1 poll       | ✅ cancellation works in 1.49 |

A `taller`-scoped run's Mastra tool read `restaurant`'s data as superuser. Fixable only if **every** DB tool re-establishes the org scope by hand (org id via `RequestContext`, separate transaction) — a fail-open footgun. Cancellation, by contrast, is fine in 1.49 (the Dec-2025 fix works). RLS is the blocker.

### Why build native instead of Mastra

1. **For Batuda's RLS-heavy agents, native is *correct by construction*; Mastra *breaks isolation* unless you build the out-of-process apparatus.** Demonstrated, not aesthetic.
2. **You already own most of the runtime** — building `AgentRuntime` is extraction; adopting Mastra means replacing working native machinery (budget, caching, RLS) and bridging back.
3. **The batteries you'd pay for, you mostly don't need or already have** — the loop is ~1 file; memory/workflows/RAG aren't what CRM prep agents need; you have provider fallback.
4. **One runtime, one paradigm, one host, one vendor: you.** Mastra adds a second Promise runtime + Zod + PostHog + a second host + pipeline + seams, plus a YC open-core dependency on the critical path.
5. **It compounds** — the runtime is a reusable asset; each new niche agent is cheaper.

Honest flip side: you own maintenance and get no ecosystem; **Mastra genuinely wins if** you want batteries-and-speed over owning the stack, **or** a future agent is DB-light and orchestration-heavy (a pure web-research or outreach agent) — that one fits Mastra out-of-process, and the seam keeps it available without touching the rest.

---

## If we ever adopt Mastra: the out-of-process path (contingency)

Never embed it. The clean fusion keeps **Effect as the body** (HTTP, auth, RLS, DB, persistence, budget) and **Mastra as only the brain** (the loop); the brain never holds a DB connection — only a short-lived, single-org token, reaching data through Effect's RLS-enforcing surface.

- **Sketch A — HTTP callback:** Effect mints a ~2-minute org-scoped JWT and calls a separate Mastra service; the Agent's data tools call back into `/v1` with that token; Effect verifies → `enterOrgScope` → RLS rows. Cross-org leak impossible by construction.
- **Sketch B — MCP seam + queue (cleaner):** the Mastra brain consumes Batuda's existing org-scoped MCP tools as an MCP client (tools stay in Effect, RLS-native); dispatch via the `research_runs` table as a queue. No bespoke contract; fully decoupled; matches "be the best MCP context provider."

**Queue** = Postgres you already have: producer inserts a `queued` row; a separate worker claims via `UPDATE … WHERE id = (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1)`. Pooler-safe, multi-worker-safe, durable. On Neon prefer `SKIP LOCKED` polling over `LISTEN/NOTIFY` (the pooler breaks `LISTEN`). Mastra ships no cross-service queue; the worker is your ~30 lines wrapping the Agent.

**Hosting:** Effect stays on Unikraft; Neon is the queue + record; the Mastra worker is a *separate conventional Node host* (Fly/Railway/Cloud Run min-1/VM) in the EU near Neon+Nebius — **not** Unikraft (heavy Node tree) and **not** Cloudflare Workers for a long queue-poller (no background loops; uncatchable CPU-time limit on long agent runs, e.g. Vercel AI #6492; `execa`/child_process unavailable). If CF is forced, use CF Queues + Workflows/Durable Objects, not a poller.

**How the research flow would change** (Effect keeps orchestration/persistence/RLS/SSE; Mastra owns the loop):

| Concern                  | Today (in-process Effect)         | Out-of-process Mastra                                             |
| ------------------------ | --------------------------------- | ----------------------------------------------------------------- |
| Run row + queue          | `research_runs` + in-memory Queue | unchanged — the row is the queue                                  |
| Dispatch                 | in-fiber fork, semaphore          | separate worker(s) claim via `SKIP LOCKED`                        |
| Phase 1 (reason + tools) | in-fiber under RLS                | moves to worker; tools are MCP calls back to Effect               |
| Persistence              | in-fiber SQL under RLS            | stays in Effect (worker writes via `save_findings` MCP tool)      |
| Budget: tool calls       | (metered at MCP/API layer)        | Effect meters each callback                                       |
| Budget: LLM tokens       | in-fiber tally                    | **new gap** — worker must report usage back                       |
| Live progress (SSE)      | in-process pubsub                 | breaks — must flow worker → Effect → client                       |
| Cancel                   | `Fiber.interrupt`                 | `status='cancelling'` flag → AbortController → agent              |
| RLS                      | native (in-fiber)                 | native only because tools go through MCP; worker never touches DB |

**Spike-first questions before ever committing:** (1) does Mastra's `MCPClient` talk to Batuda's MCP with a static service token (its MCP is OAuth-oriented)? (2) LLM-token metering across the boundary; (3) cross-service cancel with no leaked paid calls; (4) Qwen/Nebius tool-calling reliability via the AI SDK. Then the non-code items: second pipeline/host/on-call, cost model (Neon awake + a 2nd host + PostHog egress), EU/privacy telemetry, `ee/` licensing trajectory, version churn, exit cost.

---

## Build-vs-buy: the effect-uai evaluation

### What it is

[effect-uai](https://effect-uai.betalyra.com/) (`effect-uai`, MIT, `0.10.0`) is a low-level Effect-native primitives library for agent loops — self-described as "shadcn, but for your AI application": not a framework or `Agent` class but the building blocks under one. Core surface: a pull-based `loop(initial, body): Stream<A>` over a plain-record state, a tagged `Step` (`Value`/`Next`/`Stop`/`StopWith`), `onTurnComplete`, `Tool.make`/`Toolkit`, `Turn`, and `LanguageModel.streamTurn`. It spans 8 capabilities across ~14 providers (LLM, embeddings, speech, web search, web reading, sandboxes, browser, music), each an interchangeable `Layer`.

Two facts decide the evaluation. First, **its tools run in-fiber**: a tool's `run` is `(input, emit) => Effect<Output, E, R>`, requirements ride the `R` channel and are satisfied by `Layer` — the same shape as Batuda's native tools. Second, **it does not build on `@effect/ai`**: it reimplements `LanguageModel`/`Tool`/`Toolkit`/`Turn` and every provider (`@effect-uai/responses`, `/anthropic`, `/google`, …) on bare `effect`. Batuda runs the official line (`@effect/ai-openai-compat`, `-openai`, `-anthropic`, `-openrouter` — what this doc calls `effect/unstable/ai`), so effect-uai is a **parallel substrate, not an addition to it**. Maturity: single maintainer, 23 stars, explicitly experimental, a breaking-change migration guide *every minor* (0.3 → 0.10).

### Why not adopt it

**It duplicates the committed substrate to hand you the cheap part.** Batuda's hard, already-built machinery is the org-scoped RLS connection, per-run + monthly `Budget`, Postgres `SKIP LOCKED` dispatch/reclaim, heartbeat/orphan-sweep, SSE pubsub, provider fallback/caching, fan-out. effect-uai brings none of that — it brings the loop and a provider catalog, which is exactly the slice this doc already scoped as "build (small)" / "minor gap." And its value is not cherry-pickable above the substrate: `loop` operates over its own `Turn`/`Toolkit`/`Step` types and its `streamTurn` comes from its own providers, so taking the loop means taking its `LanguageModel` and provider packages. You would either **migrate** `llm-live` / `cached-llm` / `_fallback` / the MCP toolkits off `@effect/ai`, or **run two** Tool/Toolkit type systems with conversions at the seam — both strictly worse than the one stack you already run.

**Its bus factor is worse than the risk you already accept, on the critical path.** This doc's chief reservation about going native is that `effect/unstable/ai` is `unstable/` — but that is *core-team-backed* churn. effect-uai is a solo-maintained, 23-star, break-every-minor experiment; putting it under the intelligence layer is the same "third-party dependency on the critical path / solo-founder foundation" concern that weighed against Mastra, on a far smaller and younger project. For a solo founder, adding a solo-maintainer experimental dep to the critical path is the worst of both worlds.

**It is not disqualified the way Mastra was — reject it for the right reason.** Mastra's tools ran as detached async callbacks on a `BYPASSRLS` pooled connection and failed *open* across tenants (E2). effect-uai's tools are Effects on the `R` channel run in-fiber via `Toolkit.run`, so under `enterOrgScope` they inherit the org-pinned connection and are **RLS-safe by construction**, exactly like the native path. The rejection is substrate-duplication + bus-factor, **not** an isolation defect — a distinction that matters if this is ever revisited.

**On durability it is no Layer 2.** Its pause/resume is an in-process `Effect.Latch` and its compaction is a state transition — neither survives a process restart, so it does not substitute for `unstable/workflow`'s automatic suspend/resume. It sits at Layer 0, same as the hand-rolled loop.

### What to take from it instead

effect-uai is the single most useful *external reference* for [#125](https://github.com/guillempuche/batuda/issues/125) and the eventual `AgentRuntime`: an independent Effect-native author converged on precisely this doc's Layer 0/1 design — explicit loop, in-fiber typed-Effect tools, provider layers, carry-your-own-state — and wrote it out with tested recipes. Mine it as a pattern source (the shadcn way — copy the recipe, own the code), not a dependency:

| AgentRuntime need (this doc)                                  | effect-uai reference to lift                                                                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bounded reflect loop (#125)                                   | `loop` + `Step` (`Value`/`Next`/`Stop`/`StopWith`) + `onTurnComplete` shape                                                                                                         |
| Model retry / provider fallback                               | `model-retry` (typed `RateLimited`/`Unavailable`/`Timeout`), `multi-model-fallback` recipes                                                                                         |
| Structured output + #193 grounding guard                      | `streaming-structured-output` — decode/validate one object at a time                                                                                                                |
| Approval gate (research `ApprovalRequired`, proposed-update)  | `tool-call-approval` + `Tool.interaction` (decode-only, loop stops/resumes)                                                                                                         |
| Escalate / pause / handoff without fake handlers              | `Tool.signal` decode-only kind                                                                                                                                                      |
| **Reclaim correctness** (dispatch interrupts runs mid-flight) | `HistoryCheck.cancelAllPending` — synthesize closure outputs for orphaned `function_call`s before the next provider request; a real footgun an interrupted-then-resumed run can hit |
| The three agents                                              | `deep-research` + `grounded-answer` (research), `dashboard-briefing` / `market-intel` (pre/post-meeting) recipes                                                                    |

### The one narrow future carve-out

Mirroring the Mastra carve-out: if Batuda ever needs a capability neither it nor `@effect/ai` ships turnkey — **voice** (speech transcription/synthesis loops), **sandboxed code execution**, or **browser-driving** as a research capability — effect-uai's `speech` / `sandboxes` / `browser` provider packages are more ready-made than the official line. Even then, wire that one provider behind the existing `Layer<PortTag, E, R>` port pattern; do not adopt the loop.

---

## Decision

1. **Multiple niche server-side agents** — research, pre-meeting, post-meeting (server-side); negotiation stays advisory. Settle the pre/post-meeting fork (autonomous vs nudge) — leaning autonomous for its proactive value.
2. **Build a shared Effect-native** `AgentRuntime` by extracting `research-service`'s machinery; agents plug in trigger/toolkit/tier/sink/budget. In-fiber = RLS-safe by construction. Effect has the primitives (bricks, not batteries); the only day-one gap you'd feel is evals (graftable).
3. **Durability**: start with hand-rolled checkpoints (exist today); adopt `unstable/workflow` + single-node `SingleRunner` if long agents need automatic suspend/resume — **no new hosting** (verified), just Neon + a few tables.
4. **Sequencing**: ship [#125](https://github.com/guillempuche/batuda/issues/125) (research loop + [#145](https://github.com/guillempuche/batuda/issues/145) + [#193](https://github.com/guillempuche/batuda/issues/193)) on `effect/unstable/ai` now — urgent (prod ships fabricated findings) and the reference agent. Let `AgentRuntime` fall out as #2/#3 land.
5. **Mastra**: revisit only for a future genuinely DB-light, orchestration-heavy agent, and only behind the out-of-process (Sketch B) boundary — running the four spike-first questions first.
6. **effect-uai**: don't adopt — it's a parallel substrate to the official `@effect/ai` line Batuda runs, on a worse bus factor (solo maintainer, `0.10.0`, breaks every minor), bringing the cheap part (the loop) and none of the hard parts (RLS/budget/dispatch/reclaim/SSE/fan-out), and not cherry-pickable below the substrate. It is RLS-safe (tools run in-fiber), so it's rejected for substrate-duplication + bus-factor, not an isolation defect. Mine its `loop`/`Step`/`onTurnComplete` shape, `HistoryCheck` reconciliation, and recipes as references for #125; reserve its speech/sandbox/browser provider packages behind the `Layer<PortTag, E, R>` port pattern for a future turnkey-capability need.
