---
name: release
description: This skill should be used when the user asks to "release", "deploy", "ship", "create a new version", "release server", "release marketing", "release internal", "release all", or mentions CalVer versioning. Handles interactive release workflow for Engranatge apps (server, internal, marketing, or all) with independent CalVer versioning, GitHub tag-based deploys, and post-release verification.
allowed-tools: Bash(git:*) Bash(pnpm:*) Bash(gh:*) Bash(kraft:*) Bash(curl:*) Read AskUserQuestion
---

# Release Workflow

Interactive release for the Engranatge monorepo. CalVer format: `yyyy.m.d.patch` (e.g., `2026.4.6.0`). Independent versioning per app.

## Step 1: Pre-flight Checks

```bash
git branch --show-current    # Must be "main"
git status --short           # Must be empty (clean working dir)
git fetch origin main
git log HEAD..origin/main --oneline  # Must be empty (up to date)
```

If any check fails, inform the developer and stop.

## Step 2: Determine Which App to Release

If the user passed an argument (e.g. `/release server`, `/release marketing`, `/release all`), use it directly — skip the question. Accepted values: `server`, `internal`, `marketing`, `all`.

Otherwise, use `AskUserQuestion`:

- **Server** — API at api.engranatge.com (`server-v*` tag → auto-deploys)
- **Internal** — Forja CRM at forja.engranatge.com (`internal-v*` tag → auto-deploys)
- **Marketing** — Site at engranatge.com (`marketing-v*` tag → auto-deploys)
- **All** — Server first, then Internal, then Marketing

## Step 3: Check Commits Exist

```bash
# Server
git describe --tags --match='server-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 2>/dev/null || echo "no-tag"
git rev-list <tag>..HEAD --count -- apps/server packages/

# Internal
git describe --tags --match='internal-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 2>/dev/null || echo "no-tag"
git rev-list <tag>..HEAD --count -- apps/internal packages/

# Marketing
git describe --tags --match='marketing-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 2>/dev/null || echo "no-tag"
git rev-list <tag>..HEAD --count -- apps/marketing packages/
```

If 0 commits, ask if they want to force with `--no-git.requireCommits`.

## Step 4: Dry Run

```bash
pnpm release:server:dry   # or release:internal:dry / release:marketing:dry
```

Show the expected version and changelog. Ask for confirmation.

## Step 5: Execute Release

```bash
GITHUB_TOKEN=$(gh auth token) pnpm release:server --ci
GITHUB_TOKEN=$(gh auth token) pnpm release:internal --ci
GITHUB_TOKEN=$(gh auth token) pnpm release:marketing --ci
```

**Note:** Deploy triggers automatically on tag push via GitHub workflows.

## Step 6: Watch Deployment

After the tag push, the deploy workflow triggers automatically. Watch it:

```bash
# Server
sleep 5
gh run list --workflow=deploy_server.yml --limit 1
gh run watch

# Marketing
sleep 5
gh run list --workflow=deploy_marketing.yml --limit 1
gh run watch
```

## Step 7: Verify Deployment

Only verify targets that were actually released:

**Server:**

```bash
curl -s https://api.engranatge.com/health
kraft cloud --metro fra instance list | grep engranatge-server
```

**Marketing:**

```bash
curl -sI https://engranatge.com | head -5
kraft cloud --metro fra service get engranatge-marketing
```

## Config Reference

```
.release-it.base.json           # Shared: git, github, npm, changelog
.release-it.server.cjs          # Server: extends base, tag server-v*
.release-it.marketing.cjs       # Marketing: extends base, tag marketing-v*
scripts/release-calver-plugin.cjs  # CalVer version computation
scripts/release-utils.cjs       # Workspace dependency path resolver
```

### Commit Path Tracking

release-it only considers commits that touch relevant paths (computed by `scripts/release-utils.cjs`):

- **Server:** `apps/server` + all `workspace:*` dependencies
- **Marketing:** `apps/marketing` + all `workspace:*` dependencies

A change to `packages/domain/` counts for BOTH releases (shared dep).

### Debug Release Issues

```bash
# Enable release-it debug output
NODE_DEBUG=release-it:* pnpm release:server:dry

# Test CalVer computation
node -e "const P = require('./scripts/release-calver-plugin.cjs'); const p = new P({container:{}, options:{}}); console.log(p._computeNextVersion('2026.4.6.0'))"
```
