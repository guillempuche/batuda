---
name: debug-apps
description: This skill should be used when the user asks to "debug", "diagnose", "check health", "run doctor", or says "app not working", "server down", "login broken", "blank page", "white screen", "500 error", "CORS error", "auth issue", "can't connect", "database error", "migration failed", "services not running", "certificate error", or asks to check if the Engranatge apps (server, internal/Forja, marketing) are healthy locally.
---

# Debug Local Apps

Diagnose server, internal (Forja), and marketing apps. Run against one, two, or all three based on what the user asks.

## Identify targets

| Keyword                          | App(s) to debug               |
| -------------------------------- | ----------------------------- |
| `server`, `api`, `backend`       | server                        |
| `internal`, `forja`, `crm`       | internal                      |
| `marketing`, `web`, `site`       | marketing                     |
| `auth`, `login`, `session`       | server + internal             |
| `email`, `inbox`                 | server                        |
| `all`, `everything`, unspecified | server + internal + marketing |

## Pre-flight checks

Run these checks for each target app. Report results before deeper debugging.

### Portless proxy

All dev URLs route through portless (`*.engranatge.localhost`). If all three apps fail with connection errors, check the proxy first before investigating individual apps.

### Server (`api.engranatge.localhost`)

```bash
curl -sk https://api.engranatge.localhost/health 2>/dev/null && echo "OK" || echo "DOWN"
# If DOWN:
lsof -i :3010 -sTCP:LISTEN 2>/dev/null | head -5
# Start: pnpm dev:server
```

Check the persistent log file at `apps/server/server.log` (survives `node --watch` reloads). Grep for:

- `http.status=4` or `http.status=5` — failing requests
- `cause=` or `level=Error` — crashes and errors
- `cors allowed origins:` — verify CORS config
- `Listening on` — last boot, which port

### Internal / Forja (`forja.engranatge.localhost`)

```bash
curl -sk https://forja.engranatge.localhost/ 2>/dev/null | head -20 && echo "OK" || echo "DOWN"
# If DOWN:
lsof -i :3000 -sTCP:LISTEN 2>/dev/null | head -5
# Start: pnpm dev:internal
```

Verify `apps/internal/.env` contains `VITE_SERVER_URL=https://api.engranatge.localhost`. Without it, client-side API calls fall back to `http://localhost:3010` which breaks under portless.

### Marketing (`engranatge.localhost`)

```bash
curl -sk https://engranatge.localhost/ 2>/dev/null | head -20 && echo "OK" || echo "DOWN"
# If DOWN:
lsof -i :3001 -sTCP:LISTEN 2>/dev/null | head -5
# Start: pnpm dev:marketing
```

## Common issues

After pre-flight, check these in order. Stop when the cause is found.

### Environment

- `.env` exists at repo root (copy from `.env.example` if missing: `pnpm cli setup`)
- All `RESEARCH_PROVIDER_*` vars set (server crashes without them; use `stub` for local dev)
- `RESEARCH_PROVIDER_LLM` set (no auto-default; use `stub`)
- All `RESEARCH_DEFAULT_*` and `RESEARCH_MAX_*` budget/concurrency vars set
- `ALLOWED_ORIGINS` matches portless URLs (`https://*.engranatge.localhost`)
- `BETTER_AUTH_BASE_URL=https://api.engranatge.localhost`
- `EMAIL_PROVIDER` set explicitly (use `local-inbox` for dev)
- Run `pnpm cli doctor` for a full automated environment health check

### Docker services

Local dev depends on two Docker containers defined in `docker/docker-compose.yml`:

| Service     | Container            | Port(s)                               |
| ----------- | -------------------- | ------------------------------------- |
| Postgres 17 | `engranatge-db`      | `5433:5432`                           |
| MinIO (S3)  | `engranatge-storage` | `9000` (S3 API), `9001` (web console) |

```bash
pnpm cli services status   # check Docker containers
pnpm cli services up       # start Postgres + MinIO
pnpm cli services down     # stop all
```

MinIO web console available at `http://localhost:9001` (user: `engranatge`, pass: `engranatge-secret`). A one-shot `storage-init` sidecar creates the `engranatge-recordings` bucket on first boot.

### Database

```bash
pnpm cli db migrate   # run pending migrations
pnpm cli db reset     # truncate + migrate + seed (nuclear option)
```

### Auth / login flow

Auth spans server + internal. Both must be running.

1. Verify CORS preflight: `curl -sk -X OPTIONS -H "Origin: https://forja.engranatge.localhost" -H "Access-Control-Request-Method: POST" https://api.engranatge.localhost/auth/sign-in/email -D - -o /dev/null 2>&1 | grep -i 'access-control'`
2. Verify session endpoint: `curl -sk https://api.engranatge.localhost/auth/get-session`
3. Check `apps/server/server.log` for `http.url="/auth/sign-in/email"` and its status
4. Verify seed user exists: `pnpm cli seed --preset minimal` (idempotent)

### Local dev email

When `EMAIL_PROVIDER=local-inbox`, all outgoing email is written to `apps/server/.dev-inbox/` as markdown files with YAML frontmatter instead of hitting the network. Each file is named `<YYYYMMDD-HHMMSS-mmm>__<recipient>__<subject>.md`.

```bash
ls apps/server/.dev-inbox/                    # list caught emails
cat apps/server/.dev-inbox/*.md | head -30    # read frontmatter + body
```

Magic-link emails (from invite flow) are tagged with `labels: magic-link` in frontmatter. To find a sign-in link: `grep -l "magic-link" apps/server/.dev-inbox/*.md`.

If no emails appear, verify `EMAIL_PROVIDER=local-inbox` in `.env` and check `apps/server/server.log` for `"email provider: local-inbox"`.

## CLI commands reference

| Command                    | Purpose                                    |
| -------------------------- | ------------------------------------------ |
| `pnpm cli doctor`          | Full environment health check              |
| `pnpm cli setup`           | Copy `.env` files from examples            |
| `pnpm cli seed`            | Truncate + insert seed data (idempotent)   |
| `pnpm cli seed --preset X` | `minimal` or `full` preset (default: full) |
| `pnpm cli db migrate`      | Run pending migrations                     |
| `pnpm cli db reset`        | Truncate + migrate + seed (clean slate)    |
| `pnpm cli services up`     | Start Docker Postgres + MinIO              |
| `pnpm cli services down`   | Stop Docker services                       |
| `pnpm cli services status` | Show Docker container status               |
| `pnpm cli:tui`             | Interactive TUI (same commands)            |

## Browser debugging

Use `agent-browser` (Playwright-based CLI) to test the app as a real user. Ensure seed data exists first (`pnpm cli seed --preset minimal`).

For the full command reference (login flow, navigation, interaction, network inspection), consult `references/agent-browser.md`.

Quick login test:

```bash
agent-browser open https://forja.engranatge.localhost/login
agent-browser fill "input[name='email']" "dev@forja.cat"
agent-browser fill "input[name='password']" "forja-dev-2026"
agent-browser click "button[type='submit']"
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
