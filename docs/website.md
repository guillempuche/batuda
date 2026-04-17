# Engranatge: marketing site structure and copy

Source of truth for the marketing site's architecture, funnel design, and copy strategy. This document drives implementation in `apps/marketing/`. It is the demand-side companion to the three other marketing docs:

- **`docs/services.md`** covers what Engranatge sells: delivery tiers, tooling stack, and proof inventory.
- **`docs/usecases.md`** catalogues customer problems by department, with the block catalogue, case studies, and dream customer archetypes.
- **`docs/brand-voice.md`** sets voice rules: forbidden words, metaphor budget, and per-language native voice.

This file is **site structure and copy strategy only**. It's written in English, but each language's final copy is written natively per `docs/brand-voice.md` rules rather than translated from this document. The briefs below stay in English because the strategic intent has to be language-neutral, and the i18n files are the final product.

---

## Core messaging

### Big Domino

> If I can get the reader to believe two things, every other objection becomes irrelevant. First, that **the bottleneck in their business is the manual glue between their existing tools**, not their team size or their budget or their industry. Second, **that a solo engineer who built systems for satellites and banks can build a small machine to fix it in weeks rather than months**.

Every section on every page is either naming the bottleneck, proving the machine works, or showing what the reader's week looks like afterwards.

### New Opportunity reframe

The current site leans improvement offer: "I automate your invoices" reads as "do what you do, but faster". Improvement offers convert poorly because the reader has already tried to fix the process and is tired of trying.

The reframe:

- **Improvement (avoid):** "Faster invoicing. Better follow-up. Smarter scheduling."
- **New Opportunity (target):** "The work your team does every week that shouldn't exist? I build a machine. It does that job. Your team never does it again."

The team gets hours back rather than a speed boost on work they'd prefer not to be doing in the first place. The New Opportunity is a different kind of fix: instead of better software for a task the team already resents, a small machine that removes the task entirely.

### False Beliefs

Three beliefs stop every sale. The copy must break all three on every page.

| Belief                                           | Reader thinks                                                                | Copy breaks it with                                                                                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vehicle**: "Does this method actually work?"   | "Automation sounds nice but it never works for real businesses like mine."   | "A machine reads a delivery note in under a minute, costs about ten cents, and rarely gets a field wrong. The same pattern reads invoices and receipts, which is most of what eats your accountant's Friday." |
| **Internal**: "Can my business actually use it?" | "My business is too messy, too small, too manual. We're not digital enough." | "The messier your process, the more hours a machine saves. I connect WhatsApp, email, spreadsheets, whatever the team already uses. You don't need to be a digital-first company."                            |
| **External**: "Will my world allow it?"          | "My team won't learn new software. It'll take months. It'll be disruptive."  | "There's no new software for your team to log into or learn. The machine connects the tools they already use, so what they notice is less work on their plate instead of another screen to check."            |

### Proof strategy: pilot phase

Engranatge has one real case with measured numbers and zero publishable customer logos. That is the pilot-phase reality, and the copy needs to work inside it without faking proof or apologising for its absence.

#### What exists today

**Document extraction system (pre-production).** Full pipeline: receive document (scanned paper or digital PDF) → AI extracts all fields → outputs to Google Drive + Google Spreadsheet → fully digitised. Close to 0% error rate.

| Metric            | Human               | Machine     |
| ----------------- | ------------------- | ----------- |
| Time per document | 2-10 minutes        | 40 seconds  |
| Cost per document | salary time         | €0.10       |
| Error rate        | rises under fatigue | close to 0% |

**One pattern, three document types.** The same architecture handles delivery notes, receipts, and invoices. That covers three of the top four finance department use cases from `docs/usecases.md` (supplier invoices, expense receipts, delivery note reconciliation) with a single machine pattern. This is the "Amazing Discovery" storyline: a machine originally built for delivery notes turned out to read invoices and receipts just as well.

These numbers are measured rather than illustrative. Cite them as "pre-production, real numbers". The output tools (Google Drive, Google Sheets) are the reader's tools and can be named. The internal stack (n8n, LlamaIndex) cannot appear in customer copy per `docs/brand-voice.md`.

**Builder credentials.** Satellite aerospace systems, then B2B SaaS used by 50,000 employees and students monthly. Until customer logos exist, the builder's track record substitutes for social proof.

**Illustrative cases from `docs/usecases.md`.** The metalworking fabricator (6h/week freed), architecture studio (8h/week freed), and automotive workshop group (Friday afternoons back) are based on prior work and pilot conversations. Always cite them as "from prior one-off projects" and never as named customer testimonials.

#### Four proof moves that work without case studies

1. **Proof of mechanism.** Show HOW the machine works rather than WHO uses it. The delivery notes case is the anchor: a 30-second video or animated diagram of a scanned note turning into structured data in under a minute for about ten cents. The reader doesn't need a customer logo to believe the mechanism. What they need is to see the machine run.
2. **Recognition as trust.** The department use case blocks in `docs/usecases.md` describe the reader's own pain with enough specificity that the reader thinks "this person understands my business". Accurate problem description is itself a trust signal and doesn't require proof of solution, which is why use case blocks are the primary proof tool for cold, top-of-funnel pages.
3. **Backstory as authority.** The builder's credentials break the Vehicle false belief without needing customer testimonials. A line like "I built software used by 50,000 people every month, and your delivery notes are simpler than that" does the work on its own. Use once per page, in the right moment.
4. **Honest pilot framing as a feature.** A line like "I'm picking five businesses this quarter to build real pilot cases with, proving the model before publishing prices" reads as confident disclosure rather than apology, per `docs/brand-voice.md`. The reader respects the honesty and trusts the rest of the page more, especially when the disclosure sits right next to the delivery notes numbers so proof and honesty arrive together.

#### How each page handles proof

| Page                | Primary proof move                                              | What it shows                                      |
| ------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| Homepage            | Mechanism (delivery notes numbers) + backstory (50k users)      | "The machine works and the builder is credible"    |
| `/lets-talk`        | Honest pilot framing + risk reversal                            | "I'm early and I'm investing in your success"      |
| `/guillem`          | Backstory (full aerospace → banks → workshop arc)               | "This person is overqualified for my problem"      |
| `/automatitzacions` | Mechanism (delivery notes demo) + recognition (use case blocks) | "This is exactly my pain, and the fix is measured" |
| `/agents-ia`        | Mechanism (delivery notes AI extraction) + recognition          | Same pattern, AI-focused                           |
| Department pages    | Recognition only (use case blocks from `usecases.md`)           | "This person describes my Friday better than I do" |
| `/casos`            | Blocked until publishable pilots                                | Do not build yet                                   |

#### What to build next for proof

Ordered by impact:

1. **Live demo or video** of the delivery notes pipeline. A prospect submits a sample delivery note and watches the extraction happen in real time, or plays a 30-second recording of the same process. This is both proof of mechanism and the bait rung of the Value Ladder, which makes it the highest-leverage single proof asset on the roadmap.
2. **Process-specific calculator.** "How many delivery notes per month? At five minutes each, that's X hours. The machine does it in Y seconds at €0.10 each." The reader does the math themselves, which tends to convert better than numbers you hand them.
3. **First publishable pilot.** The moment a real customer agrees to be named, build `/casos/:slug` for them. A single named case study with before/after numbers is worth more than twenty anonymous logos.

### Mission framing

Fixed per `docs/brand-voice.md`. Always reclamation, never displacement:

| Lang | Framing                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- |
| `ca` | Les màquines fan la feina de poc valor. Els humans fan la feina de molt valor.           |
| `es` | Las máquinas hacen el trabajo de bajo valor. Los humanos hacen el trabajo de alto valor. |
| `en` | Machines do the low-value work. Humans do the high-value work.                           |

---

## Attractive Character

### Name

**Guillem.** The narrator is named. A solo workshop with a named person is more personal than an anonymous "I". Use the first name on the `/guillem` page, in email signatures, and wherever the reader would benefit from knowing they're talking to a person. Never "the founder" or "our team", just Guillem.

### Archetype

**Primary: The Reluctant Hero.** Technical founder who didn't want the marketing role, fell into building machines for businesses he knew, and stayed because it worked. The voice is understated, dry, and anti-guru. Uncomfortable with pitching, and says so.

**Secondary: The Leader.** Has built the thing at scale. Software for ESA (European Space Agency), then B2B SaaS used by 50,000 employees and students every month for KLM, NS (the Dutch national railway), BBVA, and other large companies. The character speaks from completed experience, and the proof is implicit: the reader thinks "this person built software for ESA and BBVA and now builds for my 60-person shop?" That reaction is the trust. BBVA is the most potent name in Spain, since every potential customer knows it. KLM is universally known. NS needs a descriptor ("the Dutch railway") for a Spanish audience.

The combination is rare and honest. The reader sees someone with serious credentials who chose to go small, and that scale contrast is itself the trust.

### Backstory

Years building software for the European Space Agency, then B2B SaaS for KLM, the Dutch national railway (NS), BBVA, and other large companies. Software used by 50,000 employees and students every month, where a bug means a satellite loses contact, a train doesn't run, or a payment doesn't clear.

Those companies have engineering teams, procurement departments, and 18-month implementation cycles. A mid-sized business in Girona has none of that. But the recurring pain (copying data, chasing invoices, filing documents by hand) is the same pain at a smaller scale.

The epiphany was simple. The same engineering that serves ESA and BBVA can run an invoice process for a 60-person fabricator. What differs between the two is ceremony rather than quality. A studio's document filing is simpler than an airline's ticketing system, and it deserves the same engineering without the 18-month wait.

### Naming rules for employer customers

ESA, KLM, NS, and BBVA were customers of previous employers. Guillem contributed to software these organisations used. The honest framing is: "I helped build software used by ESA, KLM, NS, and BBVA." They are never framed as Engranatge clients, their logos are never used, and nothing should imply endorsement. The authority lives in the experience rather than in any partnership claim.

### Polarity

| For                                              | Against                                         |
| ------------------------------------------------ | ----------------------------------------------- |
| One machine, one job, running by morning         | Consultancy theatre and 6-month implementations |
| Connecting the tools you already use             | Software nobody asked for and nobody will use   |
| Honest pilot phase: prove it, then price it      | Enterprise pricing for a 40-person studio       |
| The same engineering quality, minus the ceremony | "Digital transformation" decks                  |
| Saying no when it's not a fit                    | Taking every project regardless of fit          |

### Character flaws

1. Better at building than pitching. The about page is the longest thing the narrator will ever write about himself.
2. In pilot phase, so doesn't have fifty case studies, just a few. Every one of them is real.
3. A developer's bias for building over talking, which means he'll probably over-engineer the machine and under-explain it.

Flaws 1 and 3 reinforce competence (the reader thinks: "good, I want someone who cares more about the build than the sale"). Flaw 2 is honest and converts better than fake social proof.

### Storylines to rotate

From the six Attractive Character storylines:

1. **Us vs Them.** Enterprises get 18-month implementations with 6-person teams. Your business deserves the same engineering in two weeks from one person.
2. **Amazing Discovery.** The same patterns that route satellite telemetry can route your invoices. The engineering travels between the two scales, even if the ceremony does not.
3. **Secret Telling.** What enterprises pay six figures for is about 95% the same thing a 40-person studio needs. The 5% difference is meetings rather than engineering.
4. **Before & After.** The case studies from `docs/usecases.md`.
5. **Third-Person Testimonial.** The dream customer archetypes (Xavi, Nuria, Roser).

---

## Site architecture

### Routing: `/:lang/` with localized slugs

All URLs are prefixed with a language code (`/ca/`, `/es/`, `/en/`). Slugs are native per language. Bare paths (`/guillem`, `/automatitzacions`) redirect to the detected language. Root `/` redirects to `/:detectedLang/`. Each page emits `hreflang` alternates pointing to its siblings.

#### Slug map

| Page               | ca                                | es                                   | en                                 |
| ------------------ | --------------------------------- | ------------------------------------ | ---------------------------------- |
| Homepage           | `/ca`                             | `/es`                                | `/en`                              |
| Automation         | `/ca/automatitzacions`            | `/es/automatizaciones`               | `/en/automations`                  |
| AI Agents          | `/ca/agents-ia`                   | `/es/agentes-ia`                     | `/en/ai-agents`                    |
| About              | `/ca/guillem`                     | `/es/guillem`                        | `/en/guillem`                      |
| About aliases      | `/ca/taller`                      | `/es/taller`                         | `/en/workshop`, `/en/about`        |
| Discovery call     | `/ca/lets-talk`                   | `/es/hablemos`                       | `/en/lets-talk`                    |
| Dept: Finance      | `/ca/departaments/finances`       | `/es/departamentos/finanzas`         | `/en/departments/finance`          |
| Dept: Operations   | `/ca/departaments/operacions`     | `/es/departamentos/operaciones`      | `/en/departments/operations`       |
| Dept: Sales        | `/ca/departaments/vendes`         | `/es/departamentos/ventas`           | `/en/departments/sales`            |
| Dept: Admin        | `/ca/departaments/admin`          | `/es/departamentos/admin`            | `/en/departments/admin`            |
| Dept: Customer Svc | `/ca/departaments/atencio-client` | `/es/departamentos/atencion-cliente` | `/en/departments/customer-service` |
| Dept: Procurement  | `/ca/departaments/compres`        | `/es/departamentos/compras`          | `/en/departments/procurement`      |
| Dept: HR           | `/ca/departaments/rrhh`           | `/es/departamentos/rrhh`             | `/en/departments/hr`               |
| Dept: Legal        | `/ca/departaments/legal`          | `/es/departamentos/legal`            | `/en/departments/legal`            |
| Dept: Marketing    | `/ca/departaments/marketing`      | `/es/departamentos/marketing`        | `/en/departments/marketing`        |
| Dept: Management   | `/ca/departaments/direccio`       | `/es/departamentos/direccion`        | `/en/departments/management`       |
| Case studies       | `/ca/casos`                       | `/es/casos`                          | `/en/cases`                        |
| Case study         | `/ca/casos/:slug`                 | `/es/casos/:slug`                    | `/en/cases/:slug`                  |

#### TanStack Router structure

```
routes/
  index.tsx              → / (redirect to /:detectedLang/)
  $lang/
    route.tsx            → validate lang, provide LangProvider
    index.tsx            → /:lang/ (homepage)
    $slug.tsx            → /:lang/:slug (slug map resolves to page component)
    departaments.$dept.tsx  → /:lang/departaments/:dept (+ es/en aliases)
```

Slug resolution: `$slug.tsx` reads the lang from params, looks up the slug in a data map, resolves to the canonical page ID, and renders the matching component. Aliases (e.g. `/en/workshop` → about page) resolve through the same map. Unknown slugs → 404.

### Funnel flow

```
COLD TRAFFIC (Google, LinkedIn, referral)
    │
    ├─→ Homepage (/:lang/)
    ├─→ Department page (/:lang/departaments/:dept)
    └─→ Service page (/:lang/automatitzacions, /:lang/agents-ia)
            │
            │  recognition → curiosity → trust
            │
            ├─→ About (/:lang/guillem)     ← "who is this person?"
            │
            └─→ Discovery call (/:lang/lets-talk)  ← Application Funnel
                    │
                    │  20-min call, mutual fit check
                    │
                    └─→ Scoped pilot build (priced after call)
                            │
                            └─→ Annual support contract (continuity)
```

Every page except `/lets-talk` has exactly one primary CTA, and that CTA always points to `/lets-talk`. No competing buttons, no mailto links.

### Value Ladder (collapsed, pilot phase)

| Rung            | Surface                                                    | Current state                                       |
| --------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| **Bait**        | Department pages, before/after examples, recognition hooks | Not built yet                                       |
| **Entry**       | 20-min discovery call (`/lets-talk`)                       | CTA exists but points to mailto, not a booking form |
| **Core**        | Scoped pilot build                                         | Priced after call, not on site                      |
| **High-ticket** | Multi-service engagement                                   | Same                                                |
| **Continuity**  | Annual support contract                                    | Described in `docs/services.md`, not on site        |

When pricing is published, the ladder uncollapses and the Application Funnel gives way to a pricing page with a Stack Slide. Until then, `/lets-talk` is the bottleneck, and every improvement to the site is measured by whether more readers reach it.

---

## Page-by-page copy

### Homepage (`/`)

**Traffic:** Cold. Problem-Aware. First visit from Google, LinkedIn, or referral.
**Dream customer:** All three archetypes must recognise themselves, but the page anchors on Xavi (COO, fabricator) and Nuria (managing partner, architecture studio), who are the two automation-first personas.
**Cialdini levers:** Social Proof (case studies), Unity (shared identity as business owners who hate busywork), Reciprocity (free call).

**Page thesis (Big Domino):** The bottleneck is the manual glue between your tools, not your team.

#### Hook

Homepage traffic is Cold and Problem-Aware (declared above). Lead the hero with pain restatement and demote the outcome line "Machines do the work. You run the business." to an H2.

**Headline (Problem-Aware, leads for cold traffic).** Brief:

> *Your team typed the same invoices again last Friday.*

Variants to rotate (A/B candidates):

- *The work your team does every week that shouldn't exist.*
- *Every Friday, the same spreadsheet. Again.*

Each is pure pain restatement with no solution hint, so the reader nods before scrolling.

**H2 between hero and Epiphany Bridge (Solution-Aware, names the outcome).** Brief:

> *Machines do the work. You run the business.*

The prior headline, demoted one level. Still strong, but it belongs after the reader has registered the pain rather than before.

**Subheadline (New Opportunity framing).** Brief:

> *I build small machines that do the weekly busywork, so your team stops doing it.*

Two jobs here: first, name the fix (small machines); second, "stops doing it" carries the New Opportunity, meaning elimination rather than acceleration. Do not write a version that sells faster or better invoicing.

**Epiphany Bridge interaction.** Backstory beat #1 below ("You already have the tools…") is neutral scene-setting rather than pain, so the rhythm holds: pain headline → outcome H2 → neutral Backstory → pain Wall → relief Epiphany → proof Transformation. If a future edit makes the Backstory lead with pain, compress it to one sentence, because the reader should not drone in discomfort for more than one beat without relief.

**CTA button:** "Parlem" / "Hablemos" / "Let's talk". Keep these. The link goes to `/lets-talk` rather than a `mailto:`.

#### Story (Epiphany Bridge, short form)

Currently missing from the site. Add between the hero and the services grid as three or four short paragraphs, each one or two sentences.

1. **Backstory.** "You already have the tools. Accounting software, email, a CRM, WhatsApp for everything else, and a shared drive somewhere. The problem is that none of them talk to each other."
2. **Wall.** "So someone on your team ends up being the bridge. They copy invoice data every Friday, they chase overdue payments from a spreadsheet, and they file project documents into the right folder one by one. That person is expensive, and the work shouldn't exist."
3. **Epiphany.** "The fix isn't a new tool you install or a consultant you hire, and it isn't a six-month project. It's a small machine that moves information between the tools you already have. Nothing to log into, nothing to migrate, nobody to train."
4. **Transformation + proof.** "Right now I have a machine that reads delivery notes, whether scanned paper or PDF, and extracts every field in under a minute for about ten cents, with close to zero errors. A person takes between two and ten minutes to do the same thing, and the error rate climbs when they're tired. The same machine reads invoices and receipts too. Three problems, one pattern."

This short form breaks all three false beliefs:

- Vehicle: "one machine, one job, built in weeks" is a concrete mechanism.
- Internal: "the tools you already have" means no digital maturity is required.
- External: "no new logins, no migration, no training" means zero team disruption.

#### Before/After section

Expand from three generic items to six department-specific items pulled from `docs/usecases.md`. Rotate them or show all at once. Each item is one recognisable task rather than a feature.

| Department       | Before                                                   | After                                              |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------- |
| Finance          | 4h copying invoices every Friday                         | Extracted and filed automatically                  |
| Sales            | Quotes followed up from memory                           | Nudge sent 3 days after sending, no human involved |
| Admin            | Partner inbox: 200 emails, 2h of daily triage            | Classified, drafted, queued for review             |
| Operations       | Job orders arriving on WhatsApp, lost twice this quarter | Single intake, planner notified instantly          |
| HR               | Onboarding packet assembled by hand per hire             | Sent, personalised, and chased automatically       |
| Customer Service | Same 5 questions answered 20 times a day                 | Answered instantly, escalated when needed          |

#### Services section

Keep the MachineCard approach with two cards (Automation + AI Agents). Add a one-line New Opportunity framing above the grid.

Brief: "This isn't new software for your team to learn. These are small machines that connect what you already use."

Each card shows inputs and outputs (already working), but the tagline and description should be rewritten from feature language into outcome language.

#### Proof section

Replace the current illustrative case study cards with a **proof-of-mechanism block** anchored on the delivery notes case. This is the one real case with measured numbers.

Structure:

- **Headline:** "One machine, measured." (or equivalent per language)
- **The case:** delivery notes, scanned or digital, go in, the AI extracts all fields, edge cases get flagged for human review, and the result is fully digitised.
- **The numbers:** 2-10 min for a human versus 40 sec for the machine, at €0.10 per note.
- **Visual:** a before/after of a delivery note (anonymised), or a process diagram, or a short animation. The reader needs to watch the mechanism work rather than read about it.
- **Honest framing:** "Pre-production. Real numbers." per the brand-voice honesty rules.

Below the mechanism block, keep the illustrative cases from `data/services.ts` but frame them honestly as "from prior work and pilot conversations" rather than as named customer testimonials. The dream customer archetypes (Xavi, Nuria, Roser) can still anchor the framing.

#### CTA section

Rewrite as Application Funnel. See the `/lets-talk` page below, since the homepage CTA is a preview of that page.

**Headline brief:** "Tell me your case. I'll tell you honestly if I can build it."

**3 bullets:**

1. A 20-minute call where you describe the recurring task and I tell you whether a machine can do it.
2. No slides, no pitch, and no follow-up emails afterwards.
3. If it's not a fit, I'll say so.

**Risk reversal:** "20 minutes, free. If I can't help, I'll tell you who can."

**Scarcity (only because it's real):** "I'm picking 5 businesses this quarter to build pilot cases with."

**Primary CTA:** "Parlem", linking to `/lets-talk`.

---

### Discovery call (`/lets-talk`)

**Traffic:** Warm-to-hot. Solution-Aware to Product-Aware. Arrived from any other page.
**Funnel stage:** BoFu. Application Funnel + Stack Slide.
**Frameworks:** Application Funnel (DotCom Secrets) + Stack Slide (Expert Secrets).
**Cialdini levers:** Reciprocity (the call is free value), Scarcity (real pilot slots), Commitment (the qualifying form is a small yes).

This page replaces `mailto:hola@engranatge.com`. Every CTA on the site points here.

**Hook:** "20 minutes. Your case, honestly."

#### Stack: what you walk out of the call with

Four items the reader receives, each framed by contrast with what the same deliverable costs elsewhere. No "valued at €X" stickers, since those break the understated voice. The italic contrast lines should read as flat observation rather than boast.

1. **A task diagnosis.** You describe the recurring task eating your team's week; I tell you whether a machine can handle it, and why or why not. *Most consultants sell this step as a paid scoping session. Here it's the first 10 minutes.*
2. **A first-version sketch.** If a machine fits, I map which tools it would touch, what it replaces, and roughly how long to build. You leave with enough to evaluate the work, whether you end up hiring me or someone else. *Most agencies sell this as a €1-2k discovery deliverable. Here it's the next 5 minutes.*
3. **An honest no, with a referral.** If it doesn't fit, I tell you. If I know someone who can help, I name them. *The version most consultants deliver is a polite "let me think about it" that costs you a week of waiting. Here it's a direct answer.*
4. **A pilot slot, if it's a fit.** I'm picking five businesses this quarter to build real pilot cases with, proving the model before publishing prices. Good-fit cases are heavily invested in success, and the case study is worth more to me than the fee. *Elsewhere this would be enterprise pricing for a 40-person studio. Here it's honest pilot math.*

#### What doesn't happen

No slide deck, no pitch, and no discovery questionnaire to fill in beforehand. No follow-up drip afterwards.

**Risk reversal:** "20 minutes, free. If I can't help, I'll tell you who can."

**Booking widget:** Cal.com or Calendly embed. 3-4 qualifying fields:

1. What does your business do? (one line)
2. How many people? (range selector: 1-29 / 30-100 / 100-250 / 250+)
3. Which recurring task costs you the most time? (open text, 2-3 sentences)
4. How did you find Engranatge? (optional, dropdown)

The form friction is intentional. It qualifies the lead, and it counts as a Commitment micro-yes per Cialdini.

**Interaction with homepage CTA section.** The homepage CTA block above is a compressed three-bullet preview of this Stack rather than a separate frame. Keep the bullets short, since they hint at items 1-3 of the Stack. Item 4 (the pilot slot) only appears on `/lets-talk`, so the scarcity lands where the booking actually happens.

---

### About / Workshop (`/guillem`)

**Traffic:** Warm. The reader clicked "About" or "Workshop" because they're curious about who builds this.
**Funnel stage:** MoFu.
**Framework:** Attractive Character (all four elements) + Cause.
**Cialdini levers:** Authority (credentials), Liking (flaws, Mediterranean warmth), Unity (shared identity as someone who cares about the craft).

This is the page where the aerospace → banks → solo workshop story lives. It's the most important page for building trust with a warm reader who's thinking "this sounds good, but who is this person?"

**Metaphor budget:** spend both moves here. This is the workshop's home.

#### Structure

1. **Backstory (Epiphany Bridge long form).**
   Brief: "I'm Guillem. I helped build software for the European Space Agency, then B2B systems for KLM, the Dutch railway, and BBVA. Software used by 50,000 employees and students every month, the kind where a bug means a satellite loses contact, a train doesn't run, or a payment doesn't clear.
   Those were the customers: ESA, KLM, NS, BBVA. Now I build for a 60-person fabricator in Girona. The engineering hasn't changed much, but the meetings are a lot shorter.
   Those companies have engineering teams, procurement departments, and 18-month implementation cycles. A mid-sized business has none of that. The recurring pain is the same though: copying data, chasing invoices, filing documents by hand. It's the same waste at a smaller scale, and at some point I realised the engineering that serves BBVA can run an invoice process for sixty people. What differs between the two is ceremony rather than quality."
2. **Polarity.**
   Brief: "What I'm against: consultancy decks that cost 50k and change nothing, software nobody asked for and nobody will use, six-month implementations for a problem that takes two weeks to fix, and enterprise pricing for a 40-person studio.
   What I'm for: one machine per problem, built in weeks, running by morning. Connecting the tools you already use rather than replacing them. Saying no when the fit isn't right."
3. **Character flaws.**
   Brief: "I'm a developer rather than a salesperson, and this page is probably the longest thing I'll ever write about myself. I have a handful of pilot cases instead of fifty, but every one of them is real. Given the choice, I'd rather under-promise and over-build than do it the other way round."
4. **The Cause (mission).**
   The fixed mission framing from `docs/brand-voice.md`. One sentence, prominent. This is the mass-movement statement the reader opts into.
5. **CTA.** Links to `/lets-talk`. Soft framing: "If this sounds like the kind of workshop you'd trust with your problem, tell me about it."

---

### Service: Automation (`/automatitzacions`)

**Traffic:** Warm. Solution-Aware. The reader knows automation exists and wants to know whether this version fits.
**Funnel stage:** MoFu.
**Framework:** Epiphany Bridge (full) + department-specific use case blocks.

#### Structure

1. **Hook.**
   One-liner from `docs/services.md`: "Flow glue between the tools you already use, so the weekly and monthly tasks that eat your team's time move on their own."
2. **Story (Epiphany Bridge, automation-specific).**
   Brief: "Your tools already have the data. The accounting system knows the invoices, the CRM knows the clients, and the shared drive has the documents. The problem is that a human has to move information between them, every week by hand, making mistakes when they're tired.
   A small machine does that movement. When an invoice arrives by email, the machine reads the PDF, extracts the data, and drops it into the accounting system. When a quote goes unanswered for three days, the machine sends a nudge. When a project document arrives, the machine files it in the right folder.
   There's no new software for your team to pick up and no dashboard they have to check. The machine runs in the background, and what they notice is less work rather than more tools to learn."
3. **"Does this sound familiar?" department use case blocks.**
   Pull from `docs/usecases.md`, grouped by department. Show the **symptom and volume** from each block rather than the solution, because the reader should be nodding at the problem rather than evaluating the fix. Use blocks classified as No-Code and Low-Code in the tier map from `docs/services.md`.
   Priority departments for this page: Finance (invoices, expenses, payment chasing, month-end), Operations (job orders, document filing, handoffs, daily planning), Sales (follow-up, order entry), Admin (scheduling, documents from templates).
   Each block is a collapsible card or a short entry: department label, problem title, 1-2 sentence symptom, volume indicator.
4. **How it works (3 steps)**

- Discovery: "You tell me the task. I map the tools involved and the data that moves between them."
- Build: "I build the machine. You test it on real data. I adjust it based on your feedback until it runs clean."
- Launch + 30 days: "The machine goes live. I monitor it for 30 days. After that, it runs on its own, or you can add the annual support contract."

1. **Includes / Excludes.** From `docs/services.md` and `data/services.ts`. Already structured.
2. **Proof.** Lead with the delivery notes mechanism: under a minute per note, roughly ten cents each, scanned or digital, edge cases flagged. That's the anchor proof for the automation service. Below it, the illustrative cases from `docs/usecases.md` (fabricator, studio, workshop group) framed honestly as "from prior work and pilot conversations".
3. **CTA** → `/lets-talk`

---

### Service: AI Agents (`/agents-ia`)

**Traffic:** Warm. Solution-Aware. The reader has heard of AI but doesn't know whether it applies to their specific problem.
**Funnel stage:** MoFu.
**Framework:** Epiphany Bridge (full) + department-specific use case blocks.

#### Structure

Same as `/automatitzacions` but with the AI-specific story:

1. **Hook.**
   One-liner from `docs/services.md`: "Custom AI that reads, classifies, and answers, so your team focuses on decisions rather than triage."
2. **Story (Epiphany Bridge, AI-specific).**
   Brief: "The bottleneck isn't the decision itself. It's the reading. Your team spends hours every day reading emails, figuring out what each one is, and deciding where it goes. The decision takes seconds, but the reading and routing take hours.
   An AI agent handles the reading. It classifies the email, extracts the key data, and either drafts a response or routes it to the right person. Your team then reviews the edge cases and makes the final call, so the agent handles the volume while the humans handle the judgement.
   This never gets used for creative work or for decisions with legal or financial liability. There's always a human in the loop on anything that matters."
3. **Use case blocks.** Pull from `docs/usecases.md`, blocks classified as Code and Code+UI in the tier map: inbox triage, incoming quote requests, recurring FAQs, ticket handoffs, CV screening, inbound multi-channel questions.
4. **How it works.** Same three-step structure as the Automation page, adapted for agent delivery.
5. **Includes / Excludes.**
6. **Proof.** The delivery notes case applies here too, since the AI extraction step is the agent. Lead with the mechanism: "The AI reads a scanned delivery note, extracts every field, and flags edge cases for a human. Under a minute, about ten cents." Below that, the illustrative cases (engineering consultancy, property management) framed honestly.
7. **CTA** → `/lets-talk`

---

### Department landing pages (`/departaments/:dept`)

**Traffic:** Cold. Problem-Aware. Arrives from Google search ("automatitzar factures empresa", "gestió correu pime", "pressupostos repetitius").
**Funnel stage:** ToFu. SEO entry point.
**Cialdini levers:** Unity ("if this sounds like your week..."), Social Proof (one case study from the same world).

These are the biggest long-term cold-traffic opportunity. Each page targets long-tail queries a mid-sized business owner in Spain searches for, and the use case blocks from `docs/usecases.md` are already written in that exact language.

**Ten pages, one per department:**

| Slug             | Department              | Blocks from `usecases.md`                                                                 |
| ---------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `finances`       | Finance & Accounting    | Supplier invoices, expense receipts, payment chasing, month-end reports                   |
| `operacions`     | Operations & Delivery   | Incoming job orders, project document filing, internal handoffs, daily planning           |
| `vendes`         | Sales & Quoting         | Incoming quote requests, quotes by hand, follow-up on sent quotes, order entry            |
| `admin`          | Admin                   | Meeting minutes, calendar scheduling, partner inbox triage, documents from templates      |
| `atencio-client` | Customer Service        | Inbound questions across channels, recurring FAQs, client status updates, ticket handoffs |
| `compres`        | Procurement & Suppliers | Purchase orders, delivery note reconciliation, supplier price comparison                  |
| `rrhh`           | HR & People             | CV screening, onboarding paperwork, time-off requests                                     |
| `legal`          | Legal & Compliance      | Contract tracking, document retention, recurring NDAs                                     |
| `marketing`      | Marketing               | Lead capture, newsletter hygiene, event follow-up                                         |
| `direccio`       | Management & Reporting  | Weekly reports, cross-department coordination, board/investor updates                     |

#### Structure per department page

1. **Hook.** A department-specific headline naming the #1 pain in that department. Examples:

- Finance: "Your accountant shouldn't spend Friday afternoons typing invoices."
- Operations: "Two jobs fell through the cracks last quarter. Both were in someone's inbox."
- Sales: "The quote you sent last Tuesday? Nobody followed up."
- Admin: "200 emails a day, two hours of triage, and the important one is still unread."

1. **Three to five use case blocks.** Each block from `docs/usecases.md` rendered as:

- Problem title (h3)
- Symptom (1-2 sentences, copied or adapted from usecases.md)
- Volume indicator ("dozens per week", "daily", "every hire")
- Manual cost ("half a day per week", "1-2 days per month")
- No solution described, just the recognition.

1. **Bridge sentence.** "If any of these sound like your week, a small machine can probably fix it. I've built machines for problems exactly like these."
2. **Proof.** Department pages rely on recognition rather than case studies. The use case blocks are themselves the proof, since accurate problem description is the trust signal for cold traffic. For `/departaments/compres` (Procurement), the delivery notes case can appear as a concrete mechanism example. For other departments, end with the backstory one-liner: "I built software used by 50,000 people every month. Your [department pain] is simpler than that."
3. **CTA** → `/lets-talk`. Framing: "Tell me which one of these hurts most. 20 minutes, free."

---

### Case studies (`/casos`, `/casos/:slug`)

**Traffic:** Warm-to-hot. Product-Aware. The reader wants proof before booking.
**Funnel stage:** MoFu.
**Framework:** Epiphany Bridge long form (10 beats).

Currently blocked. Only publishable with real company names once pilots complete and customers agree to be named. Until then, the proof section on the homepage and service pages uses the illustrative cases from `docs/usecases.md` with honest disclosure ("illustrative, from prior work and pilot conversations").

When publishable pilots exist:

#### Index page (`/casos`)

- Cards per case study: industry, headline result, service type
- Filter by service (automation / AI agents)
- CTA at bottom → `/lets-talk`

#### Detail page (`/casos/:slug`)

- Full Epiphany Bridge (10 beats): backstory → desire → external struggle → internal struggle → wall → epiphany → plan → conflict → achievement → transformation
- Before/after numbers
- Dream customer archetype anchor: "If your business looks like this..."
- CTA → `/lets-talk`

---

## Register: solo workshop (I)

The speaker is one person. The current i18n files all use the plural ("nosaltres / nosotros / we") and must be flipped to singular ("jo / yo / I"). Every verb, pronoun, and possessive needs to change.

### Changes needed in i18n files

#### `ca.ts`

| Key path                | Current (we)                            | Target (I)                            |
| ----------------------- | --------------------------------------- | ------------------------------------- |
| `meta.description`      | Construïm automatitzacions...           | Construeixo automatitzacions...       |
| `hero.subheadline`      | Construïm eines que treballen...        | Construeixo eines que treballen...    |
| `sections.services`     | Què construïm                           | Què construeixo                       |
| `sections.ctaBody`      | Explica'ns què necessites i et direm... | Explica'm què necessites i et diré... |
| `sections.ctaSecondary` | Escriu-nos                              | Escriu-me                             |
| `toolDetail.ctaBody`    | Explica'ns el teu cas i et direm...     | Explica'm el teu cas i et diré...     |
| `pricing.contact`       | Digue'ns què necessites i et direm...   | Digues-me què necessites i et diré... |

#### `es.ts`

| Key path                | Current (we)                             | Target (I)                             |
| ----------------------- | ---------------------------------------- | -------------------------------------- |
| `meta.description`      | Construimos automatizaciones...          | Construyo automatizaciones...          |
| `hero.subheadline`      | Construimos herramientas que trabajan... | Construyo herramientas que trabajan... |
| `sections.services`     | Qué construimos                          | Qué construyo                          |
| `sections.ctaBody`      | Cuéntanos qué necesitas y te diremos...  | Cuéntame qué necesitas y te diré...    |
| `sections.ctaSecondary` | Escríbenos                               | Escríbeme                              |
| `toolDetail.ctaBody`    | Cuéntanos tu caso y te diremos...        | Cuéntame tu caso y te diré...          |
| `pricing.contact`       | Dinos qué necesitas y te diremos...      | Dime qué necesitas y te diré...        |

#### `en.ts`

| Key path                | Current (we)                                | Target (I)                                 |
| ----------------------- | ------------------------------------------- | ------------------------------------------ |
| `meta.description`      | We build automations...                     | I build automations...                     |
| `hero.subheadline`      | We build tools that work...                 | I build tools that work...                 |
| `sections.services`     | What we build                               | What I build                               |
| `sections.ctaBody`      | Tell us what you need and we'll tell you... | Tell me what you need and I'll tell you... |
| `sections.ctaSecondary` | Write to us                                 | Write to me                                |
| `toolDetail.ctaBody`    | Tell us your case and we'll tell you...     | Tell me your case and I'll tell you...     |
| `pricing.contact`       | Tell us what you need and we'll tell you... | Tell me what you need and I'll tell you... |

#### `data/services.ts`

Check all multi-language strings in service data for "we" / "nosaltres" / "nosotros" and flip them to singular.

---

## Build priority

Ordered by conversion impact per unit of effort. The metric is: does this change put more readers in front of `/lets-talk`?

### Phase 1: Fix the existing single page

1. **Flip register to solo (I).** All i18n files plus services data. Cascading error if left unfixed.
2. **Build `/lets-talk` as Application Funnel + Stack Slide.** Replace the mailto with a booking page whose body is the four-item Stack (task diagnosis, first-version sketch, honest no + referral, pilot slot) with italic contrast lines, plus a Cal.com embed and 3-4 qualifying fields. This is the highest-leverage single change, since every other page funnels here.
3. **Rewrite the hero by awareness level.** Problem-Aware headline ("Your team typed the same invoices again last Friday."), Solution-Aware H2 ("Machines do the work. You run the business."), New-Opportunity subhead ("I build small machines that do the weekly busywork…"). Fixes the cold-traffic/Schwartz mismatch.
4. **Add Epiphany Bridge.** Four paragraphs between the hero and the services grid. The story section that's currently missing.
5. **Rewrite CTA block as Application Funnel.** Risk reversal, three bullets (a preview of the `/lets-talk` Stack, items 1-3), real scarcity.
6. **Expand before/after items.** From three generic to six department-specific, pulled from `usecases.md`.

### Phase 2: Core pages

1. **`/guillem`.** The Attractive Character page. The backstory is too strong to leave unbuilt.
2. **`/automatitzacions`.** Full service page with use case blocks.
3. **`/agents-ia`.** Full service page with use case blocks.

### Phase 3: SEO and depth

1. **Department landing pages.** Start with the three highest-traffic departments: `finances`, `operacions`, `vendes`. Add the rest incrementally.
2. **`/casos`.** Case study pages. Blocked until publishable pilots.

### Phase 4: Nurture (post-site)

1. **Soap Opera Sequence.** A five-email welcome after a reader books a call or opts in.
2. **Seinfeld Sequence.** Ongoing nurture emails built around the Attractive Character's daily and weekly stories.
3. **Lead magnet.** A department-specific PDF or diagnosis tool as the bait rung of the Value Ladder.

---

## Validation checklist

Run this against every page before shipping copy. Every check must pass.

- **Hook test.** Does the opening stop the scroll? It rejects "We are...", "Our...", "Empowering...", and it matches the awareness level.
- **Story test.** Is a recognisable pain from `docs/usecases.md` named in the first two sentences? Are the Epiphany Bridge beats present?
- **Offer test.** Does the CTA match the next Value Ladder rung? Are there any invented prices? Is the risk reversed explicitly?
- **New Opportunity test.** Does the offer read as "a different kind of thing" rather than "the same thing, faster"?
- **Big Domino test.** Can you state the page's thesis in one sentence? If not, the page has no spine.
- **False Belief test.** Does the story break all three (Vehicle, Internal, External)? Point at the sentence that breaks each one.
- **Awareness-level test.** Does the opening match the reader's Schwartz level for this funnel stage?
- **Voice test.** Zero forbidden words from `docs/brand-voice.md`. Metaphor budget respected. Mission framing exact.
- **Register test.** Every verb, pronoun, and possessive is singular first person (I/jo/yo). Zero "we" leaks.
- **Language test.** Does it read native? If it reads like a translation, rewrite from scratch.
- **Honesty test.** No fake testimonials, fake urgency, fake numbers, or invented logos. Only proof from the `docs/services.md` proof inventory.
