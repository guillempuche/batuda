# Engranatge — services and products

Canonical catalogue of what Engranatge sells and who it sells to. This is the source of truth for proposals, briefs, sales conversations, and the TypeScript mirror at `apps/marketing/src/data/services.ts` (which must stay in sync with this document). Paired with `docs/usecases.md`, the customer-side companion that catalogues the recurring problems these services are built to solve — departments, block catalogue, case studies, and dream customer archetypes.

This file is **service details only** — what Engranatge builds, what's included, what's excluded. It intentionally contains no customer cases, no use-case blocks, and no dream customer archetypes (those live in `docs/usecases.md`), nor any brand positioning, mission framing, metaphor guidance, or copywriting rules (those live in `docs/brand-voice.md`). Written in English regardless of the marketing site's output languages; translations are produced on demand by the drafter.

## Target customer

Mid-sized businesses in Catalonia and Spain — roughly 30 to 250 employees. This is the ideal sweet spot: large enough to have multiple departments, structured processes, and real volume of recurring tasks that make manual handling expensive; small enough that the owner or leadership team still makes decisions directly, without procurement committees, IT departments, or quarterly budgeting rituals. Smaller firms can still be served when the recurring pain is acute enough to justify the work, but mid-sized is where Engranatge's value compounds — one automation can free up a team, not just a person.

Two overlapping groups:

1. **Professional and knowledge-work service firms** — architecture and engineering studios, legal and accounting practices, consultancy firms, property management companies, medical and dental networks.
2. **Mid-sized industrial firms where the pain is on the admin side, not the shop floor** — component manufacturers, metalworking and automotive workshops, construction firms, logistics and distribution operators.

Not enterprise (no thousand-person companies, no multi-country structures, no procurement committees, no RFPs). Not tech startups. Not restaurants, retail, or hospitality as a primary focus. Engranatge does not ship hardware, install sensors, scanners, or IoT devices, or build anything that lives on the shop floor. Every solution runs in a browser, in an inbox, in a chat app, or on a phone as a web app.

## Current phase

Pilot discovery. Pricing is not published. Engranatge is picking a small number of mid-sized firms each quarter to build real pilot cases with, learn the market, and publish honest prices afterwards. Every bottom-of-funnel call to action is a discovery call, never a checkout.

## What Engranatge builds

Engranatge sells **three services**. Each one is picked for a specific kind of task; a single engagement can combine two or three of them when the customer's situation calls for it.

1. **Automation** — flow glue between the tools the customer already uses, powered by n8n.
2. **Micro-SaaS** — a small, 100% custom modern web app built from scratch when the customer needs a new place for data or a dedicated interface for a specific workflow.
3. **AI agents** — custom AI assistants that read, classify, answer, or summarise unstructured input so the customer's team can focus on decisions instead of triage.

The common thread across the three: the customer's weekly and monthly recurring tasks move from **manual and error-prone** to **digital and reliable**. The value lives in the specific mess of the specific business — templates and configured SaaS tools generally fail here because they assume the customer will bend their process to the tool, not the other way around.

**Pricing:** not published yet. Engranatge is in pilot discovery; every engagement starts with a discovery call and a per-case scope.

---

### 1. Automation

**Slug:** `automatitzacions`

Flow glue between the tools the customer's team already uses — email, invoicing and accounting systems, spreadsheets, CRM, ERP, cloud drives, web forms, WhatsApp, shared inboxes, ticketing tools. Information moves on its own across departments; nothing forgotten, nothing re-typed. No new tools for the team to learn, no new places to log in. The team's week gets quieter.

This is the default starting mode and the fit for most recurring-task problems. If the customer already has the tools but the information between them moves by copy-paste across a multi-person team, this is the service.

**Powered by (internal only — never shown to customers):** n8n.

**One-liner:** Flow glue between the tools you already use, so the weekly and monthly manual tasks move on their own.

**Inputs:** invoices, emails, web forms, spreadsheets, POS tickets, WhatsApp messages, shared inboxes, paper-based counts.

**Outputs:** updated records, automatic notifications, generated reports, classified and routed emails, data extracted from one tool and dropped into another.

**Includes:** discovery meeting, flow design, integration with the customer's existing tools, testing and launch, 30-day support after go-live.

**Excludes:** third-party subscriptions (Zapier, Make, and equivalents), migration of legacy data, unplanned integrations, scope changes after delivery.

---

### 2. Micro-SaaS

**Slug:** `microsaas`

A small, 100% custom modern web app built from scratch when the customer needs a new place for data or a dedicated interface for a specific workflow — a client intake and case tracker, a customer order portal, a per-project dashboard, an internal approval flow, a bespoke lightweight CRM. Not a giant ERP or CRM platform. Modern web stack, mobile-accessible, maintained monthly, team trained.

This is the service when automation alone is not enough because the tool the customer needs does not exist yet — the data has nowhere to live, or the workflow needs a dedicated interface that no off-the-shelf tool provides.

**Powered by (internal only — never shown to customers):** modern web stack (custom build, not low-code templates).

**One-liner:** A small, 100% custom modern web app built from scratch when you need a new place for your data or a dedicated interface for a specific workflow.

**Inputs:** the customer's specific business process, the way the team works today, the people who will use the app (internal team, clients, external collaborators).

**Outputs:** a small custom web app, per-workflow dashboards, customer-facing portals, internal tools, real-time data views, structured intake forms, bespoke lightweight CRMs.

**Includes:** discovery meeting, UX design, full-stack development, deploy and hosting, team training, monthly maintenance after go-live.

**Excludes:** third-party subscriptions and licences, initial content and data migration, creative design beyond the functional UI, scope changes after delivery.

---

### 3. AI agents

**Slug:** `agents-ia`

Custom AI agents that read, classify, answer, or summarise unstructured input at the volume where a human team starts to drown — dozens to hundreds of emails, messages, or documents per day. The agent works autonomously on its portion of the task; the customer's team keeps the final decision on anything that matters.

This is the service when the bottleneck is *judgement on messy input at volume* — the work a human has to do today is reading an email, understanding what it is, and deciding where it goes, and there are too many of them for one person to keep up with. The agent handles the reading and the first judgement; the human handles the edge cases and the final call.

Never used for creative content generation. Never used for decisions with legal or financial liability where a human signature is required.

**Powered by (internal only — never shown to customers):** Mastra and LLMs. See *Internal tooling stack* below.

**One-liner:** Custom AI assistants that read, classify, answer, or summarise — so your team focuses on the decisions, not the triage.

**Inputs:** emails, PDF documents, customer queries, meeting recordings, WhatsApp messages, shared inboxes, recurring customer questions.

**Outputs:** classified emails, extracted structured data, automatic responses, meeting summaries, routed tasks, agent-drafted replies for human approval.

**Includes:** discovery meeting, agent design (role, boundaries, fallback rules, human-in-the-loop checkpoints), model configuration, initial tuning, testing and launch, 30-day support after go-live.

**Excludes:** AI API costs (OpenAI and equivalents), creative content generation, decisions with legal or financial liability, scope changes after delivery.

---

## Internal tooling stack

Internal only — never shown to customers, never named in proposals. Same rule as the per-service "Powered by" lines above.

All customer deliverables ship as **TypeScript projects** in the Forja monorepo.

**Visual editor (Automation):** Langflow or n8n. Used for [AUTO] flow glue where a readable visual graph is worth more than code-level control.

**Agent runtime (AI agents):** Mastra as the default TypeScript-native framework. LangChain.js when a feature only exists upstream. CUGA (IBM) reserved for enterprise pilots that need policy-driven, audited multi-agent runtime — Python, used only when a customer's compliance posture forces it.

**Open protocols (always preferred over proprietary glue):** MCP for tool calls, A2A for agent-to-agent coordination, AG-UI for agent ↔ human interaction.

**Eval & observability (AI agents):** Langfuse and Latitude as the two open-source, self-hosted candidates for traces, prompt versioning, datasets, and a customer-readable UI at handover. Latitude leans product-team / non-dev editable (and is Barcelona-based); Langfuse leans engineering / production-mature. Pilot both before locking in. Hosted-only platforms (LangSmith, Braintrust) are excluded — customer data stays on infra we control.
