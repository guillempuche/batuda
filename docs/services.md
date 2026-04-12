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

Engranatge sells **two services**. Each one is picked for a specific kind of task; a single engagement can combine both when the customer's situation calls for it.

1. **Automation** — flow glue between the tools the customer already uses, powered by n8n.
2. **AI agents** — custom AI assistants that read, classify, answer, or summarise unstructured input so the customer's team can focus on decisions instead of triage.

The common thread across both: the customer's weekly and monthly recurring tasks move from **manual and error-prone** to **digital and reliable**. The value lives in the specific mess of the specific business — templates and configured SaaS tools generally fail here because they assume the customer will bend their process to the tool, not the other way around.

**Pricing:** not published yet. Engranatge is in pilot discovery; every engagement starts with a discovery call and a per-case scope. An **annual support contract** is offered as an optional, additional fee on top of every engagement — it covers monitoring, minor adjustments, and break-fix after the initial 30-day launch window. Without the annual contract, support ends at day 30.

---

### 1. Automation

**Slug:** `automatitzacions`

Flow glue between the tools the customer's team already uses — email, invoicing and accounting systems, spreadsheets, CRM, ERP, cloud drives, web forms, WhatsApp, shared inboxes, ticketing tools. Information moves on its own across departments; nothing forgotten, nothing re-typed. No new tools for the team to learn, no new places to log in. The team's week gets quieter.

This is the default starting mode and the fit for most recurring-task problems. If the customer already has the tools but the information between them moves by copy-paste across a multi-person team, this is the service.

**Powered by:** n8n. *Not emphasized in marketing or sales copy — the customer-facing story is outcomes, not tools — but disclosed honestly on request during procurement, due diligence, or technical handover.*

**One-liner:** Flow glue between the tools you already use, so the weekly and monthly manual tasks move on their own.

**Inputs:** invoices, emails, web forms, spreadsheets, POS tickets, WhatsApp messages, shared inboxes, paper-based counts.

**Outputs:** updated records, automatic notifications, generated reports, classified and routed emails, data extracted from one tool and dropped into another.

**Includes:** discovery meeting, flow design, integration with the customer's existing tools, testing and launch, 30-day support after go-live.

**Ongoing support (optional, additional fee):** annual support contract covering monitoring, minor adjustments, credential rotation, break-fix, and runbook updates. Business hours (Mon–Fri, 9:00–18:00 CET). Priced per engagement.

**Excludes:** third-party subscriptions (Zapier, Make, and equivalents), migration of legacy data, unplanned integrations, scope changes after delivery.

---

### 2. AI agents

**Slug:** `agents-ia`

Custom AI agents that read, classify, answer, or summarise unstructured input at the volume where a human team starts to drown — dozens to hundreds of emails, messages, or documents per day. The agent works autonomously on its portion of the task; the customer's team keeps the final decision on anything that matters.

This is the service when the bottleneck is *judgement on messy input at volume* — the work a human has to do today is reading an email, understanding what it is, and deciding where it goes, and there are too many of them for one person to keep up with. The agent handles the reading and the first judgement; the human handles the edge cases and the final call.

Never used for creative content generation. Never used for decisions with legal or financial liability where a human signature is required.

**Powered by:** Mastra and LLMs — see *Internal tooling stack* below. *Not emphasized in marketing or sales copy — the customer-facing story is outcomes, not tools — but disclosed honestly on request during procurement, due diligence, or technical handover.*

**One-liner:** Custom AI assistants that read, classify, answer, or summarise — so your team focuses on the decisions, not the triage.

**Inputs:** emails, PDF documents, customer queries, meeting recordings, WhatsApp messages, shared inboxes, recurring customer questions.

**Outputs:** classified emails, extracted structured data, automatic responses, meeting summaries, routed tasks, agent-drafted replies for human approval.

**Includes:** discovery meeting, agent design (role, boundaries, fallback rules, human-in-the-loop checkpoints), model configuration, initial tuning, testing and launch, 30-day support after go-live.

**Ongoing support (optional, additional fee):** annual support contract covering eval monitoring, prompt adjustments, model configuration updates, regression checks, and break-fix. Business hours (Mon–Fri, 9:00–18:00 CET). Priced per engagement.

**Excludes:** AI API costs (OpenAI and equivalents), creative content generation, decisions with legal or financial liability, scope changes after delivery.

---

## Internal tooling stack

Not emphasized in marketing or proposal copy — the customer-facing story is outcomes, not tools. Disclosed honestly on request during procurement, customer due diligence, or technical handover. Same rule as the per-service "Powered by" lines above.

### Delivery model

Each customer engagement ships as a **private TypeScript repository** (one repo per client, one or multiple projects inside). The client owns the repo; Engranatge has contributor access for the duration of the engagement and, if the annual support contract is active, afterwards.

- **Automation flows** live in a self-hosted or cloud n8n instance per client. The client's team can inspect and maintain these after handover — this is the No-Code handover surface.
- **AI flows (Low-Code)** live as Langflow Runtime deployments — headless, behind Engranatge's auth layer. The client's team can inspect flow structure; Engranatge maintains via the support contract.
- **AI agents (Code)** live in the client repo as Mastra TypeScript. Engranatge maintains via the support contract; the client's team does not need to edit agent code directly.
- **MCP servers** (tool integrations) ship inside the client repo or are pulled from Engranatge's reusable library. Custom MCP servers built for one client are generalised and added to the library when the pattern recurs.

### Delivery tiers

Every use case block in `docs/usecases.md` maps to one of four tiers. The tier determines delivery cost, speed, and what the client's team can touch after handover. During a discovery call, classifying the customer's problem into a tier is the first scoping decision.

| Tier          | Code involvement   | Tools                                | Client maintains after handover             | Typical delivery |
| ------------- | ------------------ | ------------------------------------ | ------------------------------------------- | ---------------- |
| **No-Code**   | None               | n8n                                  | Yes — visual flows                          | Days             |
| **Low-Code**  | Config only        | n8n + Langflow Runtime               | Partially — visual flows and AI flow config | Days to weeks    |
| **Code**      | TypeScript         | Mastra                               | No — support contract                       | Weeks            |
| **Code + UI** | TypeScript + React | Mastra + CopilotKit or Vercel AI SDK | No — support contract                       | Weeks            |

**How to pick a tier:**

1. Does the task need an LLM (reading, classifying, summarising, or drafting from unstructured input)? **No → No-Code** (n8n only).
2. Is the LLM step a single pass — extract, classify, or summarise one input? **Yes → Low-Code** (n8n orchestrates, Langflow Runtime handles the AI step).
3. Does the LLM step require multi-step reasoning, tool orchestration, branching, or learning from corrections? **Yes → Code** (Mastra).
4. Does a human interact with the agent in real time? **Yes → Code + UI.** Chat or copilot sidebar → CopilotKit. Embedded in existing app (inline suggestions, "draft this" buttons) → Vercel AI SDK. AG-UI is the streaming protocol underneath both; it's infrastructure, not a choice.

### Use case tier map

Default tier for each block in `docs/usecases.md`. Some blocks can be upgraded to a higher tier when the client's situation demands it — noted in parentheses.

#### No-Code — n8n only (~14 blocks)

| Department  | Block                                                                                                      | Why No-Code                                                                                   | Tier shift                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Admin       | [Calendar Tetris scheduling](usecases.md#calendar-tetris-for-scheduling-meetings-with-external-parties)    | All inputs structured (calendar data, availability). Rules are deterministic.                 | → Low-Code if scheduling needs to parse free-text email preferences                             |
| Finance     | [Payment chasing](usecases.md#payment-status-chased-by-phone-and-email)                                    | Overdue list is structured data. Chase sequence is rule-based (days overdue → template).      | → Low-Code if chase messages need personalisation from relationship history                     |
| Finance     | [Month-end reports](usecases.md#month-end-reports-assembled-by-hand-from-multiple-tools)                   | Sources are structured (accounting, payroll, bank). Assembly is templated pull-and-fill.      | → Low-Code if the report needs narrative commentary or anomaly explanation                      |
| Sales       | [Follow-up on sent quotes](usecases.md#follow-up-on-sent-quotes-depending-on-salesperson-memory)           | Pipeline data is structured. Nudge timing is rule-based (days since sent, no response).       | → Low-Code if follow-up messages need personalisation from quote content or prospect context    |
| Sales       | [Order entry from confirmed quote](usecases.md#order-entry-from-a-confirmed-quote-retyped-into-the-erp)    | Quote fields map directly to ERP fields. Pure field mapping, no interpretation.               | → Low-Code if confirmation arrives as unstructured email instead of structured acceptance       |
| Marketing   | [Lead capture](usecases.md#lead-capture-forms-feeding-a-spreadsheet-nobody-watches)                        | Form → CRM is direct field mapping. Notification is rule-based.                               | → Low-Code if leads need scoring or classification based on form content before routing         |
| Marketing   | [Newsletter hygiene](usecases.md#newsletter-and-mailing-list-hygiene-done-by-hand)                         | Dedup, bounce removal, unsub processing are deterministic operations on structured lists.     | Stays No-Code. Rarely needs an LLM.                                                             |
| Operations  | [Incoming job orders](usecases.md#incoming-job-orders-scattered-across-inboxes-and-messaging-apps)         | Channel consolidation (email, WhatsApp, form → single queue). Routing is rule-based.          | → Low-Code if job orders arrive as free-text descriptions needing classification before routing |
| Operations  | [Daily planning](usecases.md#daily-planning-maintained-by-hand-in-a-shared-spreadsheet)                    | Data → formatted output. Deterministic layout, no judgement.                                  | Stays No-Code unless planning requires optimisation logic.                                      |
| Procurement | [Purchase orders](usecases.md#purchase-orders-raised-by-hand-in-email-or-a-word-template)                  | Template → fill → send → track. Structured fields, deterministic flow.                        | → Low-Code if PO needs smart population from unstructured request descriptions                  |
| HR          | [Onboarding paperwork](usecases.md#onboarding-paperwork-assembled-and-sent-by-hand)                        | Template personalisation is field substitution (name, start date, role). Chase is rule-based. | Stays No-Code. Inputs are always structured.                                                    |
| HR          | [Time-off requests](usecases.md#time-off-requests-handled-by-email-or-whatsapp)                            | Parse request (date range, type) → check calendar → flag clashes. Structured input.           | → Low-Code if requests arrive as free-text WhatsApp messages needing NLP parsing                |
| Legal       | [Contract tracking and renewal](usecases.md#contract-tracking-and-renewal-reminders-kept-in-someones-head) | Date scanning + alerting is deterministic. Contract dates are in a system or spreadsheet.     | → Low-Code if contracts are PDFs and dates need to be extracted from unstructured documents     |
| Legal       | [Document retention](usecases.md#document-retention-and-deletion-compliance-done-by-hand)                  | Retention rules are deterministic (document type × age → archive/delete).                     | → Low-Code if documents need AI classification before retention rules can apply                 |
| Management  | [Weekly reports](usecases.md#weekly-management-reports-assembled-from-multiple-sources)                    | Pull structured data → assemble into template. Same shape as month-end, weekly cadence.       | → Low-Code if reports need narrative commentary or anomaly highlighting                         |

#### Low-Code — n8n + Langflow Runtime (~13 blocks)

| Department       | Block                                                                                                           | Why Low-Code                                                                                   | Tier shift                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Admin            | [Meeting minutes and action items](usecases.md#meeting-minutes-and-action-items-captured-by-hand-every-meeting) | Single-pass AI: transcription → summary + action extraction. One input, one output.            | → Code if minutes need cross-referencing CRM data or previous meeting context to enrich actions            |
| Admin            | [Documents from templates](usecases.md#documents-drafted-from-templates-by-hand-contracts-reports-slide-decks)  | Single-pass AI: extract variables from a brief or email to fill a template.                    | → Code if templates have complex conditional sections requiring multi-step clause selection                |
| Finance          | [Supplier invoices](usecases.md#supplier-invoices-keyed-into-the-accounting-system-by-hand)                     | Single-pass AI: PDF → structured data extraction. n8n receives, Langflow extracts, n8n pushes. | ← No-Code if accounting system has built-in OCR. → Code if invoices need multi-step PO reconciliation      |
| Finance          | [Expense receipts](usecases.md#expense-receipts-collected-photographed-and-re-typed)                            | Single-pass AI: photo/PDF → amount + category. Same pattern as invoices.                       | ← No-Code if a dedicated receipt tool (Expensify, etc.) handles extraction                                 |
| Sales            | [Quotes built by hand](usecases.md#quotes-built-by-hand-from-a-spreadsheet-or-word-template)                    | Single-pass AI: suggest line items from specs. n8n handles template and pricing.               | → Code if building requires reading complex specs, cross-referencing past quotes, multi-step pricing       |
| Marketing        | [Event follow-up](usecases.md#event-follow-up-done-manually-after-each-conference)                              | Single-pass AI: personalise a message template from lead context. n8n sends.                   | ← No-Code if generic follow-up template is sufficient without personalisation                              |
| Customer Service | [Client status updates](usecases.md#client-status-updates-requested-by-phone-and-email)                         | Single-pass AI: format a natural language response from structured system data.                | → Code + UI if clients expect a real-time conversational interface instead of one-shot replies             |
| Operations       | [Project document filing](usecases.md#project-documents-landing-in-a-shared-mailbox-nobody-owns)                | Single-pass AI: classify project code from document content. n8n files.                        | ← No-Code if documents already contain a parseable project code in a standard location (subject, filename) |
| Operations       | [Internal handoffs](usecases.md#internal-handoffs-losing-context-between-people-or-shifts)                      | Single-pass AI: summarise context from one source.                                             | → Code if handoff needs to pull from multiple systems (CRM + tickets + emails) with relevance reasoning    |
| Procurement      | [Delivery notes reconciliation](usecases.md#incoming-delivery-notes-reconciled-against-pos-by-hand)             | Single-pass AI: extract data from delivery note PDF. n8n matches against PO.                   | → Code if reconciliation requires fuzzy matching across varying supplier formats                           |
| Procurement      | [Supplier price comparison](usecases.md#supplier-price-lists-compared-by-hand-for-repeat-purchases)             | Single-pass AI: extract prices from supplier documents. n8n compares and ranks.                | → Code if comparison needs historical trend analysis or quality-weighted scoring                           |
| Legal            | [Recurring NDAs/contracts](usecases.md#recurring-ndas-and-standard-contracts-drafted-from-templates)            | Single-pass AI: extract counterparty details from context. n8n fills the template.             | → Code if contracts need clause selection based on counterparty risk profile or jurisdiction               |
| Management       | [Board/investor updates](usecases.md#board-or-investor-updates-prepared-from-scratch-each-quarter)              | Single-pass AI: draft narrative from structured data.                                          | → Code if updates need cross-referencing multiple sources with sophisticated narrative coherence           |

#### Code — Mastra, no real-time UI (~5 blocks)

| Department       | Block                                                                                        | Why Code                                                                                                               | Tier shift                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin            | [Partner inbox triage](usecases.md#partner-or-executive-inbox-triage)                        | Multi-step: classify by sender + subject + body + CRM context, then draft responses. Multiple tool calls.              | ← Low-Code if triage is just classification (urgent/delegate/archive) without response drafting. → Code + UI for copilot sidebar review.            |
| Sales            | [Incoming quote requests](usecases.md#incoming-quote-requests-arriving-as-free-text-emails)  | Multi-step: read attached specs + classify discipline + route + draft first response. Tool orchestration.              | ← Low-Code if RFQs are simple enough that classification is a single-pass extraction. → Code + UI for inline salesperson review.                    |
| Customer Service | [Recurring FAQs](usecases.md#recurring-faqs-answered-from-memory-or-a-word-cheat-sheet)      | Multi-step: RAG retrieval → reason over answer → decide tone → decide if escalation needed. Learning from corrections. | ← Low-Code if FAQ set is small and static (simple lookup + template response). → Code + UI if deployed as real-time chat widget.                    |
| Customer Service | [Ticket handoffs](usecases.md#ticket-handoffs-losing-context-between-shifts-or-team-members) | Multi-source: summarise from ticket thread + CRM + internal notes + previous interactions with relevance reasoning.    | ← Low-Code if handoff is summarising a single ticket thread without cross-referencing. → Code + UI for interactive summary panel.                   |
| HR               | [CV screening](usecases.md#recruitment-intake-cvs-arriving-in-an-inbox-and-filtered-by-hand) | Multi-step: match skills + evaluate experience + rank candidates against job requirements.                             | Never downgrade — **EU AI Act high-risk** requires full traceability and human oversight regardless. → Code + UI for interactive screening copilot. |

#### Code + UI — Mastra + CopilotKit or Vercel AI SDK (~3 blocks)

| Department       | Block                                                                                                 | Why Code + UI                                                                                                           | Tier shift                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Customer Service | [Inbound questions across channels](usecases.md#inbound-questions-arriving-across-multiple-channels)  | Human interacts with agent in real time across WhatsApp, email, web. CopilotKit chat with human-in-the-loop escalation. | ← Code if the agent only needs to respond asynchronously (auto-reply, no real-time conversation) |
| Admin            | [Partner inbox triage (upgrade)](usecases.md#partner-or-executive-inbox-triage)                       | Partner reviews AI triage decisions in real time. CopilotKit copilot sidebar — approve, edit, send.                     | ← Code if the partner trusts batch triage results without real-time review                       |
| Sales            | [Incoming quote requests (upgrade)](usecases.md#incoming-quote-requests-arriving-as-free-text-emails) | Salesperson reviews AI-drafted routing and response inline before sending. Vercel AI SDK embedded in existing tool.     | ← Code if the AI routing is trusted enough to send without per-item review                       |

### Tooling

**Automation runtime (No-Code tier):** n8n. Production-grade visual automation with 400+ integrations, built-in git-based versioning, RBAC, and self-hosted deployment. This is the No-Code layer the client's team interacts with after handover.

**AI flow runtime (Low-Code tier):** Langflow Runtime (headless mode). Deployed as an API behind Engranatge's auth layer — the Langflow IDE (visual editor) is never exposed to clients or the internet. Langflow's security track record requires caution: two critical unauthenticated RCE vulnerabilities in 12 months (CVE-2025-3248 in the code validation endpoint, CVE-2026-33017 in the build endpoint) — both in IDE surfaces, not in the headless Runtime execution path. Mitigation: deploy Runtime only, behind reverse proxy with auth, patch aggressively. At SMB volumes (dozens to low hundreds of requests per day), the known scaling limitations (memory leaks under sustained RAG, Celery worker issues) do not apply.

**Agent runtime (Code tier):** Mastra as the default TypeScript-native framework. Used programmatically (imported as a library, not run as its own server). LangChain.js as a fallback when a specific integration only exists upstream.

**Agent UI layer (Code + UI tier):** CopilotKit (primary — chat, copilot sidebar, human-in-the-loop approvals) and Vercel AI SDK (secondary — embedded/inline UX like "draft this" buttons, autocomplete, form-integrated suggestions). AG-UI as the streaming protocol between agent backend and frontend — decouples the two so the backend implementation stays portable across engagements.

**Agent design (internal, all tiers):** Langflow IDE for visual prototyping and flow design during discovery and development. Runs on Engranatge's machines only. Useful for validating agent shape and MCP tool wiring before deploying as Langflow Runtime (Low-Code) or coding in Mastra (Code).

**Open protocols:** MCP for tool and data connectivity (day one, non-negotiable). AG-UI for agent-to-user streaming (adopted at Code + UI tier). A2A for agent-to-agent coordination (deferred — revisit when a client has multiple independent agent systems that need to interoperate, or when Engranatge productises a specialist agent as a standalone service).

**Eval & observability:** Langfuse and Latitude as the two open-source, self-hosted candidates for traces, prompt versioning, datasets, and a customer-readable UI at handover. Latitude leans product-team / non-dev editable (and is Barcelona-based); Langfuse leans engineering / production-mature. Pilot both before locking in. Hosted-only platforms (LangSmith, Braintrust) are excluded — customer data stays on infra we control.

### Compliance and model routing

**EU-region inference by default.** All LLM calls route to EU-hosted endpoints: Anthropic via AWS Bedrock (Frankfurt/Ireland), Azure OpenAI (Spain Central or West Europe), Mistral (Paris). Self-hosted models (vLLM or Ollama with Llama/Mistral/Qwen) for workloads where data cannot leave the client's infrastructure. Hybrid routing — self-hosted for sensitive data, cloud for harder reasoning — configured declaratively in Mastra's model router.

**GDPR / AEPD.** Contractual no-training, no-retention commitments with every model provider. Data processing agreements templated and ready before the first engagement. The Spanish data protection authority is stricter in practice than many EU countries; clients will ask and the answer must be immediate.

**EU AI Act.** Most automation and triage use cases sit in "limited risk" or "minimal risk." Engagements touching HR (CV screening), credit, insurance, or public sector are "high risk" with real compliance obligations. Risk classification is documented per engagement before scoping.

**ENS (Esquema Nacional de Seguridad).** Relevant for public-sector and quasi-public clients (ayuntamientos, mutuas, fundaciones). Hosting on ENS-certified providers (Azure Spain, AWS, Stackscale) is the path if Engranatge sells into this segment.
