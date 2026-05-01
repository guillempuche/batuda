---
name: plan-audit
description: Audits a multi-day, multi-slice plan for big-picture coherence and silent drift. Spawns adversarial agents that argue against each other to surface defects that survive scrutiny — combats hallucinated findings (false positives) and missed issues (false negatives) by structured disagreement, not parallel agreement. Use between slices of a long plan, before starting the next slice, or when context has been compacted and the original purpose feels distant.
---

# Plan Audit (Adversarial)

The defect that needs fighting is not "I missed something." It is **agreement-by-hallucination**: parallel auditors that all say the same plausible-sounding thing because they all reached for the same training prior. The fix is structured disagreement — one agent claims the work is sound, another tries to break it, a third judges. Findings that survive challenge are real; findings that collapse under counter-argument were noise.

This skill is for plans that span days, multiple slices, multiple commits — long enough that the original purpose drifts and individual slices may have stopped considering the whole.

## When to invoke

- Between slices of a multi-slice plan, before starting the next.
- After context compaction, when the original plan feels far away.
- After a long autonomous run, before declaring "done."
- When a slice was implemented in a single session but touched a lot of files and the implementer (you) wants a second opinion.

Don't invoke for: small isolated changes, a single bug fix, or anything that fits in one sitting.

## Inputs you'll need

Before running, gather these so the agents don't have to dig for them:

1. **The plan file** — the original markdown that defined the slices and intent. Usually in `~/.claude/plans/` or `/Users/<name>/.claude/plans/`. If lost, summarize from `git log` and the user's notes.
2. **The scope** — which slices/commits the audit covers. The slice numbers, the commit hashes (`git log --oneline <range>`), the files touched (`git diff --stat <base>..HEAD`).
3. **The current state** — does check-types pass? do tests pass? is the dev stack runnable? Note any known-broken state so agents don't waste cycles on it.
4. **The project's `docs/` folder.** Run `ls docs/` and identify which files are canonical for the surfaces this plan touched. Hand the relevant file paths to the matching prosecutor — they enforce *project rules*, not the agent's training prior. Common references in this repo:

   | Surface touched                        | Required reading                                |
   | -------------------------------------- | ----------------------------------------------- |
   | Backend services / packages / routes   | `docs/architecture.md` (bounded contexts, deps) |
   | Frontend routes / components / styling | `docs/frontend.md` + `docs/brand-visual.md`     |
   | Backend implementation details         | `docs/backend.md` (when present)                |
   | Brand voice in any user-facing copy    | `docs/brand-voice.md`                           |

   If a doc you'd expect doesn't exist, note it as a finding ("plan touched X but the project has no canonical doc for X"); do not invent rules from priors.

## Agent count — pick by plan size

The number of adversarial pairs scales with plan size. More agents = more disagreement = more hallucination filtering, but also more cost and more synthesis effort for the caller. Pick the smallest count that gives meaningful disagreement.

| Plan size                          | Agents to spawn | Pair shape                                                                                                        |
| ---------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1–2 slices, ≤5 commits, ≤1 day     | 3               | 1 prosecutor + 1 defender + 1 judge                                                                               |
| 3–4 slices, 5–15 commits, 1–3 days | 5               | 2 prosecutors (different angles) + 1 defender + 1 critic-of-defender + 1 judge                                    |
| 5+ slices, 15+ commits, multi-day  | 7               | 3 prosecutors (security / arch / UX) + 2 defenders (one per most-damning prosecutor) + 1 cross-examiner + 1 judge |

If unsure, default to 5. Below 3 is parallel monologue, not debate. Above 7 is diminishing returns and the synthesis step gets unwieldy.

## The protocol

### Phase 1 — Prosecutors

Spawn the prosecutor agents in parallel (single message, multiple Agent tool calls). Each gets a different angle and a list of *required reading* — usually the plan file plus the project doc(s) that define the rules for the surface they're auditing. Hand the file paths to the agent in the prompt; don't expect them to find the right docs alone.

Standard prosecutor angles:

- **Security & correctness** — "find every silent-failure path, injection vector, brittle pattern, race condition, and authorization gap. Include file:line citations." Required reading: the plan, plus any security-relevant doc the project owns.
- **Architecture & coherence** — "list every deviation from the original plan and every architectural smell that will compound when the next slice lands. Cite the plan section AND the project's architecture doc when the divergence breaks a documented rule (bounded-context boundaries, dependency direction, logic-in-the-correct-package, error mapping at the edge)." Required reading: the plan + `docs/architecture.md` (when present). Cite both: "plan §X said Y, `docs/architecture.md` § Bounded contexts says Z, file F violates both."
- **User journey & UX** — "walk every scenario end-to-end as if you were the user. List every place the experience breaks, confuses, or silently lies." Include only when the plan has user-facing surfaces.
- **Visual coherence & token discipline (frontend only)** — "audit every new/changed UI surface against the project's visual rules: tokens not hardcoded values, styled-components for visuals + Tailwind for layout split, `Pri` prefix for BaseUI primitives, the workshop metaphor (brushed-metal plates, stencil outlines, screw dots, ruler edges, etc.) carried through, and brand voice in every user-facing string. Flag every divergence with file:line." Required reading: the plan + `docs/frontend.md` + `docs/brand-visual.md` + (when copy is involved) `docs/brand-voice.md`. Spawn this only when the plan touches `apps/internal/`, `packages/ui/`, or any tenant marketing surface.
- **Plan drift over time** (only useful for ≥3-slice plans) — "compare the plan to what landed across the slice range. List: tests the plan promised but the slices skipped; files touched outside the stated slice scope; open questions in the plan that were silently resolved or ignored; ghost markers (`// TODO: handle in slice N`) that point at slices already shipped; doc statements (`docs/architecture.md`, `docs/frontend.md`) that the slices contradict." Required reading: the plan + `git log --stat <range>` + the canonical project docs.
- **Cross-cutting invariants** — "verify each invariant holds across every slice in scope. Flag the first file:line where it breaks." The invariants are project-defined: every DB-touching path sets `app.current_org_id` (or explicitly opts into `app_service`); every new user-facing string is wrapped + extracted + has a translation per locale; no bare `catch {}` swallowing errors; logs and error messages don't leak secrets, tokens, or PII; new env vars follow the project's vendor-neutral / explicit-opt-in convention. Required reading: the plan + the project's memory/feedback notes when surfaced (`feedback_*.md`).
- **Schema / data hygiene** (only when slices touch migrations or DB schema) — "audit the migration(s) for: single-initial-migration policy compliance; `ENABLE / FORCE ROW LEVEL SECURITY` plus an org policy on every new org-scoped table; indexes covering every new `WHERE` clause introduced by the slices' service code; `FK ON DELETE` actions matching the domain invariant (we got bitten by `member.primary_inbox_id` cascade behaviour)." Required reading: the migration file + the services' new query sites.
- **Test quality** — "audit the test files added by the slices, not just the count. Flag: tests that pass but assert nothing meaningful (`toBeTruthy` on a constant; `expect(value).not.toBe(null)` with no other check); tests that mock the system under test instead of its collaborators; tests that depend on order or shared state; service orchestrators that landed without both unit and integration files; e2e specs that stopped at form submission instead of asserting the downstream side effect." Project rule: BDD shape (`describe → context → it('should…')` with GIVEN/WHEN/THEN comments) per the `/test-bdd` skill. Required reading: the new tests + the `/test-bdd` skill conventions.
- **e2e through the UI as a backend-flow probe** — "list every backend flow the slice changed (route handler, service method, side-effect chain) that does NOT have a corresponding UI-driven Playwright spec exercising it end-to-end. UI-driven e2e is the cheapest way to prove the cookie/RLS/auth/middleware/server-handler/DB chain holds together; landing a backend slice without one means the wiring is unverified." Required reading: the plan's "test plan" sections + `apps/internal/tests/e2e/`.
- **Security beyond XSS** — "audit for: open redirects in callbackURL / returnTo paths (must be allow-listed against trusted origins); CSRF on state-changing routes (same-site cookie + Origin check or token); cookie flags on new cookies (`httpOnly`, `secure`, `sameSite`); rate limits on every new public endpoint; path traversal in any handler that resolves a filesystem path from user input; permission checks at the right layer (domain vs handler-only)." Required reading: the slices' new routes + `docs/architecture.md` § Authentication.
- **API contract drift** (server slices) — "verify every new route is added to the `packages/controllers` HttpApi spec (not only to the server handler), domain errors map to HTTP errors at the edge per `docs/architecture.md`, status codes are consistent (4xx with body vs 200 with `{error}`), and idempotency / pagination shape match existing list endpoints." Required reading: `packages/controllers/src/routes/*.ts` + the new handler files.
- **A11y / focus / keyboard (frontend slices)** — "audit new interactive surfaces: ARIA labels on every interactive element, keyboard navigation (Tab order, Esc closes, Enter submits), focus trap on dialogs/popovers, focus return on close, color contrast preserved against `docs/brand-visual.md`'s WCAG ratios."
- **Other angles** — if the plan touches a domain with its own doc (e.g. `docs/backend.md` for server internals, a tenant-specific brief), spin a dedicated prosecutor for that doc. Don't fold doc-specific rules into a generic angle; the prosecutor needs the doc in its hands or it falls back on priors.

Each prosecutor must produce a **ranked finding list** — not paragraphs of prose, not generic "consider X" — with the most ship-blocking finding first and a hard cap (e.g. "under 300 words" or "top 8 findings"). The cap forces compression and surfaces what they think is *most* important. Every finding must cite both the offending file:line AND the rule it breaks (plan section or doc section). Findings without a rule citation are speculative and dropped at synthesis.

### Phase 2 — Defenders

Take the top findings from Phase 1 (5–10 items, deduplicated across prosecutors). Spawn defender agents that **argue each finding is wrong, overstated, or already mitigated**. The defender's brief is explicit:

> "For each of the following findings, argue against the prosecutor. If the finding is correct, say so plainly — but for each one you concede, explain *why the prosecutor's evidence was specifically convincing* (not just 'looks bad'). For each one you reject, point at the specific code, test, or comment that contradicts the prosecutor's claim."

Defenders must read the actual files and tests. Defenders that argue from priors instead of code are recapitulating the hallucination problem.

### Phase 3 — Cross-examiner (5+ agent runs only)

Take the defender's rebuttals. Spawn one **cross-examiner** that reads each rebuttal and flags any that:

- argue from training-prior reasoning instead of code citations,
- concede a finding without explaining why,
- claim "tests cover this" without naming the test file/line,
- shift goalposts (defending against a different finding than the one raised).

The cross-examiner's output is a **trust score** per rebuttal: solid / hand-wavy / refuted. Only solid rebuttals defang the original finding.

### Phase 4 — Judge / synthesis

The caller (you) reads:

- the prosecutors' findings,
- the defenders' rebuttals,
- the cross-examiner's trust scores (if Phase 3 ran).

Then writes a **decision table** keyed to each original finding:

| Finding                     | Prosecutor said       | Defender said                                     | Cross-examiner said                | Verdict                          |
| --------------------------- | --------------------- | ------------------------------------------------- | ---------------------------------- | -------------------------------- |
| HTML XSS in `resend-…ts:56` | Real, ship-blocker    | Email clients don't run JS                        | Defender wrong: anchors+img render | **Confirmed — fix now**          |
| Race in accept page         | Two tabs accept twice | sessionStorage lock at `…tsx:53`                  | Lock isn't there, hand-waving      | **Confirmed — defer to slice 6** |
| `authHandle` forward-ref    | Will break            | Assignment is sync; runtime guard belt+suspenders | Solid: the guard is dead code      | **Dismissed**                    |

Verdict is one of: **Confirmed-ship-blocker**, **Confirmed-defer**, **Dismissed**, **Undecided** (when defender and cross-examiner couldn't reach a verdict — these need human-judgment from the user).

Present the table to the user and let them pick what to fix vs defer.

## Hallucination defenses baked in

- **Compression caps** force prosecutors to surface what they think is most important, not the longest list.
- **Adversarial structure** — defender's job is to disagree — surfaces priors masquerading as findings. A finding that survives "argue this is wrong" is one the defender couldn't refute from code.
- **Citation requirement** — every finding and every rebuttal must point at file:line. Findings without citations are dropped at synthesis.
- **Cross-examiner** catches the meta-failure where the defender hallucinates a defense (e.g. claims a test exists that doesn't). Skip on small plans where the cost outweighs the benefit.
- **Judge is the human**, not another agent — the caller writes the verdict table because the buck has to stop somewhere a model can be questioned about its judgment.

## Anti-patterns to avoid

- **Spawning 3 parallel "audit X" agents and trusting their consensus.** That's parallel hallucination; consensus among models with the same training prior is not evidence.
- **Asking one agent to "play both sides."** A single agent generating prosecution + defense smooths over the disagreement that's the whole point.
- **Skipping Phase 2.** Without defenders, every prosecutor finding looks legitimate. Defenders are the filter.
- **Letting the agents do the synthesis.** They will weight the findings by their own priors. The caller does the synthesis.
- **Padding agent prompts with "be thorough" / "consider edge cases."** Prosecutors stay sharp when they're forced to compress; defenders stay honest when they're forced to cite. Wide prompts produce slop.

## Test conventions the prosecutor enforces

Two project rules anchor every test-quality and e2e-through-UI finding — the prosecutor cites them by name:

- **`/test-bdd` skill conventions.** Vitest + Playwright tests follow the `describe → context → it('should…')` shape with explicit GIVEN/WHEN/THEN body comments and file:line annotations. Findings should compare the test file against this convention, not the agent's prior of what "good tests" look like.
- **e2e through the UI as a backend-flow probe.** Playwright specs that drive the web UI are the project's preferred way to prove the full chain (cookie → middleware → handler → service → DB → side effects) holds together. A backend slice that lands without a UI-driven e2e exercising its happy path has unverified wiring — flag every backend route or service mutation that isn't reachable from a UI test.

## Hygiene is a separate concern

This skill is about adversarial truth-finding, not polish. Don't bolt readability passes onto the protocol — that dilutes the verdict table with churn at the worst moment (the user has just decided what to fix and what to defer). If the slice range looks like it could use a hygiene sweep separately, the `readability-improver:readability-improver` agent is a fine tool to invoke afterward, scoped to the files the range touched. Keep it a deliberate, separate decision.

## Output

The skill itself emits:

1. The agent count + role assignment chosen for this plan.
2. The Agent-tool calls (single message, parallel) to spawn Phase 1.
3. After Phase 1 returns, the next message: deduped findings + Phase 2 prompts.
4. After Phase 2 returns, optionally Phase 3 (5+ agents).
5. The decision table for the user.

Always end by asking the user which Confirmed findings to fix now vs defer to a follow-up.
