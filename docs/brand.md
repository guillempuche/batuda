# Engranatge: Brand Proposal

What PostHog taught us: the best marketing sites have a **central metaphor** that unifies everything. PostHog's entire site IS a retro PC operating system — every page is an app, the nav is a file browser, the blog is a spreadsheet. That metaphor makes every design decision coherent.

Engranatge needs its own.

---

## The Name

**Engranatge** = "gear mechanism" in Catalan. Gears that mesh together, a machine that runs by itself once set in motion.

This is already a perfect metaphor. We just need to commit to it visually.

---

## Central Metaphor: The Workshop

The site IS a **taller mecànic** (mechanical workshop) where business processes get built, tuned, and set running.

| PostHog                                  | Engranatge                                  |
| ---------------------------------------- | ------------------------------------------- |
| Site = retro OS desktop                  | Site = workshop / factory floor             |
| Pages = apps (spreadsheet, file manager) | Pages = machines, workbenches, blueprints   |
| Hedgehog mascot                          | Gear character / mechanical helper          |
| "home.mdx" filename labels               | "automatitzacio.esquema" / blueprint labels |
| CD jewel case CTA                        | Machine control panel CTA                   |
| Isometric pixel art office               | Isometric workshop with running machines    |

### How it plays out per page

**Homepage** — You enter the workshop. Machines are running. A conveyor belt shows client problems going in one end, solutions coming out the other. The message: "We build the machines so you don't have to do the work."

**Services/Tools** — Each service is a **machine** on the workshop floor. Automations = conveyor belt. AI = a robot arm. Micro-SaaS = a precision instrument. Each one has a "control panel" showing what it does, inputs/outputs, and a big START button.

**Case studies** — **Blueprints** that show how we built a specific machine for a specific client. Technical drawings, before/after flow diagrams, measurable results.

**Blog** — The workshop **logbook** / **diari de taller**. Notes from the bench. What we built, what broke, what we learned. Written like a craftsperson's journal, not corporate content marketing.

**About** — The **workshop tour**. Who works here, what tools we use, why we do this.

**Pricing** — A **parts catalog** or order form. Clean, honest, no-nonsense.

---

## Visual Identity

### Color System (MD3 tokens, WCAG AA verified)

PostHog uses warm earth tones. We go **industrial Mediterranean** — structured as Material Design 3 color roles.

Terracotta `#B05220` was selected via automated WCAG optimization: it's the warmest hue that passes AA (4.5:1) for both white-on-button AND color-on-background simultaneously.

> **MD3 compliance**: All 29 standard color roles covered except **tertiary** (intentionally omitted — two-accent system: terracotta + olive). Fixed accent colors also omitted (multi-theme feature). Token names follow official MD3 naming exactly, prefixed with `--color-`.

#### Primary — Terracotta

The main brand color. Buttons, links, active states.

```css
--color-primary:               #B05220;   /* terracotta — CTA, links, interactive */
--color-on-primary:            #FFFFFF;   /* white text on primary buttons */
--color-primary-container:     #FFDBC8;   /* soft terracotta tint — cards, badges */
--color-on-primary-container:  #3B1500;   /* dark brown text on container */
```

| Pairing                                       | Ratio   | Grade |
| --------------------------------------------- | ------- | ----- |
| `on-primary` on `primary` (white on button)   | 5.15:1  | AA    |
| `primary` on `surface` (link on page)         | 4.54:1  | AA    |
| `on-primary-container` on `primary-container` | 12.54:1 | AAA   |

#### Secondary — Olive Green

Less prominent actions, chips, secondary buttons, success states.

```css
--color-secondary:               #2E6B4F;   /* olive green */
--color-on-secondary:            #FFFFFF;
--color-secondary-container:     #C8EDD9;   /* soft green tint */
--color-on-secondary-container:  #002114;
```

| Pairing                                            | Ratio   | Grade |
| -------------------------------------------------- | ------- | ----- |
| `on-secondary` on `secondary` (white on olive btn) | 6.30:1  | AA    |
| `secondary` on `surface` (olive text on page)      | 5.56:1  | AA    |
| `on-secondary-container` on `secondary-container`  | 13.50:1 | AAA   |

#### Error

```css
--color-error:               #BA1A1A;
--color-on-error:            #FFFFFF;
--color-error-container:     #FFDAD6;
--color-on-error-container:  #410002;
```

| Pairing                                   | Ratio   | Grade |
| ----------------------------------------- | ------- | ----- |
| `on-error` on `error`                     | 6.46:1  | AA    |
| `error` on `surface`                      | 5.70:1  | AA    |
| `on-error-container` on `error-container` | 13.26:1 | AAA   |

#### Surface System

The background and container hierarchy. Warm cream tones instead of cold gray.

```css
--color-surface:                   #F5F0E8;   /* page background — warm parchment */
--color-surface-bright:            #FDFAF4;   /* elevated/modal background */
--color-surface-dim:               #DED7C7;   /* recessed/disabled areas */
--color-surface-container-lowest:  #F8F3EB;   /* least emphasis — dropdowns */
--color-surface-container-low:     #EDE6D6;   /* cards, raised surfaces */
--color-surface-container:         #E7E0D0;   /* inputs, wells */
--color-surface-container-high:    #DFD8C8;   /* selected/hovered rows */
--color-surface-container-highest: #D8D1C1;   /* most emphasis — nav bars */
--color-on-surface:                #2D2A24;   /* primary text — warm graphite */
--color-on-surface-variant:        #56524A;   /* secondary text — softer */
```

| Pairing                                                | Ratio   | Grade |
| ------------------------------------------------------ | ------- | ----- |
| `on-surface` on `surface-bright`                       | 13.73:1 | AAA   |
| `on-surface` on `surface` (body text)                  | 12.61:1 | AAA   |
| `on-surface` on `surface-container-lowest`             | 12.95:1 | AAA   |
| `on-surface` on `surface-container-low` (text on card) | 11.50:1 | AAA   |
| `on-surface` on `surface-container` (text on input)    | 10.88:1 | AAA   |
| `on-surface` on `surface-container-highest`            | 9.41:1  | AAA   |
| `on-surface-variant` on `surface-bright`               | 7.46:1  | AAA   |
| `on-surface-variant` on `surface` (secondary text)     | 6.85:1  | AA    |
| `on-surface-variant` on `surface-container-lowest`     | 7.04:1  | AAA   |
| `on-surface-variant` on `surface-container-low`        | 6.25:1  | AA    |
| `on-surface-variant` on `surface-container-highest`    | 5.11:1  | AA    |

#### Outline

Borders and dividers. WCAG requires 3:1 for non-text UI components.

```css
--color-outline:         #847D71;   /* visible borders, input strokes */
--color-outline-variant:  #CCC5B5;   /* subtle dividers, separators */
```

| Pairing                                               | Ratio  | Grade       |
| ----------------------------------------------------- | ------ | ----------- |
| `outline` on `surface` (border on bg)                 | 3.59:1 | 3:1 UI pass |
| `outline` on `surface-container-low` (border on card) | 3.28:1 | 3:1 UI pass |

#### Inverse (dark overlays, tooltips, snackbars)

```css
--color-inverse-surface:     #33302A;
--color-inverse-on-surface:  #F5F0E8;
--color-inverse-primary:     #FFB68E;   /* terracotta tint for dark surfaces */
```

| Pairing                                   | Ratio   | Grade |
| ----------------------------------------- | ------- | ----- |
| `inverse-on-surface` on `inverse-surface` | 11.59:1 | AAA   |
| `inverse-primary` on `inverse-surface`    | 7.72:1  | AAA   |

#### Why this palette

- **Terracotta** is distinctly Mediterranean/Catalan — no other SaaS uses it
- **Olive green** connects to the land, craft, and growth
- **Warm cream surfaces** feel like paper, parchment, a workshop notebook
- Zero blue CTAs, zero purple gradients, zero SaaS cliches
- Every text pairing passes WCAG AA. Most pass AAA.
- Surface hierarchy uses warm undertones (yellow-brown) not cool gray

### Typography

PostHog uses IBM Plex Sans. We need something that feels **mechanical but warm**:

| Role           | Option 1                                         | Option 2                                           |
| -------------- | ------------------------------------------------ | -------------------------------------------------- |
| Headings       | **DM Sans** (geometric, modern, clean)           | **Space Grotesk** (mechanical, techy but friendly) |
| Body           | **Inter** (highly readable, neutral)             | **IBM Plex Sans** (proven, open source)            |
| Technical/code | **JetBrains Mono**                               | **IBM Plex Mono**                                  |
| Decorative     | **Instrument Serif** (for workshop logbook feel) | **Playfair Display** (elegant, artisan)            |

### Mascot / Character

PostHog has their hedgehog in every situation. We need a **gear character**:

- A single gear cog with eyes and simple expressions
- Appears in different contexts: wearing a hard hat (building), holding a wrench (fixing), sleeping (automated process running itself), celebrating (client results)
- Simple enough to be an icon, expressive enough to have personality
- Name suggestion: **Roda** (Catalan for "wheel/gear") or **Dent** (gear tooth)

Alternative: a **small mechanical robot** made of visible gears, springs, and brass — steampunk-lite, friendly, helpful. Less abstract, more memorable.

---

## Tone of Voice

PostHog is irreverent and techy because they talk to developers. Engranatge talks to **local business owners** — people who don't care about tech, they care about results.

### Our tone

| Principle              | In practice                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Direct**             | "This saves you 10 hours a week" not "Leverage synergistic automation paradigms"                                          |
| **Local**              | Catalan first, proud of it. Mediterranean sensibility. "Som del barri" not "We're a global platform"                      |
| **Honest**             | "This won't work for everyone" — PostHog says "a competitor might suit you better if..."                                  |
| **Workshop craftsman** | We talk like someone who builds things with their hands. "We built this." "Here's how it works." "This is what it costs." |
| **Anti-consultant**    | No jargon, no buzzwords, no "digital transformation". Just: "Your invoicing takes 4 hours. We made it take 10 minutes."   |

### Example copy

**Bad (generic SaaS):**

> "Empower your business with AI-driven automation solutions that transform your operational efficiency."

**Good (Engranatge):**

> "El teu negoci fa coses que una maquina podria fer. Nosaltres construim la maquina."
> (Your business does things a machine could do. We build the machine.)

**Hero headline options:**

- "Les maquines fan la feina. Tu fas el negoci." (Machines do the work. You run the business.)
- "Eines que treballen mentre tu dorms." (Tools that work while you sleep.)

---

## Site Structure (Workshop Metaphor Applied)

```
engranatge.com/
  /                    — Workshop entrance (hero + what we do + proof)
  /eines               — Tools catalog (services: automations, AI, micro-SaaS)
  /eines/:slug         — Individual machine/tool page
  /projectes           — Blueprints (case studies)
  /projectes/:slug     — Individual blueprint
  /diari               — Workshop logbook (blog)
  /diari/:slug         — Individual entry
  /taller              — About us (workshop tour)
  /pressupost          — Pricing / quote request
  /:lang/:slug         — Prospect-specific pages (existing)
```

---

## What We Take From PostHog

| Pattern                             | Our version                                          |
| ----------------------------------- | ---------------------------------------------------- |
| OS desktop metaphor                 | Workshop/taller metaphor                             |
| Hedgehog mascot                     | Gear character (Roda) or mechanical robot            |
| Warm earth tones (#EEEFE9, #EB9D2A) | Mediterranean industrial (#F5F0E8, #C45A2D, #2E6B4F) |
| Anti-corporate humor                | Anti-consultant directness                           |
| Developer-coded filenames           | Blueprint/workshop labels                            |
| "Shameless CTA" parody              | "Control panel" CTA                                  |
| Spreadsheet blog                    | Workshop logbook                                     |
| CD jewel case pricing               | Parts catalog pricing                                |
| IBM Plex Sans                       | DM Sans / Space Grotesk + Inter                      |
| Content density (developers read)   | Result density (business owners scan)                |
| Tailwind + Gatsby                   | Tailwind + TanStack Start (already chosen)           |
| Competitor comparison tables        | Problem/solution before-after tables                 |

---

## What We DON'T Take From PostHog

- **Page length**: PostHog pages are very long. Local SMBs won't scroll that much. Keep it tight.
- **Technical depth**: PostHog shows SQL queries and API docs. We show results and savings.
- **Self-referential humor**: PostHog jokes about SaaS conventions. Our audience doesn't know SaaS conventions. Our humor should be about the frustrations of running a small business.
- **English-first**: We're Catalan-first, multilingual second.
- **Feature comparison tables**: We don't have direct competitors. We compare "with Engranatge" vs "without Engranatge" (manual vs automated).
