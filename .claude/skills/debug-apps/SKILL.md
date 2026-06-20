---
name: debug-apps
description: This skill should be used when the user asks to "debug", "diagnose", "check health", "run doctor", or says "app not working", "server down", "login broken", "blank page", "white screen", "500 error", "CORS error", "auth issue", "can't connect", "database error", "migration failed", "services not running", "certificate error", or asks to check if the Batuda server or web app is healthy locally.
---

# Debug Local Apps

Diagnose the Batuda server (API) and web (internal CRM) apps. Run against one or both based on what the user asks.

## Identify targets

| Keyword                          | App(s) to debug |
| -------------------------------- | --------------- |
| `server`, `api`, `backend`       | server          |
| `web`, `internal`, `crm`         | web             |
| `auth`, `login`, `session`       | server + web    |
| `email`, `inbox`                 | server          |
| `all`, `everything`, unspecified | server + web    |

## Pre-flight checks

Run these checks for each target app. Report results before deeper debugging.

### Portless proxy

All dev URLs route through the portless proxy (web at `batuda.localhost`, API at `api.batuda.localhost`) on whatever port it bound — 443 when it can, otherwise a non-privileged fallback like `:1355`. Grab that port once and reuse it below (the internal app/server ports are portless-assigned, so `lsof -i :3010` finds nothing):

```bash
P=$(cat ~/.portless/proxy.port 2>/dev/null || echo 443)       # the portless proxy port
WEB=https://batuda.localhost$([ "$P" = 443 ] || echo ":$P")   # the web origin (drops :443)
```

If both apps fail with connection errors, check the proxy first: `portless list` shows the registered routes and the local port each proxies to.

### Server (`api.batuda.localhost`)

```bash
curl -sk https://api.batuda.localhost:$P/health 2>/dev/null && echo "OK" || echo "DOWN"
# If DOWN: `portless list` (is api.batuda registered?), then start: pnpm dev:server
```

Check the persistent log file at `apps/server/server.log` (survives `node --watch` reloads). Grep for:

- `http.status=4` or `http.status=5` — failing requests
- `cause=` or `level=Error` — crashes and errors
- `cors allowed origins:` — verify CORS config
- `Listening on` — last boot, which port

### Web / Internal (`batuda.localhost`)

```bash
curl -sk $WEB/ 2>/dev/null | head -20 && echo "OK" || echo "DOWN"
# If DOWN: `portless list` (is batuda registered?), then start: pnpm dev:internal
```

In dev the client derives its API origin from the page (`<host>.api.batuda.localhost`), so `VITE_SERVER_URL` is prod-only — not needed locally. If `/v1/*` data won't load, confirm the page is open on the URL `pnpm dev` printed (with portless's port), not a bare `https://batuda.localhost`.

## Common issues

After pre-flight, check these in order. Stop when the cause is found.

### Environment

- `.env` exists at repo root (copy from `.env.example` if missing: `pnpm cli setup`)
- All `RESEARCH_PROVIDER_*` vars set (server crashes without them; use `stub` for local dev)
- `RESEARCH_PROVIDER_LLM` set (no auto-default; use `stub`)
- All `RESEARCH_DEFAULT_*` and `RESEARCH_MAX_*` budget/concurrency vars set
- `ALLOWED_ORIGINS` — literal web origins, comma-separated (dev: `https://batuda.localhost`); no wildcards (any `*` fails boot). A worktree's `<branch>.batuda.localhost` origin is derived from `PORTLESS_URL` and merged in automatically — no entry needed. Details: `docs/backend.md` → Cross-origin policy
- `BETTER_AUTH_BASE_URL=https://api.batuda.localhost` (in a worktree the server derives this + `APP_PUBLIC_URL` from `PORTLESS_URL`, so they point at the worktree's own host)
- `EMAIL_PROVIDER` set explicitly (use `local-inbox` for dev)
- Run `pnpm cli doctor` for a full automated environment health check

### Docker services

Local dev depends on two Docker containers defined in `docker/docker-compose.yml`:

| Service     | Container        | Port(s)                               |
| ----------- | ---------------- | ------------------------------------- |
| Postgres 18 | `batuda-db`      | `5433:5432`                           |
| MinIO (S3)  | `batuda-storage` | `9000` (S3 API), `9001` (web console) |

```bash
pnpm cli services status   # check Docker containers
pnpm cli services up       # start Postgres + MinIO
pnpm cli services down     # stop all
```

MinIO web console available at `http://localhost:9001` (user: `batuda`, pass: `batuda-secret`). A one-shot `storage-init` sidecar creates the `batuda-assets` bucket on first boot.

### Database

```bash
pnpm cli db migrate   # run pending migrations
pnpm cli db reset     # truncate + migrate + seed (nuclear option)
```

### Auth / login flow

Auth spans server + internal. Both must be running.

1. Verify CORS preflight (`$P`/`$WEB` from the pre-flight): `curl -sk -X OPTIONS -H "Origin: $WEB" -H "Access-Control-Request-Method: POST" https://api.batuda.localhost:$P/auth/sign-in/email -D - -o /dev/null 2>&1 | grep -i 'access-control'`
2. Verify session endpoint: `curl -sk https://api.batuda.localhost:$P/auth/get-session`
3. Check `apps/server/server.log` for `http.url="/auth/sign-in/email"` and its status
4. Verify seed user exists: `pnpm cli seed --preset minimal` (idempotent)
5. **Active org:** logging in does not set an active organization. If org-scoped pages (companies, emails, templates…) render "Couldn't load … Refresh to try again." and the switcher shows "NO ACTIVE ORGANIZATION", select one: `agent-browser find testid "org-switcher" click` then `find testid "org-switcher-option-<slug>" click` (Better Auth `setActive` + reload). The available `<slug>`s are the `org-switcher-option-*` entries in the open switcher's snapshot — one per membership, or run `pnpm cli data members`.

### Local dev email

When `EMAIL_PROVIDER=local-inbox`, all outgoing email is written to `apps/server/.dev-inbox/` as markdown files with YAML frontmatter instead of hitting the network. Each file is named `<YYYYMMDD-HHMMSS-mmm>__<recipient>__<subject>.md`.

```bash
ls apps/server/.dev-inbox/                    # list caught emails
cat apps/server/.dev-inbox/*.md | head -30    # read frontmatter + body
```

Magic-link emails (from invite flow) are tagged with `labels: magic-link` in frontmatter. To find a sign-in link: `grep -l "magic-link" apps/server/.dev-inbox/*.md`.

If no emails appear, verify `EMAIL_PROVIDER=local-inbox` in `.env` and check `apps/server/server.log` for `"email provider: local-inbox"`.

## Running a worktree dev stack

Each git worktree gets its own dev data inside the **one shared** Docker stack — its
own Postgres database (`batuda_<slug>`) and MinIO bucket (`batuda-assets-<slug>`),
**not** a stack per worktree. portless serves it at `<label>.batuda.localhost` (web)
and `<label>.api.batuda.localhost` (server), where `<label>`/`<slug>` is the branch's
last path segment (so `ui/foo` → `foo.batuda.localhost`), so there's no clash
with the main checkout. See the `/worktrees` skill for the full model.

```bash
# Provision this worktree: creates its DB + bucket, writes .env, migrates + seeds.
# Auto-runs once on session start (skips once the DB exists); re-running re-seeds.
pnpm cli worktree up

# Run the stack — portless injects PORT/PORTLESS_URL per service, no clash with main.
pnpm dev

pnpm cli worktree ls        # every worktree + its DB + provisioned state + URL
pnpm cli worktree doctor    # this worktree: stack, DB, migrations, bucket, URL
pnpm cli worktree down      # drop this worktree's DB + bucket
pnpm cli worktree prune     # reap DBs/buckets of worktrees that no longer exist
```

Verify: `curl -sk https://<label>.api.batuda.localhost:$P/health` and drive
`agent-browser` against `https://<label>.batuda.localhost` (use the full URL
`pnpm cli worktree doctor` prints — host plus portless's port).
The server derives its own auth/app origins from
`PORTLESS_URL`, so login, API calls, and minted links (invitations, auth redirects)
all target the worktree's host automatically — no per-worktree `.env` edits. If the
server won't boot with `ALLOWED_ORIGINS does not accept wildcard patterns`, a `.env`
(main or worktree) still lists `https://*.batuda.localhost` — remove it; the worktree
origin is derived from `PORTLESS_URL`, no wildcard needed.

## CLI commands reference

| Command                    | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `pnpm cli doctor`          | Full environment health check                  |
| `pnpm cli setup`           | Copy `.env` files from examples                |
| `pnpm cli seed`            | Truncate + insert seed data (idempotent)       |
| `pnpm cli seed --preset X` | `minimal` or `full` preset (default: full)     |
| `pnpm cli data [entity]`   | List seeded mock data (overview or rows)       |
| `pnpm cli db migrate`      | Run pending migrations                         |
| `pnpm cli db reset`        | Truncate + migrate + seed (clean slate)        |
| `pnpm cli services up`     | Start Docker Postgres + MinIO                  |
| `pnpm cli services down`   | Stop Docker services                           |
| `pnpm cli services status` | Show Docker container status                   |
| `pnpm cli worktree up`     | Provision this worktree's DB + bucket (+ seed) |
| `pnpm cli worktree ls`     | List all worktrees + DB / URL / provisioned    |
| `pnpm cli worktree doctor` | Diagnose the current worktree's data layer     |
| `pnpm cli worktree down`   | Drop this worktree's DB + bucket               |
| `pnpm cli worktree prune`  | Reap orphaned worktree DBs + buckets           |
| `pnpm cli:tui`             | Interactive TUI (same commands)                |

## Browser debugging

Use `agent-browser` (Playwright-based CLI) to test the app as a real user. Ensure seed data exists first (`pnpm cli seed --preset minimal`).

For the full command reference (login flow, navigation, interaction, network inspection), consult `references/agent-browser.md`.

Quick login test:

```bash
agent-browser open "$WEB/login"                               # $WEB from the pre-flight
agent-browser fill "input[name='email']" "admin@taller.cat"
agent-browser fill "input[name='password']" "batuda-dev-2026"
agent-browser click "button[type='submit']"
agent-browser wait 3000
agent-browser find testid "org-switcher" click                # org-scoped pages error
agent-browser find testid "org-switcher-option-taller" click  # without an active org
agent-browser wait 3000
agent-browser snapshot
```

## Reporting

After diagnosis, report:

1. Which apps are up/down
2. What failed and why (with log excerpts or curl output)
3. The fix applied (or suggested fix if user confirmation needed)
4. Verification that the fix worked (re-run the failing check)
5. Suggest running `pnpm cli doctor` as a follow-up verification step

## Additional resources

### Reference files

For detailed commands and workflows, consult:

- **`references/agent-browser.md`** — Full agent-browser command reference, login flow, navigation, interaction, network inspection
