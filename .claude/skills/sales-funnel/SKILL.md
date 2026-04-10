---
name: sales-funnel
description: This skill should be used when the developer asks to "write copy", "draft a hero", "rewrite the landing page", "generate sales copy", "write a CTA", "add marketing copy", "write a lead magnet", "write the about page", "improve the homepage wording", "fix the copy on X", or needs sales-funnel copy for any marketing surface. Applies Russell Brunson's Secret Formula, Hook-Story-Offer, Epiphany Bridge, Value Ladder, and Application Funnel frameworks. The skill is product-agnostic — it loads project-specific context (services catalogue, brand voice including per-language native-voice rules) from the project's `docs/` folder before drafting.
argument-hint: [target-language or "all"]
allowed-tools: Read, Grep, Glob, Edit, Write, AskUserQuestion
---

# Sales Funnel Copywriting

Generate Russell-Brunson-style sales-funnel copy for any marketing surface. Applies Hook-Story-Offer, Epiphany Bridge, Value Ladder, Secret Formula, and the Application Funnel pattern (for high-trust B2B without published pricing).

The skill is **product-agnostic**. Framework knowledge lives in the skill; project-specific knowledge (what you sell, how you talk about it, which languages you support) lives in the project's `docs/` folder and is read on demand.

## Workflow

### Step 1 — Load project context from `docs/`

Before drafting any line of copy, read the project's product and voice docs. The skill relies on a light convention: documents live in the repo's top-level `docs/` folder with the following names.

| Doc                   | Purpose                                                                                                                          | Required? |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `docs/services.md`    | What the project sells, dream-customer archetypes, proof inventory.                                                              | Required  |
| `docs/brand-voice.md` | Voice rules, forbidden words, mission framing, metaphor/tone budgets, per-language native-voice rules (register, idioms, traps). | Required  |

Resolution order:

1. Try each path with `Read`. If a file is missing, fall back to `Glob` with patterns like `docs/**/*services*.md`, `docs/**/*brand*voice*.md`, `docs/**/*voice*.md`.
2. Some projects split per-language rules into a separate `docs/language-voice.md` or equivalent. If `docs/brand-voice.md` has no per-language section, also look for a sibling language-voice doc before falling back to defaults.
3. If still missing, ask the developer once with `AskUserQuestion` where the equivalent document lives. Do not invent product details, brand voice, or language rules.
4. Never draft copy without at least reading the services/products catalog and the brand voice rules. Writing copy without these produces consultant-voice slop.

### Step 2 — Resolve the target language(s)

The skill argument is the target language code (e.g. `ca`, `es`, `en`, `de`, `fr`) or the literal `all`.

- If the argument is a single code, produce that language only.
- If the argument is `all`, produce every language the project supports. Discover supported languages from the per-language section in `docs/brand-voice.md` (or a sibling `docs/language-voice.md` if the project keeps them separate) or from the i18n files (e.g. `apps/**/i18n/*.ts`, `locales/*.json`, `public/locales/*`).
- If the argument is missing or ambiguous, ask the developer with `AskUserQuestion`.

Each language is written **natively from the same brief**, not translated. Follow the project's per-language traps and register choices strictly — they live in `docs/brand-voice.md` by default.

### Step 3 — Identify the surface and the speaker register

Before drafting, establish:

- **File** — find it with `Glob`/`Grep`. Do not guess the path.
- **Funnel stage** — ToFu (cold traffic, lead magnet), MoFu (warm, value-prop page), BoFu (discovery-call / application).
- **Product** — which service, plan, or product the surface is about (or cross-product).
- **Dream customer** — pick one archetype from `docs/services.md`, do not write to "everyone".
- **Speaker register — first person singular or plural.** Brand-voice docs that support both (solo vs team workshop, founder-led vs agency) usually do not hard-code which is current. Resolve it before drafting:
  1. Read the existing live copy — i18n files, hero/CTA strings, the About page if one exists. If everything says *I build / construeixo / construyo*, continue in singular. If everything says *we build / construïm / construimos*, continue in plural. Match what is already shipped.
  2. If there is no existing copy, or the files mix registers, ask the developer with `AskUserQuestion`: *"Should this copy speak as a solo workshop (I) or as a team (we)?"*
  3. Never silently pick one. Picking the wrong register cascades through every sentence and is expensive to undo.

Ask exactly one targeted question with `AskUserQuestion` when the surface or the register is unclear. Do not guess.

### Step 4 — Apply Hook-Story-Offer

Every page is **Hook → Story → Offer**. If any one is off, the page does not convert.

- **Hook** — one-line headline plus one-line subhead that stops the scroll. Name the pain, hint at a different kind of solution, make one concrete promise. Reject any sentence starting with "We are…".
- **Story** — Epiphany Bridge: Backstory → Conflict → Epiphany → Framework → Transformation + proof. Keep each beat to one short paragraph. If the project has no real proof yet, say so honestly.
- **Offer** — the next-rung action from the Value Ladder. When no pricing is published, that action is almost always a discovery call. Frame the call as valuable, not salesy. Three bullets of what the reader gets from it. Reverse risk explicitly (free, duration, no commitment). One primary CTA, no competing buttons.

Consult `references/brunson-frameworks.md` for the detailed framework, the 5-step Epiphany Bridge prompts, the Secret Formula (who/where/bait/destination), the Value Ladder, and the Application Funnel pattern for no-pricing B2B services.

### Step 5 — Voice check against `docs/brand-voice.md`

Enforce the project's voice rules strictly:

- Forbidden-word list — strike on sight and replace with the project's approved alternatives.
- Metaphor budget — do not overspend the brand's signature metaphor. Most brands can tolerate 1–2 metaphor moves per page; check the project doc for the specific budget.
- Mission framing — if the project specifies a fixed mission phrasing, never drift from it.
- Tech-stack words — if the project bans internal tool names in customer-facing copy, do not leak them. AI/automation projects especially care about this (no LLM, no RAG, no vendor names).
- Tone dials — adjust empathy/proof/specificity/metaphor/urgency per funnel stage as specified in the brand doc.

If the project has no brand voice doc yet, apply the defaults in `references/brunson-frameworks.md` → Common failure modes, and flag to the developer that voice rules should be captured in `docs/brand-voice.md`.

### Step 6 — Write each language natively against the per-language rules

Do not write in one language and translate to another. For each target language:

1. Re-brief from scratch in that language's voice.
2. Use local vocabulary, register (tu vs. usted vs. vous, etc.), and idiom traps from the per-language section in `docs/brand-voice.md` (or a sibling `docs/language-voice.md` if the project keeps it separate).
3. Keep cross-language consistency on digits, currency, time formats, and em-dash style.

If the project has no per-language rules documented, apply generic anti-consultant defaults and ask the developer to capture the specific rules in `docs/brand-voice.md` afterwards.

### Step 7 — Format the output

For each piece of copy produced, return a block in this exact shape:

```
### <Surface name> — <lang>

**File:** <relative path>
**Funnel stage:** <ToFu | MoFu | BoFu>
**Frameworks applied:** <Hook-Story-Offer | Epiphany Bridge | Application Funnel | …>

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

See `examples/hero-example.md` and `examples/discovery-cta-example.md` for fully worked examples.

When editing an existing file, show the preview block first, then propose the exact `Edit` diff. Never apply edits before the developer approves the preview.

### Step 8 — Run the validation checklist

Run every check before returning any copy. If any check fails, fix it before responding.

1. **Hook test** — does it stop the scroll? Reject any opening that starts with "We are…" or "Our…".
2. **Story test** — is a recognisable pain from `docs/services.md` named in the first two sentences?
3. **Offer test** — does the CTA match the next rung of the Value Ladder? If no pricing, is it a discovery call? No invented prices? Risk reversed explicitly?
4. **Voice test** — zero words from the forbidden list in `docs/brand-voice.md`, metaphor budget respected?
5. **Language test** — does it read native? If it reads like a translation, throw it out and rewrite natively.
6. **Honesty test** — no fake testimonials, fake urgency, fake numbers, or invented client logos? Only cite proof that exists in `docs/services.md` → proof inventory.
7. **File fit** — does the copy match the shape of the file being edited (i18n key structure, JSON schema, Markdown front-matter, etc.)?

## Additional resources

### Reference files

- **`references/brunson-frameworks.md`** — Secret Formula (dream customer, bait, destination), Hook-Story-Offer expanded, Epiphany Bridge 5-step prompts, Value Ladder mapped to a lead funnel, Application Funnel pattern for no-pricing B2B, and decision rules for which framework to emphasise per surface.

### Example files

- **`examples/hero-example.md`** — A worked homepage hero in three languages, annotated with the framework moves applied at each line. The example project is Engranatge (this repo's marketing site) — use it as calibration for the framework moves, not as a literal template.
- **`examples/discovery-cta-example.md`** — A worked BoFu CTA block showing the Application Funnel pattern applied to a no-pricing situation. Same calibration principle.

### Project-specific context (not bundled — lives in the project repo)

- **`docs/services.md`** — the project's service catalog and dream customers.
- **`docs/brand-voice.md`** — the project's voice rules including per-language native-voice rules (register, vocabulary, trap tables).

These docs are where all project-specific knowledge lives. Keep them up to date as the offering and the voice evolve; the skill reads them fresh on every invocation.
