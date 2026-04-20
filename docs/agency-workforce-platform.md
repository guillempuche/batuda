# Agency Workforce Platform — future scope

Deferred design note. Captures what Batuda would need to evolve from
"solo-founder CRM with an AI sidekick" into a platform that runs a small
agency where AI employees and human employees share the same queue.

Not a commitment to build. Purpose is to lock in the vocabulary,
bounded-context shape, and migration hooks now, so today's CRM schema
doesn't paint us into a corner.

---

## 1. When to trigger this work

Build this only when at least two of the following are true:

- A second human joins the workshop (employee, contractor, or partner).
- Two or more distinct AI agents run long-lived queues (not one-shot tools),
  each with its own prompt, budget, and scope.
- Client engagements span multiple workers and run longer than ~2 weeks.
- Billable hours start mattering (fixed-fee retainer vs T&M).
- Cross-client capacity planning ("can I take on Acme next month?") is a
  regular question.

Until then, the "Path A-and-a-half" changes documented in the task design
(add `assignee_id`, expanded `status`, nullable `company_id`) are enough.

## 2. Scope — what the platform is and isn't

**Is:**

- Work planning and execution for a small agency (1–10 workers, mixed AI
  and human).
- CRM-adjacent: clients and contacts are already first-class; the platform
  adds projects, deliverables, time, and reviews on top.
- Opinionated about autonomy: every AI action has an explicit trust level,
  not a permission bit.

**Isn't:**

- A Jira/Asana replacement for large teams. Scale ceiling ~10 workers.
- An ERP. Accounting, payroll, HR — all out of scope. Export to the tools
  that do those things.
- A general-purpose PM tool. Non-agency use (product teams, personal tasks)
  is not a goal.

## 3. Core concepts

| Concept                             | One-line definition                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Worker**                          | A user that executes work. Human or AI. Backed by existing `user` table with `isAgent`.        |
| **Project**                         | A container of work for a client engagement, with a budget, timeline, and deliverables.        |
| **Deliverable**                     | A client-visible outcome of a project (a website, a research report, a campaign).              |
| **Task**                            | A unit of work assigned to one worker. Can belong to a project or stand alone.                 |
| **Queue**                           | Per-worker ordered list of tasks the worker will pick next.                                    |
| **Autonomy policy**                 | Per-agent, per-action-type trust level: `auto`, `propose`, or `forbidden`.                     |
| **Review**                          | A gate between work done by one worker and acceptance by another (agent→human or human→agent). |
| **Time log**                        | Recorded work duration on a task, contributing to billing and capacity.                        |
| **Capacity**                        | How much work a worker can absorb per day/week.                                                |
| **Handoff**                         | Explicit transfer of a task from one worker to another with context.                           |
| **Engagement**                      | The contractual container: client, rate, cadence, scope. Projects live inside engagements.     |
| **Client portal** (optional, later) | External-facing view of projects/deliverables for the client.                                  |

## 4. Bounded contexts it would introduce

New contexts in `packages/`, each following the existing layered pattern
(`domain/`, `application/`, `infrastructure/`):

### 4.1 `packages/workforce`

Owns workers, queues, autonomy, handoffs, reviews.

- `domain/` — `Worker`, `Queue`, `AutonomyLevel`, `Review`, tagged errors
  (`ForbiddenByPolicy`, `QueueFull`, `ReviewStale`)
- `application/` — ports:
  - `WorkerRegistry` — enumerate and describe workers
  - `QueueStore` — push/peek/claim/release
  - `AutonomyPolicyStore` — per-agent action gates
  - `ReviewInbox` — requests needing human approval
- `infrastructure/` — Postgres-backed stores; in-memory for tests

### 4.2 `packages/projects`

Owns projects, deliverables, engagements, budgets.

- `domain/` — `Project`, `Deliverable`, `Engagement`, `Budget` (value type)
- `application/` — `ProjectService`, budget roll-up, status roll-up
- `infrastructure/` — Postgres tables + migration

### 4.3 `packages/time`

Owns time logs, capacity, billing export.

- `domain/` — `TimeLog`, `CapacityWindow`, `BillingLine`
- `application/` — `TimeService`, capacity query, export to CSV/QuickBooks/Holded
- `infrastructure/` — Postgres + an export adapter per target

Dependencies flow one way: `workforce → projects → time` is fine; the other
direction is forbidden (projects must not know how queues work; time must
not know review state).

The existing `crm` context (companies, contacts, interactions, tasks) stays
put. Tasks gain fields (see §5) but the domain model stays minimal.

## 5. Data model sketch

Additions to the schema (would be new migration, not retrofit into
`0001_initial.ts`). Names are indicative, not final.

```
engagements
  id, company_id, title, kind ('retainer'|'fixed'|'tm'|'internal'),
  starts_at, ends_at, rate_cents, currency, status, ...

projects
  id, engagement_id, title, status ('proposed'|'active'|'paused'|'done'|'cancelled'),
  budget_minutes, budget_cents,
  starts_at, target_end_at, actual_end_at,
  client_visible, ...

deliverables
  id, project_id, title, description, status, due_at,
  accepted_at, accepted_by_user_id

tasks                                       -- extended
  + project_id?                             -- a task may be internal (null)
  + deliverable_id?
  + assignee_id                             -- required after migration
  + status                                  -- open|in_progress|blocked|in_review|done|cancelled
  + autonomy                                -- auto|propose|forbidden (null for human assignees)
  + review_state                            -- null|pending|approved|changes_requested
  + review_requested_to_user_id?
  + estimate_minutes?
  + scheduled_for?                          -- when work happens (vs due_at = deadline)
  + parent_task_id?                         -- single-level breakdown

time_logs
  id, task_id, worker_id, started_at, ended_at, minutes,
  source ('manual'|'agent'|'timer'),
  billable, rate_cents_override?

agent_autonomy_policy
  agent_user_id, action_type, level ('auto'|'propose'|'forbidden'),
  scope_project_id?, scope_client_id?, updated_at

handoffs
  id, task_id, from_worker_id, to_worker_id,
  reason, context, at

capacity_windows
  worker_id, starts_at, ends_at, minutes_capacity
  -- human: contracted hours; agent: budget/ratelimit bucket
```

The existing `tasks` table absorbs several of these fields gradually.
A `task_events` append-only audit table (proposed in the current task
design) becomes load-bearing here — it's the raw material for the undo
drawer, the review log, and billing dispute resolution.

## 6. AI + human hybrid — the distinctive problems

These are the areas that generic OSS PSA tools don't solve and that
a hybrid workforce makes urgent.

### 6.1 Autonomy, not permissions

Better-Auth permissions gate the API: *can* this user call this endpoint.
Autonomy gates the behavior: *should* this agent do it without asking.

Matrix:

```
agent            action_type              level
research-bot     propose_update           auto
research-bot     send_email               propose
research-bot     delete_company           forbidden
outreach-bot     send_email               auto        (for warm leads)
outreach-bot     send_email               propose     (scope: cold leads)
outreach-bot     cancel_meeting           propose
```

Scope lets you say "auto for internal projects, propose for client-facing."

### 6.2 Queues as first-class

Each worker has an inbox. Humans pull from theirs with a UI; agents poll
theirs with a scheduler. Unassigned tasks go to a triage queue that a human
routes. Queue order considers priority, due date, blocked state, and (for
agents) capacity/budget remaining.

### 6.3 Handoff with context

A handoff isn't reassignment — it's a typed event: "I did X, I'm stuck on
Y, here's what I learned, your turn." It carries references (document ids,
interaction ids, tool outputs) so the receiver doesn't re-derive context.

### 6.4 Review lanes

Some work is agent-proposed → human-approved. Some is human-created →
agent-executed. Both flow through a single `review_state` field with a
clear actor:

- `pending` + `review_requested_to_user_id` — someone owes a decision
- `approved` — executor may proceed / task is accepted
- `changes_requested` + `review_note` — bounces back with a reason

### 6.5 Cost + time visibility per worker

Agents cost tokens + API calls. Humans cost salary + benefits. Both are
time-logged against tasks; the difference is the rate type. A project's
profitability view must aggregate both uniformly.

### 6.6 Dual views

Every screen has two modes:

- **My work** — what I (the current user) do next
- **Workshop** — what's happening across all workers

The workshop view is where you supervise agents: in-flight tasks, queue
depth, pending reviews, budget burn.

## 7. Integration with today's Batuda

Mapping from existing entities to the platform model:

| Today                     | Under the platform                                | Migration note                                  |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `user` (team + `isAgent`) | `Worker`                                          | No schema change; worker is a view over user    |
| `tasks`                   | `Task` with project/deliverable/assignee          | Additive fields, no destructive migration       |
| `interactions`            | Unchanged — interactions remain CRM facts         | Tasks and deliverables *link to* interactions   |
| `companies`               | Unchanged — clients live here                     | `engagements.company_id` is the new pivot       |
| `documents`               | Unchanged                                         | Deliverables can point to documents             |
| `proposals`               | Feed engagements (accepted proposal → engagement) | New link column                                 |
| `research_runs`           | Executed by agent workers; count as time/cost     | `research_paid_spend` feeds billing aggregation |
| `calendar_events`         | Unchanged — meetings are capacity consumers       | `time_logs.source='calendar'` for past events   |

Nothing in the current schema needs to be rewritten. The platform is
additive on top of the CRM spine.

## 8. Open source prior art

Studied to steal good ideas and avoid bad ones. None are adopted as-is —
each solves part of the problem but assumes a scale or workflow that
doesn't match a small agency with AI workers.

### 8.1 PSA / project management

- **[OpenProject](https://github.com/opf/openproject)** — full PSA, work
  packages, Gantt, time logs, budgets. GPLv3. Rails. **Steal:** work-package
  state machine, budget roll-up, cost reports. **Skip:** Gantt complexity,
  multi-tenant org model.
- **[Plane](https://github.com/makeplane/plane)** — self-hosted Jira
  alternative. Cycles, modules, issues. **Steal:** clean cycle/sprint
  abstraction if we ever need iterations. **Skip:** issue-tracker mindset
  is wrong for services work.
- **[Worklenz](https://worklenz.com)** — explicitly agency-focused OSS.
  **Steal:** client-visibility model, flexible task categorization.
- **[ERPNext](https://github.com/frappe/erpnext)** (Frappe) — project +
  HR + accounting modules. **Steal:** chart of accounts integration shape.
  **Skip:** full ERP, too heavy.
- **project-open** — older, GPL, PSA with invoicing and Gantt.
  **Steal:** time-to-invoice workflow vocabulary. **Skip:** UI era mismatch.

### 8.2 Time tracking

- **[Kimai](https://www.kimai.org)** — mature OSS time tracker; PHP/Symfony.
  **Steal:** billable/unbillable toggle per entry, export formats.
- **[Traggo](https://github.com/traggo/server)** — simple self-hosted
  tagged time tracking. **Steal:** lightweight tag model.
- **OpenProject time tracking** — see above.

### 8.3 AI orchestration / human-in-the-loop

- **[LangGraph HITL patterns](https://github.com/topics/human-in-the-loop)**
  — interrupt/resume graphs with human approval nodes. **Steal:** the
  explicit "interrupt until human decides" primitive as our review state.
- **[Flyte 2.0 + ai-agent-template](https://github.com/unionai-oss/ai-agent-template)**
  — multi-agent orchestration with dependencies. **Steal:** task-routing
  ideas for the scheduler. **Skip:** DAG engine weight — too much for a
  small agency.
- **Microsoft Semantic Kernel AgentGroupChat** — multi-agent with HITL.
  **Steal:** the discussion-then-decide pattern for complex jobs.
- **GitHub topic [`ai-workforce`](https://github.com/topics/ai-workforce)**
  — emerging pattern of Kanban-driven task loops for agents. **Watch.**
- **GitHub topic [`agent-orchestration`](https://github.com/topics/agent-orchestration)**
  — self-hosted mission-control dashboards for agent dispatch.

### 8.4 AI workforce / agent control planes

Newer category: platforms that model a collection of AI agents as a
company (org chart, goals, budgets, governance). Closer to what
Batuda would become than classic PSA tools — but all of them assume
*agents-only*, not mixed human/agent teams.

- **[Paperclip](https://paperclip.ing)** ([paperclipai/paperclip](https://github.com/paperclipai/paperclip))
  — "Human control plane for AI labor." MIT, self-hosted, Node.js +
  React + embedded Postgres. Models a *company*: CEO/CTO/engineer roles
  in an org chart, company/project/agent/task goal hierarchy, heartbeats
  (agents wake on cron), per-agent monthly budgets with hard stop,
  ticket system with immutable audit log, multi-company isolation,
  BYOAI (Claude Code, OpenClaw, Codex, Cursor, HTTP webhooks).
  **Steal:** goal-ancestry injection (every task carries why it matters),
  heartbeat scheduler, per-agent budget hard-stop semantics, ticket +
  tool-call tracing shape. **Skip:** "autonomous company" framing —
  Batuda's user is a founder doing real work, not a board
  approving a CEO-agent.
- **[MeisnerDan/mission-control](https://github.com/MeisnerDan/mission-control)**
  — "Command center for solo entrepreneurs who delegate work to AI
  agents." AGPL-3.0, Next.js, local JSON files as source of truth.
  Eisenhower matrix + Kanban, brain dump, inbox, decisions queue,
  per-task spawn of `claude -p` sessions, Field Ops (encrypted vault,
  spend limits, approval workflows for real-world actions like posting
  to X or sending ETH), loop detection, continuous missions.
  **Steal:** token-optimized Agent API (sparse fields, `?fields=`,
  compressed context dump), inbox/decisions split, Field Ops approval
  ladder (manual / supervised / full autonomy). **Skip:** JSON-file
  storage (fine for solo, wrong for multi-worker), Field Ops crypto
  adapters (out of scope).
- **[builderz-labs/mission-control](https://github.com/builderz-labs/mission-control)**
  — Self-hosted dashboard for AI agent fleets: dispatch tasks, track
  costs, coordinate workflows. **Watch:** fleet-level metrics shape.
- **[crshdn/mission-control](https://github.com/crshdn/mission-control)**
  — "Autonomous Product Engine" — agents research market, generate
  features, ship code as PRs. **Skip:** product-only scope; doesn't
  fit services work.
- **[carlosazaustre/tenacitOS](https://github.com/carlosazaustre/tenacitOS)**
  — OpenClaw mission-control dashboard (Next.js 15 + React 19).
  **Watch:** lightweight instance-supervision UI.
- **[AgentsMesh](https://github.com/AgentsMesh/AgentsMesh)** — "AI
  Agent Workforce Platform — where teams scale beyond headcount."
  Remote/hosted runtime for agents at fleet scale. **Skip:** cloud
  runtime for agents themselves; orthogonal to our problem, which is
  scheduling the work, not hosting the agents.
- **Microsoft Copilot Cowork** (proprietary, Microsoft 365, 2026-03)
  — Enterprise take: agents get Teams logins, mailboxes, and show up
  on the org chart alongside employees. **Watch:** validates the
  "agents as coworkers" framing at enterprise scale. **Skip:** closed
  source, M365-only, wrong audience.
- **GitHub topic [`ai-workforce`](https://github.com/topics/ai-workforce)**
  and [`agent-orchestration`](https://github.com/topics/agent-orchestration)
  — active fast-moving category as of 2026-Q1; revisit before
  committing to a build.

Common pattern across this category: they all reinvent ticketing,
org-charts, and budgets because there's no "agent-native" PM tool.
Common gap: none of them have a real notion of a *client* or
*engagement*, so billing and client-visibility are out of scope. That
gap is precisely where Batuda's CRM spine would be the
differentiator.

### 8.5 Modern CRMs — inspiration for the CRM spine

Batuda already has a CRM spine (companies, contacts, interactions,
tasks). These are the CRMs whose UX, data model, and agent-readiness we
should steal from — not replace Batuda with. Proprietary ones are
here for design inspiration only.

#### Agent-native / AI-native (proprietary — study, don't copy)

- **[Attio](https://attio.com)** — the clearest articulation of
  "agent-native" CRM. Ask Attio (natural-language search + write), MCP
  server so coding agents can operate on the CRM, and agents put to
  work on prospecting and lead scoring. Flexible data model (objects,
  attributes, lists) that's more Notion-like than Salesforce-like.
  **Steal:** MCP-first surface area (every CRM action reachable to an
  agent without a custom tool), natural-language search over entities,
  enrichment pipelines as first-class. **Skip:** the "generic CRM for
  any team" positioning — Batuda is opinionated for solo/agency.
- **[Folk](https://folk.app)** — CRM for founders and agencies,
  relationship-first rather than deal-first. LinkedIn/email sync,
  multi-channel inbox, lightweight "groups" instead of heavy pipelines.
  **Steal:** contact-first UX (Batuda today is more company-first),
  message sync across channels, smart fields auto-filled from
  interactions. **Skip:** closed source, SaaS-only.
- **[Reevo](https://reevo.ai)** — AI-native CRM that auto-structures
  emails, calls, and pipeline movements. **Steal:** implicit capture
  (no manual data entry) as the north-star UX. **Skip:** enterprise
  sales-team focus.
- **Attio/Lightfield/Aurasell/Monaco cluster** (SaaStr 2026 list) —
  early-stage AI-native CRMs. **Watch:** the wave is validating the
  bet that CRMs get rebuilt around agents, not retrofitted.

#### Modern open-source (reference codebases)

- **[Twenty](https://github.com/twentyhq/twenty)** (AGPL-3.0,
  TypeScript/NestJS/React) — #1 open-source CRM, modern Salesforce
  alternative. Custom fields and objects via GUI, workflow builder,
  GraphQL + REST, Zapier integration. ~44k stars. **Steal:** workspace
  data-model patterns (custom fields/objects), kanban/table view
  composition, Figma kit, Storybook-per-component. **Skip:** huge
  codebase; retrofitting it would be harder than incremental extension
  of Batuda's typed CRM.
- **[Atomic CRM](https://github.com/marmelab/atomic-crm)** (MIT,
  React + shadcn/ui + Supabase) — 15k LOC, marketed as a *template* to
  build your own CRM. First-class **MCP server**, Agents.md + Claude.md,
  kanban pipeline, inbound email, SSO. Closest in spirit to what
  Batuda already is. **Steal:** MCP server layout, Agents.md
  conventions, "small codebase as a feature" stance, inbound-email
  ingest. **Skip:** Supabase lock-in (we have our own Effect stack).
- **[EspoCRM](https://github.com/espocrm/espocrm)** (AGPL-3.0, PHP) —
  mature, clean UI, powerful in-app admin (model studio, roles,
  fine-grained access, OIDC/LDAP). **Steal:** model-studio UX (if we
  ever let users add custom fields), audit-log presentation.
  **Skip:** PHP + home-made framework.
- **[Krayin](https://github.com/krayin/laravel-crm)** (MIT, Laravel +
  Vue) — marketing-automation-forward, web forms, image-to-contact.
  **Skip:** Laravel stack mismatch.
- **[SuiteCRM](https://github.com/salesagility/SuiteCRM)** and
  **[OroCRM](https://github.com/oroinc/crm)** — legacy-feel but
  feature-rich. **Skip:** outdated stacks.
- **[NocoBase](https://github.com/nocobase/nocobase)** / **[NocoDB](https://github.com/nocodb/nocodb)**
  — Airtable-likes with CRM templates. **Skip:** generic models again.
- **[Monica](https://github.com/monicahq/monica)** — personal-CRM
  (friends, family). **Watch:** the "relationship-first" data model
  — useful counterpoint to deal-pipeline CRMs.

#### What to look for when studying these

When reading any of the above for inspiration, focus on:

1. **How they model the core trio** — company, contact, interaction —
   and what they add on top (deals, lists, tags, custom objects).
2. **Agent/AI surface** — MCP server? Natural-language search?
   Agents.md? Attio and Atomic CRM are the two to read closely here.
3. **Interaction capture** — how email/calendar/call sync lands as
   structured data. Folk, Reevo, Attio all solve this differently.
4. **Pipeline vs. relationship framing** — founder-CRMs (Folk,
   Monica) emphasize relationships; sales-CRMs (Twenty, Salesforce)
   emphasize deals. Batuda is closer to the former.
5. **Extension surface** — custom fields, workflows, webhooks. Twenty
   and EspoCRM are the references.

### 8.6 Adjacent / general

- **[Baserow](https://baserow.io)** — Airtable-like. Some consultants use
  it as a flexible project table. **Skip:** too generic to replace a
  typed model.

### 8.7 Why none of these are enough

Every PSA tool assumes humans-only. Every AI-orchestration project
assumes agents-only. The distinctive problem — a task queue where a human
and an agent are interchangeable executors, with typed handoffs and
autonomy policy — doesn't exist off the shelf. That's the defensible
product surface if we ever decide to build.

## 9. Non-goals (explicit)

- Multi-tenancy. One workshop per deployment.
- Public marketplace of agents / "hire an AI."
- Gantt charts. Small agencies don't need them; linear scheduling +
  calendar view is enough.
- Chat. Threads live in email; slack is not a surface we own.
- Mobile-native app. The Batuda web app is mobile-first; that's the mobile story.
- Offline mode. Cloud-first is fine for this audience.
- Fine-grained permissions beyond Better-Auth + autonomy policy.

## 10. Open questions

- Do agents get their own `user` rows (current model) or a separate
  `agent` entity? Current model is simpler; agent entity is cleaner long
  term. **Leaning:** keep user rows, add `worker_kind` denorm view.
- Budget enforcement — soft warn or hard stop when project budget hits?
  **Leaning:** soft warn, hard stop only for agent workers (cost runaway
  protection).
- Where does "approval" live for a finished deliverable — in the task
  `review_state` or a separate `deliverable.accepted_at`?
  **Leaning:** deliverable-level; tasks are internal.
- How much of this is exposed in the MCP surface? Agents should see
  their queue and request reviews, but probably not edit autonomy policy.

## 11. Phasing when the trigger fires

- **Phase 1 — Assignees + status machine** (~1 week)
  Add `assignee_id`, expand task `status`, review fields. UI: per-user
  queue on `/tasks`.
- **Phase 2 — Autonomy policy** (~1 week)
  `agent_autonomy_policy` table + middleware that reads it before agent
  writes. Settings UI.
- **Phase 3 — Projects + deliverables** (~2 weeks)
  `projects`, `deliverables`, `engagements`. Task gets `project_id`.
  Project board view.
- **Phase 4 — Time + capacity** (~2 weeks)
  `time_logs`, timer, capacity windows, profitability view.
- **Phase 5 — Client portal** (optional, ~2 weeks)
  Read-only external view scoped by engagement.

Each phase is shippable on its own. None require rewriting CRM primitives.

---

*Last updated: 2026-04-18. Status: design note, not scheduled.*
