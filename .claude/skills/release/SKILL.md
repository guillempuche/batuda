---
name: release
description: This skill should be used when the user asks to "release", "deploy", "ship", "create a new version", "release server", "release internal", "release ui", "release all", or mentions CalVer versioning. Handles interactive release workflow for Batuda targets (server, internal, ui, or all) with independent CalVer versioning, GitHub tag-based deploys/publishes, and post-release verification.
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

If the user passed an argument (e.g. `/release server`, `/release ui`, `/release all`), use it directly — skip the question. Accepted values: `server`, `internal`, `ui`, `all`.

Otherwise, use `AskUserQuestion`:

- **Server** — API at api.batuda.co (`server-v*` tag → auto-deploys)
- **Internal** — Batuda web at batuda.co (`internal-v*` tag → auto-deploys; tag prefix kept while the app folder is `apps/internal/`)
- **UI** — `@batuda/ui` shared package (`ui-v*` tag → auto-publishes to npm + JSR)
- **All** — Server first, then Internal, then UI

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
```

If 0 commits, ask if they want to force with `--no-git.requireCommits`.

## Step 4: Dry Run

```bash
pnpm release:server:dry   # or release:internal:dry / release:ui:dry
```

Show the expected version and changelog. Ask for confirmation.

## Step 4.5: Apply DB Migrations (if schema changed)

Only for `server` or `all` releases. Check whether migration files changed since the last server tag:

```bash
last_tag=$(git describe --tags --match='server-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 2>/dev/null)
git diff --name-only "$last_tag"..HEAD -- apps/server/src/db/migrations/
```

If non-empty **and** a production DB is provisioned, run migrations against the direct (non-pooled) NeonDB URL from your machine before tagging:

```bash
DATABASE_URL="<neon-direct-url>" pnpm db:migrate
```

The deploy workflow does not run migrations — deploying new server code against an unmigrated schema will crash on boot. Skip this step until Phase 2 of `docs/TODO_DEPLOYMENT.md` is done (prod DB not yet provisioned).

## Step 5: Execute Release

```bash
GITHUB_TOKEN=$(gh auth token) pnpm release:server --ci
GITHUB_TOKEN=$(gh auth token) pnpm release:internal --ci
GITHUB_TOKEN=$(gh auth token) pnpm release:ui --ci
```

**Note:** Deploy triggers automatically on tag push via GitHub workflows. For `ui`, the `ui-v*` tag triggers `publish-ui.yml` which builds `packages/ui/dist`, publishes to npm, then publishes to JSR via OIDC.

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
npx jsr show @batuda/ui         # latest on JSR
```

## Config Reference

```
.release-it.base.json              # Shared: git, github, npm, changelog
.release-it.server.cjs             # Server: extends base, tag server-v*
.release-it.internal.cjs           # Internal: extends base, tag internal-v*
.release-it.ui.cjs                 # UI: extends base, tag ui-v*, bumps jsr.json too
scripts/release-calver-plugin.cjs  # CalVer version computation
scripts/release-utils.cjs          # Workspace dependency path resolver
```

### Commit Path Tracking

release-it only considers commits that touch relevant paths (computed by `scripts/release-utils.cjs`):

- **Server:** `apps/server` + all `workspace:*` dependencies
- **Internal:** `apps/internal` + all `workspace:*` dependencies
- **UI:** `packages/ui` (leaf — no workspace deps of its own)

A change to `packages/ui/` counts for any app that depends on it.

### Debug Release Issues

```bash
# Enable release-it debug output
NODE_DEBUG=release-it:* pnpm release:server:dry

# Test CalVer computation
node -e "const P = require('./scripts/release-calver-plugin.cjs'); const p = new P({container:{}, options:{}}); console.log(p._computeNextVersion('2026.4.6.0'))"
```
