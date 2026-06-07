# Preventing drift in AI-generated code

Background reference for the `/pr` self-review (Step 3) and for setting up repo-wide enforcement.

## The core problem

Vibe-coded changes each look fine *per PR*, but the same decision made slightly differently across many PRs is how an architecture quietly decays. **The deviation is imperceptible day-to-day and only visible mid-term** — so per-PR review structurally cannot catch it on its own. Prevention has to run at three time-scales:

1. **Author-time** — make the right pattern the path of least resistance.
2. **Per-PR** — catch point-in-time deviations (the `/pr` Step 3 self-review).
3. **Mid-term / longitudinal** — catch *accumulated* drift no single diff reveals.

Guiding rule: **demote conventions from "things humans must remember" to "things the machine enforces."** The strongest techniques make drift a build failure, not a judgment call.

## Confirmed live drift in this repo (as of 2026-06-07 — illustrative, will rot)

Real examples found on `origin/main`, to show the failure modes are not hypothetical:

- **Time/date:** raw `new Date()` / `Date.now()` where Effect `DateTime` is the norm — `apps/mail-worker/src/folder-sync.ts:126,145`, `apps/server/src/mcp/tools/calendar.ts:262`, `apps/server/src/services/tasks.ts:399`, `packages/research/src/application/budget.ts:151`. Each sits next to a sibling that *does* use `DateTime.nowUnsafe()`.
- **Doc/vendor lag:** `docs/backend.md:647` still titled "Email service (AgentMail…)" ~5 commits after AgentMail was replaced by BYO IMAP/SMTP; stale AgentMail comments at `docs/backend.md:126,620` and `apps/cli/src/commands/auth-invite.ts:67`; "Cloudflare R2" comment over vendor-neutral `STORAGE_*` vars in `.env.cloud:44`.
- **Doc structural:** `docs/architecture.md` says "three bounded contexts" / 5 packages, but the tree has 8 (`calendar`, `email`, `instructions` undocumented).

Don't maintain this list — regenerate it with the scheduled audit (§6).

---

## Techniques (ranked roughly by leverage)

### 1. Eliminate the chance to drift (author-time)

- **One canonical helper per capability** — a single `DateTime` wrapper, one provider-selector, one error→HTTP mapper, one `slugify`. Re-export from a barrel; "reuse before add" is mandatory. Reinvention is the root of most drift.
- **Golden reference modules + scaffolding** — a "copy this service" exemplar and a generator (`turbo gen` / plop) so a new package/context/route starts from the canonical `domain/application/infrastructure` skeleton, not a blank file. Prevents new packages skipping the layering.
- **Ban the primitive** — make `new Date()` / `Date.now()` unreachable in app code so the wrapper is the only path.

### 2. Convert conventions to executable constraints (per-commit, zero vigilance)

- **Biome lint rules** — `noRestrictedSyntax` for `new Date(`, `Date.now(`, raw `throw`, `console.log`, `as any`; forbid `eslint-disable` (must be `biome-ignore`); `noRestrictedImports` to block cross-context and inner→outer imports.
- **Import-boundary CI** — `dependency-cruiser` (or eslint-plugin-boundaries) encoding the bounded-context graph + layer direction as a build gate: "domain must not import infrastructure," "no package imports another context's package," "apps don't import apps."
- **Type-level enforcement** — lean on Effect's `R` channel (deps must be declared), `strict` + `exactOptionalPropertyTypes`, branded types, `any` banned, Schema at every boundary so wire shapes are types not hopes.
- **Naming as lint** — kebab-case filenames, env-var naming, and a CI check that fails on any `*.spec.*` (must be `*.test.*`).
- **Vendor-name guard** — regex/lint CI banning `AgentMail|AGENTMAIL|R2_|Cloudflare` in `src/**` and identifiers.

### 3. Kill doc drift by generating or testing docs (the AgentMail class)

- **Generate the volatile parts from code** — package list, bounded-context list, route table, DB-table list, env-var table, MCP tool list — emitted into the docs by a script; `docs:check` in CI fails if committed docs differ. Doc drift becomes structurally impossible.
- **Doc tests** — assert every `packages/*` appears in `architecture.md`; assert no banned vendor strings in docs; assert `.env.example` matches the `Config` schema.
- Keep prose thin (the "why"); push specifics to generated tables (the "what").

### 4. Effect-way drift prevention

- **Read the vendored source** `docs/repos/effect` before inventing an API; document the canonical idioms + a golden module.
- **Typed errors only** — `Schema.TaggedError` / `Data.TaggedError`; lint-ban raw `throw` and rejected `Promise` inside Effect code; never `any` in the `E` channel.
- **Layer discipline** — every provider goes through the one `Layer.unwrap + Config.schema` selector; ban `Effect.runPromise` / `runSync` outside the app composition root via import rule; services constructed one way (`Effect.Service` / `Context.Tag`).
- **Schema at boundaries** (HTTP, MCP, DB rows, env) — decode once, trust types after; kills the snake/camel-case class of bug.
- **Effect lint** — `@effect/eslint-plugin` or a small Biome rule set for floating Effects / yield misuse; one-style rule (`Effect.gen` vs pipe per layer) to curb stylistic drift.

### 5. Tests that survive future change (the "BDD throws errors later" problem)

Root cause: tests coupled to *implementation* break on legitimate change. Couple them to *behavior* instead.

- **Assert observable outcomes through the public API only** — roles/text not DOM internals; service return values not "was this mock called."
- **Centralize fixtures in builders/factories** (one `makeCompany()`). A model change updates the builder, not 100 tests — the single biggest reducer of "future change throws errors everywhere."
- **Guard wire-shapes with ONE contract/schema test**, so an intentional shape change fails one obvious place, not scattered units.
- **Group tests with their logic in the same commit** — behavior changes are deliberate; a later failure means *either* a real regression *or* an un-updated test, and the GIVEN/WHEN/THEN comments tell future-you which.
- **Minimal specificity** — assert the least that proves the behavior; avoid broad snapshots (scope + review if used).
- **Quarantine, don't rot** — a legitimately-changed test gets rewritten, never `.skip`'d; track `.skip` / `.only` / `.todo` as a ratchet.
- **Mutation testing (Stryker)** on critical modules — proves the tests actually catch regressions.
- For volatile areas, prefer a few integration/characterization tests over many implementation-coupled units.

### 6. Longitudinal controls (what per-PR review structurally cannot see)

- **Ratchets / fitness functions that can only improve** — baseline today's counts (`any`, raw `Date`, `@ts-expect-error`, `.skip`, untested packages, undocumented packages); CI fails if any rises. Drift literally cannot accumulate.
- **Trend metrics** — commit those counts as JSON over time; mid-term drift becomes a visible line going up.
- **Scheduled repo-wide drift audit** — the `/pr` Step 3 checklist run across the *whole tree* on a cron (via `/schedule` or CI), reporting the trend, not a diff. This is the missing half of per-PR review.
- **Architecture tests in CI** — dependency-graph assertions, "every package has domain/application/infrastructure," "every RLS table has a policy," "every context appears in architecture.md."
- **ADRs** — any intentional direction change is a recorded decision; the self-review asks "does this diverge from architecture.md / an ADR? if so, where's the new ADR?" — the line between *drift* (accidental) and *evolution* (decided).

### 7. AI-specific guardrails

- **AGENTS.md / CLAUDE.md kept in lockstep with the lint rules** — never state a rule you don't enforce, never enforce one you don't state.
- **`/pr` Step 3 = per-PR; the scheduled audit (§6) = mid-term** — you need both.
- **Golden examples linked from AGENTS.md** so the model imitates the right thing; small single-purpose PRs so drift can't hide in noise.

---

## Highest-leverage starter set

If only five things get built:

1. **Lint-ban the primitives** (`new Date`, `throw`, `any`, vendor names, `eslint-disable`) → turns the date + vendor findings into build failures.
2. **Import-boundary CI** (dependency-cruiser) for the context/layer graph.
3. **Generate doc tables + `docs:check`** → kills the AgentMail class permanently.
4. **Fixture builders + behavior-only tests + a `.skip`/`any` ratchet** → fixes brittle BDD.
5. **Scheduled drift audit + ratchet metrics** → makes mid-term drift visible and non-accumulating.

Items 1–4 are cheap, one-time, and prevent recurrence; #5 is the longitudinal backstop.
