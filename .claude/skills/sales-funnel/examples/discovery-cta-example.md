# Discovery CTA example — worked BoFu CTA in three languages

Fully worked bottom-of-funnel CTA block, the shape any no-published-pricing project should use. The central challenge: close the reader without a price, a plan, or a product tier. Brunson's Application Funnel pattern solves this by reframing the CTA from "buy" to "apply for a mutual fit check".

> **Illustrative — not a template.** This example is built around an example project (Engranatge, a Mediterranean mechanical-workshop automation service for SMBs, this repo's marketing site at `apps/marketing`). The project-specific voice, vocabulary, and scarcity language come from that project's `docs/services.md` and `docs/brand-voice.md`. When applying the skill to a different project, load that project's docs and rewrite the specifics — keep the five-component structure (headline → framing → bullets → risk reversal → single CTA).

## Context

- **Surface:** BoFu CTA block — lives at the bottom of the homepage, every service detail page, and the dedicated `/contact` page. Shared i18n section (e.g., `cta` or `contact`).
- **Funnel stage:** BoFu — the reader is ready or nearly ready.
- **Primary framework:** Application Funnel + Hook-Story-Offer (offer portion).
- **Secondary framework:** Risk reversal as the central move. Brunson: the bigger the unknown, the more explicit the risk reversal must be.
- **Metaphor budget:** 0. By the CTA block the reader needs plain trust-building language, not workshop imagery. (See `docs/brand-voice.md` → Tone ladders → Metaphor fades at BoFu.)

## The five components, in order

Every CTA block has these in this order. Missing any one breaks the conversion.

1. **CTA headline** — frames the call as valuable, not salesy.
2. **Short framing paragraph** — one sentence naming the current reality (pilot phase, no published prices yet). Turns the awkwardness into a feature.
3. **Three bullets of what the reader gets from the call** — diagnosis, honest yes/no, rough scope.
4. **Explicit risk reversal** — free, duration, no commitment, no slides, no spam.
5. **Single primary CTA button** — one word or two. No competing buttons.

## Catalan — `cta` block

```
### Discovery CTA — ca

**File:** apps/marketing/src/i18n/ca.ts
**Funnel stage:** BoFu
**Frameworks applied:** Application Funnel, Hook-Story-Offer (offer)

**Hook (CTA headline)**
Explica'm el teu cas. Et diré honestament si ho puc construir.

**Story (framing paragraph — one line)**
Estic en fase pilot: trio cinc pimes aquest trimestre per construir casos reals, aprendre i publicar preus honestos.

**Offer**
- Un diagnòstic del teu flux actual — què es pot automatitzar i què no
- Un sí o un no honest, sense embolics
- Un abast aproximat i, si encaixa, els següents passos
- 20 minuts, gratis, sense compromís, sense diapositives, sense correus de venda després
- [Parlem]
```

### Annotations

- **Headline — *"Explica'm el teu cas. Et diré honestament si ho puc construir."***
  - Exactly Brunson's mutual-fit-check framing. *"Honestament"* is load-bearing — it reverses the expectation that a sales call will pressure the reader.
  - Singular *Explica'm / diré / puc* matches the solo-workshop speaker rule in `docs/brand-voice.md`.
  - Two short sentences. No metaphor.
  - Passes the anti-consultant test: would not appear on a McKinsey page.

- **Framing paragraph — *"Estic en fase pilot: trio cinc pimes aquest trimestre per construir casos reals, aprendre i publicar preus honestos."***
  - **This is the key move.** Instead of hiding the no-pricing reality, name it explicitly and reframe it as an advantage.
  - *"Trio cinc pimes"* = **real scarcity**, stated as a fact. Brunson's rule: scarcity only works if it is true.
  - *"Aprendre i publicar preus honestos"* — signals that prices will exist, and that the reader is helping shape them. Positions the reader as a partner in discovery, not a mark for an upsell.
  - *Estic / trio* (singular) matches the solo-workshop speaker rule.
  - Does not apologise. Apologising for the phase would break trust. Naming it as a deliberate phase builds trust.

- **Bullets — three things the reader gets from the call**
  - *"Un diagnòstic del teu flux actual — què es pot automatitzar i què no"* → the honest-diagnosis bullet. *"Què es pot i què no"* is important: signals Engranatge will not pretend everything is automatable.
  - *"Un sí o un no honest, sense embolics"* → the yes-or-no bullet. *"Sense embolics"* is a colloquial Catalan phrase for "no runaround" and tests as native, not translated.
  - *"Un abast aproximat i, si encaixa, els següents passos"* → the next-step bullet. The *"si encaixa"* clause is the mutual-fit signal — it is OK if the answer is no.

- **Risk reversal bullet — *"20 minuts, gratis, sense compromís, sense diapositives, sense correus de venda després"***
  - Five explicit reversals in one line. Each one preempts a specific objection:
    - *"20 minuts"* → not a time sink.
    - *"gratis"* → no payment.
    - *"sense compromís"* → no contract.
    - *"sense diapositives"* → not a pitch deck.
    - *"sense correus de venda després"* → not a drip sequence. (This is the one consultants almost never promise, and the one reader most expects.)

- **CTA button — *"Parlem"***
  - Same one-word CTA as the hero. Continuity across surfaces.

## Castilian — `cta` block

```
### Discovery CTA — es

**File:** apps/marketing/src/i18n/es.ts
**Funnel stage:** BoFu
**Frameworks applied:** Application Funnel, Hook-Story-Offer (offer)

**Hook (CTA headline)**
Cuéntame tu caso. Te digo honestamente si puedo construirlo.

**Story (framing paragraph — one line)**
Estoy en fase piloto: elijo cinco pymes este trimestre para construir casos reales, aprender y publicar precios honestos.

**Offer**
- Un diagnóstico de tu flujo actual — qué se puede automatizar y qué no
- Un sí o un no honesto, sin rodeos
- Un alcance aproximado y, si encaja, los siguientes pasos
- 20 minutos, gratis, sin compromiso, sin diapositivas, sin correos de venta después
- [Hablemos]
```

### Annotations

- **Headline** — *"Cuéntame"* (tú + singular *me*) not *"Cuénteme"* (usted). *"Te digo honestamente"* mirrors the Catalan move and matches the solo-workshop speaker rule.
- **Framing paragraph** — *"pymes"* not *"PYMES"* (lowercase reads warmer in running text). *"Precios honestos"* is deliberate — signals both that prices will exist and that the workshop rejects obscure pricing games. *Estoy / elijo* (singular) matches the solo speaker.
- **Bullets**
  - *"Sin rodeos"* is the Castilian native equivalent of *"sense embolics"* — colloquial, warm, anti-corporate.
  - *"Si encaja"* → same mutual-fit-check move.
- **Risk reversal** — *"sin correos de venda después"* is the explicit anti-drip promise. Consultants rarely make it.
- **CTA button** — *"Hablemos"*. Consistent with the hero. No competing *"Contáctanos"*, no *"Empezar ahora"*.

## English — `cta` block

```
### Discovery CTA — en

**File:** apps/marketing/src/i18n/en.ts
**Funnel stage:** BoFu
**Frameworks applied:** Application Funnel, Hook-Story-Offer (offer)

**Hook (CTA headline)**
Tell me your case. I'll tell you honestly if I can build it.

**Story (framing paragraph — one line)**
I'm in a pilot phase: picking five small businesses this quarter to build real cases, learn the work, and publish honest prices.

**Offer**
- A diagnosis of your current workflow — what can be automated and what can't
- A straight yes or no, no runaround
- A rough scope and, if it fits, the next steps
- 20 minutes, free, no commitment, no slides, no sales emails afterwards
- [Let's talk]
```

### Annotations

- **Headline** — *"Tell me your case."* Not *"Book a discovery call"* (SaaS default). *"I'll tell you honestly"* is the mutual-fit-check signal. Singular *me / I'll / I* matches the solo-workshop speaker rule in `docs/brand-voice.md`.
- **Framing paragraph** — *"I'm in a pilot phase"* is stated, not apologised for. *I'm / picking* (singular) matches the solo speaker. *"Learn the work"* is deliberately plain English and avoids *"learn the market"* (which sounds consultant-coded).
- **Bullets**
  - *"A straight yes or no, no runaround"* — *"no runaround"* tests as native British English and translates the force of *"sense embolics"* / *"sin rodeos"*.
  - *"If it fits, the next steps"* → mutual-fit-check.
- **Risk reversal** — *"no sales emails afterwards"* is the anti-drip promise, spelled out. Deliberately stronger than "no follow-up".
- **CTA button** — *"Let's talk"*. Matches the hero. Rejected alternatives: *"Book a call"* (bureaucratic), *"Get a quote"* (implies prices exist), *"Schedule now"* (SaaS default).

## Framework checklist — what this CTA passes

Run through before shipping any BoFu CTA variant:

- [x] **Reframes no-pricing as a deliberate phase.** Turns the weak spot into the proof of authenticity.
- [x] **Real scarcity, not fake.** "Five pilots this quarter" is a true constraint, not a countdown timer.
- [x] **Mutual-fit check, not a pitch.** The reader and Engranatge are both deciding.
- [x] **Three specific benefits of the call.** Not "learn more about our services".
- [x] **Five risk reversals, spelled out.** Free, duration, no commitment, no slides, no spam.
- [x] **Single primary CTA.** One button. One word or two. No competing buttons.
- [x] **Zero metaphor.** By the CTA block the reader wants plain trust-building language.
- [x] **Zero consultant jargon.** No *transformation*, *synergies*, *trusted partner*.
- [x] **Zero tech stack names.** No n8n, Flowise, LLM, RAG.
- [x] **Three languages read native.** *Sense embolics* / *sin rodeos* / *no runaround* are three native idioms for the same force, not a translation chain.

## When to deviate from this template

- **If real case studies exist** — add a one-line proof anchor between the framing paragraph and the bullets: *"The last restaurant I worked with recovered 8 hours a week in the first month."* Use the actual case from `services.ts` → `examples[]`.
- **If published pricing exists** — the framing paragraph changes entirely. The Application Funnel reframing stops being necessary once prices are on the page. This skill should be re-calibrated at that point.
- **If the surface is an ad CTA** — cut the framing paragraph and the bullets. Keep only the headline and the button. Ads carry a hook only; the landing page carries the rest.
- **If the surface is an email sign-off** — use the headline and the button. The framing lives in the preceding email body.

## Common failures to catch before shipping

- **Two CTAs in the block.** Delete one. Brunson: the most common failure mode in his own audits.
- **"Book a demo" creeping in.** Engranatge does not demo a product. The CTA is always a conversation, not a product walkthrough.
- **Generic risk reversal ("no commitment").** Not enough. Spell out every specific fear.
- **Invented scarcity ("only 3 slots left!").** If the scarcity is not true, delete it. Fake urgency kills trust faster than no urgency.
- **Apologising for no pricing.** *"We don't have prices yet, sorry."* — rewrite. Name the phase deliberately.
- **Metaphor creep.** *"Step into the workshop"*, *"hand us the wrench"*. Metaphor is banned in the CTA block. Period.
