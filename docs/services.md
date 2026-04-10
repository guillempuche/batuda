# Engranatge — services and products

Canonical catalogue of what Engranatge sells, who it sells to, and the real examples cited as proof. This is the source of truth for proposals, briefs, sales conversations, and the TypeScript mirror at `apps/marketing/src/data/services.ts` (which must stay in sync with this document).

This file is **service details only**. It intentionally contains no brand positioning, no mission framing, no metaphor guidance, and no copywriting rules — all of that lives in `docs/brand-voice.md`. Written in English regardless of the marketing site's output languages; translations are produced on demand by the drafter.

## Target customer

Mid-sized businesses in Catalonia and Spain — roughly 30 to 250 employees. This is the ideal sweet spot: large enough to have multiple departments, structured processes, and real volume of recurring tasks that make manual handling expensive; small enough that the owner or leadership team still makes decisions directly, without procurement committees, IT departments, or quarterly budgeting rituals. Smaller firms can still be served when the recurring pain is acute enough to justify the work, but mid-sized is where Engranatge's value compounds — one automation can free up a team, not just a person.

Two overlapping groups:

1. **Professional and knowledge-work service firms** — architecture and engineering studios, legal and accounting practices, consultancy firms, property management companies, medical and dental networks. The bottleneck is document handling, client intake, quoting, routing, and recurring client communication at a volume where manual handling is costing full-time roles.
2. **Mid-sized industrial firms where the pain is on the admin side, not the shop floor** — component manufacturers, metalworking and automotive workshops, construction firms, logistics and distribution operators. The bottleneck is order intake, supplier paperwork, customer quoting, and internal coordination across departments — not production, stock handling, or anything physical.

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

**Real examples:**

- **Metalworking fabricator (~60 employees).** Job orders were arriving as WhatsApp photos and emailed PDFs across multiple inboxes; the production planner was a shared spreadsheet updated by hand each morning. Two jobs fell through the cracks in the previous quarter. Solution: automatic intake from email and WhatsApp into the planner, with instant notifications to the shift leads. Result: **around 6 hours per week freed across the ops team, zero lost jobs.**
- **Architecture studio (~40 people, ~90 active projects).** Project documentation from clients, suppliers, and the municipality was landing in a shared mailbox and filed by hand into shared-drive folders by project code. Solution: a flow that reads incoming email, detects the project code, files the attachments into the right folder, and notifies the project lead. Result: **around 8 hours per week freed across the ops team, filing always complete.**
- **Automotive workshop group (~4 locations, shared finance team).** Supplier invoices and delivery notes were typed into the accounting system every Friday afternoon by the finance team. Solution: automatic extraction from supplier PDFs into the accounting system, one pipeline per supplier. Result: **Friday afternoons back across the 3-person finance team.**

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

**Real examples:**

- **Component manufacturer (~120 employees, ~200 regular B2B customers) — customer order portal.** Regular B2B customers were placing orders by phone and email; the 4-person office team re-keyed each order into the ERP and chased payment status on the phone. Solution: a small custom web portal where customers log in, place orders, check status, and download past invoices themselves. Result: **phone/email order load down around 60%, the office team moved from re-keying to handling complex cases and new accounts.**
- **Mid-sized legal firm (~35 lawyers, 3 offices) — client case tracker.** Client intake in a spreadsheet, case timeline in a Word doc per case; handoffs between lawyers and offices cost hours of re-reading per case. Solution: a small custom web app with a client intake form feeding a per-case dashboard accessible from any office. Result: **case context available in under 30 seconds from any office, smoother handoffs when a lawyer is out.**

---

### 3. AI agents

**Slug:** `agents-ia`

Custom AI agents that read, classify, answer, or summarise unstructured input at the volume where a human team starts to drown — dozens to hundreds of emails, messages, or documents per day. The agent works autonomously on its portion of the task; the customer's team keeps the final decision on anything that matters. Typical uses: RFQ triage, email routing, client Q&A on WhatsApp or the website, data extraction from PDFs and invoices, meeting summarisation, recurring-question answering.

This is the service when the bottleneck is *judgement on messy input at volume* — the work a human has to do today is reading an email, understanding what it is, and deciding where it goes, and there are too many of them for one person to keep up with. The agent handles the reading and the first judgement; the human handles the edge cases and the final call.

Never used for creative content generation. Never used for decisions with legal or financial liability where a human signature is required.

**Powered by (internal only — never shown to customers):** Flowise and LLMs.

**One-liner:** Custom AI assistants that read, classify, answer, or summarise — so your team focuses on the decisions, not the triage.

**Inputs:** emails, PDF documents, customer queries, meeting recordings, WhatsApp messages, shared inboxes, recurring customer questions.

**Outputs:** classified emails, extracted structured data, automatic responses, meeting summaries, routed tasks, agent-drafted replies for human approval.

**Includes:** discovery meeting, agent design (role, boundaries, fallback rules, human-in-the-loop checkpoints), model configuration, initial tuning, testing and launch, 30-day support after go-live.

**Excludes:** AI API costs (OpenAI and equivalents), creative content generation, decisions with legal or financial liability, scope changes after delivery.

**Real examples:**

- **Engineering consultancy (~50 people, multi-discipline).** Incoming requests for quotes arrived as free-text emails with attached specs; the ops team spent around 90 minutes every morning classifying them by discipline and routing to the right engineer. Solution: an AI agent that reads each RFQ, extracts the key specs, classifies the discipline, and drafts a routing suggestion the partner approves. Result: **around 1.5 hours per day freed across the ops team, faster first response to clients.**
- **Property management firm (~800 units under management).** Tenant questions on WhatsApp — rent, inspections, small repairs — were handled one by one by the 2-person front office, interrupting the rest of the day. Solution: an AI agent that answers routine questions from the tenant handbook and escalates the rest to the front office with a drafted reply. Result: **around 3 hours per day freed across the front office, faster tenant responses.**

---

## Dream customer archetypes

When briefing a proposal or a sales conversation, anchor on one archetype. A vague "SMB" framing is too thin to build a real case around.

1. **Xavi, COO of a metalworking fabricator.** Runs ops at a 60-person stainless-steel fabricator near Girona — three shifts, two production lines. Incoming jobs still arrive as WhatsApp photos and emailed PDFs landing in multiple inboxes; the production planner is a shared spreadsheet updated by hand each morning. Two jobs fell through the cracks last quarter. Xavi wants a single intake lane that lands every new job in the planner automatically and notifies the shift lead. *Likely service fit: automation.*
2. **Núria, managing partner at an architecture studio.** Runs a 40-person multi-discipline studio near Barcelona — buildings, urban planning, interiors. Project documentation from clients, suppliers, and the municipality lands in a shared mailbox that no one really owns; someone has to file every attachment under the right project code. At 90 active projects, "someone" is losing two full days a week across the ops team. *Likely service fit: automation.*
3. **Roser, partner at an engineering consultancy.** Partner at a 50-person multi-discipline engineering consultancy in Barcelona — civil, structural, energy. Incoming requests for quotes arrive as free-text emails with attached specs; the ops team spends roughly 90 minutes each morning classifying them by discipline and routing to the right engineer. Roser wants that time back without losing the partner-level review at the end. *Likely service fit: AI agent.*
4. **Joan, CFO of a component manufacturer.** Runs finance and operations at a 120-person B2B component supplier near Barcelona, serving around 200 regular customers. Orders still arrive by phone and email; the 4-person office team spends half the week re-keying them into the ERP and chasing payment status on the phone. Joan wants the regular customers to serve themselves for routine orders so his team can focus on complex cases and new accounts. *Likely service fit: micro-SaaS.*
5. **Laia, managing partner at a mid-sized legal firm.** Heads a 35-lawyer regional firm split across three offices. Client intake is tracked in a spreadsheet; each case timeline lives in a Word doc per case. Handoffs between lawyers and offices cost hours of re-reading per case. She wants one place per case, accessible from any office, and no more spreadsheets. *Likely service fit: micro-SaaS.*

## Proof inventory

What can be cited today. Never invent clients, numbers, or logos.

- **Pilot in progress:** Engranatge is picking five mid-sized firms this quarter to build real pilot cases. This is true and can be stated directly.
- **Before/after numbers:** the figures in the service examples above are illustrative, calculated from prior one-off projects. Only cite them as customer pilots once a specific customer has agreed to be named.
- **Logos, quotes, testimonials:** none yet. Do not invent any.
