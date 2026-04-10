# Hero example — worked homepage hero in three languages

Fully worked homepage hero annotated with the Brunson framework moves applied at each line. Use this as calibration for tone, framework balance, and metaphor budget.

> **Illustrative — not a template.** This example is built around an example project (Engranatge, a Mediterranean mechanical-workshop automation service for SMBs, this repo's marketing site at `apps/marketing`). The project-specific voice, vocabulary, services, and metaphor come from that project's `docs/services.md` and `docs/brand-voice.md`. When applying the skill to a different project, load that project's docs and rewrite the specifics — keep the framework moves.

## Context

- **Surface:** Homepage hero (`apps/marketing/src/i18n/{ca,es,en}.ts` → `hero` section)
- **Funnel stage:** ToFu — cold traffic landing on the root URL
- **Primary framework:** Hook-Story-Offer (micro). Full Epiphany Bridge is too long for a hero; story collapses to one line.
- **Secondary framework:** Secret Formula — "dream customer" is a Catalan/Spanish SMB owner copy-pasting data on weekends.
- **Metaphor budget:** 1 metaphor move (the subhead). Headline stays plain.

## Catalan — `hero` block

### --- ca.ts preview ---

```
### Homepage hero — ca

**File:** apps/marketing/src/i18n/ca.ts
**Funnel stage:** ToFu
**Frameworks applied:** Hook-Story-Offer (micro), Secret Formula

**Hook**
Les màquines fan la feina. Tu fas el negoci.
Construeixo petites màquines que treballen mentre dorms — per a pimes, autònoms i negocis de barri.

**Story (one line)**
Factures, correus, fulls de càlcul. Tot el que avui copies i enganxes cada setmana, ho pot fer una connexió que no s'oblida de res.

**Offer**
- Parlem 20 minuts del teu cas
- Et diré honestament si ho puc construir
- Gratis, sense venda, sense diapositives
- [Parlem]
```

### Annotations — what each line is doing

- **Headline — *"Les màquines fan la feina. Tu fas el negoci."***
  - Mission framing (see `docs/brand-voice.md`), exact form. Two short sentences. No metaphor.
  - Passes the "would a comerciant say this?" test.
  - Rejects: any form of *empoderar*, *transformació digital*, *solucions*.

- **Subheadline — *"Construeixo petites màquines que treballen mentre dorms — per a pimes, autònoms i negocis de barri."***
  - **First-person singular** (*construeixo*) matches the solo-workshop speaker rule in `docs/brand-voice.md`.
  - **Metaphor move #1** — "petites màquines" + "mentre dorms". This is the page's entire metaphor budget for the hero. No other section should reuse this imagery.
  - Dream customer named explicitly: *pimes, autònoms, negocis de barri*. No "small and medium businesses across Europe" abstraction.
  - Em-dash used once, correctly.

- **Story line — *"Factures, correus, fulls de càlcul. Tot el que avui copies i enganxes cada setmana, ho pot fer una connexió que no s'oblida de res."***
  - Collapses the Epiphany Bridge to a single sentence.
  - *Conflict* ("copies i enganxes cada setmana") and *epiphany* ("ho pot fer una connexió") in one breath.
  - Concrete nouns only: *factures, correus, fulls de càlcul*. No abstract "data pipelines".
  - *"connexió"* not *"integració"*. The reader knows what a connection is.

- **Offer bullets**
  - Three bullets, exactly the Application Funnel shape: what the reader gets from the call, the honesty clause, the risk reversal.
  - *"Et diré honestament si ho puc construir"* — Brunson's "mutual fit check" framing. Lowers defensiveness. Singular *diré / puc* matches the solo-workshop speaker rule.
  - *"sense venda, sense diapositives"* — double risk reversal. Explicit.

- **CTA button — *"Parlem"***
  - One word. Plain. Singular primary CTA.
  - Rejected alternatives: *"Entra al taller"* (metaphor overspend), *"Agenda una reunió"* (bureaucratic), *"Contacta'ns"* (generic).

## Castilian — `hero` block

```
### Homepage hero — es

**File:** apps/marketing/src/i18n/es.ts
**Funnel stage:** ToFu
**Frameworks applied:** Hook-Story-Offer (micro), Secret Formula

**Hook**
Las máquinas hacen el trabajo. Tú haces el negocio.
Construyo pequeñas máquinas que trabajan mientras duermes — para pymes, autónomos y negocios de barrio.

**Story (one line)**
Facturas, correos, hojas de cálculo. Todo lo que hoy copias y pegas cada semana, lo puede hacer una conexión que no se olvida de nada.

**Offer**
- Hablemos 20 minutos de tu caso
- Te digo honestamente si puedo construirlo
- Gratis, sin venta, sin diapositivas
- [Hablemos]
```

### Annotations

- **Headline** — direct Castilian mission framing. Not a translation of the Catalan line — this is what a Castilian copywriter would write from the same brief.
- **Subheadline** — *pymes, autónomos, negocios de barrio*. Same structure, native vocabulary. *"mientras duermes"* is the metaphor spend. *Construyo* (1st person singular) matches the solo-workshop rule.
- **Story line** — passive voice ("se olvida") is allowed here because the agent is the connection, and forcing "una conexión nunca se olvida" reads as copy-writer Spanish. The current phrasing is what a shop owner says.
- **Offer** — *"sin venta, sin diapositivas"* mirrors the Catalan double risk reversal. *"Te digo"* (not *"le diré"*) keeps the tú register and the singular speaker.
- **CTA button** — *"Hablemos"*. Rejected alternatives: *"Empezar"* (too SaaS), *"Contacta"* (too cold), *"Solicitar consulta"* (consultant voice).

## English — `hero` block

```
### Homepage hero — en

**File:** apps/marketing/src/i18n/en.ts
**Funnel stage:** ToFu
**Frameworks applied:** Hook-Story-Offer (micro), Secret Formula

**Hook**
Machines do the work. You run the business.
I build small machines that work while you sleep — for small businesses, shops, and one-person teams.

**Story (one line)**
Invoices, emails, spreadsheets. Everything you copy and paste every week — a connection can do it, and it never forgets.

**Offer**
- 20 minutes on your case, no slides
- I'll tell you honestly if I can build it
- Free, no sales pitch, no follow-up spam
- [Let's talk]
```

### Annotations

- **Headline** — *"Machines do the work. You run the business."* Not *"You do the business"* (that reads as a Spanish calque). *"Run"* is the native verb.
- **Subheadline** — dream customer framed as *"small businesses, shops, and one-person teams"*. No "SMB" acronym (too SaaS-corporate for a hero). *"Work while you sleep"* is the single metaphor spend. *"I build"* (singular) matches the solo-workshop rule — the one-to-one craftsman framing lands harder than *"we build"* would in a solo shop.
- **Story line** — em-dash used correctly, separating setup from payoff. *"A connection can do it"* is deliberately plain. Not *"an automated workflow"*.
- **Offer** — *"no slides"*, *"no follow-up spam"* — two specific anti-consultant promises. Braver than the generic "no commitment".
- **CTA button** — *"Let's talk"*. Rejected alternatives: *"Get started"* (SaaS default), *"Book a demo"* (the workshop is not demoing a product), *"Schedule a call"* (bureaucratic).

## Framework checklist — what this hero passes

Run through before shipping any hero variant:

- [x] **Hook stops the scroll.** Names mission + dream customer in two lines.
- [x] **Story is present but one line.** Conflict + epiphany compressed; full Epiphany Bridge saved for service pages.
- [x] **Offer is a discovery call, not a purchase.** Matches the Application Funnel pattern.
- [x] **Metaphor used once.** *"Small machines while you sleep"* is the only workshop move in the hero.
- [x] **Dream customer named explicitly.** Not "businesses" — *pimes/pymes/small businesses*.
- [x] **No consultant jargon.** No *empoderar*, *transformación*, *leverage*, *synergy*.
- [x] **No tech stack names.** No n8n, no Flowise, no LLM, no RAG.
- [x] **Risk reversed.** *"Free, 20 min, no sales pitch, no spam."*
- [x] **Primary CTA only.** One button per language. No secondary "learn more".
- [x] **Three languages read native.** None of them reads like a translation of the other.

## When to deviate from this template

- **If the page is not a cold-traffic hero** — this structure is optimised for ToFu. A MoFu page (e.g., a service detail) should use the full Epiphany Bridge, not the one-line collapse.
- **If real proof exists** — when a case study or real customer example is available, swap the story line for a proof line (see `brunson-frameworks.md` → Epiphany Bridge → Transformation).
- **If the page has multiple services** — the hero should not name a specific service. Keep it cross-service. Service-specific copy lives on the service detail page.
- **If the surface is an ad or email subject line** — use the hook only. Kill the subhead and the story line. The landing page carries those.
