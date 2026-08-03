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

Magic-link emails are tagged with `labels: magic-link` in frontmatter. To find a sign-in link: `grep -l "magic-link" apps/server/.dev-inbox/*.md`.

If no emails appear, verify `EMAIL_PROVIDER=local-inbox` in `.env` and check `apps/server/server.log` for `"email provider: local-inbox"`.

## Running a worktree dev stack

Each git worktree gets its own dev data inside the **one shared** Docker stack — its
own Postgres database (`batuda_<slug>`) and MinIO bucket (`batuda-assets-<slug>`),
**not** a stack per worktree. portless serves it at `<label>.batuda.localhost` (web)
and `<label>.api.batuda.localhost` (server), where `<label>`/`<slug>` is the branch's
last path segment (so `ui/foo` → `foo.batuda.localhost`), so there's no clash
with the main checkout. See the `/worktree` skill for the full model.

```bash
# 1. Install. In a worktree this MUST be --ignore-scripts: core.hooksPath points at
# the main checkout, so lefthook's `prepare` step fails and takes the install with it.
pnpm install --ignore-scripts

# 2. --ignore-scripts leaves workspace dist/ unbuilt, and the server imports
# @batuda/ui as built output — without this it dies on `Cannot find module
# '@batuda/ui/dist/blocks/index.mjs'`.
pnpm --filter @batuda/ui build

# 3. Provision this worktree: creates its DB + bucket, writes .env, migrates + seeds.
# Auto-runs once on session start (skips once the DB exists); re-running re-seeds.
pnpm cli worktree up

# 4. Run the stack — portless injects PORT/PORTLESS_URL per service, no clash with main.
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
`PORTLESS_URL`, so login, API calls, and minted links (sign-in, auth redirects)
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
| `pnpm cli worktree watch`  | Open this worktree in a live browser window    |
| `pnpm cli:tui`             | Interactive TUI (same commands)                |

## Browser debugging

Use `agent-browser` (Playwright-based CLI) to test the app as a real user. Ensure seed data exists first (`pnpm cli seed --preset minimal`).

For the full command reference (login flow, navigation, interaction, network inspection), consult `references/agent-browser.md`.

If the session has browser MCP tools (`preview_start`, `read_page`, `form_input`, `javascript_tool`, `resize_window`), they drive the same app and suit some jobs better: `read_page` returns an accessibility tree with stable refs, `resize_window` sweeps viewports, and `javascript_tool` reads computed styles and element geometry — which is what the layout section below needs and `agent-browser` cannot do. Use whichever is available; don't mix both against one page.

A click on an element below the fold does nothing and still prints `✓ Done`, which looks identical to a broken handler — scroll it into view first. Before reporting any button as broken, verify the click actually landed; see the interaction section of `references/agent-browser.md` for the recipe.

**A dropdown will not stay open under a synthetic click.** `agent-browser click` on a `PriSelect` trigger leaves `aria-expanded="false"` — Base UI opens on the press and closes again on the release. The options are still in the DOM afterwards (Base UI keeps them mounted), so a check that counts `[role=option]` reads as success while the popup is invisible and has zero height, and every attempt to click an option then fails as "covered". Open it from the keyboard instead — focus the trigger, press `ArrowDown` — and it stays open. Playwright's own `click` does not have this problem, so an e2e test can drive it directly.

**Wait after loading `/login` before filling anything.** Without a pause the password field is often not in the DOM yet, so `fill` reports `✗ Element not found`, the submit click posts an empty form, and the next `find testid "org-switcher"` also misses — three failures that together read exactly like broken auth. It is a hydration race, not a bug in the app. The same applies after `pnpm dev` restarts: the session cookie is gone, so a page you had open lands back on `/login?returnTo=…` and every subsequent `find` fails until you sign in again.

Quick login test:

```bash
agent-browser open "$WEB/login"                               # $WEB from the pre-flight
agent-browser wait 3000                                       # let the form hydrate — see above
agent-browser fill "input[name='email']" "admin@taller.cat"
agent-browser fill "input[name='password']" "batuda-dev-2026"
agent-browser wait 500                                        # let controlled inputs commit first
agent-browser click "button[type='submit']"
agent-browser wait 5000
agent-browser find testid "org-switcher" click                # org-scoped pages error
agent-browser wait 1500
agent-browser find testid "org-switcher-option-taller" click  # without an active org
agent-browser wait 5000
agent-browser snapshot
```

To force one feed to fail while the rest of a page keeps working — the only honest way to see an error branch — revoke the read grant on that one table and put it back afterwards:

```bash
docker exec batuda-db psql -U batuda -d <db> -c "REVOKE SELECT ON calendar_events FROM app_user, app_service;"
# ... check the page shows its failure state, then ...
docker exec batuda-db psql -U batuda -d <db> -c "GRANT SELECT ON calendar_events TO app_user, app_service;"
```

## When the page renders but looks wrong

The checks above all assume something *errors*. A layout bug throws nothing: the request is 200, the rows are in the DOM, and the screen is still wrong. Do not reach for the network tab or the server log — measure the box that is the wrong size.

Two symptoms, one cause. A list that shows a couple of rows and refuses to grow, or content clipped with no way to scroll to it, is almost always a scroll container that collapsed to leftover flex space.

**Find the clipped container.** Anything whose content is taller than its own box is a scroller that is losing:

```js
[...document.querySelectorAll('*')]
  .filter(el => { const s = getComputedStyle(el)
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4 })
  .map(el => ({ cls: el.className.toString().slice(0, 60),
                clientH: el.clientHeight, scrollH: el.scrollHeight }))
```

Styled-components names each class after its component and the file it sits in, so a hit names the file to open. `side-nav__NavList` is a normal hit — ignore it.

**Then walk the height chain upward** from that element, reading `clientHeight`, `display`, `flex`, `minHeight` and `overflowY` at each ancestor up to `<body>`. The break is the first ancestor whose height stops coming from real content — a `flex: 1` child inside a viewport-locked parent gets whatever the fixed siblings above it left over, which can be almost nothing.

**Sweep viewport sizes before concluding anything.** These bugs scale with height, so one window size tells you nothing about severity — the same page can look acceptable at 1920×1080 and show half a row at 1440×620. Resize to at least 1280×720, 1440×900, 1920×1080, tablet and mobile, re-measuring at each. Note that below 768px the app drops the viewport height lock and the document scrolls instead, so a desktop-only bug disappears on mobile.

**The app's intended pattern is that `PriScrollArea` scrolls the whole page.** A route with its own `overflow-y: auto` is the exception and deserves suspicion. Two things break when a route introduces one: `infinite-list-footer.tsx` observes the sheet viewport, never a page-local scroller, so auto-load silently stops firing; and only the sheet viewport carries `data-scroll-restoration-id`, so an inner scroller loses its position on back-navigation.

**Row counts lie when a list is paginated.** `EMAILS_PAGE_SIZE` caps the emails list at 100, so a DOM row count answers to the page size, not to how much data exists. Assert on the page's own total (`emails-thread-total`) instead — see `apps/internal/tests/e2e/inbox-listing.test.ts`.

**Need more rows than the seed provides?** `--preset full` scales companies, not mail — it still leaves 7 threads. Insert them directly into the worktree's disposable DB:

```bash
docker exec batuda-db psql -U batuda -d batuda_<slug> -c "
INSERT INTO email_thread_links (organization_id, external_thread_id, inbox_id, subject, status, created_at, updated_at)
SELECT '<org-id>', 'bulk-' || g, '<inbox-id>', 'Test thread ' || g, 'open', now(), now()
FROM generate_series(1, 113) g;"
```

## Watch several worktrees at once

One AI session per worktree — give each its own **headed** browser window (the default here, via `AGENT_BROWSER_HEADED=1`) to watch them navigate live, side by side. From inside each worktree:

```bash
pnpm cli worktree watch          # opens THIS worktree's app in its own visible window
pnpm cli worktree watch --stop   # closes only this worktree's window (others untouched)
```

`watch` opens a stable per-worktree `agent-browser` session (`ai-<slug>`) at the worktree's URL; `--stop` closes only that one. A freshly opened window auto-tiles into a 2×2 grid cell (up to four side by side), so parallel worktrees don't stack on top of each other; a reused window is left where you dragged it.

For an extra tile of the same worktree (e.g. a mobile viewport), open another named session by hand:

```bash
agent-browser --session "ai-<slug>-mobile" set device "iPhone 16 Pro"
agent-browser --session "ai-<slug>-mobile" open "<worktree-url>/login"
```

Never `agent-browser close --all` (or `pkill -f .../browsers/chrome`) while other worktree windows are live — those close **every** session at once.

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
