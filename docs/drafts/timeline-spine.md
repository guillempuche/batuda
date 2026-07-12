# Timeline spine — design note

Status: mostly built already. The spine exists today as the `timeline_activity` table, written through one central `TimelineActivityService.record()` path, and exposed as the `batuda://timeline/{companyId}` MCP resource. This note documents what is in place, paints the before/after honestly, and scopes the handful of net-new pieces (status-change capture, retiring the parallel `interactions` table, the negotiation lens).

For system context see [architecture.md](architecture.md); for the MCP surface see [backend.md](backend.md). This note assumes the intelligence-locus split (the external MCP client is the brain; Batuda is the structured memory it reads and appends to).

---

## Why a spine

A company's history spans many sources — contacts logged, emails, documents authored, proposals sent, research runs, meetings, tasks, and funnel-stage moves. The question the AI and the mobile UI both ask is "what has happened with this company," and that needs one chronological answer, not a fan-in across a dozen tables at read time.

The negotiation book's Chapter 1 names the artifact: the *diario de la negociación* — a single chronological record of every contact, agreement, and open point. Its explicit job is to defeat the *Selective Memory* tactic ("esto nunca lo hemos acordado así") by making partial agreements provable.

Batuda already implements this as a spine: `timeline_activity` is a per-company activity log, pre-materialized on write so the read is a single ordered `SELECT`. This is the direction the event-sourced-activity principle points at — a polymorphic activity log as the assembled history, with the sibling tables feeding it.

---

## Before and after

**Before is not "scattered tables with no spine."** The spine is already here. The honest gap is narrower than a greenfield redesign.

### Before (today, in `main`)

```
each source ──► TimelineActivityService.record(taggedEvent)  ──┐
(handlers/interactions, documents, proposals;                  │  one SQL txn
 services/email, calendar, tasks, recordings;                  │
 research sink in main.ts)                                      ▼
                                            ┌──────────────────────────────┐
                                            │  timeline_activity  (spine)   │  ← materialized read-model
                                            │  kind, entityType, entityId,  │
                                            │  companyId, occurredAt,       │
                                            │  summary, payload(jsonb)      │
                                            └──────────────┬───────────────┘
                                  same txn also:           │
                                    • inserts interactions row (email + non-attached)
                                    • bumps last_email_at / last_call_at / last_meeting_at
                                    • recomputes next_calendar_event_at
                                                           │
                                     batuda://timeline/{companyId}  ── SELECT * … LIMIT 100
```

What exists: the central write path, the taxonomy (`TimelineKind` × `TimelineEntityType`), the recency denormalization, and the read resource. The combined history is real and already served.

Rough edges in the current form:

- **Status changes are invisible.** `companies.status` is a single column with no transition log, no `TimelineKind`, and no event — a move from `meeting` to `proposal` leaves no trace on the spine. Net-new.
- **`interactions` runs in parallel.** It is still written alongside `timeline_activity` in the same transaction (for email + non-attached interactions), so there are two records of the same fact. The event-sourced principle wants `interactions` demoted to a projection *of* the spine, not a co-equal store.
- **Channel flattening.** `kindForInteractionChannel` maps phone/call to `call_logged` and everything else to `system_event`, so a DM or a visit loses its channel identity on the spine.
- **Webhooks barely fire.** `WebhookService.fire()` is centralized but only research + recordings actually call it; documented events like `company.status_changed` and `interaction.logged` are structured *log annotations*, not live webhook fires.

### After (proposed)

```
each source ──► TimelineActivityService.record(taggedEvent) ──► timeline_activity  (source of truth)
     │                                                                  │
     │  + StatusChanged event (new kind)                                ├─► interactions  (projection, derived — not a parallel write)
     │  + real channel preserved                                        ├─► recency columns (as today)
     │                                                                  └─► WebhookService.fire (same moment, broadly wired)
     │
 read side:  batuda://timeline/{companyId}      (spine, as today)
             batuda://negotiation/{companyId}   (filtered lens over the spine — net-new)
```

The delta from before to after is four bounded changes, not a rewrite: add a status-change kind + emit it on transitions; make `interactions` a derived projection rather than a parallel write; preserve the real channel; and (optionally) fire webhooks from the same central `record()` moment so a spine append and a webhook are one write observed twice.

---

## Projection types — already present

Batuda already has the projection taxonomy. This is not something to invent.

- `TimelineKind` (`packages/domain/src/schema/timeline-activity.ts:8-24`): `email_sent, email_received, call_logged, document_created, proposal_sent, proposal_viewed, proposal_responded, research_run, system_event, meeting_scheduled, meeting_rescheduled, meeting_cancelled, meeting_rsvp, task_created, task_updated, task_completed`.
- `TimelineEntityType` (`:26-37`): `email_message, interaction, call_recording, document, proposal, research_run, system, calendar_event, task`.

The set is a code-defined string union, so adding a kind is a code change, not a migration. The one clearly missing member for the funnel is a **status-change** kind (today a stage move would fall through to `system_event`, losing from/to). That is the main net-new projection type.

Structured vs narrative still holds as the guardrail: the event row carries the machine-actionable fields (`kind`, `occurredAt`, `companyId`, `payload`), while prose (research brief, prenotes/postnotes, negotiation brief) lives in the linked `documents` row and is referenced, never parsed back out to drive automation.

---

## How the existing tables fold in

- **interactions** — today a parallel write; target state is a projection derived from `timeline_activity`. The row stays useful as the fast, indexed path for "list calls with Garcia"; the spine stays the source of truth. This demotion is the one schema-semantics change with real migration weight.
- **documents** — `documents` has `type` (the kind column) + `companyId` + timestamps; a `document_created` event already points at it via `entityType='document'`, `entityId`. Prose in the doc, structured pointer on the spine. No change needed beyond adding the negotiation-brief `type`.
- **proposals** — `proposals` has `status` + `sentAt` + `companyId`; `proposal_sent/viewed/responded` kinds already exist. Structured by nature, already on the spine. No change.

Rule for future fields: *does the system act on this?* → structured column + spine payload. *Is it prose a human reads?* → a linked document. The moment you want to parse structure back out of a document to drive automation, it was modelled as prose when it should have been a column.

---

## tasks are not history

The spine is past-tense — things that happened (`task_created/updated/completed` are the *events* about tasks). The `tasks` table itself is the forward queue — open commitments that have not happened yet.

Open tasks (step 11 "planificar el siguiente contacto" and the debrief's follow-ups) are reached through tools, not read as history. Completing one emits `task_completed` onto the spine. So: **timeline = past events of all kinds; interactions = the human-touchpoint projection of that past; tasks = the open future that emits events when closed.**

---

## The single MCP resource — and how many resources total

The spine adds **zero** resources — `batuda://timeline/{companyId}` is already wired (`apps/server/src/mcp/resources/timeline.ts`). The model does not multiply the resource surface; that is the point of the identity-addressable-bundle principle — one resource per stable nameable thing, not one per table.

Current resource set (6, all in `apps/server/src/mcp/server.ts:13-18`):

| URI                             | shape                     |
| ------------------------------- | ------------------------- |
| `batuda://pipeline`             | static snapshot           |
| `batuda://company/{slug}`       | parameterized             |
| `batuda://document/{docId}`     | parameterized             |
| `batuda://research/{id}`        | parameterized             |
| `batuda://instructions/{agent}` | parameterized             |
| `batuda://timeline/{companyId}` | parameterized (the spine) |

The timeline-spine model needs **6 — the ones that exist**. Building the negotiation lens adds exactly **one** (`batuda://negotiation/{companyId}`, a filtered view over the spine), for **7**. A `batuda://proposal/{id}` is an optional 8th only if a single quote needs to be cited standalone. That is the ceiling — the funnel does not warrant a resource per entity; contacts, tasks, interactions stay as tools and as projections composed into these bundles.

One inconsistency worth fixing while here: `company/{slug}` keys by slug but `timeline/{companyId}` keys by id. Pick one addressing scheme for company-scoped resources (slug reads better in a URI and matches the completion already used for `company`).

### The negotiation lens sits on top

`batuda://negotiation/{companyId}` is a filtered, enriched view over `timeline`, not a second spine: the four Chapter-1 recall questions (contacts and with whom, what's agreed, what's open, sensibilities) plus references to the live negotiation-brief artifacts. It ships as a `WHERE kind IN (…)` + brief-document join over `timeline_activity` — no new store.

The brief artifacts themselves (concession matrix, ZOPA, walk-away lines, the meeting pre/post discussions) **live in `documents`, not in the lens**. The lens references them; the AI authors and revises them, using the org's or user's resolved instruction stack (see [§ Where the negotiation content lives](#where-the-negotiation-content-lives)). The lens is multiparty by construction — it filters the company's whole spine, so every contact's touchpoints appear; it never assumes a single counterpart.

---

## Design decisions

Settled calls that scope the build. Each closes a consideration raised while reviewing this model.

### Editable history — no anti-tamper audit log

Users may edit or correct past activities; mistakes get fixed in place. The diario's value here is *recall*, not courtroom-grade evidence, so no immutable/append-only audit guarantee is required. This confirms the denormalized read-model choice below and removes any tension with the book's Selective-Memory motivation — a corrected record beats a frozen wrong one for the user's own memory.

### Org-scoped reads only — never cross-org

Every resource and query fetches data only from an organization the calling user is a member of; it must never touch data from an org the user is not part of. Concretely, the company-keyed resources (`timeline`, `negotiation`) resolve under `app_user` RLS with `app.current_org_id` set from the caller's active org, and a request for a company the caller's org does not own returns not-found, not another org's rows. This is a hard boundary, not a default.

### Where the negotiation content lives

Negotiation briefs and meeting pre/post discussions are **documents**. Timeline events and the negotiation lens *reference* them by id; they never inline the prose. When the AI chat writes or revises one of these documents, it composes using the org's or the user's resolved instruction stack, so the house negotiation method shapes the output without being hardcoded.

The instruction stack is wired **advisory, exactly like `email`** — never server-enforced like `research`. A negotiation brief has no safety invariant a template could subvert, and the intelligence-locus split says the external client composes, so advisory is the correct tier. The wiring mirrors email in three parts:

1. **Declare the surface — one line.** Add `'negotiation'` to `agents` in `packages/instructions/src/domain.ts`. No migration (`agent` is a plain `text` column, no enum/CHECK); `AgentSchema`, the resource's `{agent}` validation, and the completion list all derive from that array, so `batuda://instructions/negotiation` starts resolving stacks immediately and users can create a `negotiation` default stack via the existing `manage_instruction_default_stack` tool.
2. **Resource — no logic change.** `apps/server/src/mcp/resources/instructions.ts` is surface-generic; only its hardcoded `(research, email)` description strings widen to include `negotiation`.
3. **Consumer wiring — the advisory reference.** This is the "like email" part. Email embeds one sentence in the composer's tool description (`send_email`/`reply_email`, `email.ts:87`) telling the client to read `batuda://instructions/email` before composing. Negotiation's composer is a document (the prep/prenotes/debrief brief), so the same sentence goes in its two composition entry points: the negotiation-prep/debrief MCP prompt content, and the `create_document`/`update_document` tool description (conditional on `type ∈ {negotiation-brief, prenotes, postnotes}`). No server-side resolve-and-inject.

Sequencing: the union line is inert on its own — a `negotiation` default stack that nothing reads just sits there. Land all three parts together with the negotiation-prep prompt and the document-authoring path, never the surface declaration alone.

### Upcoming meetings prepare a pre-meeting document

A scheduled meeting (`meeting_scheduled` on the spine, from `services/calendar.ts`) should trigger preparation of a **pre-meeting document** — the prenotes brief — authored by the AI using the resolved instruction stack so it nails the house method. This anchors the prep flow to a real event instead of leaving the prompt as a tool the user must remember to invoke. The debrief mirrors it after the meeting.

### Analytics-ready, not analytics-now

Analytics is postponed but must not be foreclosed. Design the status-change event (below) to carry what win-rate / time-in-stage / concession give-vs-get reporting will later need — from/to stage, timestamp, actor — so enabling analytics is a read over existing spine data, never a backfill.

### Multiparty negotiations are supported

A negotiation may span several contacts (and, later, considerations beyond one company). The lens filters the company's whole spine, so all parties' touchpoints already surface; brief documents must not assume a single counterpart. Keep the model per-company for v1 but do not encode a one-contact assumption anywhere that would block per-thread growth.

### `timeline_activity` is the single source of truth

`timeline_activity` is the authoritative record of what happened; `interactions` becomes a **derived projection** of it, not a co-equal store written alongside. Today `record()` authors both tables in the same transaction, so the same fact lives twice and can drift. Target state: the spine is the only authored write, and `interactions` is derived from it (a view, or a materialized table rebuilt from the event) — keeping its fast indexed reads while removing the second source of truth.

This is *single source of truth*, not a full append-only event-sourcing rewrite: the spine stays a denormalized read-model (editable, per decision #1), the recency columns stay materialized as today. Only the duplication goes.

Prerequisite it surfaces: the spine must carry everything `interactions` exposes. `interactions` holds fields the spine currently keeps only in `payload` jsonb or not at all (`duration_min`, `subject`, `outcome`, `next_action`/`next_action_at`, `type`). Before `interactions` can derive cleanly, the event/`payload` must capture these — so this decision depends on channel fidelity (below) plus a payload-completeness pass.

### Deferred

Live bidirectional sync (PowerSync) for the on-the-go mobile read path is **postponed**. Until then, the mobile brief-read goes through the normal server read path; offline field use is revisited when PowerSync lands.

---

## Open questions, resolved and remaining

### Why not infrastructure — a general event bus?

Two reasons, one architectural and one factual.

Architectural: the spine's consumers are the AI (via the MCP resource) and the mobile UI (via the read path) — both are *readers of a per-company history*, not subscribers reacting to a firehose. An event bus solves a different problem (decoupled fan-out to many independent processors); Batuda's need is a materialized read-model keyed by company. Modelling it as infra would invert the design — you would build subscription, ordering, replay, and delivery guarantees that no current consumer asks for, to serve a read that is already one indexed `SELECT`.

Factual: the outward-fan-out slot already exists and is deliberately thin — `WebhookService` is the "let other systems (n8n, Zapier) subscribe" surface, and it fires for only research + recordings today. That is the honest amount of external subscription the product needs. Keeping the spine as an internal read-model and the webhook dispatcher as the (narrow) external bus keeps the two concerns from bleeding: the timeline is memory Batuda reads; webhooks are notifications Batuda pushes. Making the spine itself a bus would merge them and pull server-side reactivity into a system whose intelligence is supposed to live in the external client.

If a genuine bus need appears later (many internal processors reacting to events), it graduates then — but it is not what "help the user across the funnel" requires now, and building it speculatively contradicts the minimal-just-in-time-scope stance.

### `activity_events` (a new event store) vs. today's `timeline_activity` / `interactions`

This is now largely settled by what exists. There is no need for a *new* `activity_events` table — `timeline_activity` already is the spine. The real fork is about its *semantics*:

- **Keep it a denormalized read-model (recommended).** `timeline_activity` is written on each event, pre-materialized, effectively append-only in practice. This is cheap, already built, and exactly right for the two readers it has. Add the status-change kind, preserve channels, and demote `interactions` to a derived projection — bounded changes.
- **Promote to true append-only event-sourcing.** Make the event stream the *only* write and rebuild every projection (including `interactions` and the recency columns) from it. This is the purist form but buys nothing the current consumers need, and costs backfill + the discipline of no direct projection writes. Defer unless a second lens or replay requirement proves it.

The one piece of `interactions`-vs-spine cleanup worth committing to: stop treating `interactions` as a co-equal store. Today it is written in the same transaction as `timeline_activity`, duplicating the fact. Target it as a projection derived from the spine so there is a single source of truth — the smallest change that honors the event-sourced principle without a full event-store rewrite.

Remaining genuinely open:

- Retention/windowing for the resource bundle — the timeline resource currently hard-caps at `LIMIT 100`; decide the default window and whether a cursor is needed before older ranges matter.
- Whether status changes get their own `TimelineKind` (`status_changed`) or ride `system_event` with a typed payload — a naming/queryability call, cheap either way since the kind set is code-defined.

---

## Implementation plan

Sliced into PR-sized units. The default is a **shared worktree, one PR per slice** with focused commits via `/commits`; slices D–G may share one worktree since they interlock. Every slice passes the verification gates before merge: `pnpm install` → `check-types` + `test` (parallel) → `build`, and every logic commit carries its tests (BDD shape, `*.test.*`). No tests for `apps/cli`; services/adapters are tested instead.

### Guiding constraints (apply to every slice)

- **Org-scoped reads only.** Every new resource/query resolves under `app_user` RLS with `app.current_org_id` from the caller's active org. A company the caller's org does not own returns not-found, never another org's rows. Assert this in tests.
- **Advisory instructions, never enforced** for negotiation — mirror `email`, not `research`.
- **Analytics-ready, not analytics-now.** Status-change events carry `from`/`to`/`occurredAt`/`actor` so reporting is a later read, not a backfill.
- **Editable history.** No append-only/immutability work; corrections in place are allowed.
- **Documents are the home** for negotiation prose; timeline events and the lens reference by id.
- **Multiparty by construction.** Nothing assumes a single counterpart.

---

### Slice A — Status-change capture on the spine

**Goal.** A funnel stage move (`companies.status`) leaves a first-class, analytics-shaped event on the timeline. Closes the biggest current blind spot.

**Changes.**

- `packages/domain/src/schema/timeline-activity.ts` — add `status_changed` to `TimelineKind`; keep `entityType='company'` (add `company` to `TimelineEntityType` if absent). Define a typed payload `{ from: Status, to: Status }`. **No migration** — `timeline_activity.kind` is `TEXT` with no CHECK (verified `0001_initial.ts:556`); the kind set is a code union and `idx_timeline_activity_kind` already covers reads.
- `apps/server/src/services/timeline-activity.ts` — add a `StatusChanged` tagged event to the `record()` union + its `rowBase` mapping. `occurredAt`/`actor` come from the existing `occurred_at`/`actor_user_id` columns; only `{from, to}` goes in payload. No `interactions` row for this kind (it is not a touchpoint).
- The company-update path (`apps/server/src/services/companies.ts` / `handlers/companies.ts` — today only a log annotation at `companies.ts:44`) — detect a status delta in the same transaction as the update and call `record(StatusChanged{...})`.

**Tests.** Updating status emits exactly one `status_changed` event with correct `from`/`to`/`actor`; a no-op update (same status) emits none; cross-org update is rejected.

**Risk.** Low. Additive kind, one new emit site.

---

### Slice B — Channel fidelity

**Goal.** A DM/visit/whatsapp interaction keeps its channel on the spine instead of collapsing to `system_event`.

**Changes.**

- `apps/server/src/services/timeline-activity.ts` — `kindForInteractionChannel` (~`:290`) currently maps only phone→`call_logged`, else `system_event`. Either add the missing `TimelineKind`s (e.g. `dm_logged`, `visit_logged`) or carry the raw channel in the event payload and stop flattening. Prefer payload-carried channel to avoid a kind explosion; add a kind only where a consumer filters on it.

**Tests.** Each interaction channel round-trips its channel onto the timeline row; the phone→`call_logged` mapping is unchanged.

**Risk.** Low, but touches a shared mapping — cover every existing channel branch.

---

### Slice C — Make `interactions` a projection of the spine *(committed)*

**Goal.** Single source of truth (decision above): `timeline_activity` is the only authored write; `interactions` is derived from it.

**Prerequisite.** The spine must carry every field `interactions` exposes. `interactions` holds `duration_min`, `subject`, `outcome`, `next_action`/`next_action_at`, `type` that the spine keeps only in `payload` jsonb or not at all. **Depends on Slice B** (channel fidelity) plus a payload-completeness pass so the event captures these before `interactions` can derive cleanly.

**Changes.**

- `apps/server/src/services/timeline-activity.ts` — `record()` authors only `timeline_activity`; `interactions` becomes derived. Choose: a `VIEW` over `timeline_activity` (zero duplication) or a materialized table rebuilt from the event in the same txn (keeps existing indexes). Recommend the materialized form to preserve the fast "list calls with Garcia" reads.
- Re-point every `interactions` reader — the `interactions` MCP tools, the frontend Interactions tab, any direct query — at the derived source.
- Migration + backfill: existing `interactions` rows reconciled with / rebuilt from the spine.

**Note on `next_action`/`next_action_at`.** These are forward-looking and arguably belong to `tasks`, not history. Keep them in the projection for now; flag a later move to `tasks` rather than expanding scope here.

**Risk.** Medium — the only real migration weight in the plan. Not a blocker for the negotiation slices (the lens reads the spine directly), so it can land in parallel with or after them, but it is committed, not optional.

**Tests.** A logged interaction produces one spine event and a matching derived `interactions` row; no path writes `interactions` independently; every prior `interactions` field round-trips; backfilled rows match their source events.

---

### Slice D — `negotiation` instruction surface (advisory)

**Goal.** A tunable house negotiation method, auto-applied when the AI authors negotiation documents.

**Changes.**

- `packages/instructions/src/domain.ts:7` — add `'negotiation'` to `agents`. No migration.
- `apps/server/src/mcp/resources/instructions.ts` — widen the two `(research, email)` description strings to include `negotiation`. No logic change.
- **Starter house method.** Seed an org-owned default `negotiation` stack of instruction templates **distilled** from `docs/negociar-preparado.md` (the 11-step method, "never concede without getting something," the gain/loss-framing bias, singular/solo register per house voice) — tight composable blocks, not the book pasted verbatim. Without this the advisory surface resolves to empty and decision #4's "nail it" has nothing to apply. Author via the existing `manage_instruction_template` / `manage_instruction_default_stack` tools (or a seed) so users can still edit/replace it.
- Consumer wiring lands with Slices E/F (the advisory reference), per the sequencing note — do **not** merge the union line alone.

**Tests.** `batuda://instructions/negotiation` resolves the seeded stack under org scope; unknown-agent path still returns the valid list; a user override replaces the org default per the resolver ladder.

**Risk.** Trivial for the union; the starter stack is content authoring, not code.

---

### Slice E — Negotiation document types + authoring

**Goal.** `negotiation-brief`, `prenotes`, `postnotes` are first-class document types the AI writes and revises; the concession matrix / ZOPA / walk-away lines live inside them.

**Changes.**

- `packages/domain/src/schema/documents.ts` — no schema change needed (`type` is free `text`); document the three new `type` values as a code-defined set + validate at the tool boundary.
- `apps/server/src/mcp/tools/documents.ts` — add the advisory reference to `create_document`/`update_document` descriptions, conditioned on `type ∈ {negotiation-brief, prenotes, postnotes}`: *"first read `batuda://instructions/negotiation` and follow it."* (mirrors `email.ts:87`).
- Authoring a negotiation document already emits `document_created` on the spine (existing wiring) — verify it does for the new types.

**Tests.** Creating a negotiation-brief document emits `document_created` referencing it; the type set is validated; cross-org create rejected.

**Risk.** Low.

---

### Slice F — `negotiation-prep` / `negotiation-debrief` MCP prompts

**Goal.** The 11-step prep and the post-meeting debrief as parameterized prompts, mirroring existing prompts (`proposal-draft`, `interaction-follow-up`).

**Changes.**

- `apps/server/src/mcp/prompts/negotiation-prep.ts` and `negotiation-debrief.ts` — params `{ slug, lang, depth: fast|full }` (key by `slug`, matching the other prompts + `completeCompanySlug`, not `companyId`); content pulls the company + spine context and walks the steps; **ends with the advisory reference** to `batuda://instructions/negotiation`. `fast` emits the checklist-fast-track subset; `full` the 11 steps.
- Register both in `apps/server/src/mcp/server.ts` and the `McpToolsLive` composition; add slug/id completion via `_completions.ts`; use `LangParam`/`langDirective` from `_lang.ts`.
- Document in `AGENTS.md` (prompt workflows).

**Tests.** Prompt content includes the advisory reference and the correct step set per `depth`; `lang` directive is prepended; unknown company handled.

**Risk.** Low. Follows the established prompt pattern.

---

### Slice G — `batuda://negotiation/{slug}` lens resource

**Goal.** The identity-addressable negotiation bundle: the raw material for the four Chapter-1 recall questions + references to the live brief documents, as a filtered view over the spine.

**Changes.**

- `apps/server/src/mcp/resources/negotiation.ts` — parameterized resource, keyed by `slug` (resolve slug→id first). It assembles from **three sources**, not just the spine:
  - **contacts** — from the `contacts` table for the company (the spine has `contact_id` refs but not names/roles), so "with whom" is answerable.
  - **event feed** — `SELECT … FROM timeline_activity WHERE company_id = ? AND kind IN (email_sent, email_received, call_logged, meeting_scheduled, meeting_rescheduled, meeting_cancelled, meeting_rsvp, document_created, proposal_sent, proposal_viewed, proposal_responded, status_changed, task_completed) ORDER BY occurred_at DESC` — the chronological diario.
  - **brief references** — the latest negotiation-typed documents (`negotiation-brief`/`prenotes`/`postnotes`) by id.
- **Do not compute "agreed / open / sensibilities."** Those are *interpretations*, not spine facts — they live in the latest brief document as the AI authored them. The lens returns the *raw material* (contacts + event feed + brief refs) and lets the client reason; it must not fabricate a computed "what's agreed." Shape: `{ contacts, events, briefs: [ref], latestBriefId }`.
- Read-only; references documents by id, never inlines prose. Multiparty — filters the whole company spine, so every contact's touchpoints appear.
- Register in `apps/server/src/mcp/server.ts`. Reuse `completeCompanySlug`.
- **Addressing note:** new company-scoped surfaces (this lens + the prompts) key by `slug` to match `company/{slug}`. Aligning the pre-existing `timeline/{companyId}` to slug is a separate small follow-up, called out to avoid churn here.

**Tests.** Returns only the calling org's data (cross-org → not-found); assembles contacts + event feed + brief refs; brief docs appear as references, not inlined bodies; a company with multiple contacts surfaces all of them; does not invent computed agreement fields.

**Risk.** Low-medium — the multi-source assembly and slug resolution need care.

---

### Slice H — Calendar → pre-meeting document hook

**Goal.** A scheduled meeting triggers preparation of a prenotes document authored via the negotiation instruction stack, so prep is anchored to a real event (decision #4).

**Changes.**

- `apps/server/src/services/calendar.ts` — on `meeting_scheduled`, create (or flag for creation) a `prenotes` document for the company, and surface it so the client authors it with the resolved `negotiation` stack. Keep authoring on the client (advisory) — the server seeds the artifact and the trigger, not the prose.
- Mirror on the debrief side: a just-ended meeting nudges the `postnotes`/debrief.

**Open detail to settle in this slice.** Whether the server auto-creates an empty prenotes doc on schedule, or only emits a task/nudge that prompts the client to author it. Prefer the lighter nudge unless product wants a guaranteed artifact.

**Risk.** Medium — touches calendar flow; keep the server side to seeding + trigger.

---

### Slice I — Frontend: read the brief and diario on the go

**Goal.** The mobile web app *displays* the negotiation brief and the chronological diario so the user can prep before / review after a meeting on the go. Display + light human edit only — all generation stays in the AI chat (intelligence locus).

**Changes.**

- `apps/internal` company detail (`src/routes/companies/$slug.tsx`) — the Documents tab already lists `research / prenotes / postnotes` (frontend.md:817); ensure the new `negotiation-brief` type renders and the prenotes/postnotes open in the existing Tiptap editor for hand-tweaks.
- Surface the diario — the chronological event feed — on mobile (reuse the existing Interactions tab / a timeline view). **No new HTTP endpoint if avoidable:** the web app reads via existing `/v1` document + interaction routes; the `batuda://negotiation` lens is MCP-only (for the AI), not consumed by the web app. If a combined timeline read is needed, add one thin `/v1` timeline route rather than duplicating the lens shape.
- Lingui-wrap every new string (`apps/internal` convention); mobile-first layout.

**Depends on** Slice E (document types exist). Independent of the MCP lens (G).

**Tests.** Playwright: a negotiation-brief document renders on company detail; prenotes open editable; the diario lists events newest-first. `*.test.*` naming, uncontrolled inputs per house rules.

**Risk.** Low-medium — read-mostly UI; the only judgment call is whether a `/v1` timeline route is warranted or existing routes suffice.

---

### Cross-cutting — documentation

Any slice that changes the MCP surface updates the reference docs in the same PR: `backend.md` (§ MCP server resource/prompt/tool lists), `architecture.md` (resource list), and `AGENTS.md` (agent workflows). Fold `docs/drafts/timeline-spine.md` into `docs/` proper once the first slice lands.

---

### Sequencing

```
A ─┐
B ─┼─ independent, ship first (funnel visibility + fidelity)
   │
   └─► C   (single source of truth; needs B + payload-completeness)
   │
D ─┴─► E ─► F ─► G      (negotiation capability; D never alone)
        │        │
        │        └─► H  (calendar hook, once prompts + lens exist)
        │
        └─► I           (frontend display; needs doc types from E)
```

A and B are independent and low-risk — land them first; they also make analytics and the lens richer. C (single source of truth) is committed and depends on B; it is not a blocker for the negotiation slices (the lens reads the spine directly), so it can run in parallel with or after D–G. D–G are the negotiation feature and interlock (share a worktree). H depends on F+G. I (frontend) depends only on E and can proceed in parallel with F/G/H.

### Out of scope / explicitly deferred

- PowerSync live-sync / offline mobile read path (decision #5).
- True append-only event-sourcing (`activity_events` rewrite) — `timeline_activity` stays the denormalized read-model.
- Analytics dashboards — only the *event shape* is designed now.
- Broad webhook firing beyond research+recordings — add `status_changed`/`interaction.logged` fires opportunistically if a subscriber needs them, not as blocking work.
- Anti-tamper/audit log — declined (decision #1).

### Verification per slice

Beyond the gates, exercise each slice against the live stack (the `verify` skill / end-to-end), not just type-checks: emit a status change and read it back on `batuda://timeline`; resolve `batuda://instructions/negotiation`; author a negotiation-brief and see it on the lens; schedule a meeting and confirm the prenotes trigger. Run the readability-improver pass on staged changes before `/commits`.
