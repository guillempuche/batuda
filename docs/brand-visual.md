# Batuda: Visual Brand

The visual identity, central metaphor, layout vocabulary, and design rationale for Batuda and its tenants. Paired with `docs/brand-voice.md` (copy voice rules, forbidden words, tone ladders, per-language native-voice rules for Catalan/Castilian/English). Together the two documents are the canonical brand.

> **Scope note.** Batuda is the multi-tenant SaaS CRM. This document captures the visual language shared by the Batuda product UI *and* by tenant marketing sites served through it. The first tenant is **Engranatge** (the author's own agency at `engranatge.com`), whose site is used as the worked example below. Seeds use a fictitious tenant *Taller* (`taller.cat`). *"Forja"* may still appear as a workshop-metaphor word (forge), but is not a product name.

What PostHog taught us: the best marketing sites have a **central metaphor** that unifies everything. PostHog's entire site IS a retro PC operating system — every page is an app, the nav is a file browser, the blog is a spreadsheet. That metaphor makes every design decision coherent.

Batuda and its tenants need one too.

---

## The Name

**Batuda** = in Catalan, a sudden blow or stroke (the sound of a hammer on the anvil) — the decisive move that starts the work. In the workshop metaphor, it's the stroke that sets a machine running.

*Engranatge* (the first tenant) = "gear mechanism" in Catalan: gears that mesh together, a machine that runs by itself once set in motion. The two words pair naturally — Batuda is the strike that engages the gears.

Both are already perfect metaphors. The design just needs to commit to them visually.

---

## Central Metaphor: The Workshop

The site IS a **taller mecànic** (mechanical workshop) where business processes get built, tuned, and set running.

| PostHog                                  | Batuda / tenant sites                       |
| ---------------------------------------- | ------------------------------------------- |
| Site = retro OS desktop                  | Site = workshop / factory floor             |
| Pages = apps (spreadsheet, file manager) | Pages = machines, workbenches, blueprints   |
| Hedgehog mascot                          | Gear character / mechanical helper          |
| "home.mdx" filename labels               | "automatitzacio.esquema" / blueprint labels |
| CD jewel case CTA                        | Machine control panel CTA                   |
| Isometric pixel art office               | Isometric workshop with running machines    |

### How it plays out per page

**Homepage** — You enter the workshop. Machines are running. A conveyor belt shows client problems going in one end, solutions coming out the other. The message: "We build the machines so you don't have to do the work."

**Services/Tools** — Each service is a **machine** on the workshop floor. Automations = conveyor belt. AI = a robot arm. Each one has a "control panel" showing what it does, inputs/outputs, and a big START button.

**Case studies** — **Blueprints** that show how we built a specific machine for a specific client. Technical drawings, before/after flow diagrams, measurable results.

**Blog** — The workshop **logbook** / **diari de taller**. Notes from the bench. What we built, what broke, what we learned. Written like a craftsperson's journal, not corporate content marketing.

**About** — The **workshop tour**. Who works here, what tools we use, why we do this.

**Pricing** — A **parts catalog** or order form. Clean, honest, no-nonsense.

---

## Visual Identity

### Color System (MD3 tokens, WCAG AA verified)

PostHog uses warm earth tones. We go **industrial Mediterranean** — structured as Material Design 3 color roles.

Terracotta `#95400F` was selected via automated WCAG optimization: it's the warmest hue that passes AA (4.5:1) for both white-on-button AND color-on-background simultaneously. It clears that bar with room to spare — 6.96:1 and 6.13:1 — which is what lets the same hue carry into the dark themes without a second brand colour.

> **MD3 compliance**: All 29 standard color roles covered except **tertiary** (intentionally omitted — two-accent system: terracotta + olive). Fixed accent colors also omitted (multi-theme feature). Token names follow official MD3 naming exactly, prefixed with `--color-`.

#### Primary — Terracotta

The main brand color. Buttons, links, active states.

```css
--color-primary:               #95400F;   /* terracotta — CTA, links, interactive */
--color-on-primary:            #FFFFFF;   /* white text on primary buttons */
--color-primary-container:     #FFDBC8;   /* soft terracotta tint — cards, badges */
--color-on-primary-container:  #3B1500;   /* dark brown text on container */
```

| Pairing                                       | Ratio   | Grade |
| --------------------------------------------- | ------- | ----- |
| `on-primary` on `primary` (white on button)   | 6.96:1  | AAA   |
| `primary` on `surface` (link on page)         | 6.13:1  | AA    |
| `on-primary-container` on `primary-container` | 12.54:1 | AAA   |

#### Secondary — Olive Green

Less prominent actions, chips, secondary buttons, success states.

```css
--color-secondary:               #2E6B4F;   /* olive green */
--color-on-secondary:            #FFFFFF;
--color-secondary-container:     #D8E4D0;   /* soft green tint */
--color-on-secondary-container:  #1E3524;
```

| Pairing                                            | Ratio   | Grade |
| -------------------------------------------------- | ------- | ----- |
| `on-secondary` on `secondary` (white on olive btn) | 6.30:1  | AA    |
| `secondary` on `surface` (olive text on page)      | 5.56:1  | AA    |
| `on-secondary-container` on `secondary-container`  | 10.02:1 | AAA   |

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

| Role    | Font                 | Why                                                 |
| ------- | -------------------- | --------------------------------------------------- |
| Display | **Barlow Condensed** | Narrow, industrial, reads like stamped metal labels |
| Body    | **Barlow**           | Same family, warm and readable at body sizes        |

Tokens: `--font-display` and `--font-body` in `@batuda/ui/tokens.css`. The font files are self-hosted in `apps/internal/src/fonts/barlow` (Open Font License alongside them) and declared with `@font-face` in `apps/internal/src/styles.css`. The root route preloads the faces every page paints with first.

### Mascot / Character

**GearMascot** — emoji-based gear character with switchable expressions (`default`, `happy`, `working`, etc.). Lives in the hero section. Simple colored circle with an emoji face — approachable, not over-designed.

---

## Workshop Layout — Desktop & Mobile

The layout IS the metaphor. No standard navbar, no standard cards, no standard footer. Every visual element maps to a physical workshop object.

### Single-Page Sales Funnel

One page, one goal, one CTA. Russell Brunson AIDA flow:

1. **Hook** — Hero headline + conveyor belt animation
2. **Problem** — Before/after comparison (manual vs automated)
3. **Solution** — Service machines (Automatitzacions, IA)
4. **Proof** — Industry examples with results
5. **Offer** — Transparent pricing (parts catalog style)
6. **CTA** — "Parlem del teu negoci" → email

No page navigation. Shadow board tools and tool belt tabs scroll to sections.

### Desktop (>=1024px): Pegboard Wall

You're standing at the workbench, looking at the pegboard wall.

- **No navbar.** The pegboard IS the interface. Logo is a stamped metal plate bolted to the wall (top-left).
- **Machine push buttons** on the left column. Colored dome caps in metal bezels with screw dots — scroll to funnel sections (Inici, Eines, Preus, Parla). Active section glows amber via IntersectionObserver.
- **Blueprint sheet** as the content area. Aged cream paper (`#EDE5D0`) with grid lines (24px), ruler markings along top and left edges, masking tape strips at corners, corner fold cutout (clip-path). Paper shadow and vignette for depth.
- **Sheet-metal footer plate** at bottom-right with stamped brand and copyright, screw dots.
- No right column (single-page funnel has no "future pages" to hint at).

### Interactive Elements — Stamped Metal

Buttons are **stamped metal plates**, not flat web buttons:

- Primary: terracotta metal gradient, embossed text (`text-shadow`), 2px radius, depth `box-shadow`, `:active` press effect
- Secondary: dashed stencil outline, uppercase, no border-radius, no background

### Mobile (<1024px): Clipboard

You're walking around the shop floor, clipboard in hand.

- **Metal binder clip** as the sticky header. Brushed chrome gradient with fine horizontal lines, engraved tenant brand ("ENGRANATGE" on the first tenant's site, "BATUDA" on the tool surface). Wider binder clip (64px) protruding above. Screw/rivet dots on edges. No hamburger menu.
- **Paper surface** for content. Cream background with faint grid lines (body-level CSS). Normal scroll — you're flipping through the work order.
- **Tool belt** as the fixed bottom bar. Dark leather/canvas texture (#3E2723), stitching dividers between tools. 4 tabs scroll to funnel sections. Active tab in terracotta tint.
- **Label plate footer** — metal gradient (matching the clip header) with stamped brand, copyright, email. No multi-column grid. Sharp, minimal.

### Why These Choices

| Element                | Physical analog                        | Why it works                                      |
| ---------------------- | -------------------------------------- | ------------------------------------------------- |
| Shadow board           | How real workshops organize tools      | "Missing tool" active state is unique             |
| Clipboard              | How shop floor workers carry documents | The phone IS something you hold                   |
| Technical drawing grid | Engineering drawings on cream paper    | Stays warm/Mediterranean, not cold blueprint blue |
| Metal plate logo       | Brand plates bolted to equipment       | No navbar = instantly breaks "website" feel       |
| Tool belt tabs         | Reaching into a belt pouch for tools   | More tactile than a flat tab bar                  |
| Bench edge ruler       | Workshop bench with built-in ruler     | Gives the bottom strip physical presence          |

---

## Workshop Visual Language

The specific aesthetic vocabulary shared across Batuda surfaces and tenant marketing sites. Defined in `@batuda/ui/tokens.css` — consumed locally by the Batuda web app and published to npm for tenant marketing sites (e.g. Engranatge's), so both draw from the same visual language.

### Surfaces

- **Metal palette** — 4 anchor tones (`--color-metal-light` → `--color-metal` → `--color-metal-dark` → `--color-metal-deep`) used in `linear-gradient()` at varying angles. Cards, plates, tags, screw dots all draw from this palette.
- **Workshop elevation** — `--elevation-workshop-sm/md/lg`: inset white highlight on top + outer shadow underneath = top-lit metal depth effect. Replaces flat `box-shadow`.
- **Brushed metal texture** — `--texture-brushed-metal`: fine horizontal `repeating-linear-gradient` overlay layered on top of metal gradients.
- **Aged paper** — warm beige `#EDE5D0` with diagonal fiber + 24px grid textures. Used for the blueprint sheet content area.

### Typography effects

- **Embossed stamp** — `--text-shadow-emboss`: light highlight below text simulates stamped/pressed metal lettering.
- **Engraved text** — `--text-shadow-engrave`: dark shadow above text simulates cut-in lettering.
- **Display headings** — `var(--font-display)` (Barlow Condensed), uppercase, `0.04–0.12em` letter-spacing — reads like industrial stencil labels.
- **Labels** — small, bold, uppercase, wide letter-spacing — stenciled markings on equipment.

### Decorative elements

- **Screw/rivet dots** — 5px circles with `radial-gradient(circle at 35% 35%, metal-dark, metal-deep)` at corners or edges of metal panels.
- **Nail holes** — 8px circles with inner shadow at top-center of hanging tags (MachineCard).
- **Pin tacks** — 10px red `radial-gradient` (#D4544A → #A03030) at top-center of pinned cards (ProofCard).
- **Masking tape** — semi-transparent beige strips (`#D8D0B8` → `#E2DAC4`) at paper corners, rotated ±2deg.
- **Rulers** — 14px strips along paper edges with repeating grid tick marks at 24px intervals.
- **Corner fold** — `clip-path: polygon()` cuts bottom-right of blueprint paper, fold overlay triangle behind.

### Interactive elements

- **Machine push buttons** — circular metal bezel housing + colored dome cap (green/blue/orange/red). Spring physics via `motion/react` (`whileTap: { scale: 0.9 }`).
- **Active glow** — warm amber `box-shadow` ring when section is in view (IntersectionObserver via `ActiveSectionProvider` context).
- **Card hover** — cards have slight alternating rotation (`nth-child` ±0.3–0.6deg), straighten to 0deg on hover.
- **Stamped metal buttons** — primary CTA uses terracotta gradient with `--elevation-workshop-md` and `--text-shadow-engrave`. Press effect via `:active { transform: translateY(1px) }`.
- **Stencil outline buttons** — secondary CTA uses `border: 2px dashed`, no background, uppercase. Hover highlights in terracotta.

---

## Dark Workshop

The workshop at night, lit by one work-lamp rather than by daylight.

This is a *reinterpretation* of the workshop metaphor, not an inversion of the light palette. Inverting cream surfaces yields mud, because the whole system assumes a lit-from-above cream ground. Instead the ground goes near-black warm charcoal, the metal desaturates and drops to low key, and the paper dims from cream to ochre. Terracotta and olive stay as the accents — they are what the lamp *lands on*, so they remain the brightest things on screen and keep their brand role rather than receding.

**The light model is the load-bearing decision.** The lamp stays above-left, so bevels keep their direction and only lose contrast. Inset highlights dim toward a warm low-alpha tint rather than flipping to shadow, and outer shadows deepen because a dark ground swallows a 12%-black shadow. This is why `--elevation-workshop-*`, `--text-shadow-emboss` and the metal gradients survive into dark with new values instead of being rebuilt — the geometry is unchanged, only the tone.

Two themes are defined here: `dark` (WCAG AA) and `dark-hc` (high contrast, WCAG AAA). There is no light-high-contrast theme. All ratios below are computed, not estimated.

### Dark — surface system

The ramp climbs with elevation, per MD3 dark convention: higher surfaces are lighter, the reverse of the light theme.

```css
--color-surface:                   #17140F;   /* page ground — unlit charcoal */
--color-surface-bright:            #3A342B;   /* elevated/modal */
--color-surface-dim:               #100E0A;   /* recessed */
--color-surface-container-lowest:  #0B0908;   /* dropdowns */
--color-surface-container-low:     #1F1B15;   /* cards */
--color-surface-container:         #23201A;   /* inputs, wells */
--color-surface-container-high:    #2E2A22;   /* selected rows */
--color-surface-container-highest: #39342B;   /* nav bars */
--color-on-surface:                #EDE6DA;   /* primary text — warm off-white */
--color-on-surface-variant:        #CBC2B2;   /* secondary text */
```

| Pairing                                             | Ratio   | Grade |
| --------------------------------------------------- | ------- | ----- |
| `on-surface` on `surface` (body text)               | 14.81:1 | AAA   |
| `on-surface` on `surface-bright`                    | 9.93:1  | AAA   |
| `on-surface` on `surface-container-lowest`          | 16.02:1 | AAA   |
| `on-surface` on `surface-container-low`             | 13.81:1 | AAA   |
| `on-surface` on `surface-container`                 | 13.10:1 | AAA   |
| `on-surface` on `surface-container-high`            | 11.51:1 | AAA   |
| `on-surface` on `surface-container-highest`         | 9.96:1  | AAA   |
| `on-surface-variant` on `surface`                   | 10.41:1 | AAA   |
| `on-surface-variant` on `surface-bright`            | 6.97:1  | AA    |
| `on-surface-variant` on `surface-container-lowest`  | 11.26:1 | AAA   |
| `on-surface-variant` on `surface-container-low`     | 9.71:1  | AAA   |
| `on-surface-variant` on `surface-container`         | 9.20:1  | AAA   |
| `on-surface-variant` on `surface-container-high`    | 8.09:1  | AAA   |
| `on-surface-variant` on `surface-container-highest` | 7.00:1  | AAA   |

### Dark — accents

Terracotta and olive lighten to carry on a dark ground. These are the lamp-lit colors.

```css
--color-primary:               #F2A578;   /* lit terracotta */
--color-on-primary:            #4A1B00;
--color-primary-container:     #6B2E0A;
--color-on-primary-container:  #FFDBC8;

--color-secondary:               #8ECFA8;   /* lit olive */
--color-on-secondary:            #003821;
--color-secondary-container:     #1F5038;
--color-on-secondary-container:  #C8EDD9;

--color-error:               #FFB4AB;
--color-on-error:            #690005;
--color-error-container:     #93000A;
--color-on-error-container:  #FFDAD6;

--color-outline:          #9A9082;   /* visible borders */
--color-outline-variant:  #4C463E;   /* subtle dividers */
```

| Pairing                                           | Ratio   | Grade       |
| ------------------------------------------------- | ------- | ----------- |
| `on-primary` on `primary`                         | 7.20:1  | AAA         |
| `primary` on `surface`                            | 9.12:1  | AAA         |
| `on-primary-container` on `primary-container`     | 8.03:1  | AAA         |
| `on-secondary` on `secondary`                     | 7.33:1  | AAA         |
| `secondary` on `surface`                          | 10.18:1 | AAA         |
| `on-secondary-container` on `secondary-container` | 7.32:1  | AAA         |
| `on-error` on `error`                             | 7.72:1  | AAA         |
| `error` on `surface`                              | 10.82:1 | AAA         |
| `on-error-container` on `error-container`         | 7.24:1  | AAA         |
| `outline` on `surface`                            | 5.85:1  | 3:1 UI pass |
| `outline` on `surface-container-low`              | 5.45:1  | 3:1 UI pass |

`outline-variant` is a decorative divider and never the sole carrier of meaning, so WCAG 1.4.11 does not apply — it sits at 1.97:1 on `surface` here, against 1.51:1 in the light theme. The high-contrast theme holds it to 3:1 anyway.

### Dark — workshop surfaces

```css
/* Ground — the unlit workshop */
--color-pegboard:      #14120F;
--color-leather-dark:  #241A16;

/* Metal — same 4-anchor ramp, desaturated and compressed */
--color-metal-light:  #4A443B;
--color-metal:        #3B362E;
--color-metal-dark:   #2C2821;
--color-metal-deep:   #1E1B16;

/* Paper — dim ochre, not cream */
--color-paper-aged:        #2A2318;
--color-paper-aged-hover:  #332B1F;

/* The lamp is still above-left, so the highlight stays on top of the bevel —
   dimmed and warmed rather than removed or flipped. Shadows deepen because a
   dark ground swallows the light theme's 12%-black. */
--highlight-inset:         rgba(255, 226, 190, 0.07);   /* light: rgba(255,255,255,0.2) */
--highlight-inset-strong:  rgba(255, 226, 190, 0.11);   /* light: rgba(255,255,255,0.3) */
--shadow-color:            rgba(0, 0, 0, 0.55);         /* light: rgba(0,0,0,0.12) */
--shadow-color-strong:     rgba(0, 0, 0, 0.72);         /* light: rgba(0,0,0,0.2)  */
```

### High contrast dark

`dark-hc` inherits dark's structure and then removes what is contrast *noise* rather than depth. It is a distinct theme, not a darker dark — the texture and glow that make the workshop legible in the other two themes actively harm legibility here.

Removed: `--texture-brushed-metal` goes `none`; metal and popup gradients flatten to solid fills; the amber `--glow-active` halo is replaced by a solid high-contrast focus ring; `--text-shadow-emboss` and `--text-shadow-engrave` go `none`; `--highlight-inset` goes `transparent`. Borders become solid and every divider is held to 3:1, including `outline-variant`.

```css
--color-surface:                   #0A0908;
--color-surface-bright:            #332E27;
--color-surface-dim:               #000000;
--color-surface-container-lowest:  #000000;
--color-surface-container-low:     #121010;
--color-surface-container:         #17150F;
--color-surface-container-high:    #222019;
--color-surface-container-highest: #2C2921;
--color-on-surface:                #FFFBF5;
--color-on-surface-variant:        #E8DFD0;

--color-primary:               #FFC9A6;
--color-on-primary:            #2E0F00;
--color-primary-container:     #5A2400;
--color-on-primary-container:  #FFEDE2;

--color-secondary:               #B6E8C9;
--color-on-secondary:            #002515;
--color-secondary-container:     #113D28;
--color-on-secondary-container:  #E2F6EA;

--color-error:               #FFD2CC;
--color-on-error:            #4A0002;
--color-error-container:     #7A0006;
--color-on-error-container:  #FFF0EE;

--color-outline:          #C9BFAF;
--color-outline-variant:  #8A8276;
```

Every text pairing clears AAA; the lowest is `on-surface-variant` on `surface-bright` at 10.18:1, and `outline-variant` on `surface` reaches 5.24:1.

| Pairing                                       | Ratio   | Grade |
| --------------------------------------------- | ------- | ----- |
| `on-surface` on `surface`                     | 19.30:1 | AAA   |
| `on-surface-variant` on `surface`             | 15.06:1 | AAA   |
| `on-primary` on `primary`                     | 11.95:1 | AAA   |
| `primary` on `surface`                        | 13.41:1 | AAA   |
| `on-primary-container` on `primary-container` | 10.94:1 | AAA   |
| `on-secondary` on `secondary`                 | 12.05:1 | AAA   |
| `secondary` on `surface`                      | 14.57:1 | AAA   |
| `on-error` on `error`                         | 11.87:1 | AAA   |
| `error` on `surface`                          | 14.54:1 | AAA   |
| `outline` on `surface`                        | 10.95:1 | AAA   |

OS forced-colors mode (Windows High Contrast) is a **separate, independent axis**. In that mode the user agent overrides author colors regardless of which theme is active, so `dark-hc` neither implements nor substitutes for it.

### What does not change across themes

Type scale, spacing, shape, and every geometric value are theme-invariant. So is the light *direction* — above-left in all three themes. Only tone changes. A component that hardcodes a color cannot participate in any of this, which is why the token rule in [frontend.md](frontend.md) is load-bearing rather than stylistic.

---

## Tone of Voice

Voice rules live in **`docs/brand-voice.md`**. That document covers the anti-consultant positioning, forbidden words, the workshop metaphor budget for copy, mission framing, tone ladders per funnel stage, and per-language native-voice rules (Catalan, Castilian, English, with Castilianism and anglicism traps).

Quick orientation for designers working in `brand-visual.md` without opening the voice doc: the brand is **direct, local, honest, workshop-craftsman, anti-consultant**. Never use "empower", "leverage", "synergy", "digital transformation". The mission is *"Machines do the low-value work. Humans do the high-value work."* Every detailed voice rule is in `brand-voice.md`.

---

## Site Structure

Single-page sales funnel at `/` for each tenant marketing site. No multi-page navigation — all content on one scrollable page. Shadow board tools and tool belt tabs use TanStack Router hash navigation (`Link` with `hash` prop + `defaultHashScrollIntoView: { behavior: 'smooth' }`).

```
<tenant-domain>/              (e.g. engranatge.com/ or taller.cat/)
  /                    — Single-page funnel (hook → problem → solution → proof → pricing → CTA)
  /:lang/:slug         — Prospect-specific pages (CMS, Tiptap blocks, served by api.batuda.co)
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
- **English-first**: Tenants like Engranatge are Catalan-first, multilingual second.
- **Feature comparison tables**: The tenant's readers don't have direct competitors to compare. Compare "with the workshop" vs "without the workshop" (manual vs automated).
