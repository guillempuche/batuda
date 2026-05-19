---
name: release
description: This skill should be used when the user asks to "release", "deploy", "ship", "create a new version", "release server", "release internal", "release ui", "release mail-worker", "release all", or mentions CalVer versioning. Handles interactive release workflow for Batuda targets (server, internal, ui, mail-worker, or all) with independent CalVer versioning, GitHub tag-based deploys/publishes, and post-release verification.
allowed-tools: Bash(git:*) Bash(pnpm:*) Bash(gh:*) Bash(kraft:*) Bash(curl:*) Bash(npm:*) Read AskUserQuestion
---

# Release Workflow

Interactive release for this monorepo (Batuda server + web app + shared UI package). CalVer format: `yyyy.m.d.patch` (e.g., `2026.4.6.0`). Independent versioning per target. The public marketing site lives in the separate `engranatge-marketing` repo (the first tenant's site, not the Batuda tool).

## Step 1: Pre-flight Checks

```bash
git branch --show-current    # Must be "main"
git status --short           # Must be empty (clean working dir)
git fetch origin main
git log HEAD..origin/main --oneline  # Must be empty (up to date)
```

If any check fails, inform the developer and stop.

## Step 2: Determine Which Target to Release

If the user passed an argument (e.g. `/release server`, `/release ui`, `/release all`), use it directly — skip the question. Accepted values: `server`, `internal`, `ui`, `mail-worker`, `all`.

Otherwise, use `AskUserQuestion`:

- **Server** — API at api.batuda.co (`server-v*` tag → auto-deploys)
- **Internal** — Batuda web at batuda.co (`internal-v*` tag → auto-deploys; tag prefix kept while the app folder is `apps/internal/`)
- **UI** — `@batuda/ui` shared package (`ui-v*` tag → auto-publishes to npm)
- **Mail-worker** — IMAP IDLE + SMTP-aware worker (`mail-worker-v*` tag → auto-deploys to KraftCloud as a background instance, no public endpoint)
- **All** — Server first, then Internal, then UI, then Mail-worker

## Step 3: Check Commits Exist

```bash
# Server
git describe --tags --match='server-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 2>/dev/null || echo "no-tag"
git rev-list <tag>..HEAD --count -- apps/server packages/

# Internal
git describe --tags --match='internal-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 2>/dev/null || echo "no-tag"
git rev-list <tag>..HEAD --count -- apps/internal packages/

# UI
git describe --tags --match='ui-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 2>/dev/null || echo "no-tag"
git rev-list <tag>..HEAD --count -- packages/ui

# Mail-worker
git describe --tags --match='mail-worker-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 2>/dev/null || echo "no-tag"
git rev-list <tag>..HEAD --count -- apps/mail-worker packages/
```

If 0 commits, ask if they want to force with `--no-git.requireCommits`.

## Step 4: Dry Run

```bash
pnpm release:server:dry   # or release:internal:dry / release:ui:dry / release:mail-worker:dry
```

Show the expected version and changelog. Ask for confirmation.

## Step 4.5: Apply DB Migrations (if schema changed)

Only for `server` or `all` releases (mail-worker reads/writes existing schema; no migrations live under `apps/mail-worker/`). Check whether migration files changed since the last server tag:

```bash
last_tag=$(git describe --tags --match='server-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 2>/dev/null)
git diff --name-only "$last_tag"..HEAD -- apps/server/src/db/migrations/
```

If non-empty, run migrations against the direct (non-pooled) NeonDB URL from your machine before tagging:

```bash
DATABASE_URL="<neon-direct-url>" pnpm db:migrate
```

The deploy workflow does not run migrations — deploying new server code against an unmigrated schema will crash on boot.

## Step 5: Execute Release

```bash
GITHUB_TOKEN=$(gh auth token) pnpm release:server --ci
GITHUB_TOKEN=$(gh auth token) pnpm release:internal --ci
GITHUB_TOKEN=$(gh auth token) pnpm release:ui --ci
GITHUB_TOKEN=$(gh auth token) pnpm release:mail-worker --ci
```

**Note:** Deploy triggers automatically on tag push via GitHub workflows. For `ui`, the `ui-v*` tag triggers `publish-ui.yml` which builds `packages/ui/dist` and publishes to npm with provenance via npm **Trusted Publishing (OIDC)** — no `NPM_TOKEN` secret. The trusted publisher is configured at https://www.npmjs.com/package/@batuda/ui/access (repo: `guillempuche/batuda`, workflow: `publish-ui.yml`). Same-day patches land as `YYYY.M.D-N` (a semver prerelease), so the workflow passes `--tag latest` to keep them as the default install target. JSR is not used — it does not allow non-JS/TS files and the UI package ships `tokens.css` / `tailwind.css`. For `mail-worker`, the `mail-worker-v*` tag triggers `deploy_mail_worker.yml` which builds the worker image and `kraft cloud deploy`s it to a no-public-port service on KraftCloud.

## Step 6: Watch Deployment

After the tag push, the deploy workflow triggers automatically. Watch it:

```bash
# Server
sleep 5
gh run list --workflow=deploy_server.yml --limit 1
gh run watch

# Internal
sleep 5
gh run list --workflow=deploy_web.yml --limit 1
gh run watch

# UI
sleep 5
gh run list --workflow=publish-ui.yml --limit 1
gh run watch

# Mail-worker
sleep 5
gh run list --workflow=deploy_mail_worker.yml --limit 1
gh run watch
```

## Step 7: Verify Deployment

Only verify targets that were actually released:

**Server:**

```bash
curl -s https://api.batuda.co/health
kraft cloud --metro fra instance list | grep batuda-server
```

**Internal:**

```bash
curl -sI https://batuda.co | head -5
kraft cloud --metro fra service get batuda-web
```

**UI:**

```bash
npm view @batuda/ui version     # latest on npm
```

**Mail-worker:**

```bash
kraft cloud --metro fra instance list | grep batuda-mail-worker
kraft cloud --metro fra instance logs batuda-mail-worker --tail 50 | grep "IDLE established"
```

No `curl /health` — the mail-worker has no HTTP listener.

## Config Reference

```
.release-it.base.json              # Shared: git, github, npm, changelog
.release-it.server.cjs             # Server: extends base, tag server-v*
.release-it.internal.cjs           # Internal: extends base, tag internal-v*
.release-it.ui.cjs                 # UI: extends base, tag ui-v*
.release-it.mail-worker.cjs        # Mail-worker: extends base, tag mail-worker-v*
scripts/release-calver-plugin.cjs  # CalVer version computation
scripts/release-utils.cjs          # Workspace dependency path resolver
```

### Commit Path Tracking

release-it only considers commits that touch relevant paths (computed by `scripts/release-utils.cjs`):

- **Server:** `apps/server` + all `workspace:*` dependencies
- **Internal:** `apps/internal` + all `workspace:*` dependencies
- **UI:** `packages/ui` (leaf — no workspace deps of its own)
- **Mail-worker:** `apps/mail-worker` + all `workspace:*` dependencies

A change to `packages/ui/` counts for any app that depends on it.

### Debug Release Issues

```bash
# Enable release-it debug output
NODE_DEBUG=release-it:* pnpm release:server:dry

# Test CalVer computation
node -e "const P = require('./scripts/release-calver-plugin.cjs'); const p = new P({container:{}, options:{}}); console.log(p._computeNextVersion('2026.4.6.0'))"
```
