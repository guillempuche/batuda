---
name: sales-funnel
description: Drafts sales-funnel copy (hero, CTA, landing page, about page, lead magnet, pricing page, email sequence, manifesto, webinar) using Russell Brunson's DotCom / Expert / Traffic Secrets frameworks — Hook-Story-Offer, Epiphany Bridge, Value Ladder, Application Funnel, Attractive Character, New Opportunity vs Improvement Offer, Big Domino, False Belief Patterns, Stack Slide, Hormozi Value Equation, Schwartz awareness levels, Soap Opera Sequence. Use when the user asks to write copy, draft a hero, rewrite the landing page, generate sales copy, write a CTA, write a lead magnet, write the about page, improve the homepage wording, fix the copy on X, or draft an email sequence for any marketing surface. Product-agnostic — loads project-specific context (services catalogue, brand voice, per-language native-voice rules) from the project's docs/ folder before drafting.
argument-hint: [target-language or "all"]
allowed-tools: Read Grep Glob Edit Write AskUserQuestion
---

# Sales Funnel Copywriting

Draft high-converting sales copy for any marketing surface using Russell Brunson's frameworks. The skill is **product-agnostic**: framework theory lives in `references/`, and project-specific knowledge (what the project sells, how it talks, which languages it supports) lives in the project's `docs/` folder and is read on demand.

## Framework reference files

Pick the right file for the surface being drafted. Each file is self-contained, theory-only, and cross-links to the others where relevant.

- [`references/dotcom-secrets.md`](references/dotcom-secrets.md) — **landing-page mechanics**: Secret Formula, Hook-Story-Offer, Epiphany Bridge (5 beats), Value Ladder, Application Funnel, common failure modes. Load this for heroes, service detail pages, before/after sections, CTA blocks, and anywhere that needs the Hook-Story-Offer shape.
- [`references/expert-secrets.md`](references/expert-secrets.md) — **mass movement and offer construction**: Attractive Character (4 elements, 4 archetypes, 6 storylines), Cause, New Opportunity vs Improvement Offer, Big Domino Statement, False Belief Patterns (Vehicle / Internal / External), Hero's Two Journeys, Stack Slide, Hormozi Value Equation, Perfect Webinar, Trial Closes. Load this when the surface is about *who the narrator is* or *how the offer is constructed*: about pages, manifesto pages, pricing pages, webinars, long-form sales letters.
- [`references/traffic-secrets.md`](references/traffic-secrets.md) — **audience, temperature, and nurture sequences**: 3 Markets, Traffic Temperature (Cold / Warm / Hot), Schwartz 5 Awareness Levels, 3 Traffic Types, Dream 100, Soap Opera Sequence, Seinfeld Sequence, Funnel Hacking. Load this for ads, lead magnets, welcome sequences, daily nurture emails, and any decision about what tone and awareness level to write for.

## Workflow

### Step 1 — Load project context from `docs/`

Before drafting any line of copy, read the project's product and voice docs. The skill relies on a light convention: documents live in the repo's top-level `docs/` folder with the following names.

| Doc                   | Purpose                                                                                                                          | Required? |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `docs/services.md`    | What the project sells, dream-customer archetypes, proof inventory.                                                              | Required  |
| `docs/brand-voice.md` | Voice rules, forbidden words, mission framing, metaphor/tone budgets, per-language native-voice rules (register, idioms, traps). | Required  |

Resolution order:

1. Try each path with `Read`. If a file is missing, fall back to `Glob` with patterns like `docs/**/*services*.md`, `docs/**/*brand*voice*.md`, `docs/**/*voice*.md`.
2. Some projects split per-language rules into a separate `docs/language-voice.md` or equivalent. If `docs/brand-voice.md` has no per-language section, look for a sibling language-voice doc before falling back to defaults.
3. If still missing, ask the developer once with `AskUserQuestion` where the equivalent document lives. Do not invent product details, brand voice, or language rules.
4. Never draft copy without at least reading the services catalog and the brand voice rules. Writing copy without these produces consultant-voice slop.

### Step 2 — Resolve the target language(s)

The skill argument is a language code (e.g. `ca`, `es`, `en`, `de`, `fr`) or the literal `all`.

- Single code → produce that language only.
- `all` → produce every language the project supports. Discover supported languages from the per-language section in `docs/brand-voice.md` (or a sibling `docs/language-voice.md`) or from the i18n files (`apps/**/i18n/*.ts`, `locales/*.json`, `public/locales/*`).
- Missing or ambiguous → ask the developer with `AskUserQuestion`.

Each language is written **natively from the same brief**, not translated. Follow the project's per-language traps and register choices strictly.

### Step 3 — Identify the surface and the speaker register

Before drafting, establish:

- **File** — find it with `Glob`/`Grep`. Do not guess the path.
- **Funnel stage** — ToFu (cold traffic, lead magnet), MoFu (warm, value-prop page), BoFu (discovery-call / application).
- **Product** — which service, plan, or product the surface is about (or cross-product).
- **Dream customer** — pick one archetype from `docs/services.md`. Do not write to "everyone".
- **Traffic temperature and awareness level** — cold vs warm vs hot, and which of the 5 Schwartz levels the reader is at. Rule of thumb: cold traffic is Problem-Aware; referred traffic is Solution-Aware. See [`references/traffic-secrets.md`](references/traffic-secrets.md) → Schwartz Awareness Levels.
- **Speaker register — first person singular or plural.** Brand-voice docs that support both (solo workshop vs team, founder-led vs agency) usually do not hard-code which is current. Resolve it before drafting:
  1. Read the existing live copy — i18n files, hero/CTA strings, the About page. If everything says *I build / construeixo / construyo*, continue in singular. If everything says *we build / construïm / construimos*, continue in plural. Match what is already shipped.
  2. If there is no existing copy, or the files mix registers, ask the developer with `AskUserQuestion`: *"Should this copy speak as a solo workshop (I) or as a team (we)?"*
  3. Never silently pick one. Picking the wrong register cascades through every sentence and is expensive to undo.

Ask exactly one targeted question with `AskUserQuestion` when the surface or the register is unclear. Do not guess.

### Step 4 — Route to the right framework

Use the table below to pick the primary framework and load the matching reference file. Most surfaces load one file; a few load two.

| Surface                   | Primary framework                | Load file(s)                                                                                                |
| ------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Homepage hero             | Hook-Story-Offer (micro)         | [`dotcom-secrets.md`](references/dotcom-secrets.md)                                                         |
| Service detail page       | Epiphany Bridge (full)           | [`dotcom-secrets.md`](references/dotcom-secrets.md)                                                         |
| Before/after section      | Hook (list of hooks)             | [`dotcom-secrets.md`](references/dotcom-secrets.md)                                                         |
| Pricing / quote page      | Application Funnel + Stack Slide | [`dotcom-secrets.md`](references/dotcom-secrets.md) + [`expert-secrets.md`](references/expert-secrets.md)   |
| Lead magnet landing page  | Hook + Value Ladder bait         | [`dotcom-secrets.md`](references/dotcom-secrets.md) + [`traffic-secrets.md`](references/traffic-secrets.md) |
| Ad / email single hook    | Hook only                        | [`dotcom-secrets.md`](references/dotcom-secrets.md)                                                         |
| Case study page           | Epiphany Bridge (long form)      | [`dotcom-secrets.md`](references/dotcom-secrets.md) + [`expert-secrets.md`](references/expert-secrets.md)   |
| About page (solo or team) | Attractive Character             | [`expert-secrets.md`](references/expert-secrets.md)                                                         |
| Manifesto / movement page | Cause + Big Domino               | [`expert-secrets.md`](references/expert-secrets.md)                                                         |
| Welcome email sequence    | Soap Opera Sequence (5 emails)   | [`traffic-secrets.md`](references/traffic-secrets.md)                                                       |
| Ongoing nurture emails    | Seinfeld Sequence                | [`traffic-secrets.md`](references/traffic-secrets.md)                                                       |
| Webinar / long-form sales | Perfect Webinar + Stack Slide    | [`expert-secrets.md`](references/expert-secrets.md)                                                         |
| Ad copy (cold traffic)    | Hook + Schwartz Problem-Aware    | [`dotcom-secrets.md`](references/dotcom-secrets.md) + [`traffic-secrets.md`](references/traffic-secrets.md) |

### Step 5 — Apply Hook-Story-Offer (the universal shape)

Every page is **Hook → Story → Offer**. Details in [`references/dotcom-secrets.md`](references/dotcom-secrets.md).

- **Hook** — one-line headline plus one-line subhead that stops the scroll. Match the hook pattern to the reader's Schwartz awareness level from [`references/traffic-secrets.md`](references/traffic-secrets.md).
- **Story** — Epiphany Bridge: Backstory → Wall → Epiphany → (Framework) → Transformation + proof. Each beat must break one of the three False Belief Patterns (Vehicle, Internal, External) from [`references/expert-secrets.md`](references/expert-secrets.md).
- **Offer** — next rung of the Value Ladder. When no pricing is published, almost always a discovery call framed via the Application Funnel. When pricing *is* published, construct the offer with the [Stack Slide](references/expert-secrets.md#stack-slide--the-offer-layered-and-re-stated) and [Hormozi Value Equation](references/expert-secrets.md#hormozi-value-equation--the-math-of-an-irresistible-offer).

**Critical check before drafting:** write the page's Big Domino Statement (see [`references/expert-secrets.md`](references/expert-secrets.md) → Big Domino) in one sentence. The Big Domino is the single belief the reader must accept for everything else on the page to matter. If you can't state it, the page has no spine — stop drafting and write the Big Domino first.

**Also critical:** check that the hook and story sell a *new opportunity*, not an *improvement offer*. An improvement offer is "do what you're already doing, but better/faster/cheaper" and converts poorly. A new opportunity is "a different kind of thing entirely". See [`references/expert-secrets.md`](references/expert-secrets.md) → New Opportunity vs Improvement Offer.

### Step 6 — Voice check against `docs/brand-voice.md`

Enforce the project's voice rules strictly:

- Forbidden-word list — strike on sight and replace with the project's approved alternatives.
- Metaphor budget — do not overspend the brand's signature metaphor. Most brands tolerate 1–2 metaphor moves per page; check the project doc.
- Mission framing — if the project specifies a fixed mission phrasing, never drift from it.
- Tech-stack words — if the project bans internal tool names, vendors, or engineering jargon in customer-facing copy, do not leak them. The full ban list lives in the project's `docs/brand-voice.md`.
- Tone dials — adjust empathy / proof / specificity / metaphor / urgency per funnel stage as specified in the brand doc.

If the project has no brand voice doc yet, apply the defaults in [`references/dotcom-secrets.md`](references/dotcom-secrets.md) → Common failure modes, and flag to the developer that voice rules should be captured in `docs/brand-voice.md`.

### Step 7 — Write each language natively against per-language rules

Do not write in one language and translate. For each target language:

1. Re-brief from scratch in that language's voice.
2. Use local vocabulary, register (tu vs. usted vs. vous, etc.), and idiom traps from the per-language section in `docs/brand-voice.md`.
3. Keep cross-language consistency on digits, currency, time formats, and em-dash style.

If the project has no per-language rules documented, apply generic anti-consultant defaults and ask the developer to capture the specific rules in `docs/brand-voice.md` afterwards.

### Step 8 — Format the output

For each piece of copy produced, return a block in this exact shape:

```
### <Surface name> — <lang>

**File:** <relative path>
**Funnel stage:** <ToFu | MoFu | BoFu>
**Traffic temperature:** <Cold | Warm | Hot>
**Awareness level:** <Unaware | Problem-Aware | Solution-Aware | Product-Aware | Most Aware>
**Frameworks applied:** <Hook-Story-Offer | Epiphany Bridge | Big Domino | Application Funnel | Stack Slide | Soap Opera | ...>
**Big Domino:** <one-sentence page thesis>

**Hook**
<headline>
<subheadline>

**Story**
<1–5 short paragraphs>

**Offer**
- <CTA headline>
- <bullet 1>
- <bullet 2>
- <bullet 3>
- <primary CTA button label>

**Notes**
<anything requiring developer input: missing numbers, real examples, keys to add, decisions to make>
```

When editing an existing file, show the preview block first, then propose the exact `Edit` diff. Never apply edits before the developer approves the preview.

### Step 9 — Run the validation checklist

Copy this checklist and track each check before returning any copy. If any check fails, fix it before responding.

```
Validation progress:
- [ ] Hook test
- [ ] Story test
- [ ] Offer test
- [ ] New Opportunity test
- [ ] Big Domino test
- [ ] False Belief test
- [ ] Awareness-level test
- [ ] Voice test
- [ ] Language test
- [ ] Honesty test
- [ ] File-fit test
```

1. **Hook test** — does it stop the scroll? Reject any opening that starts with "We are…" or "Our…". Hook pattern matches the reader's Schwartz awareness level.
2. **Story test** — is a recognisable pain from `docs/services.md` named in the first two sentences? Does the story follow the Epiphany Bridge beats?
3. **Offer test** — does the CTA match the next rung of the Value Ladder? If no pricing, is it a discovery call? No invented prices? Risk reversed explicitly?
4. **New Opportunity test** — does the offer read as a *different kind of thing*, not a better version of the same thing? If it reads as an improvement offer, rewrite it. See [`expert-secrets.md`](references/expert-secrets.md#new-opportunity-vs-improvement-offer).
5. **Big Domino test** — can you state the page's thesis in one sentence using the Big Domino template? If not, the page has no spine. See [`expert-secrets.md`](references/expert-secrets.md#big-domino-statement--the-one-sentence-that-makes-everything-else-irrelevant).
6. **False Belief test** — does the story break all three belief patterns (Vehicle, Internal, External)? Can you point at which sentence breaks each one? See [`expert-secrets.md`](references/expert-secrets.md#false-belief-patterns--vehicle-internal-external).
7. **Awareness-level test** — does the opening sentence match the reader's Schwartz awareness level for this funnel stage? See [`traffic-secrets.md`](references/traffic-secrets.md#schwartz-awareness-levels--the-5-stages-every-reader-passes-through).
8. **Voice test** — zero words from the forbidden list in `docs/brand-voice.md`. Metaphor budget respected. Mission framing exact.
9. **Language test** — does it read native in the target language? If it reads like a translation, throw it out and rewrite natively.
10. **Honesty test** — no fake testimonials, fake urgency, fake numbers, or invented client logos. Only cite proof that exists in `docs/services.md` → proof inventory.
11. **File-fit test** — does the copy match the shape of the file being edited (i18n key structure, JSON schema, Markdown front-matter, etc.)?

## Project-specific context (not bundled — lives in the project repo)

- **`docs/services.md`** — the project's service catalog, dream customers, and proof inventory.
- **`docs/brand-voice.md`** — the project's voice rules, forbidden words, metaphor budget, mission framing, and per-language native-voice rules.

These docs are where all project-specific knowledge lives. Keep them up to date as the offering and the voice evolve; the skill reads them fresh on every invocation.
