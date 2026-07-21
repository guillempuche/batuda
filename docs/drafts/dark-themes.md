# Dark + high-contrast-dark themes

Status: **Slices 0–4 built, not yet committed (2026-07-21).** Adds two themes — `dark` and `dark-hc` — alongside the current light-only system. The dark aesthetic is **work-lamp on unlit metal**: near-black warm charcoal ground, desaturated low-key metal lit from above-left only, dim ochre paper, terracotta and olive kept as the lit accents, bevels in the same direction at much lower contrast. Shipping as one PR from the `claude/dark-themes-tokens` worktree, one commit per area.

Done so far: the palette and its contrast tables live in [brand-visual.md](../brand-visual.md) §Dark Workshop; the token system is reconciled, restructured, and complete; and every colour literal outside one file is now a token. **No theme blocks or switching yet** — that starts at Slice 6. The light theme is what currently renders, and it was verified against the running app.

For frontend context see [frontend.md](../frontend.md); for the visual language see [brand-visual.md](../brand-visual.md). Counts below are as-measured; where a slice has landed, the "after" number is recorded with it.

---

## Why this isn't a token swap

*This section describes the state as found, before any slice ran. Slices 1–4 have since resolved the second and third points — see the slice entries for the after numbers. It is kept because the reasoning is what sized the work, and because the same trap recurs.*

**There is no theming mechanism at all.** [`packages/ui/src/tokens.css`](../../packages/ui/src/tokens.css) is a single flat `:root` block — no `prefers-color-scheme`, no `data-theme`, no `color-scheme` declaration anywhere in the app. [frontend.md:216](../frontend.md) states it plainly: *"No dark mode at this writing — light only."*

**277 hardcoded color literals across 52 component files bypass the token system.** (Counting the three token/style CSS files too it is 332 across 55, but those are the files that *should* hold literals — 277/52 is the number that measures the debt.) Swapping `:root` values does nothing for them. The doc's own Rule 1 — *"Tokens always. Never hardcode hex"* — is already broadly violated; dark mode is what forces the reckoning.

| Bucket                | Count | What it is                                 | Dark-mode consequence                 |
| --------------------- | ----- | ------------------------------------------ | ------------------------------------- |
| `rgba(0,0,0,α)`       | 110   | Drop shadows, hairline borders             | Invisible on dark; depth cue vanishes |
| `rgba(255,255,255,α)` | 23    | Inset top-light highlights                 | Reads as a smudge, not a bevel        |
| Other `rgba()`        | 58    | Ledger lines, paper fibre, tints           | Wrong hue against a dark base         |
| Hex                   | 86    | Paper, terracotta tints, off-palette drift | Stays light — the loudest failure     |

**Some tokens the code already uses do not exist**, so there is nothing to override — see below. This is the finding that breaks the naive "swap `:root` and everything follows" premise.

**The workshop aesthetic is intrinsically light.** `--elevation-workshop-*` bakes `inset 0 1px 0 rgba(255,255,255,0.2)` top-lit highlights; `--text-shadow-emboss` is a white highlight; the pegboard body, aged paper, and brushed metal all assume a lit-from-above cream surface. Inverting the values produces mud, not a dark theme. This needs a *reinterpretation* of the metaphor — unlit metal, low-key paper, a repositioned light source — which is a brand decision, not an implementation detail.

---

## Findings that change the shape of the work

### Undefined tokens in shipped code

Twelve `var()` references point at **color tokens that are defined nowhere**. They silently fall back to `inherit`/nothing, which happens to look acceptable on cream and will not on a dark ground — and because no token exists, a dark override cannot reach them.

| Token                                                                                                   | Refs | Where                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| `--color-ink-strong` / `-soft` / `-hairline`, `--color-surface-raised`                                  | 5    | [`companies/where-panel-client.client.tsx`](../../apps/internal/src/components/companies/where-panel-client.client.tsx) |
| `--color-on-metal` / `-muted`, `--color-on-surface-muted`, `--color-border-subtle`, `--color-ink-muted` | 5    | [`routes/calendar/index.tsx`](../../apps/internal/src/routes/calendar/index.tsx)                                        |
| `--color-tertiary`                                                                                      | 2    | [`routes/emails/$threadId.tsx`](../../apps/internal/src/routes/emails/$threadId.tsx)                                    |

`--color-tertiary` is its own problem: [brand-visual.md:62](../brand-visual.md) says tertiary is *deliberately omitted* ("No tertiary, no fixed accents"), and the code uses it anyway.

Also undefined but non-color: `--shape-3xs` (24 refs), `--font-size-xs`/`-sm`/`-md` (4 refs). And `--radius-md`/`--radius-sm` (3 refs) and `--font-mono` (30 refs) resolve only because Tailwind's default theme happens to define them — off-system, and they should be `--shape-md`/`--shape-sm` and a real font token.

### `packages/ui` hardcodes literals it cannot theme

`#f0e8d0` — the value of `--color-paper-aged` — is hardcoded in eight `packages/ui/src/pri/` components: `PriDialog`, `PriInput`, `PriTabs`, `PriTextarea`, `PriToast`, `PriToolbar`, `PriPreviewCard`, `PriNumberField`. Two `#1a1612` scrims are likewise inline, at [`pri-dialog.tsx:14`](../../packages/ui/src/pri/pri-dialog.tsx) and [`pri-tooltip.tsx:55`](../../packages/ui/src/pri/pri-tooltip.tsx).

Be precise about *why* this matters, because the obvious reason is wrong. CSS custom properties inherit from the document root, so a `var(--color-paper-aged)` inside a library component rendered by `apps/internal` **would** resolve fine — the library is not blocked from referencing an app-defined token. The actual problem is simpler: these are **literals, not `var()` calls**, so no theme can override them in any consumer, `apps/internal` included.

Note also that [`batuda-tokens.css:29-32`](../../apps/internal/src/batuda-tokens.css) documents a *deliberate* decision to keep the paper tokens app-local, on the grounds that marketing does not consume them. `apps/marketing` no longer lives in this repo (extracted in `56116a0d58`); tenant marketing sites consume the published npm package from their own repos. So promoting these tokens reverses a commented decision and should be done knowingly, with that comment updated — the promotion is justified by "the library needs a themeable token of its own", not by a marketing consumer that may not want it.

### Base UI portals force `data-theme` onto `<html>`

Every Base UI popup surface portals into `document.body` by default (`FloatingPortal.tsx:110-113`: `containerProp ?? parentPortalNode ?? document.body`). The `Portal` part is **mandatory** for Dialog, Popover, Menu, Tooltip, PreviewCard, Combobox and NavigationMenu — the positioner throws `Base UI: <X.Portal> is missing.` without it.

So a `data-theme` on a wrapper `<div>` inside the app root would leave every dialog, menu, tooltip, select popup and toast outside the selector's subtree, resolving custom properties against `:root` instead. `<html>` is the only ancestor enclosing both the app root and `document.body`'s portal wrappers. A `container` prop exists as an escape hatch, but using it would mean threading it through every portal in the app.

Base UI ships no CSS and emits no color-related custom properties — its `--anchor-width`/`--transform-origin`/`--collapsible-panel-height` variables are dimensional only, so there is no namespace collision with our tokens.

### The `lang` cookie flow is an exact structural precedent

[`__root.tsx`](../../apps/internal/src/routes/__root.tsx) already does this dance for locale: `beforeLoad` reads the cookie (SSR via `getServerCookieHeader`, client via `document.cookie`) → returns it as route context → `loader` passes it through → `RootDocument` renders `<html lang={htmlLang[lang]}>`. Supporting files are [`i18n/cookie.ts`](../../apps/internal/src/i18n/cookie.ts), [`i18n/detect-lang.ts`](../../apps/internal/src/i18n/detect-lang.ts), [`i18n/lang-provider.tsx`](../../apps/internal/src/i18n/lang-provider.tsx), and the [`LanguageSelect`](../../apps/internal/src/components/profile/language-select.tsx) switcher.

Theme should mirror this file-for-file rather than invent a second pattern. One difference matters, below.

### `system` has no server-side answer — the one genuine gap

Locale has no "auto" option, so the server can always resolve it. Theme does: a user on `system` needs `prefers-color-scheme`, which the server cannot read from headers. On a first visit with no cookie, SSR must guess, and a wrong guess flashes.

TanStack Start's answer is `ScriptOnce` (`packages/react-router/src/ScriptOnce.tsx:7-21`) — an SSR-only, self-removing inline script that runs at HTML-parse time before hydration, and returns `null` on the client so navigations don't re-run it. It requires `suppressHydrationWarning` on `<html>`, which the framework docs do recommend.

The framework docs' own theme example is `localStorage` + `matchMedia` + `classList`, client-only and SSR-unsafe — **not** what we want. The cookie + SSR hybrid below is our design, not theirs.

The only CSP in the app is `frame-ancestors 'none'` ([`start.ts:14`](../../apps/internal/src/start.ts)), so the inline script needs no nonce plumbing.

---

## Architecture

**Single source of truth is the `data-theme` attribute on `<html>`.** CSS never reads `prefers-color-scheme` directly; the media query feeds only the initial JS resolution. This avoids the dual-source bug where CSS says dark (OS preference) while JS says light (explicit user choice).

```
:root                        → light values (default, and the fallback if the attribute is missing)
:root[data-theme='dark']     → dark overrides
:root[data-theme='dark-hc']  → high-contrast-dark overrides
```

Light stays in bare `:root` rather than `[data-theme='light']` so consumers of the published `@batuda/ui` package that set no attribute keep working unchanged.

Each theme block sets `color-scheme` (`light` / `dark` / `dark`) so native scrollbars and form controls follow. Nothing sets this today.

### Preference vs resolved value — two distinct things

The stored **preference** is `light | dark | dark-hc | system`. The `data-theme` attribute always holds a **resolved** value and never `system`. Conflating them is an easy bug: if the pre-paint script wrote its resolved value back into the preference cookie, a `system` user would be silently converted to an explicit choice and could never return to following the OS.

So: cookie `batuda.theme` holds the preference only, and is written only by an explicit user choice.

1. `beforeLoad` reads `batuda.theme` — SSR from the cookie header, client from `document.cookie` — mirroring `readLangCookieFromHeader`.
2. A concrete preference renders straight into `<html data-theme>`. No script involved, no flash.
3. Preference `system` (or no cookie) renders `data-theme="light"` and emits `ScriptOnce`, which reads `matchMedia('(prefers-color-scheme: dark)')` and corrects the attribute before first paint. The preference cookie is **not** touched.
4. `ThemeProvider` reconciles against localStorage on mount, as `LangProvider` does, and — for `system` only — registers a `matchMedia` change listener so flipping the OS theme mid-session takes effect live.

An optional refinement, if step 3's attribute correction proves visible: a second cookie caching the last resolved value, letting SSR pre-render the right theme on repeat visits. Adds a cache-invalidation path, so only take it if measurement justifies it.

### High contrast is a third theme, not a darker dark

`dark-hc` inherits dark's structure and then removes what *is* contrast noise:

- `--texture-brushed-metal: none`
- Gradients flatten to solid fills (metal plates, popup backgrounds)
- `--glow-active` amber halo off; focus becomes a solid high-contrast ring
- `--text-shadow-emboss` / `--text-shadow-engrave` off
- All borders solid and ≥3:1 against their surface
- Text pairings target AAA 7:1 rather than AA 4.5:1

OS forced-colors mode is a **separate, independent axis** — Base UI has zero handling for it, and in that mode the UA overrides our colors regardless of theme. Out of scope; noted so it isn't mistaken for covered.

---

## Slices

One worktree, one PR, one commit per area — the house default. Slice 0 is a decision, not code, and gates everything after it.

### Slice 0 — dark workshop direction (brand-visual.md) — **DONE**

**Decided: work-lamp on unlit metal.** The workshop at night is lit by one lamp, not by daylight. The ground goes near-black warm charcoal; metal desaturates and goes low-key, lit from above-left only; paper dims from cream to ochre. Terracotta and olive stay as the accents — they are what the lamp *lands on*, so they remain the brightest things on screen and keep their brand role.

The light model is the load-bearing part: the source stays above-left, so **bevels keep their direction and only lose contrast**. Inset highlights dim from white toward a warm low-alpha tone rather than flipping to shadow. This is why the existing `--elevation-workshop-*` and `--text-shadow-emboss` structures survive into dark with new values instead of being rebuilt — the geometry is unchanged, only the tone.

Landed as §Dark Workshop in [brand-visual.md](../brand-visual.md): direction, light model, full palette for both `dark` and `dark-hc`, and contrast tables in the same format as the light sections.

**Every ratio is computed, not estimated.** 26 pairings per theme, zero below target — AA for `dark`, AAA for `dark-hc`. The tables were then checked back against their own declared hex values, which caught two bugs in the *checking script* before it passed. One correction to the original plan: `outline-variant` at 1.97:1 on dark is **not** a failure. It is a decorative divider, never the sole carrier of meaning, so WCAG 1.4.11 does not apply — light ships it at 1.51:1. `dark-hc` holds it to 3:1 anyway, reaching 5.24:1.

### Slice 1 — reconcile the existing token system — **DONE**

Before adding themes, make the light theme internally consistent. This slice is entirely about the *current* system and could have shipped on its own value.

The 12 undefined colour tokens were drive-by inventions, not gaps, so each was mapped to the existing token that already meant the same thing — `--color-ink-strong` → `--color-on-surface`, `--color-ink-hairline` → `--color-outline-variant`, `--color-on-metal-muted` → `--color-on-surface-variant`, and so on (16 replacements across two files). `--color-tertiary` was rewritten rather than granted: the two `inboxTone` usages became neutral `--color-on-surface-variant`, honouring brand-visual's two-accent rule. `--shape-3xs` (0.125rem) and `--font-mono` were genuinely missing and got defined; `--font-size-*` mapped to typescale tokens and `--radius-*` to `--shape-*`.

Afterwards the only unresolved `var()` references left in the codebase are Base UI runtime variables (`--anchor-width`, `--transform-origin`, `--active-tab-width` — set by `TabsIndicator.tsx:101`), one locally-set `--card-rotate`, and `var(--space-${…})` template interpolation in the layout primitives. All accounted for.

Fix `--color-on-status` — but not as first diagnosed. Its comment in `batuda-tokens.css` asserted every status tone clears contrast for white text, and computed, five of eight fail badly (meeting 2.15:1, proposal 2.31, closed 2.68, contacted 2.86, prospect 2.92). **That pairing does not exist in the product.** `--color-on-status` is referenced by zero files, and `StatusBadge` uses the tone as a 4px left rule on a metal plate, never as a text background; the nav uses the tones for icon caps and lists for dots, each alongside a visible text label. So the token is dead and its comment is a false claim about a pairing nothing renders — the fix is to delete it, not to repaint the palette.

Auditing the real usages did surface two genuine failures, both text on a low-opacity tint of its own colour:

| Site                                      | Pairing                         | Ratio           | Fix                                      |
| ----------------------------------------- | ------------------------------- | --------------- | ---------------------------------------- |
| `$slug.tsx` `PageStatusBadge` (published) | `status-client` on its 20% tint | 4.19:1          | text → `on-secondary-container` (8.78:1) |
| `$threadId.tsx` `inboxTone` (agent)       | `secondary` on its 14% tint     | 4.26:1 on paper | text → `on-secondary-container` (9.58:1) |

The lesson generalises: a token's comment is not evidence, and a failing ratio means nothing until you confirm something renders that pairing.

Stale values in [brand-visual.md](../brand-visual.md) were reconciled against the code. A systematic diff of every colour token declared in both files found exactly **three** drifted: `--color-primary` documented `#B05220` but shipping `#95400f`, and the `--color-secondary-container` pair. The doc's contrast tables were recomputed for the real values — and the code turns out to be *better* than the doc claimed (primary is 6.13:1 on surface, not the documented 4.54:1). [frontend.md:210](../frontend.md) repeated the stale hex and was fixed too. Drift is now zero, which is what makes Slice 9's script viable.

### Slice 2 — token architecture — **DONE**

The workshop-surface tokens (`--color-paper-*`, `--color-pegboard`, `--color-leather-dark`, `--color-ledger-line-*`, `--shadow-paper-*`) moved from `batuda-tokens.css` to `packages/ui/src/tokens.css`, with the scoping comment rewritten to record the reversal and its reason. Domain tokens (`--color-status-*`) stayed app-local.

The semantic families the literals collapse into were added — `--shadow-color-*`, `--highlight-inset-*`, `--color-scrim` — and `--elevation-workshop-*` / `--shadow-paper-*` were rebuilt on top of them, so a theme retunes four primitives instead of five composite shadows. **This refactor is behaviour-preserving:** all five composite shadows were verified to expand byte-identical to their pre-refactor values. One near-miss caught in the process — the first pass collapsed three distinct shadow alphas (0.12/0.15/0.2) onto two, silently changing `--elevation-workshop-md`; a third rung restored exact fidelity.

The nine MD3 roles that brand-visual documented but code lacked were added as complete pairs. See §Design-system completeness below for why they stayed even though nothing consumes them yet.

### Design-system completeness (decided 2026-07-21)

**The token system is exempt from the minimal-scope rule.** A design system is a product with its own API, not a residue of the current screens; a half-populated scale is worse than an absent one, because the next person cannot tell a deliberate gap from an oversight and reaches for a literal instead.

The practical consequence is that an *unused-token* audit is close to meaningless here — the useful question is what is **missing**. Running that audit found and filled four gaps:

| Gap                                                      | Filled    |
| -------------------------------------------------------- | --------- |
| 12 typescale rows missing `weight` and/or `tracking`     | 18 tokens |
| MD3 roles `--color-shadow`, `--color-surface-tint`       | 2         |
| `--shape-xl` — nothing between `lg` (1.75rem) and `full` | 1         |
| `--elevation-0/1/2/3` — the MD3 tonal ramp               | 4         |

Token count went **167 → 199** across the three token files (183 of them in `tokens.css` itself). All 18 typescale rows are now complete and the MD3 colour set is full (tertiary and fixed accents remain deliberately omitted).

The elevation gap is the notable one: [frontend.md:266](../frontend.md) documents that ramp and four code examples call `var(--elevation-1)`, but it had never been built — those examples referenced nothing. They now resolve.

New values were **derived from how each role actually renders, not from the MD3 defaults**. MD3 puts display and headline at weight 400; Batuda's are 700, because those surfaces route through `stenciledTitle`, which sets `--font-weight-bold`. Copying the spec would have created tokens that contradict the app.

Corollary, also settled: external consumers of the published `@batuda/ui` package are **not** a reason to preserve a token. No backward compatibility — delete freely when a token is stale or incoherent.

### The alpha ladder (decided 2026-07-21)

The literals held **12 distinct black alphas**, split by role: 19 were metal-edge borders (0.08–0.4), 11 drop shadows (0.04–0.35), the rest insets. Collapsing them needed a call, since the same alpha means different things in a border and a shadow.

Chosen: a **semantic ladder per role**, accepting small rounding, over exact preservation. Exactness was achievable — `rgb(0 0 0 / calc(0.35 * var(--shadow-boost)))` with a per-theme multiplier would have been pixel-identical — but that idiom is clever, verbose across ~35 call sites, and opaque to a later reader. The ladder also gives each theme genuine control over depth, which is the point of the exercise.

So the tokenizer matches on the CSS property, not the value: `--color-metal-edge-{soft,muted,,strong}` for borders, `--shadow-color-{subtle,,medium,strong,deep}` for shadows, `--highlight-inset-{faint,soft,,strong,bright}` for top lights. Extending it to `apps/internal` surfaced alphas the original estimate missed (0.1, 0.28, 0.45), so `muted` and `faint` rungs were added to keep every jump small. **Net visual delta is a handful of sites shifting by ≤0.07 alpha** — larger than the ~10 sites first quoted, and the reason the running app was checked by eye rather than trusted from the numbers.

### Slice 3 — tokenize `packages/ui` — **DONE**

All **19** files done; `packages/ui` is at **zero literals**. Library-first, because `apps/internal` composes these and inherits the fixes.

Two findings worth keeping. `pri-dialog.tsx` had `rgba(176, 82, 32, …)` baked into its paper texture — that is the **retired** `#B05220` terracotta, so the dialog was drawing itself in a colour the brand had abandoned. And a second `#1a1612` scrim hid in `pri-tooltip.tsx:55`, which the original plan had missed by looking only at the dialog.

### Slice 4 — tokenize `apps/internal` — **DONE**

**277 → 18 literals.** Everything outside one file is now a token, including [`blueprint-sheet.tsx`](../../apps/internal/src/components/layout/blueprint-sheet.tsx) (26), which needed its own `--color-blueprint-{grid,rule}` family, and [`styles.css`](../../apps/internal/src/styles.css)'s body pegboard.

Three new families were required: a **warning ramp** (`--color-warning`, `-strong`, `--color-on-warning-container`) unifying amber badges across three email surfaces that had been drifting on four different ambers; `--color-board-line` for pegboard ruling; `--color-tape-edge`. The warning ramp and `--color-priority-urgent-glow` are domain concepts and live app-local.

The off-palette drift was folded in as planned — indigo and green in `emails/inboxes.tsx` became neutral and `--color-secondary`. But `#c6664b`, flagged in the original plan as "16 uses needing a token", turned out to be a **dead fallback**: every occurrence was inside `var(--color-error, #c6664b)`, and `--color-error` is always defined, so it never fired. Stripped with zero visual change, along with 23 identical dead `--font-mono` fallbacks.

**The 18 remaining are deliberate.** [`schedule-grid.tsx`](../../apps/internal/src/components/calendar/schedule-grid.tsx) holds a Schedule-X categorical event palette that **already ships its own `lightColors`/`darkColors` pairs**. Forcing brand tokens on it would flatten the category distinctions it exists to draw. It does not need tokenizing — it needs its theme *wired* to `data-theme`, which is Slice 5 work.

### Slice 5 — third-party and content surfaces

Surfaces no token can reach, because the color isn't ours. Each needs an explicit decision.

- **Leaflet map** — [`where-panel-client.client.tsx`](../../apps/internal/src/components/companies/where-panel-client.client.tsx) renders raster OpenStreetMap tiles and imports `leaflet/dist/leaflet.css`. Raster tiles cannot be recolored; this needs a dark tile provider, or a CSS filter as a cheap approximation, plus overrides for Leaflet's own white popups, zoom controls and attribution bar.
- **Sender-authored email HTML** — [`emails/$threadId.tsx:631`](../../apps/internal/src/routes/emails/$threadId.tsx) renders untrusted HTML via `dangerouslySetInnerHTML`. Emails carry their own inline black-on-white. Simplest correct answer is to keep the message body on a forced-light card rather than try to invert arbitrary sender markup.
- **Favicons** — `/favicon.svg` and the PNG set ([`__root.tsx:101-118`](../../apps/internal/src/routes/__root.tsx)) have baked backgrounds and no `prefers-color-scheme` variant.
- **`<meta name="theme-color">`** — absent. `color-scheme` does not drive the mobile address bar; `theme-color` does, and it needs a per-theme value.

### Slice 6 — dark + high-contrast token blocks

Write the two override blocks using Slice 0's palette. Dark reinterprets the workshop shadows and highlights for the new light model; `dark-hc` flattens and strengthens per the rules above.

### Slice 7 — theme plumbing

Mirroring the `lang` files one-for-one:

| New file                                                                     | Mirrors                  |
| ---------------------------------------------------------------------------- | ------------------------ |
| `theme/index.ts` — `ThemeCode`, `isThemeCode`, `defaultTheme`                | `i18n/index.ts`          |
| `theme/cookie.ts` — read/write `batuda.theme`                                | `i18n/cookie.ts`         |
| `theme/detect-theme.ts` — localStorage + `matchMedia`                        | `i18n/detect-lang.ts`    |
| `theme/theme-provider.tsx` — context, `useTheme`, `useSetTheme`, OS listener | `i18n/lang-provider.tsx` |

Plus `__root.tsx`: extend `beforeLoad`/`loader`, render `<html data-theme={theme} suppressHydrationWarning>`, and add `ScriptOnce` for the `system` path.

### Slice 8 — switcher UI

`components/profile/theme-select.tsx` mirroring `language-select.tsx`, beside `<LanguageSelect />` at [settings/profile/index.tsx:177](../../apps/internal/src/routes/settings/profile/index.tsx). Four options: System, Light, Dark, Dark (high contrast). Every string via Lingui macros; `pnpm i18n:extract` and Catalan filled before merge, or the pre-commit hook blocks.

### Slice 9 — contrast verification

Contrast must be **computed, not eyeballed**. A script that parses `tokens.css`, resolves each theme block, and asserts every documented pairing meets its target (AA 4.5:1 light/dark, AAA 7:1 for `dark-hc`, 3:1 for borders and non-text UI). This makes brand-visual.md's hand-maintained tables executable — and, per Slice 1, they must be corrected first or the script fails on light mode.

Plus an e2e test for the round trip: pick a theme → reload → correct `data-theme` server-rendered, no flash.

### Slice 10 — docs

New §Theming in [frontend.md](../frontend.md): token architecture, `data-theme` on `<html>` and *why* (the Base UI portal constraint), SSR resolution, high-contrast rules. Replace the "No dark mode" line at 216.

While in there, fix the verified drift:

- **frontend.md documents the wrong map library.** The §Map section describes `react-map-gl` + MapLibre + `supercluster` with a MapTiler key and a `MAPTILER_KEY` env var. None of those are installed — the app uses `react-leaflet` + `leaflet` with raster OSM tiles. The whole section is fiction.
- **Token usages in code examples that reference nothing.** Originally 24; `var(--elevation-1)` ×4 now resolves because the MD3 ramp was built in Slice 2, leaving 20: `var(--space-4)` ×10, `--space-6` ×2, `--space-1`, `--space-2`, `--space-3`, `var(--shape-medium)` ×4 and `--shape-large` (tokens are `--shape-md`/`--shape-lg`). Line 224 explicitly says the numeric scale "is gone", then thirteen examples keep using it.
- ~~Stale `--color-primary: #B05220` at line 210~~ — fixed in Slice 1.

---

## Verification of Slices 0–4

Static checks: type-checks clean on both packages; Biome reports **0 errors and 20 warnings, byte-identical to the baseline diagnostic list** (confirmed by stashing the changes and re-running, not by assumption).

The app was then run and walked — Pipeline, Companies, Tasks, Emails, Inboxes, Calendar — because the ladder rounding is exactly the kind of change static analysis cannot judge. The workshop language survives intact: pegboard, blueprint grid, masking tape, brushed-metal plates with screw dots, machine buttons, stencilled titles. The drift fixes are visibly correct — CONNECTED renders olive, AI AGENT neutral. Console shows **0 errors on a clean load**, and the hydration/setState errors that accumulate during authenticated navigation are present identically in baseline (they originate in `PagesListPage`).

Two process notes for whoever picks this up:

- **`pnpm install --ignore-scripts` skips the `prepare` hook that builds `packages/ui/dist`.** The web app doesn't care — it resolves `@batuda/ui` through the `development` condition to `src/` — but `apps/server` imports from `dist/` and dies at boot with `ERR_MODULE_NOT_FOUND`. Run `pnpm --filter @batuda/ui build` after provisioning a worktree.
- Do not pipe `pnpm dev` into `tail`; it buffers the whole boot, so a crash reports nothing.

A method note worth carrying into the remaining slices: reading colour off a screenshot produced a false regression report (a badge looked wrong; the source showed the component I had changed was a different one, and the suspect had always been terracotta). Screenshots are for catching what you did not think to check — the source and computed contrast are what settle whether a specific colour is right.

---

## Open questions

None blocking. The next slice (5) needs one call when it starts: whether the Leaflet map gets a dark tile provider or a CSS filter as a cheap approximation.

Settled (Guillem, 2026-07-20 / 07-21):

- Dark direction is **work-lamp on unlit metal** (Slice 0).
- **One PR**, one commit per area.
- **No light high-contrast** — dark and `dark-hc` only.
- **No `@batuda/ui` publish needed.** `apps/internal` consumes it as `"@batuda/ui": "workspace:*"` ([package.json:24](../../apps/internal/package.json)), so the workspace link carries Slices 2–3 straight through. A publish rides the next scheduled release.
- **The design system is exempt from minimal scope** — complete scales, audit for gaps not for unused tokens.
- **No backward compatibility for `@batuda/ui` consumers** — an external consumer is not a reason to keep a token.
- **Alpha ladder over exact preservation**, accepting ≤0.07 alpha shifts on a handful of sites.
- `--color-tertiary` **rewritten, not granted** — the two usages became neutral, honouring the two-accent rule.
