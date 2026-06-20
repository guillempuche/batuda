---
name: worktrees
description: This skill should be used when working with git worktrees for parallel Claude/dev sessions on Batuda — creating, provisioning, running, listing/diagnosing, or tearing down a worktree's dev stack, or cleaning up orphaned data. Covers the shared-services model (one Docker stack; each worktree gets its own Postgres database + MinIO bucket), the `pnpm cli worktree` commands, lifecycle hooks, and per-worktree CORS/portless.
allowed-tools: Bash(pnpm:*) Bash(git:*) Bash(docker:*) Read
---

# Worktrees on Batuda

Run many sessions at once, each in its own git worktree, **without** running a Docker
stack per worktree.

## The model

One **shared** Docker stack (the `batuda` compose project: Postgres, MinIO, GreenMail) backs
everything — **3 containers total, regardless of how many worktrees you have**. A worktree
is a *logical tenant* inside it:

- its own Postgres **database** `batuda_<slug>` and MinIO **bucket** `batuda-assets-<slug>`,
  where `<slug>` is the branch's **last path segment** lowercased, non-alphanumerics → `-`
  (the database swaps `-` → `_`; a very long name gets a short hash suffix) — so branch
  `ui/feature-x` gives `batuda_feature_x` / `batuda-assets-feature-x`, which is what
  `ls`/`doctor` print,
- a generated `.env` pointing `DATABASE_URL` / `STORAGE_BUCKET` at them; everything else
  (shared endpoints, secrets) is inherited from the main checkout's `.env`.

portless serves each worktree on that same last-path-segment label — web
`https://<label>.batuda.localhost`, server `https://<label>.api.batuda.localhost`, so
`ui/feature-x` → `feature-x.batuda.localhost` and two worktrees' `pnpm dev` never collide.
**Use the URL `pnpm cli worktree ls`/`doctor` prints** — don't build it from the branch by hand.

## Where worktrees live

`.claude/worktrees/<name>` (gitignored). Create one with
`git worktree add .claude/worktrees/<name> -b <branch>` (works anywhere), or — on a Claude Code
build with worktree support — `claude --worktree <name>` (branch `worktree-<name>`), which also
fires the auto-provision/teardown hooks below.

## Lifecycle

1. **Create** — `claude --worktree foo`, or `git worktree add`.
2. **Provision** — auto on first session start (the `SessionStart` hook runs
   `pnpm install && pnpm cli worktree up`, then skips once the worktree's database exists). Or
   run `pnpm cli worktree up` yourself: it ensures the shared stack is up, creates the DB +
   bucket, writes `.env`, and migrates + seeds (re-running re-seeds — see Caveats).
3. **Run** — `pnpm dev` → portless serves `https://<label>.batuda.localhost` (the branch's last path segment).
4. **Inspect** — `pnpm cli worktree ls` (every worktree + its DB/URL/provisioned state),
   `pnpm cli worktree doctor` (deep health of the current one).
5. **Tear down** — auto when **Claude** removes the worktree (the `WorktreeRemove` hook drops
   the DB + bucket). Or `pnpm cli worktree down` — it drops the database + bucket recorded in
   this worktree's `.env` (not re-derived from the live branch), so it stays correct even after
   the branch is switched, e.g. by a PR merge (see Caveats).

## Commands (`pnpm cli worktree …`; run `--help` for flags)

| command  | does                                                                   |
| -------- | ---------------------------------------------------------------------- |
| `up`     | provision this worktree: DB + bucket, then migrate + seed              |
| `down`   | drop this worktree's DB + bucket (shared stack untouched)              |
| `ls`     | table of every worktree + database + provisioned (✓) + URL             |
| `doctor` | health of the current worktree (stack, DB, migrations, bucket, URL)    |
| `prune`  | list orphaned DBs + buckets (worktrees that are gone); `--yes` to drop |

## Caveats

- **`git worktree remove` does NOT auto-tear-down** — the `WorktreeRemove` hook only fires when
  *Claude* removes the worktree. After a manual `git worktree remove`, the DB + bucket leak; run
  `pnpm cli worktree down` **first**, or `pnpm cli worktree prune` later. `prune` only *lists*
  orphans by default (pass `--yes` to drop) and keys ownership off each live worktree's `.env`,
  so it never reaps a live worktree — even one whose branch was switched.
- **Merging a worktree's PR switches its branch.** `gh pr merge --delete-branch` checks `main`
  out into the worktree (the PR branch is gone). `down`/`doctor`/`ls`/`prune` read this worktree's
  identity from its `.env`, not the live branch, so teardown stays correct — but the portless
  **URL** then follows the new branch. Run `pnpm cli worktree down` before removing the dir.
- **`pnpm cli worktree up` re-seeds** (`--preset minimal`) every run, so re-running it resets the
  worktree's seed data — don't re-run it on a worktree whose data you've hand-edited.
- **`pnpm cli services down` from a worktree** stops the *shared* stack (every worktree + main),
  so it refuses unless run from the main checkout or given `--force`. To remove just your
  worktree's data, use `worktree down`.
- The shared Postgres caps connections at 200 — plenty for ~20 parallel dev servers.
- **New worktree, no HTTPS?** If `https://<label>.batuda.localhost` gives `ERR_CONNECTION_CLOSED`
  (the proxy serves no cert for the nested host), check `~/.portless/ca.srl` — a past `sudo` run
  can leave it root-owned, which silently fails cert *signing* for every new host (the generated
  `host-certs/<host>.pem` lands 0 bytes). The `.portless` dir is yours, so `rm ~/.portless/ca.srl`,
  then restart this worktree's `pnpm dev` to re-mint the cert.

## CORS / auth (works per worktree, no per-worktree env)

The **server derives its canonical origins from `PORTLESS_URL`** and merges the worktree's
`<label>.batuda.localhost:<port>` origin into the trusted set; the session cookie spans
`batuda.localhost`; and the client derives its `<label>.api.batuda.localhost` API host the same
way — so login, `/v1` data, API calls, and minted links (invitations, auth redirects) all target
the *worktree's* host automatically. `ALLOWED_ORIGINS` is literal-only (no `*.batuda.localhost`
wildcard). Each worktree's own database keeps sessions/data isolated.

A worktree whose `.env` lists `https://*.batuda.localhost` won't boot — `ALLOWED_ORIGINS` is
literal-only, so remove that line (or re-run `pnpm cli worktree up` to regenerate the `.env`,
which re-seeds — see Caveats).
