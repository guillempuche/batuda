# Engranatge — customer use cases

Catalogue of the recurring problems that mid-sized businesses bring to Engranatge: department by department, problem by problem, with real case studies and dream customer archetypes at the end. This is the demand-side companion to `docs/services.md` — that file defines what Engranatge sells, this one defines what customers have. The two are designed to be read side by side: a customer problem picked from here maps to one or more services there during a discovery call.

Written in English regardless of sales language; translations are produced on demand by the drafter. Written for internal use — to brief proposals, anchor discovery calls, spark sales conversations, and help a business owner recognise themselves in a problem before any solution is discussed.

This file is **customer-side only**. It intentionally contains no service names, no solution shapes, no mentions of internal tools (n8n, Mastra, Forja monorepo), no brand positioning, no metaphor guidance, and no copywriting rules. Mapping a customer problem to a service (automation, AI agent, or a combination of them) is a judgement call made during a discovery call, never encoded here.

## The 80/20 filter

This catalogue is tight on purpose. Every block is a recurring task where **the effort to fix it is small relative to the weekly manual cost it carries today** — the 20% of a department's work that causes 80% of its friction. Low-leverage pains — rare events, expensive-to-fix structural issues, low-volume tasks where manual handling is fine — are deliberately excluded. Across the 10 departments below there are roughly 3–5 blocks each, and the catalogue grows by one block per real pilot, never by speculation.

Two tests a candidate block must pass to earn a spot:

1. **Weekly or monthly recurring.** One-off projects, annual audits, and rare events don't belong here. If it happens a few times a year, it's not a block.
2. **Value-to-effort ratio is obvious.** A block belongs when an owner reading it nods and says "yes, that one hurts, and it's not that hard to fix." If the fix is ambitious but the payoff small, or if the payoff is huge but the fix is a multi-year project, it doesn't belong.

## How to read this file

The file has five parts:

1. **Department diagnostic** — the 10 functional departments of a mid-sized business and where the recurring manual cost usually concentrates in each. Use this to orient a new conversation before diving into specific problems.
2. **Block catalogue** — by department, 3–5 tight cards per department. Each card is one recurring task that many mid-sized owners will recognise immediately. Read the title first; read the rest only if the title lands.
3. **Case studies** — real before/after examples with volumes, outcomes, and numbers. Grouped by the kind of solution Engranatge built (automation, AI agents) to show the shape of each service in practice.
4. **Dream customer archetypes** — three named personas combining a role, a sector, and a specific recurring pain. Anchor any proposal or sales conversation on one of them rather than on a vague "SMB" framing.
5. **Proof inventory** — what can and cannot be cited publicly today, so nothing in the catalogue gets used dishonestly.

## Department diagnostic

Ten functional departments, cross-sector, applicable to a mid-sized business of 30 to 250 employees regardless of whether it's a professional services firm, a manufacturer, or a logistics operator. The pain in each department follows a pattern: reading-and-writing tasks done by hand, recurring weekly or monthly, on unstructured input — emails, PDFs, messages, paper forms — that never stabilises into a format a spreadsheet can handle cleanly.

1. **Admin** — the internal overhead of running the firm: meetings, partner inboxes, documents from templates, scheduling threads. Biggest leverage in knowledge-work firms where the whole job is already digital.
2. **Finance & Accounting** — supplier invoicing, expense receipts, chasing receivables, month-end management reporting.
3. **Sales & Quoting** — inbound quote requests, building quotes from templates, follow-up on sent quotes, order entry from a confirmed quote.
4. **Marketing** — lead capture from the website, mailing list hygiene, event follow-up. Usually lean in mid-sized B2B.
5. **Customer Service** — inbound questions across multiple channels, recurring FAQs, status updates, ticket handoffs between shifts and team members.
6. **Operations & Delivery** — work intake, project document filing, handoffs between people, daily production or delivery planning.
7. **Procurement & Suppliers** — purchase orders, incoming delivery notes, price comparisons across recurring suppliers.
8. **HR & People** — recruitment intake, onboarding paperwork, time-off and training tracking.
9. **Legal & Compliance** — contract and renewal tracking, document retention, recurring agreements from templates.
10. **Management & Reporting** — weekly management reports, cross-department coordination, quarterly board and investor updates.

---

## Block catalogue

### Admin

The hidden weekly tax of a knowledge-work firm: meeting coordination, document preparation, inbox triage, and the back-office work that keeps partners, lawyers, architects, and consultants productive. Because knowledge work happens almost entirely in the digital world, the 20% that causes 80% of the friction is almost always **reading-and-writing work done by hand** (minutes, summaries, scheduling threads, template-filling) and **triage of unstructured input** (partner inboxes, shared drives, incoming document requests).

#### Meeting minutes and action items captured by hand, every meeting

- **Department:** Admin
- **Symptom:** Internal meetings, client calls, and project reviews are minuted by someone in the room typing notes into a Word doc. After the meeting, that person cleans up the notes, extracts action items, emails the summary around, and files the doc. On a busy day a partner is in 4–6 meetings and the minutes pile up.
- **Volume:** dozens of meetings per week across the firm
- **Manual cost:** 30–60 minutes of admin per meeting minuted; action items occasionally missed; older meetings hard to find later

#### Calendar Tetris for scheduling meetings with external parties

- **Department:** Admin
- **Symptom:** Scheduling any meeting with a client, supplier, or prospect kicks off a back-and-forth email thread — proposing times, checking availability, confirming, rescheduling when something changes. The assistant or the person themselves spends real time on this, and slots still collide when two threads move in parallel.
- **Volume:** dozens of scheduling threads per week per partner or executive
- **Manual cost:** 15–30 minutes per meeting scheduled; double bookings and last-minute reshuffles

#### Partner or executive inbox triage

- **Department:** Admin
- **Symptom:** Partners and executives receive hundreds of emails per day — client queries, internal requests, supplier notices, newsletters, vendor pitches. An assistant (or the partner themselves) reads each one to decide what's urgent, what to delegate, what to reply to, and what to archive. Important emails occasionally sit unread for days.
- **Volume:** 100–500 emails per day per partner
- **Manual cost:** 1–2 hours per day of triage; occasional missed high-priority messages; slow client response when the partner is busy

#### Documents drafted from templates by hand (contracts, reports, slide decks)

- **Department:** Admin
- **Symptom:** Recurring document types — NDAs, engagement letters, project reports, client proposals, board slide decks — are created by copying the last version and editing the variable parts by hand. Variables are missed, outdated clauses slip through, and version sprawl makes it unclear which file in the shared drive is the canonical one.
- **Volume:** multiple documents per day across the firm
- **Manual cost:** 20–60 minutes per document; version confusion; occasional embarrassing errors in sent versions

---

### Finance & Accounting

Where recurring admin meets the month-end scramble. The 20% that causes 80% of the friction is almost always **re-keying structured data from PDFs into accounting software** (supplier invoices, expense receipts, bank statements) and **chasing humans for information that's already in the system** (overdue payments, missing receipts, reconciliation mismatches).

#### Supplier invoices keyed into the accounting system by hand

- **Department:** Finance & Accounting
- **Symptom:** Incoming supplier invoices arrive as PDFs attached to emails or as paper delivered with goods. Someone opens each one, reads the line items, and types the data — supplier, amount, VAT, category — into the accounting system. At the end of the week or month the numbers are reconciled against bank statements and delivery notes by hand.
- **Volume:** dozens to hundreds of invoices per month
- **Manual cost:** 1–2 full days per month of finance time; typing errors occasionally make it into the books; Friday afternoons routinely burned on data entry

#### Expense receipts collected, photographed, and re-typed

- **Department:** Finance & Accounting
- **Symptom:** Employees spend money on the company card or out of pocket — travel, meals, supplies, fuel — and submit receipts at month-end by email, photographed from a phone, or handed in as paper. Someone checks each one, enters the amount and category into a spreadsheet or the accounting tool, and reconciles against the card statement.
- **Volume:** 50–200 receipts per month
- **Manual cost:** 1–2 days per month of finance time; late submissions delay month-end close; occasional duplicate or missed receipts

#### Payment status chased by phone and email

- **Department:** Finance & Accounting
- **Symptom:** Customers who haven't paid their invoice by the due date are chased one by one — finance checks the accounting system, pulls a list, and calls or emails each customer. Older overdue items sometimes slip below the radar until year-end or until a customer file is reviewed for another reason.
- **Volume:** weekly chasing cycle; dozens of customers per cycle
- **Manual cost:** half a day per week of finance time; cash collected later than it should be; customer relationships strained when chasing is uneven

#### Month-end reports assembled by hand from multiple tools

- **Department:** Finance & Accounting
- **Symptom:** At the close of each month, someone pulls numbers from the accounting system, bank statements, payroll, and spreadsheets to build the management report — revenue, cash position, margin, overdue receivables. The assembly takes days and the numbers are already stale by the time leadership reads them.
- **Volume:** monthly
- **Manual cost:** 2–4 days per month of finance time; leadership decisions made on old data

---

### Sales & Quoting

Mid-sized B2B sales runs on quote documents that are one-off every time. The 20% that causes 80% of the friction is **building the quote by hand** (template copy, line-item edit, manual price lookup) and **forgetting to follow up** (memory-based, no central pipeline view).

#### Incoming quote requests arriving as free-text emails

- **Department:** Sales & Quoting
- **Symptom:** New customers email their requests as prose — sometimes with PDF specs attached, sometimes describing the problem in plain text. Someone reads each one, figures out what's being asked, and routes it to the right salesperson, engineer, or project lead. When volume is high, the first response slips past 24 hours and deals cool.
- **Volume:** dozens per week with seasonal peaks
- **Manual cost:** 1–2 hours per day of triage; slow first response loses deals to faster competitors

#### Quotes built by hand from a spreadsheet or Word template

- **Department:** Sales & Quoting
- **Symptom:** Every quote is a one-off document. The salesperson opens the template, copies the last similar quote, edits the line items, checks pricing in a separate list or email thread, and recalculates the totals by hand. Errors in totals and missing line items occasionally get sent out and caught only by the customer.
- **Volume:** dozens of quotes per week
- **Manual cost:** 30–60 minutes per quote; pricing errors; stale templates cause rework and lost trust

#### Follow-up on sent quotes depending on salesperson memory

- **Department:** Sales & Quoting
- **Symptom:** After a quote is sent, whether it gets followed up depends on the salesperson remembering to do it. Some quotes sit for weeks without a nudge; sales leadership has no central view of which ones are pending, which were won, and which were lost and why.
- **Volume:** every quote sent
- **Manual cost:** deals lost to silence; no reliable pipeline forecasting; leadership flies blind

#### Order entry from a confirmed quote retyped into the ERP

- **Department:** Sales & Quoting
- **Symptom:** When a customer accepts a quote, someone re-keys the line items, prices, and delivery details into the ERP to generate the sales order. The information already exists in the quote document but there's no direct link between the two systems.
- **Volume:** every order
- **Manual cost:** 10–20 minutes per order; occasional mismatches between what was quoted and what was ordered, which surface as disputes at invoicing

---

### Marketing

Mid-sized B2B marketing is usually lean — sometimes one part-time person, sometimes a shared agency. The 20% that causes 80% of the friction is **lead capture that doesn't feed anywhere useful** and **list hygiene done by hand**.

#### Lead capture forms feeding a spreadsheet nobody watches

- **Department:** Marketing
- **Symptom:** The website has a contact form, an event registration form, a newsletter signup, and a download form for a white paper. Submissions email a generic inbox and land in a spreadsheet or a CRM nobody opens. Leads are followed up only when someone remembers to check, which isn't often.
- **Volume:** dozens of submissions per week
- **Manual cost:** warm leads go cold; no reliable source-of-leads analysis; marketing spend can't be justified

#### Newsletter and mailing list hygiene done by hand

- **Department:** Marketing
- **Symptom:** The marketing list is maintained by exporting CSVs from the CRM, deduping in a spreadsheet, removing bounces, and re-uploading before each send. Unsubscribes and bounces are processed weeks after they happen; list quality degrades over time.
- **Volume:** every newsletter send; monthly list hygiene pass
- **Manual cost:** half a day per send; deliverability drops; legal risk on stale opt-outs under GDPR

#### Event follow-up done manually after each conference

- **Department:** Marketing
- **Symptom:** After each trade show, conference, or workshop, someone sits with the stack of business cards (or the exported lead list) and emails each person individually with a generic follow-up. Half the leads go cold before the follow-up even happens.
- **Volume:** 2–6 events per year, 20–200 leads per event
- **Manual cost:** 1–3 days per event of someone's time; leads cool rapidly; conversion from events is lower than it should be

---

### Customer Service

Where the 80/20 lens is most obvious. A small handful of recurring question types, asked dozens of times a day across several channels, answered by the same people who are also trying to do other work. The 20% that causes 80% of the friction is **repetitive questions on unstructured channels** and **status updates the customer could see themselves**.

#### Inbound questions arriving across multiple channels

- **Department:** Customer Service
- **Symptom:** Clients ask questions through WhatsApp, email, the website form, phone calls, and sometimes in person. Each channel is watched by a different person (or not watched at all during busy periods). The same question is answered several times a week, inconsistently, and the response time depends on which channel the client happened to pick.
- **Volume:** dozens per day across the channels
- **Manual cost:** several hours per day of front-office time; inconsistent answers; slow first response during peaks

#### Recurring FAQs answered from memory or a Word cheat sheet

- **Department:** Customer Service
- **Symptom:** 20–30% of incoming questions are the same handful of things: opening hours, pricing, whether a service is available, document requirements, where to submit something. The front office answers each one by hand from memory or an internal cheat sheet. When a key person is off, answers get inconsistent or wrong.
- **Volume:** daily
- **Manual cost:** interruptions throughout the day; reduced focus on complex cases; occasional misinformation when a stand-in answers

#### Client status updates requested by phone and email

- **Department:** Customer Service
- **Symptom:** Clients call or email to ask "where are we on X" — the status of a case, an order, a repair, a project, or a ticket. Someone checks the internal system and replies. The information is already stored in the system; the client simply has no way to see it themselves.
- **Volume:** daily, 5–20 status requests per day
- **Manual cost:** hours per day of status lookups; client friction; interruptions that kill deep work

#### Ticket handoffs losing context between shifts or team members

- **Department:** Customer Service
- **Symptom:** A support ticket or client case started by one person gets picked up by another — at shift change, during holiday cover, or after escalation. The new owner re-reads the thread, calls the client back, and often asks the same questions again.
- **Volume:** every handover
- **Manual cost:** hours of re-reading per week; client frustration at repeating themselves; mistakes when context is lost in transit

---

### Operations & Delivery

Where the weekly manual cost of a mid-sized business usually concentrates: work intake, handoffs between people, and the filing of documents tied to each job. The 20% that causes 80% of the friction is almost always **intake fragmentation** (too many channels, no owner) and **handoff loss** (context doesn't travel with the work).

#### Incoming job orders scattered across inboxes and messaging apps

- **Department:** Operations & Delivery
- **Symptom:** New work requests arrive across several channels — email, WhatsApp photos, phone calls, web forms — and no single inbox owns them. Someone re-types each one into the planning system every morning; occasionally a job falls through the cracks because nobody is formally responsible for intake.
- **Volume:** daily; 10–30+ new requests per week depending on sector
- **Manual cost:** several hours per week across the ops team; 1–2 missed or delayed jobs per quarter

#### Project documents landing in a shared mailbox nobody owns

- **Department:** Operations & Delivery
- **Symptom:** Clients, suppliers, and third parties email documents tied to a project — plans, certificates, invoices, reports, delivery notes — into a shared inbox. Someone opens each one, identifies the project code, and files the attachment into the right shared-drive folder by hand. When volume is high, filing lags or gets skipped entirely.
- **Volume:** dozens of documents per day across an active project portfolio
- **Manual cost:** 1–2 full days per week of one person's time; documents occasionally misfiled or missing at audit

#### Internal handoffs losing context between people or shifts

- **Department:** Operations & Delivery
- **Symptom:** When a job moves from one person, shift, or office to the next, the context lives in someone's head or a Word doc. The receiving person re-reads the case, re-calls the client, or asks the original owner to explain. When the original owner is out, the handoff stalls completely.
- **Volume:** every time a job changes hands — dozens to hundreds of times per week in multi-person teams
- **Manual cost:** hours of re-reading and re-asking per week; slower client response; occasional errors when context is misremembered

#### Daily planning maintained by hand in a shared spreadsheet

- **Department:** Operations & Delivery
- **Symptom:** The week's jobs, shifts, deliveries, or appointments live in a shared spreadsheet updated every morning by one person — often scribbled on paper first and typed up during the first hour. When the planner is off, nobody knows what's happening. Mistakes in the planner cascade into the whole week.
- **Volume:** daily
- **Manual cost:** 30–60 minutes per day of planning admin; brittle and person-dependent; a holiday for the planner is a crisis

---

### Procurement & Suppliers

Mid-sized firms rarely have a full procurement department — usually one person in finance or operations handles it alongside other work. The 20% that causes 80% of the friction is **unstructured paperwork flowing in both directions** (POs out, delivery notes in) and **comparison work done by hand every time**.

#### Purchase orders raised by hand in email or a Word template

- **Department:** Procurement & Suppliers
- **Symptom:** When something needs ordering — raw materials, office supplies, specialist services — someone writes a purchase order in Word or as an email to the supplier. The order details are then retyped into the accounting system when the invoice arrives weeks later. There's no central record of open POs or committed spend.
- **Volume:** dozens per week
- **Manual cost:** 10–20 minutes per PO; occasional duplicate orders; no visibility on commitments or budgets

#### Incoming delivery notes reconciled against POs by hand

- **Department:** Procurement & Suppliers
- **Symptom:** Deliveries arrive with a paper note or an emailed PDF. Someone cross-checks the note against the original order, marks received quantities, and files the note in a binder or a folder. Discrepancies — short deliveries, wrong items, price mismatches — are sometimes noticed weeks later when the invoice doesn't match.
- **Volume:** daily for active operators
- **Manual cost:** half a day per week of receiving time; payment disputes when mismatches slip through

#### Supplier price lists compared by hand for repeat purchases

- **Department:** Procurement & Suppliers
- **Symptom:** For items bought regularly from multiple suppliers — consumables, raw materials, subcontracted services — procurement compares offers by hand in a spreadsheet or from memory. The same comparison gets redone every few weeks as prices change, and the work is often skipped when time is short.
- **Volume:** weekly or monthly comparison cycle
- **Manual cost:** hours per week of research; suboptimal supplier choices when comparisons are rushed or skipped

---

### HR & People

Mid-sized firms have an HR person, not an HR department, and that person is stretched. The 20% that causes 80% of the friction is **paperwork around employee events** (joining, leaving, taking time off) and **first-pass screening of incoming candidates**.

#### Recruitment intake: CVs arriving in an inbox and filtered by hand

- **Department:** HR & People
- **Symptom:** When a role is open, CVs arrive at a generic HR inbox or the hiring manager's inbox. Someone opens each one, reads the summary, decides whether it fits, and files the candidate into a spreadsheet. Most CVs are never answered. Good candidates are occasionally missed because they were reviewed on a busy day.
- **Volume:** dozens to hundreds per role
- **Manual cost:** days of hiring manager or HR time per role; candidate experience suffers; slow hiring

#### Onboarding paperwork assembled and sent by hand

- **Department:** HR & People
- **Symptom:** Every new hire triggers the same packet: contract, NDA, handbook, equipment form, emergency contact sheet, tax forms. Each one is pulled from a shared-drive folder, personalised with the new person's details, sent by email, and chased until returned. Incomplete packets are discovered on day one.
- **Volume:** every hire
- **Manual cost:** 2–4 hours per hire; documents occasionally incomplete at start date; poor first-day experience

#### Time-off requests handled by email or WhatsApp

- **Department:** HR & People
- **Symptom:** Employees request holidays, sick days, and personal leave through whatever channel is easiest — email, WhatsApp, or in person. Someone maintains a shared calendar or spreadsheet by hand to track who's off when. Clashes between team members taking the same week off are spotted late.
- **Volume:** daily trickle across the firm
- **Manual cost:** hours per week of admin; clashes cause staffing gaps; disputes about who requested what first

---

### Legal & Compliance

Mid-sized firms without an in-house legal team (most of them) outsource the hard cases and handle recurring work themselves. The 20% that causes 80% of the friction is **tracking what exists and when it expires** and **repeatedly producing the same standard documents**.

#### Contract tracking and renewal reminders kept in someone's head

- **Department:** Legal & Compliance
- **Symptom:** Client contracts, supplier agreements, office leases, insurance policies, and software licences all have expiry or renewal dates. Tracking lives in a spreadsheet, a shared calendar, or someone's memory. Contracts occasionally auto-renew under unfavourable terms because nobody was reminded; other times an expiry is noticed a week before and the renegotiation is rushed.
- **Volume:** dozens to hundreds of live agreements across the firm
- **Manual cost:** reactive firefighting; auto-renewal surprises; rushed negotiations; real legal and financial risk

#### Document retention and deletion compliance done by hand

- **Department:** Legal & Compliance
- **Symptom:** Data protection and sector compliance rules require old client data, HR records, and financial documents to be deleted or archived after a set period. The work is done by hand on an irregular schedule — often only when an audit is upcoming or a regulator asks. Some records linger years past their retention period; others get deleted too early.
- **Volume:** ongoing; audited quarterly or annually
- **Manual cost:** days of preparation before audits; compliance risk; reputational exposure if a breach occurs

#### Recurring NDAs and standard contracts drafted from templates

- **Department:** Legal & Compliance
- **Symptom:** Standard legal documents — NDAs, data-processing agreements, engagement letters, standard supplier agreements — are copied from a reference folder, personalised by hand with the counterparty's details, and sent out. Variables are sometimes missed; outdated clauses from previous versions are occasionally carried over.
- **Volume:** several per week
- **Manual cost:** 15–30 minutes per document; occasional errors in sent versions; version drift across the firm's templates

---

### Management & Reporting

Where cross-department pain shows up: the owner or the leadership team has to assemble a view of the business from a dozen tools and a dozen people. The 20% that causes 80% of the friction is **pulling numbers from multiple places into a single report** and **coordination work that happens in email chains**.

#### Weekly management reports assembled from multiple sources

- **Department:** Management & Reporting
- **Symptom:** The weekly leadership meeting needs a report: revenue, pipeline, delivery status, key incidents, overdue receivables. Building it means pulling figures from the accounting system, the CRM, the project tracker, and emails, then pasting into a slide deck or a document. The person who builds it loses half a day every week.
- **Volume:** weekly
- **Manual cost:** half a day per week of senior time; numbers sometimes wrong or stale by meeting time; discussions anchored on outdated data

#### Cross-department coordination happening in long email chains

- **Department:** Management & Reporting
- **Symptom:** When a decision affects several departments — a pricing change, a new client policy, a process update — coordination happens in long email chains or group chats with dozens of replies. Decisions get buried in the thread; follow-through is uneven; weeks later nobody is sure what was actually agreed.
- **Volume:** several coordination threads per week
- **Manual cost:** slow decisions; rework when people act on different interpretations of the same thread

#### Board or investor updates prepared from scratch each quarter

- **Department:** Management & Reporting
- **Symptom:** Quarterly board or investor updates are built from scratch each time — numbers pulled from finance, commentary written from memory, slides reformatted by hand. The executive team spends days on each one. Metrics reported shift from one update to the next because they're assembled from whatever felt relevant that week.
- **Volume:** quarterly
- **Manual cost:** days of executive time per cycle; inconsistent reporting; key metrics sometimes missing or redefined

---

## Case studies

Real before/after examples from Engranatge's prior work and pilot conversations. Grouped by the kind of solution built, to show the shape of each service in practice. See `docs/services.md` for the definition of each service.

### Automation in practice

- **Metalworking fabricator (~60 employees).** Job orders were arriving as WhatsApp photos and emailed PDFs across multiple inboxes; the production planner was a shared spreadsheet updated by hand each morning. Two jobs fell through the cracks in the previous quarter. Solution: automatic intake from email and WhatsApp into the planner, with instant notifications to the shift leads. Result: **around 6 hours per week freed across the ops team, zero lost jobs.**
- **Architecture studio (~40 people, ~90 active projects).** Project documentation from clients, suppliers, and the municipality was landing in a shared mailbox and filed by hand into shared-drive folders by project code. Solution: a flow that reads incoming email, detects the project code, files the attachments into the right folder, and notifies the project lead. Result: **around 8 hours per week freed across the ops team, filing always complete.**
- **Automotive workshop group (~4 locations, shared finance team).** Supplier invoices and delivery notes were typed into the accounting system every Friday afternoon by the finance team. Solution: automatic extraction from supplier PDFs into the accounting system, one pipeline per supplier. Result: **Friday afternoons back across the 3-person finance team.**

### AI agents in practice

- **Engineering consultancy (~50 people, multi-discipline).** Incoming requests for quotes arrived as free-text emails with attached specs; the ops team spent around 90 minutes every morning classifying them by discipline and routing to the right engineer. Solution: an AI agent that reads each RFQ, extracts the key specs, classifies the discipline, and drafts a routing suggestion the partner approves. Result: **around 1.5 hours per day freed across the ops team, faster first response to clients.**
- **Property management firm (~800 units under management).** Tenant questions on WhatsApp — rent, inspections, small repairs — were handled one by one by the 2-person front office, interrupting the rest of the day. Solution: an AI agent that answers routine questions from the tenant handbook and escalates the rest to the front office with a drafted reply. Result: **around 3 hours per day freed across the front office, faster tenant responses.**

---

## Dream customer archetypes

When briefing a proposal or a sales conversation, anchor on one archetype. A vague "SMB" framing is too thin to build a real case around.

1. **Xavi, COO of a metalworking fabricator.** Runs ops at a 60-person stainless-steel fabricator near Girona — three shifts, two production lines. Incoming jobs still arrive as WhatsApp photos and emailed PDFs landing in multiple inboxes; the production planner is a shared spreadsheet updated by hand each morning. Two jobs fell through the cracks last quarter. Xavi wants a single intake lane that lands every new job in the planner automatically and notifies the shift lead. *Likely service fit: automation.*
2. **Núria, managing partner at an architecture studio.** Runs a 40-person multi-discipline studio near Barcelona — buildings, urban planning, interiors. Project documentation from clients, suppliers, and the municipality lands in a shared mailbox that no one really owns; someone has to file every attachment under the right project code. At 90 active projects, "someone" is losing two full days a week across the ops team. *Likely service fit: automation.*
3. **Roser, partner at an engineering consultancy.** Partner at a 50-person multi-discipline engineering consultancy in Barcelona — civil, structural, energy. Incoming requests for quotes arrive as free-text emails with attached specs; the ops team spends roughly 90 minutes each morning classifying them by discipline and routing to the right engineer. Roser wants that time back without losing the partner-level review at the end. *Likely service fit: AI agent.*

---

## Proof inventory

What can be cited today. Never invent clients, numbers, or logos.

- **Pilot in progress:** Engranatge is picking five mid-sized firms this quarter to build real pilot cases. This is true and can be stated directly.
- **Before/after numbers:** the figures in the case studies and block catalogue above are illustrative, calculated from prior one-off projects and Engranatge's understanding of mid-sized operations. Only cite them as customer pilots once a specific customer has agreed to be named.
- **Logos, quotes, testimonials:** none yet. Do not invent any.
