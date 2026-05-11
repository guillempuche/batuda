# TODO — Deployment

Remaining work to bring `apps/internal` (the Batuda web app), `apps/server` (API), and `apps/mail-worker` (IMAP IDLE worker) live on KraftCloud.

Each tenant's public marketing site is deployed from its own repo (e.g. the first
tenant's site at `engranatge.com` ships from `engranatge-marketing`). See
`.github/workflows/deploy_*.yml` for the workflow definitions in this repo and
`.env.example.github` for the secrets/vars reference.

---

## Background

The three Batuda apps in this repo share the same deploy pattern (each tenant marketing repo follows the same pattern):

1. Cloudflare DNS record (CNAME → `fra.unikraft.app`, **proxied** — orange cloud)
2. GitHub Actions workflow (`deploy_<app>.yml`) triggered by tag push or `workflow_dispatch`
3. Workflow probes `kraft cloud service get <name>` to decide between rolling update
   (`--service`) and first-time creation (`--name -d`)
4. KraftCloud auto-issues a **Let's Encrypt** cert during the first `-d <domain>`
   deploy. LE is publicly-trusted, so Cloudflare SSL/TLS mode **Full (Strict)**
   validates against it without further work.
5. Order on first setup: add the proxied DNS record → run the deploy
   (LE issuance) → flip SSL mode to Full (Strict). Flipping Full (Strict)
   before LE finishes returns 525 to visitors.

Reference setup: `engranatge.com` (zone `e996b6467494c2b21cbf8a626d99d16b`)
runs apex CNAME → `fra.unikraft.app` proxied, Universal SSL on, Full (Strict),
LE at origin. Batuda mirrors this exactly.

> **Why not Cloudflare Origin Certificates?** Tried and blocked. CF Origin CA
> rewrites every cert's subject to `CN=CloudFlare Origin Certificate` (a
> generic non-FQDN string), and KraftCloud's `certificate create` rejects it
> with `400: "The certificate CN must be a fully-qualified domain name"`.
> The two formats are incompatible. If we want edge-only origin TLS later,
> the path is **Authenticated Origin Pulls** on top of LE (Cloudflare presents
> a client cert; UKC verifies it via mTLS), pending verification that UKC
> supports listener-level mTLS — not CF Origin Certs.

---

## Phase 1 — Batuda web app (`apps/internal` → `batuda.co`)

No runtime secrets needed; the workflow only reads `KRAFTCLOUD_TOKEN`.

### DNS

- [x] Cloudflare → batuda.co → DNS → CNAME `@` → `fra.unikraft.app` (**proxied**, orange cloud) — record id `633d3c07be44665d6f144d3a7ee8c1e4`
- [x] Wait ~5 min for propagation
- [x] Confirm: `dig +short batuda.co` returns Cloudflare proxy IPs (`104.x` / `172.x`) — verified `104.21.87.42`, `172.67.140.144`
- [x] `www.batuda.co` CNAME → `batuda.co`, proxied (already present)

### Deploy

- [x] Trigger workflow: `gh workflow run deploy_web.yml -R guillempuche/batuda`
- [x] Watch run: `gh run watch -R guillempuche/batuda`
- [x] Confirm LE cert issued: `kraft cloud --metro fra certificate list | grep batuda.co` — `batuda.co-5nna3`, valid
- [x] Confirm instance running: `kraft cloud --metro fra instance list | grep batuda-web` — `batuda-web-om2b1`, running
- [x] Smoke test via Cloudflare edge: `curl -sI https://batuda.co | head -5` — HTTP/2 307 → `/login?returnTo=%2F` (Better Auth gating, no 525)

### Cloudflare SSL/TLS (do AFTER first successful deploy so LE cert exists)

- [x] SSL/TLS → Overview → set encryption mode to **Full (Strict)** — set in dashboard
- [x] SSL/TLS → Edge Certificates → **Always Use HTTPS** = on — verified `curl -sI http://batuda.co` returns `301 → https://batuda.co/`
- [x] SSL/TLS → Edge Certificates → **Minimum TLS Version** = 1.2 — set in dashboard
- [x] SSL/TLS → Edge Certificates → **TLS 1.3** = on — verified `openssl s_client -tls1_3` succeeds with `TLS_AES_256_GCM_SHA384`
- [x] Verify via Cloudflare edge: `curl -I https://batuda.co` (expect no 525) — returns HTTP/2 307 to `/login` (auth-gated, not 200 because every route requires session; goal of "TLS handshake succeeds end-to-end through CF edge" is met)
- [ ] Verify SSL Labs grade A on `batuda.co` — gated on origin deploy

### (Deferred) Hardening — restrict origin to Cloudflare-only traffic

LE at origin means anyone with the UKC IP can probe it directly with a valid
TLS handshake. To force traffic through Cloudflare, follow up with
Authenticated Origin Pulls (mTLS): Cloudflare presents a client cert on every
edge → origin connection, KraftCloud verifies it. Requires UKC listener-level
mTLS support — verify with KraftCloud first.

- [ ] Verify UKC supports listener-side client-cert verification (kraft cloud / KraftCloud docs / support ticket)
- [ ] If supported: Cloudflare → SSL/TLS → Origin Server → **Authenticated Origin Pulls** = on, enable per-hostname for `batuda.co`, configure UKC listener to require + verify CF's AOP CA
- [ ] If not supported: file an issue, document the residual risk in PLAN.md

### Optional follow-ups

- [ ] Bump `release:internal` once verified, set up CalVer tag flow
- [ ] Add a basic `/health` route to internal so the workflow's verify step has a real signal
- [ ] Document the web app login flow once Better Auth is wired through the server

---

## Phase 2 — Server (`apps/server` → `api.batuda.co`)

> **PR shape — Slice 1 (env hygiene), 3 commits in one PR**, must merge **before** the production deploy.
> Audit found 2 stale vars (`EMAIL_API_KEY`, `EMAIL_WEBHOOK_SECRET`) that the workflow still passes despite zero code readers (AgentMail leftovers), and **8 + 8 vars the code requires with no defaults** that neither the workflow nor `.env.example.github` declares — server boot crashes today on a fresh prod deploy. The PR fixes both. (Original audit said 5 + 8; the missing var was `CALENDAR_PROVIDER`, the boot selector for `BookingProviderLive` in `packages/calendar/src/infrastructure/live.ts`.)

Commits in PR #1:

- [x] `cicd(deploy): drop stale AgentMail env vars from server deploy`
  - Stripped `-e EMAIL_API_KEY=…` from update + first-create branches
  - Stripped `-e EMAIL_WEBHOOK_SECRET=…` from update + first-create branches
- [x] `cicd(deploy): wire transactional, calendar, and research-budget vars`
  - Added `-e EMAIL_CREDENTIAL_KEY`, `-e EMAIL_API_KEY_TRANSACTIONAL`, `-e EMAIL_FROM_TRANSACTIONAL`, `-e EMAIL_PROVIDER_TRANSACTIONAL`, `-e CALENDAR_PROVIDER`, `-e CALENDAR_API_KEY`, `-e CALENDAR_WEBHOOK_SECRET`, `-e GEOCODER_PROVIDER` to both branches (8 vars — original audit missed `CALENDAR_PROVIDER`, also required at boot)
  - Added the 8 `-e RESEARCH_DEFAULT_*` / `RESEARCH_MAX_*` / `RESEARCH_CONFIRM_*` to both branches
- [x] `docs: align .env.example.github with code env reads`
  - Stripped `EMAIL_API_KEY` and `EMAIL_WEBHOOK_SECRET` lines (and AgentMail commentary)
  - `EMAIL_PROVIDER` was already `local-inbox`, no rename needed
  - Added the 5 newly-required entries with comments naming their consumer (EMAIL_CREDENTIAL_KEY, EMAIL_API_KEY_TRANSACTIONAL, CALENDAR_PROVIDER, CALENDAR_API_KEY, CALENDAR_WEBHOOK_SECRET)
  - Verified all 8 research-budget entries already present
  - Added commented-out optional examples: `MIN_LOG_LEVEL`, `CALENDAR_BASE_URL`, `BATUDA_ACTIVE_ORG_*`, `PORTLESS_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`

Already applied to `deploy_server.yml` (kraft timing knobs, separate from Slice 1):

- [x] `KRAFT_VERSION: v0.12.10` pinned + `--timeout 10s` on both branches + `--rollout-wait 5s` on update branch

### Provision external services

- [ ] **NeonDB** — Postgres
  - [ ] Create project `batuda` in EU (Frankfurt) region
  - [ ] Create role with pooled + direct connection strings
  - [ ] Capture **pooled** `postgres://…?sslmode=require` URL → `DATABASE_URL`
  - [ ] Save the **direct** URL locally for `pnpm db:migrate` (never goes to GH)
  - [ ] Run `DATABASE_URL='<direct-url>' pnpm --filter @batuda/domain db:migrate` against the new database

- [ ] **Cloudflare R2** — object storage (call recordings, raw RFC822, attachments)
  - [ ] Create bucket `batuda-assets`
  - [ ] Create API token (Object Read/Write, scoped to that bucket)
  - [ ] Capture access key ID → `STORAGE_ACCESS_KEY_ID`
  - [ ] Capture secret access key → `STORAGE_SECRET_ACCESS_KEY`
  - [ ] Capture S3 endpoint URL `https://<account>.r2.cloudflarestorage.com` → `STORAGE_ENDPOINT`

- [ ] **Resend** — transactional email (magic links, invitations)
  - [ ] Create API key on resend.com (domain-scoped to `batuda.co`)
  - [ ] Capture key `re_…` → `EMAIL_API_KEY_TRANSACTIONAL`
  - [ ] Decide sender → `EMAIL_FROM_TRANSACTIONAL` (suggested: `Batuda <noreply@batuda.co>`)

- [ ] **Cal.com** — calendar integration
  - [ ] Create API key in cal.com → Settings → Developer → API Keys
  - [ ] Capture `cal_…` → `CALENDAR_API_KEY`
  - [ ] Configure webhook endpoint pointed at `https://api.batuda.co/webhooks/calcom` (after first deploy resolves the URL — placeholder OK initially)
  - [ ] Capture webhook secret → `CALENDAR_WEBHOOK_SECRET`

- [ ] **Brave Search** — research search provider
  - [ ] Provision key on api.search.brave.com (Free tier OK)
  - [ ] Capture `BSA…` → `RESEARCH_API_KEY_SEARCH`

- [ ] **Firecrawl** — research scrape/extract/discover provider
  - [ ] Provision key on firecrawl.dev → API Keys
  - [ ] Capture `fc-…` — paste into all three: `RESEARCH_API_KEY_SCRAPE`, `RESEARCH_API_KEY_EXTRACT`, `RESEARCH_API_KEY_DISCOVER`

- [ ] **Nebius AI Studio** (or whichever LLM provider you set in `RESEARCH_PROVIDER_LLM`) — research LLM
  - [ ] Capture key → `RESEARCH_API_KEY_LLM`
  - [ ] Decide model → `RESEARCH_MODEL_LLM` (suggested: `Qwen/Qwen3-32B`)

- [ ] **Self-generate locally** — random secrets
  - [ ] `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` → `BETTER_AUTH_SECRET` (hex)
  - [ ] `node -e "console.log(crypto.randomBytes(32).toString('base64'))"` → `EMAIL_CREDENTIAL_KEY` (**base64**, not hex — `apps/server/src/services/credential-crypto.ts` decodes with `Buffer.from(..., 'base64')` and dies if the result is not exactly 32 bytes; HKDF master for inbox credential AES-256-GCM; **rotation breaks every encrypted inbox row** — save in a password manager before pasting to GH; must match the mail-worker value in Phase 3)

### Configure GitHub `production` environment

Reference: `.env.example.github`. All values land in the `production` environment, not the repo.

#### Secrets to delete (stale, AgentMail leftovers, zero code readers)

- [x] `gh secret delete EMAIL_API_KEY` — already absent in `production` env (verified via `gh secret list`)
- [x] `gh secret delete EMAIL_WEBHOOK_SECRET` — already absent in `production` env

#### Secrets to set (`gh secret set <NAME> --env production -R guillempuche/batuda`)

Already present:

- [x] `KRAFTCLOUD_TOKEN` — verified via `gh secret list --env production`

To add:

- [ ] `DATABASE_URL` — pooled NeonDB URL
- [ ] `BETTER_AUTH_SECRET` — generated hex
- [ ] `EMAIL_CREDENTIAL_KEY` — generated base64 (must match the value mail-worker will use in Phase 3)
- [ ] `STORAGE_ACCESS_KEY_ID` — R2
- [ ] `STORAGE_SECRET_ACCESS_KEY` — R2
- [ ] `EMAIL_API_KEY_TRANSACTIONAL` — Resend (required because `EMAIL_PROVIDER_TRANSACTIONAL=resend`)
- [ ] `CALENDAR_API_KEY` — Cal.com (required when Calendar layer mounts at boot)
- [ ] `CALENDAR_WEBHOOK_SECRET` — Cal.com webhook
- [ ] `RESEARCH_API_KEY_SEARCH` — Brave
- [ ] `RESEARCH_API_KEY_SCRAPE` — Firecrawl
- [ ] `RESEARCH_API_KEY_EXTRACT` — Firecrawl
- [ ] `RESEARCH_API_KEY_DISCOVER` — Firecrawl
- [ ] `RESEARCH_API_KEY_LLM` — Nebius (or chosen LLM)

#### Variables (`gh variable set <NAME> --env production -R guillempuche/batuda --body "<value>"`)

Quoted values to avoid shell quirks. To set:

- [ ] `BETTER_AUTH_BASE_URL` = `"https://api.batuda.co"`
- [ ] `ALLOWED_ORIGINS` = `"https://batuda.co,https://engranatge.com"` (add each tenant's marketing origin)
- [ ] `STORAGE_ENDPOINT` = `"https://<account>.r2.cloudflarestorage.com"`
- [ ] `STORAGE_REGION` = `"auto"`
- [ ] `STORAGE_BUCKET` = `"batuda-assets"`
- [ ] `EMAIL_PROVIDER` = `"local-inbox"` (the BYO IMAP/SMTP per-inbox path; only literal accepted by `Schema.Literals` today — naming follow-up tracked separately)
- [ ] `EMAIL_PROVIDER_TRANSACTIONAL` = `"resend"`
- [ ] `EMAIL_FROM_TRANSACTIONAL` = `"Batuda <noreply@batuda.co>"`
- [ ] `CALENDAR_PROVIDER` = `"calcom"` (boot selector in `packages/calendar/src/infrastructure/live.ts`)
- [ ] `GEOCODER_PROVIDER` = `"nominatim"`
- [ ] `RESEARCH_PROVIDER_SEARCH` = `"brave"`
- [ ] `RESEARCH_PROVIDER_SCRAPE` = `"firecrawl"`
- [ ] `RESEARCH_PROVIDER_EXTRACT` = `"firecrawl"`
- [ ] `RESEARCH_PROVIDER_DISCOVER` = `"firecrawl"`
- [ ] `RESEARCH_PROVIDER_REGISTRY_ES` = `"librebor"`
- [ ] `RESEARCH_PROVIDER_REPORT_ES` = `"none"`
- [ ] `RESEARCH_PROVIDER_LLM` = `"nebius"`
- [ ] `RESEARCH_MODEL_LLM` = `"Qwen/Qwen3-32B"`
- [ ] `RESEARCH_DEFAULT_BUDGET_CENTS` = `"100"`
- [ ] `RESEARCH_DEFAULT_PAID_BUDGET_CENTS` = `"500"`
- [ ] `RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS` = `"200"`
- [ ] `RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS` = `"2000"`
- [ ] `RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS` = `"10000"`
- [ ] `RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL` = `"3"`
- [ ] `RESEARCH_MAX_CONCURRENCY_FANOUT` = `"3"`
- [ ] `RESEARCH_CONFIRM_THRESHOLD_FANOUT` = `"10"`

### DNS

- [x] Cloudflare → batuda.co → DNS → add CNAME `api` → `fra.unikraft.app` (**proxied**, orange cloud) — record id `0b18987335bda3e69926b3ace118c8c7`
- [x] Wait ~5 min, confirm `dig +short api.batuda.co` returns Cloudflare proxy IPs — verified `104.21.87.42`, `172.67.140.144`

### Deploy

- [ ] Confirm Slice 1 PR is merged on `main`
- [ ] Trigger workflow: `gh workflow run deploy_server.yml -R guillempuche/batuda`
- [ ] Watch run: `gh run watch -R guillempuche/batuda`
- [ ] Confirm cert: `kraft cloud --metro fra certificate list | grep api.batuda.co`
- [ ] Confirm instance: `kraft cloud --metro fra instance list | grep batuda-server`
- [ ] **Boot smoke**: `curl -sf https://api.batuda.co/health` returns 200 (proves every required `Config.*` read succeeded)
- [ ] Tail logs once if smoke fails: `kraft cloud --metro fra instance logs <instance-name>`

### Functional verification (separate from boot)

- [ ] Trigger a magic-link sign-in via `apps/internal` → email arrives via Resend
- [ ] Hit a real endpoint that touches the database (e.g. company search) → returns data
- [ ] Trigger an outbound email through a connected inbox → SMTP send succeeds, message APPENDed to Sent folder
- [ ] Upload a test recording to R2 via the server, verify it lands in the bucket
- [ ] Confirm cookies set by Better Auth resolve under `.batuda.co`
- [ ] Refresh `CALENDAR_WEBHOOK_SECRET` in Cal.com against the now-resolvable `https://api.batuda.co/webhooks/calcom`

---

## Phase 3 — Mail-worker (`apps/mail-worker`, no public domain)

> **PR shape — Slice 2 (mail-worker deploy), 4 commits in one PR**, after Slice 1 merges.
> Mail-worker is a long-running egress-only Node process holding one IMAP IDLE connection per `inboxes` row. Multi-tenant scaling is via Postgres advisory locks (`apps/mail-worker/src/claim.ts`) — add replicas to scale horizontally; per-replica cap `EMAIL_WORKER_MAX_CONNECTIONS=50`. No public listener; relies on `EMAIL_CREDENTIAL_KEY` byte-for-byte matching the server's value (cred decryption fails on mismatch).

Commits:

- [ ] `feat(mail-worker): add Dockerfile + Kraftfile for KraftCloud`
- [ ] `ci(mail-worker): add deploy workflow`
- [ ] `chore(release): add mail-worker target to release skill + release-it config`
- [ ] `docs: TODO_DEPLOYMENT.md Phase 3 mail-worker`

### Build artefacts (Slice 2, PR #2)

- [ ] Add `apps/mail-worker/Dockerfile` (Node 22 slim, `COPY dist/`, `ENTRYPOINT ["node","main.mjs"]`, **no `EXPOSE`**)
- [ ] Add `apps/mail-worker/Kraftfile` (Node runtime spec, **no `services:` block** — egress-only)
- [ ] Verify UKC accepts a service with no listener via `kraft cloud service create --help`; if it requires ≥1, expose `:9000/internal` (no public domain) for a future `/healthz`

### Deploy workflow (Slice 2, PR #2)

- [ ] Add `.github/workflows/deploy_mail-worker.yml`, mirroring `deploy_web.yml`:
  - [ ] Tag prefix `mail-worker-v*`
  - [ ] Concurrency group `deploy-mail-worker`
  - [ ] `cp apps/mail-worker/{Kraftfile,Dockerfile} .`
  - [ ] Service name `batuda-mail-worker`
  - [ ] First-create branch: `kraft cloud service create --name batuda-mail-worker` with **no `-d`, no `-c`, no `443:…` listener** (or `:9000/internal` if UKC mandates one)
  - [ ] Update branch: `kraft cloud deploy --service batuda-mail-worker --rollout remove_sequential --rollout-wait 5s --timeout 10s -M 512`
  - [ ] Kraft CLI pinned `v0.12.10`
  - [ ] Replace HTTP `Verify deployment` step with `kraft cloud --metro fra instance logs <id> | grep 'mail-worker: starting'`

### Release skill update (Slice 2, PR #2)

- [ ] Add `mail-worker` as a 4th release target to `.claude/skills/release/SKILL.md`:
  - [ ] Description triggers add `"release mail-worker"`
  - [ ] Step 2 accepted values: `server`, `internal`, `ui`, `mail-worker`, `all`
  - [ ] Step 2 AskUserQuestion: 4th option *Mail-worker — IMAP IDLE worker (`mail-worker-v*` tag → auto-deploys)*
  - [ ] Step 2 "All" semantics: *Server → Internal → UI → Mail-worker* (mail-worker last, so any server-side migration lands first)
  - [ ] Step 3: add `git describe --match='mail-worker-v[0-9]*.[0-9]*.[0-9]*'` block
  - [ ] Step 4: add `pnpm release:mail-worker:dry`
  - [ ] Step 4.5: explicitly note migrations run only on `server`/`all`; mail-worker alone never triggers them
  - [ ] Step 5: add `GITHUB_TOKEN=$(gh auth token) pnpm release:mail-worker --ci`
  - [ ] Step 6: add watch block for `deploy_mail-worker.yml`
  - [ ] Step 7: add Mail-worker verify (`kraft cloud instance list | grep batuda-mail-worker`, `kraft cloud instance logs <id> | head -10`)
  - [ ] Config Reference: add `.release-it.mail-worker.cjs`
  - [ ] Commit Path Tracking: add Mail-worker bullet (`apps/mail-worker` + workspace deps; includes `@batuda/server` per its package.json — server changes mark mail-worker releasable)
- [ ] Add `.release-it.mail-worker.cjs` (mirrors `.release-it.server.cjs`, calls `getCommitPaths('apps/mail-worker')`)
- [ ] Add `release:mail-worker` and `release:mail-worker:dry` scripts to root `package.json`
- [ ] No changes to `scripts/release-utils.cjs` — the workspace dep walker is already generic

### GitHub `production` env additions

Most secrets/vars are reused from Phase 2. The worker only adds optional knobs (defaults exist in code):

- [ ] (optional, override only if needed) `gh variable set EMAIL_WORKER_MAX_CONNECTIONS --env production --body "50"`
- [ ] (optional) `gh variable set EMAIL_WORKER_BACKFILL_DAYS --env production --body "30"`
- [ ] (optional) `gh variable set EMAIL_WORKER_IDLE_TIMEOUT_SEC --env production --body "1740"`

### Deploy

- [ ] Confirm Slice 2 PR is merged on `main`
- [ ] `pnpm release:mail-worker:dry` — verify expected version (CalVer) and changelog
- [ ] `GITHUB_TOKEN=$(gh auth token) pnpm release:mail-worker --ci` (tags `mail-worker-v<calver>` and pushes)
- [ ] `gh run watch -R guillempuche/batuda` until green
- [ ] `kraft cloud --metro fra service get batuda-mail-worker -o json` shows `persistent: true`, no autoscale policy
- [ ] `kraft cloud --metro fra instance list | grep batuda-mail-worker` shows running
- [ ] `kraft cloud --metro fra instance logs <id> | head -20` shows `"mail-worker: starting"` and `"mail-worker: env loaded"`

### Functional verification

- [ ] From `apps/internal` UI, add a real test IMAP inbox (Infomaniak / Fastmail / etc.)
- [ ] Within 5s, `instance logs` shows `"mail-worker: claimed inbox=<uuid>"` and an `IDLE` line
- [ ] Send a test email to that mailbox externally → within 2s, a new row appears in `email_messages` and the raw RFC822 lands at `messages/<org>/<inbox>/<uidvalidity>/<uid>.eml` in R2

### Release-skill regression test

- [ ] Run `/release server` (without args, picks server) → only `deploy_server.yml` runs
- [ ] `kraft cloud --metro fra service get batuda-mail-worker` shows the same `instances:` value as before — confirms server release doesn't disturb mail-worker

---

## Phase 4 — Cross-cutting

- [x] Add a `Verify deployment` step to the internal workflow (mirror the one in `deploy_server.yml`) — already present in `deploy_web.yml`
- [ ] Decide on alerting: KraftCloud email vs Better Stack vs OpenTelemetry exporter (and wire `OTEL_EXPORTER_OTLP_*` if chosen)
- [ ] Document the rollback procedure (`kraft cloud instance stop <previous>` + redeploy previous tag)
- [ ] Once all three services exist, audit `kraft cloud --metro fra image list` and prune old image versions
- [ ] Rename the `EMAIL_PROVIDER='local-inbox'` literal in code (current schema accepts only this one value, semantics is "BYO per-inbox creds" not "local dev catcher" — track as code follow-up, not config change)
- [ ] Implement `LISTEN inbox_changed` wake-on-NOTIFY in mail-worker (drops claim latency from 5s to <1s; comment in `apps/mail-worker/src/main.ts:20-22` flags it as a future revision)
