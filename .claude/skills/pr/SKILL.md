---
name: pr
description: This skill should be used when the user asks to "open a PR", "create a pull request", "raise a PR", "PR this", or "send it for review" — turning a finished change (usually already committed on a local branch) into a reviewable, mergeable pull request. Drives the full Batuda PR lifecycle — re-baseline on main, verify end-to-end (with screenshots/recording for UI changes), self-review for pattern drift and AI-code smells, commit via /commits when there are new changes, run the verification gates, write an architecture-aware PR body in the house style, work the review loop (watch CI, address comments), and merge by rebase or squash. Stops at merge into `main`; deploying a merged change to production is `/release`.
allowed-tools: Bash(git:*) Bash(gh:*) Bash(pnpm:*) Bash(agent-browser:*) Bash(curl:*) Bash(mktemp:*) Bash(cp:*) Bash(mkdir:*) Read AskUserQuestion
---

# Pull Request Workflow

Takes a finished change and turns it into a reviewed, mergeable pull request, following this repo's conventions. **By the time this runs the work is usually already committed on a local feature branch**, so the default path is review → verify → push → PR → review-loop → merge; the readability and commit steps (4–5) fire only when there are *new* changes to make (self-review fixes or review follow-ups). The uncommitted case is handled too.

Work from a feature branch — ideally a worktree off `main` — and never commit on `main`. The steps are sequential gates; don't merge or hand off the PR until every one is green.

## Step 1 — Re-baseline on main

The user (solo founder) merges PRs in parallel, so the branch base drifts during a session. Before doing anything, re-fetch and confirm the branch sits on current `origin/main`.

```bash
git branch --show-current               # must be a feature branch, not main
git fetch origin main
git log HEAD..origin/main --oneline      # what landed under you since you branched
```

If `origin/main` moved, rebase the feature branch onto it before continuing:

```bash
git rebase origin/main
```

Re-read the actual files in the touched area afterward — don't trust an earlier read or a subagent's generalization.

Then take stock — the rest of the flow branches on this:

```bash
git status --short                       # uncommitted changes? (usually none — already committed)
git log --oneline origin/main..HEAD      # the commits that will form the PR
gh pr view --json number,state,isDraft 2>/dev/null || echo "no PR yet"
```

- **Already committed (common):** Steps 2–3 review the whole branch; Steps 4–5 fire only if you make fixes.
- **Uncommitted (rarer):** the full readability → `/commits` flow (Steps 4–5) applies before the gates.
- **PR already exists:** you'll update it, not open a duplicate (Step 7).

## Step 2 — Verify end-to-end (do not skip)

Type-checks and unit tests are **not** enough — they have passed on changes that produced wrong behavior at runtime. Run the changed path against the live local stack and confirm the user-visible behavior. If the stack is unhealthy, run `/debug-apps` first.

- **CLI** — run the actual command (`pnpm cli seed`, `pnpm cli doctor`, …) and inspect output / DB state.
- **Server** — hit the endpoint (curl or via the running app), check the response and `apps/server/server.log`.
- **UI** — drive the page and confirm the rendered state (see below).
- **Seed** — `pnpm cli db reset && pnpm cli seed`, verify row counts, then drive the page.

### UI changes — capture screenshots / recording (required for UI PRs)

When the change touches the web UI (`apps/internal`, `packages/ui`), attach visual proof so the reviewer sees it without running the branch. Drive the app with `agent-browser` — full command reference in `.claude/skills/debug-apps/references/agent-browser.md`. First make sure the stack is up and seeded (`/debug-apps`; `pnpm cli seed --preset minimal`) and log in if the route is gated.

**Default to capturing — screenshots are on by default for every UI PR; capture them without asking.** The only case where skipping is even on the table is a change whose visual result is self-evident from the diff alone — a token value, a one-word copy edit, a renamed label — something any human understands by reading the code. Even then, don't decide for the user: **`AskUserQuestion`** whether to capture or skip, and follow their answer. Never skip silently. "The stack is slow to start" is not a reason to skip; if it genuinely won't come up, surface that and ask rather than burying a note in the PR body.

**Screenshot, recording, or both — pick by what changed:**

- **Screenshot** — a *state*: new/changed layout, copy, color, a field, an empty / loading / error state. One still per distinct state. This is the default; prefer it when a single frame tells the story.
- **Concise recording** — *behavior over time*: a multi-step flow, navigation, a modal/sheet open-close, an animation or transition, an optimistic update, a loading→loaded sequence. Keep it short — set up state **before** `record start`, then perform only the steps that demonstrate the change, then `record stop`. A few seconds, not a whole session.
- **Both** — when a flow is worth recording *and* it ends on a state worth a quick-scan still (record the flow, plus a screenshot of the final screen).

**Which screen sizes — `apps/internal` is mobile-first:**

- **Both small + big** whenever the change is responsive or layout-affecting: navigation (mobile bottom-nav vs desktop sidebar), grids/tables, modal vs bottom-sheet, or anything gated on a breakpoint / `use-media-query`. The two layouts differ, so one screenshot hides half the change.
- **One viewport** is enough for a size-agnostic change (a copy fix, a shared component with no layout shift) or a surface that exists only at one size. State which you captured and why.
- Mobile (small): `agent-browser set device "iPhone 16 Pro"` (or `set viewport 375 812`). Desktop (big): `agent-browser set viewport 1440 900`.

**Screenshots:**

```bash
agent-browser set viewport 1440 900                    # big (desktop)
agent-browser open https://batuda.localhost/<route>
agent-browser screenshot /tmp/pr-<feature>-desktop.png
agent-browser set device "iPhone 16 Pro"               # small (mobile)
agent-browser open https://batuda.localhost/<route>
agent-browser screenshot /tmp/pr-<feature>-mobile.png
```

**Recording** (native WebM — the uploader transcodes it to a compact MP4, so capture stays simple; preserves login state when started from the current page — see vercel-labs/agent-browser#116). Record at the viewport that matters, and keep it tight — set up state *before* `record start`, then perform only the steps that show the change; record both sizes only if the flow itself differs by size:

```bash
agent-browser set device "iPhone 16 Pro"               # or: set viewport 1440 900
agent-browser open https://batuda.localhost/<route>    # log in / set up state first
agent-browser record start /tmp/pr-<feature>.webm
# ... perform only the steps that show the change ...
agent-browser record stop
```

Then embed them in the PR body (Step 7 → *Embedding media*).

Also confirm for UI work: every new user-facing string in `apps/internal` is wrapped in Lingui macros, and `pnpm --filter @batuda/internal i18n:extract` has been run.

## Step 3 — Self-review: review-readiness gate

The reviewer's time is for judgment calls, not for catching what a careful self-read or the repo's own tooling would. Review your own diff against the repo's standards and fix what you find — so the PR that reaches the human is already pattern-conformant, on-direction, and free of AI-code smells. Review the **whole branch**, since the work is usually already committed: `git diff origin/main...HEAD` (plus `git diff` for any uncommitted work). Scale the depth to the change. Anything you fix here goes through Steps 4–5; if the branch is already clean, this is just the review.

**Always (every PR) — self-read the diff against this checklist:**

- **Reuse, not reinvent** — did I add a service / helper / type / component that already exists? Search before adding; AI code tends to recreate what's already there.
- **Pattern conformance** — does the diff match the repo's documented patterns? Read the relevant section, don't guess: `AGENTS.md` (§ Modifying code — file naming, env var naming, backend/frontend rules, schema changes), `docs/backend.md` (Effect v4 layers, bounded contexts, tagged errors, boot-time provider selection), `docs/frontend.md` (component naming, BaseUI, breakpoints, styled-components).
- **No directional drift** — does this quietly bend the architecture (a new ad-hoc layer, a cross-context dependency, an inner layer naming an outer one, RLS sidestepped "just here")? If it diverges from `docs/architecture.md`, that's a decision to **surface** in the `## Review guide`, not bury.
- **Scope discipline** — every hunk serves this PR's one purpose. No drive-by reformatting, unrelated renames, or tangential edits. If something unrelated must ride along, call it out explicitly (PR #67 had to).
- **AI-code smells** — no leftover `TODO` / `console.log` / commented-out blocks; no `any` or `@ts-expect-error` (narrow from `unknown`); no over-abstraction; no refactoring-narration or plan-label comments (describe current behavior in plain language).
- **Tests test behavior** — assert observable outcomes through the public API, not implementation details; cover branches, guards, and edge cases, not just the happy path (`/test-bdd` shape).

**Escalate to the repo's review tooling by risk — fix findings before opening the PR:**

- **Substantive logic change** → run `/code-review` on the diff for correctness bugs.
- **Sensitive surface** (auth, RLS / `organization_id` scoping, a parser/sanitizer, crypto, file upload, a webhook or other external input) → run `/security-review`. Also run `snyk_code_scan` on the new code if the Snyk tool is available (global security policy); if it isn't, note that in the `## Review guide`.
- **UI change** (`apps/internal`, `packages/ui`) → run the `a11y-accessibility-reviewer:a11y-accessibility-reviewer` agent on the changed components.
- **Trivial diff** (typo, copy, dep bump, comment) → the self-read checklist alone is enough; skip the tooling.

Fix what these surface, then re-verify (Step 2) and re-read the checklist on the fix. Carry anything you couldn't resolve into the PR's `## Review guide` rather than leaving it silent.

**Drift is bigger than one PR.** This step catches point-in-time deviations; *mid-term* architectural drift — the same small deviation repeated across many PRs — is invisible at diff granularity, so a per-PR gate can't catch it alone. For the full prevention catalog (enforcement-as-code via lint / import-boundary CI, generated docs, Effect-way drift, tests that survive change, and the scheduled repo-wide audit that complements this per-PR check), see [`references/drift-prevention.md`](references/drift-prevention.md).

## Step 4 — Readability pass (only when committing new changes)

Steps 4–5 fire **only if there are uncommitted changes to land** — the original work in the uncommitted case, or fixes from Steps 2–3 (or, later, review). If the branch is already fully committed and self-review found nothing, skip to Step 6.

When there are changes: before staging, run the `readability-improver:readability-improver` agent on the files you're about to commit. It is selective and skips self-documenting code, so the cost is low. Skip only for trivial commits (single-line typo, dependency bump, rename with no body change). Re-run type-check after it edits.

## Step 5 — Commit via the /commits skill (when there are changes)

Same condition as Step 4 — only when there's something uncommitted to land.

- Stage one logical group at a time (`git add <paths>`). **Tests ride in the same commit as the logic they cover** — never a separate logic/test split. A standalone `test:` commit is fine only when no logic changed.
- Call `Skill(skill="commits")` to draft and validate the message(s); use the validated preview verbatim. Never hand-roll a message and skip the skill.
- **Before each `git commit`**, give a plain-English explanation of what is about to land and why (which files, what the diff does, any risk), then **wait for the user's OK**. Applies to every commit, one at a time — don't batch "here are the next three, OK?".
- Commit shape: **one PR per slice with focused commits**; or, when a multi-slice plan chose it, **one shared worktree + one PR + one commit per area**. Never split a slice across PRs.
- **No AI attribution** anywhere — no "Generated with Claude Code", no "Co-Authored-By".

## Step 6 — Verification gates (all four must pass before opening the PR)

Run order: `install` → (`check-types` + `test` in parallel) → `build`.

```bash
pnpm install                              # clean lockfile, no unintended pnpm-lock.yaml drift
pnpm -w check-types                       # run concurrently with the next line
pnpm -w test                              # both must exit 0
pnpm -w build                             # last — catches dev-only paths
```

A green `test` with a broken `build` has shipped before: dev-server-only paths (Vite SSR chunking, Lingui catalog compile, TanStack Start bundle) only execute in `build`. Fix and re-run until all four are green — don't assume CI will catch it.

## Step 7 — Push and open (or update) the PR

Push the branch, then **create or update** — never open a duplicate:

```bash
git push -u origin <branch>
gh pr view --json number,state,isDraft 2>/dev/null \
  && echo "PR exists → the push updated it; refresh the body if scope grew (Step 8)" \
  || gh pr create --base main --title "type(scope): subject" --body-file <file>   # add --draft only for nameable WIP
```

- **Open ready for review by default.** A committed, self-reviewed, verified change is finished — reserve `--draft` for work you can *name* as unfinished (a partial slice, a known-broken intermediate, something opened early for direction). CI status shows on the PR either way; protect the reviewer by working CI to green and only merging or handing off when it passes (Step 8), not by parking finished work in draft.
- **If you're unsure about anything in the PR, ask the user.** A judgment call you can't settle, a path you couldn't verify, an ambiguity in scope — raise it as a question rather than guessing or burying it in the body.
- The title mirrors the lead commit's subject (same type/scope rules as `/commits`).
- **Stacked PR:** if this branch depends on another unmerged branch, set `--base <dep-branch>` (not `main`) so the diff shows only this slice; re-target to `main` after the dependency merges. **CI only runs on main-targeting PRs** (`ci.yml` is `pull_request: branches: [main]`), so a stacked PR gets *no checks* until it's retargeted — and a base change alone won't fire them, so push a fresh commit (empty or amended) to trigger the run.

### PR body — house style

The reviewer is one person (the solo founder), reading on a phone between other work. The diff already shows *what code changed* — the PR text exists to carry **what the diff can't show**: the intent, and the blast radius across this architecture (`docs/architecture.md`). Every line should answer "what does the reviewer need to know that reading the diff wouldn't tell them?" Cut anything that just narrates the diff.

Match recent PRs (`gh pr view 67 --json body`, `gh pr view 64 --json body`). Include only the sections that apply, in this order:

- `## What` — one paragraph: what the change does and **why**. Name the bounded context / surface it lives in (CRM / Auth / Research; `server` / `internal` / `cli` / `mail-worker` / `ui`) so the reviewer knows where to stand.
- `## Changes` (or `## The fix` for a bug) — the substantive changes as bullets describing **intent**, not file lists. The diff already shows the files.
- `## Impact` — the blast radius (see checklist below). The single most valuable section for this codebase, because the surfaces are decoupled and the diff doesn't reveal the ripple. Omit only if genuinely none apply.
- `## Review guide` — how to review this fast: where to look first, the riskiest part and why, any decision I made that you might overrule, and anything I couldn't fully verify (e.g. Snyk unavailable). Mark generated or mechanical parts as skip-able. This is where the self-review (Step 3) surfaces what it couldn't resolve.
- `## Screenshots` / `## Demo` — **mandatory for UI PRs**: embed the media, or — only for a self-evident change the user approved skipping — one line `> Screenshots skipped (approved): <reason>`. Neither present = an incomplete PR; there is no silent third option. (Embedding below.)
- `## Tests` — what's covered (unit / integration), when notable.
- `## Verification` — only what you **actually ran** (verify-before-assert): the gates you executed (`check-types` / `test` / `build`) and the live-stack or UI check you actually performed. Never write "all tests pass" you didn't run — an unverified claim here is worse than saying nothing.
- `## Deferred` — follow-ups intentionally not in this PR.

Voice: first-person singular ("I"), never "we". No AI attribution.

### The important text — blast radius to surface (architecture-aware)

These are the things a human reviewer of *this* system must act on or verify and **cannot infer from the diff**. Call out every one that the change touches — usually in `## Impact`, or inline where it fits:

- **Migration / schema change** — the deploy does **not** run migrations; new server code on an unmigrated schema crashes on boot (see `/release`). State which migration must run, and that it must be applied **before** the server tag. Flag any destructive/irreversible step.
- **Multi-org / RLS** — any change to tenant isolation, an `organization_id` scope, an RLS policy, or which Postgres role (`app_user` / `app_service` / `app_mcp_resolver`) a path runs under. This is a security boundary; say what now sees what.
- **MCP + HTTP parity** — services are shared between the two transports. If a service changed, state whether **both** surfaces get the behavior (and, if not, why).
- **API / wire-shape contract** — `packages/controllers` and `packages/domain` are consumed by both server and `apps/internal`'s typed client; a shape change ripples to the frontend. Note new/removed/renamed fields. (Pre-prod: clean breaks over shims — say if data must be recreated.)
- **New env vars** — provider/feature selection is boot-time, explicit, and required (no `auto`/NODE_ENV fallback). List every new var and that production must set it, or the server fails to boot.
- **Auth / route protection** — changes to the public/protected boundary, API-key attribution, OAuth/DCR, or session resolution.
- **Cross-app / CORS / deploy coupling** — touching `ALLOWED_ORIGINS`, the tenant allow-list, the `internal` → `api.batuda.co` forwarding, or anything that needs a coordinated deploy of more than one target.
- **Webhooks / fan-out / cost** — new webhook events, research fan-out concurrency, or paid-provider spend behavior.

If a change touches none of these, say so briefly rather than leaving the reviewer guessing.

### Embedding media

Media goes **with the PR** — never on a side branch. Two paths:

**Automated (agent, no human) — the shared media bucket.** `scripts/gh-pr-media.sh <pr#> <file>…` syncs each capture to the team's public `github-media` bucket over S3 (provider-agnostic, via the `aws` CLI), keyed `<repo>/pr-<n>/<file>`, and prints the markdown — an image embed or a `<video>` tag — to drop into the body with `gh pr edit`. It compacts as it uploads — PNG/JPEG screenshots become WebP, WebM/MOV recordings a downscaled MP4 — so you hand it raw captures and the embed stays small (a UI shot drops ~8× vs PNG). Re-running for a PR **replaces** its media (new files uploaded, then stale objects under the PR's folder deleted), so updated screenshots/recordings don't pile up. This is what lets `/pr` run end-to-end on any teammate's laptop, with no stray branch and no manual drag.

- One-time per-laptop config (gitignored `.env.pr-media`, copied from `.env.example.pr-media`, filled from the team vault): `GITHUB_MEDIA_S3_ENDPOINT` + `GITHUB_MEDIA_S3_ACCESS_KEY_ID` + `GITHUB_MEDIA_S3_SECRET_ACCESS_KEY` + `GITHUB_MEDIA_PUBLIC_BASE` (the bucket's public r2.dev/custom URL — public access is required, since GitHub fetches the media unauthenticated). Namespaced `GITHUB_MEDIA_S3_*` so they never collide with the backend `STORAGE_*` or a teammate's `AWS_*`; the script maps them to `AWS_*` for the one subprocess. The `aws`, `cwebp`, and `ffmpeg` CLIs come from the nix dev shell (`flake.nix`), so `nix develop` / direnv covers it. Bucket + script are shared; only the keys are per-person.
- If a var is missing the script exits naming it; fall back to the manual path.

**Manual (human) — GitHub user-attachments.** Drag the file into the PR description in the web UI; GitHub mints a `user-attachments` URL bound to the PR (a `.webm` becomes an inline player). Use this when no R2 token is set up — leave a `> _Drag the <thing> in here._` placeholder in the body so the spot is obvious.

**Never** create a `pr-media` (or any media) branch — it clutters the repo with a branch nobody asked for, and surprises like that erode trust even when they work.

## Step 8 — Review loop

Between opening and merging is where most of the work is — don't jump to merge.

**Watch CI to green:**

```bash
gh pr checks <N> --watch        # wait for every check; triage any red
```

A check that passes locally but fails in CI is usually env / strict-mode (Turbo env scoping, build-only paths). Fix it, push, and re-run the relevant gate (Step 2 or 6) on the fix. If you opened as draft (genuine WIP that's now complete), flip it to ready once CI is green:

```bash
gh pr ready <N>
```

**Address review comments:**

```bash
gh pr view <N> --comments       # read the reviewer's threads
```

- Treat each fix as a normal change: re-run the Step 3 self-review on it → readability (Step 4) → `/commits` (Step 5, with the explain-and-wait gate) → push. Don't bypass the gates for "small" review fixes — that's how regressions and drift slip in.
- Reply to each thread with what you did and resolve it once pushed; re-request review when all are addressed.
- **Keep the PR body in sync** as commits land: if the scope grew, update `## What` / `## Changes` / `## Impact` (the description grows as slices land — your shared-worktree convention).

Loop until CI is green and the review is approved, then Step 9.

## Step 9 — Merge

After review approval and green checks. **Never use a merge-commit** (`--merge` / "Create a merge commit") — it adds a noisy parent that breaks `git log --oneline` and `git bisect`.

Don't pick squash vs rebase alone. Post the commit trail with a one-line summary per commit and ask which to use:

```bash
git log main..HEAD --oneline
```

- **Rebase** — each commit is independently meaningful and worth keeping on main (matches one-PR-per-slice, each commit a focused topic).
- **Squash** — the trail has cleanup / fix-on-fix commits not worth preserving. If squashing, draft the squashed message via `/commits` first so it's reviewable.

Default to **rebase** unless squashing serves a specific reason.

```bash
gh pr merge <N> --rebase --delete-branch    # or --squash --delete-branch
```

**Never `--delete-branch` a PR that another open PR is stacked on.** GitHub closes the child instead of auto-retargeting it, and a PR closed because its base branch was deleted can't be reopened or retargeted — you have to recreate it as a fresh PR. To land a stack: merge each parent **without** `--delete-branch`, retarget the child to `main` and rebase it onto main (dropping the merged parent's commits), then delete the orphaned branches once nothing targets them.

If rebase hits conflicts: pause and surface to the user — rebase the branch locally, force-push, then retry rebase-merge. Never fall back to a merge-commit.

`--delete-branch` removes the remote branch only — after the merge, also drop the local branch: `git checkout main && git pull && git branch -D <branch>`. If the change was made in a worktree, clean it up afterward: `git worktree remove <path>` (or `ExitWorktree` if this session created it), then `git worktree prune`.

## Conventions this skill encodes

- Re-baseline long sessions on `origin/main` before editing or finalizing.
- Default path assumes the branch is already committed; readability + `/commits` (Steps 4–5) fire only for new fixes.
- Verify end-to-end; screenshots/recording for UI.
- Self-review the whole branch: reuse-not-reinvent, pattern conformance (`AGENTS.md` / `docs/*`), scope discipline, AI-code smells; escalate to `/code-review`, `/security-review` (+ Snyk), and the a11y agent by risk.
- Readability pass, then commit via `/commits` with an explain-and-wait gate per commit.
- Tests ride with their logic in one commit.
- Verification gates: `install` → `check-types` + `test` → `build`.
- PR body in the house style with a Review guide; `## Verification` claims only what was actually run; first-person singular; no AI attribution.
- Open ready by default (draft only for nameable WIP); watch CI to green; address review through the same gates; keep the PR body in sync.
- Merge by rebase or squash (consult first), never a merge-commit.
