# Russell Brunson frameworks — sales funnel reference

Product-agnostic reference for the five frameworks the skill relies on: the Secret Formula, Hook-Story-Offer, the Epiphany Bridge, the Value Ladder, and the Application Funnel. Each section ends with a decision rule about when to emphasise that framework.

All concrete examples in this file are illustrative. Substitute the project's own dream customers, services, and proof inventory when applying the frameworks — load them from `docs/services.md` and `docs/brand-voice.md` at the start of every drafting session.

## The Secret Formula — designing the page around the reader

Brunson's Secret Formula (from *DotCom Secrets*) is a four-question filter to run before writing a single sentence. Answer all four before drafting.

1. **Who is the dream customer?** — the specific person the page is for, not a category. Pick one archetype from `docs/services.md`, not "small businesses" or "developers" or "founders". Concrete illustrative examples: a restaurant owner reconciling POS invoices by hand on Sunday night; a gestoria handling 80 monthly declarations with one junior; a comerç de barri whose stock is always wrong on the website. One archetype per page.

2. **Where are they?** — physically, online, and emotionally. Physically: the specific market the project serves. Online: the platforms this archetype actually uses (often local WhatsApp groups, Instagram, the odd Facebook group, Google-for-the-tax-deadline — not X or LinkedIn). Emotionally: end of the day, tired, already behind on next week.

3. **What bait brings them in?** — the lead magnet or entry point. Good baits are specific: a before/after example, an industry-specific PDF ("5 automations any gestoria can ship this month"), a free audit call. Bad baits: "a free consultation" — too vague and too salesy. Load the project's actual baits from `docs/services.md` if it lists them.

4. **What destination are they after?** — the transformation, not the feature. Not "automated invoice processing". The destination is "Sunday nights back", "leaving at 19:00 like a normal person", "hiring one junior instead of two". Destinations are always emotional reclamations.

**Decision rule:** if the answer to any of the four is vague, stop writing and ask the developer a targeted question. Copy written without a clear dream customer always sounds like a consultancy deck.

## Hook-Story-Offer — the shape of every page

Brunson's central principle: every page, every section, every ad, every email has three parts. If any one is off, the page does not convert.

### Hook — stop the scroll

The hook is the first headline and subheadline a reader sees. Its only job is to make them stay for one more line. Three hook patterns that work for service businesses selling to SMBs:

1. **Name-the-pain + different-solution**
   *"Still copying invoices from the POS to the gestoria's Excel every Sunday? There is a smaller fix than hiring another junior."*
   — Names the exact workflow, hints that the solution is not the obvious one.

2. **Concrete promise with a number**
   *"Recover 4 hours a week from invoice copy-paste. Permanently. Without changing your software."*
   — The number is specific, the promise is bounded, the "without X" reverses a common objection.

3. **Anti-consultant stance**
   *"We don't sell transformation. We build small machines that do one thing, every day, forever."*
   — Uses the brand's signature metaphor as a differentiator. The project's own metaphor budget is defined in `docs/brand-voice.md`.

Hooks to reject on sight:

- Anything starting with "We are…" or "Our…"
- "Empowering businesses to…"
- "Your trusted partner in…"
- "Digital transformation" in any form
- Anything that could describe every software company on the planet

### Story — build the bridge (Epiphany Bridge)

Brunson: people buy emotionally and justify logically. The story is what creates the emotional buy-in. Use the 5-step Epiphany Bridge, one short paragraph per step.

1. **Backstory** — the dream customer's "before world", recognisable in two sentences. Use the pain, not abstractions. Illustrative: *"Every Sunday, Marta printed the TPV tickets and typed them into the gestoria's Excel, one by one. It took four hours if the internet behaved."*
2. **Conflict / stakes** — what the workaround costs. Hours, errors, weekends, sanity. Be specific. Illustrative: *"She had missed one family lunch a month for two years. Then the gestoria found three typing errors in the VAT return and the penalty was €340."*
3. **Epiphany** — the realisation. Framed as a discovery, not a pitch. Illustrative: *"It turned out she did not need new software. She needed the POS and the Excel to talk to each other — a small connection that runs every night while she sleeps."*
4. **Framework** — what the solution is, in broad strokes only. Never dump the tech stack (the project's forbidden-tech-word list lives in `docs/brand-voice.md`). Illustrative: *"We build that connection: when a ticket closes in the TPV, a row lands in the right sheet, cleaned up, with the VAT already split. One small machine, one job."*
5. **Transformation + proof** — what life looks like on the other side, anchored by something concrete. Pull real proof from `docs/services.md` → proof inventory. If real proof does not exist yet, say so honestly: *"We're picking five SMBs this quarter to build pilot cases with. The result: 4h/week back, every week, starting month one."*

### Offer — the close

The offer is whatever the next rung of the project's Value Ladder is (see next section). For projects in the pilot-discovery / pre-pricing phase, the offer is almost always a **discovery call**. Never a checkout. Never a price. Never a "buy now".

The CTA block must contain, in this order:

1. **CTA headline** — frames the call as valuable, not salesy. Illustrative: *"Tell us your case. We'll tell you, honestly, if we can build it."*
2. **Three bullets of what the reader gets from the call** — a diagnosis, a yes/no, a rough scope. Not a sales pitch.
3. **Risk reversal, explicit** — free, ~20–30 minutes, no commitment, no slide deck, no email spam after. Say all of it.
4. **Mild scarcity, only if it is true** — e.g. *"We're picking 5 SMBs this quarter to build pilot cases with."* Never fake urgency. Countdown timers are banned.
5. **One primary CTA button** — one or two words. No competing buttons above the fold.

**Decision rule:** if the page has more than one primary CTA above the fold, delete one. Two CTAs is the most common failure mode in Brunson's own audits.

## Value Ladder — the long game, and its collapsed form

Brunson's Value Ladder is the five-rung shape of a fully productised business: **free → entry → core → high-ticket → continuity**.

For projects in the pilot-discovery phase (no public pricing, scope decided after the call), the ladder is **collapsed** — most of the rungs exist conceptually but are not transactable until after a conversation. Map it to a lead funnel instead:

| Ladder rung | Pre-pricing equivalent                                       |
| ----------- | ------------------------------------------------------------ |
| Bait / free | Before/after example, industry-specific PDF, free audit call |
| Entry       | 20–30 min discovery call                                     |
| Core        | Scoped pilot build (priced after the call)                   |
| High-ticket | Multiple integrations, full engagement                       |
| Continuity  | Maintenance / managed service (a fixed monthly fee)          |

Every page should make the next-rung action obvious, and in the pre-pricing phase that next rung is almost always the discovery call. ToFu bait exists to lead to the discovery call, not to sell itself.

**Decision rule:** when in doubt about which rung to push on a page, push on the discovery call. That is the current bottleneck in the funnel for any project that has not published prices yet.

Once the project publishes pricing, the ladder uncollapses. The discovery-call-as-offer pattern gives way to a real product-as-offer pattern, and this section of the reference should be revisited at that point.

## The Application Funnel — Brunson's pattern for no-published-pricing B2B

Brunson recommends the Application Funnel for higher-trust services priced over $2k / €2k, or for anything where the price depends on scope. The reader does not buy on the page — they apply for a slot, and the call qualifies fit.

The pattern:

1. The page pre-sells with hook / story / case-study style content.
2. The CTA is "apply" or "book a call", not "buy".
3. The form or booking flow has just enough friction to qualify — a few questions about the business and the pain. Not a 30-field interrogation.
4. The call itself is positioned as a mutual fit check: *"we'll tell you honestly if we can help"*.
5. Scarcity is real and stated: a limited number of pilot slots, not a fake countdown.

Any project without published pricing — because pricing depends on scope, because the project is still in discovery, or because the customer is high-trust B2B — should use the Application Funnel by default for every bottom-of-funnel page.

## Decision rules — which framework to emphasise per surface

| Surface                     | Primary framework         | Notes                                                                       |
| --------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| Homepage hero               | Hook-Story-Offer (micro)  | Hook + 1-line story + discovery-call CTA. Full Epiphany Bridge is too long. |
| Service detail page         | Epiphany Bridge (full)    | The whole 5-step story, anchored by real examples from `docs/services.md`.  |
| Before/after section        | Hook (list of hooks)      | Each row is a mini-hook pair: pain → relief.                                |
| Pricing / quote page        | Application Funnel        | Explain why no prices are published yet. Make the call feel generous.       |
| Lead magnet landing page    | Hook + Value Ladder bait  | Tight hook, one bullet list of what's inside, email capture.                |
| Ad / email hook             | Hook only                 | One curiosity-driven line. Story and offer live on the landing page.        |
| Case study page             | Epiphany Bridge           | Frame the customer as the hero; the project is the helper, not the star.    |
| Lead nurture email sequence | Story + progressive offer | Short stories across a sequence, leading to the discovery call.             |

## Common failure modes

- **Feature dumps** — listing what the product does instead of what the reader gets. Fix by running each sentence through "so what?" until it lands on a destination.
- **Two CTAs above the fold** — kills conversion. Delete one.
- **Consultant voice creeping in** — *"We partner with businesses to…"*. Rewrite as *"We build…"*.
- **Named tech stack** — vendor names, model names, internal tooling. Replace with reader-facing descriptions (see the project's `docs/brand-voice.md` → tech stack ban list).
- **Fake proof** — invented client names, fake numbers, fake testimonials. If proof does not exist, position the honesty as a feature.
- **Missing risk reversal** — never assume the reader will trust a 20-minute call is free. Say it.
- **Hero that is a paragraph** — the hero is two lines. Pack the rest into the story section.
