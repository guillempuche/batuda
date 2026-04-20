# TODO — Deployment

Remaining work to bring `apps/internal` (the Batuda web app) and `apps/server` (API) live on KraftCloud.

Each tenant's public marketing site is deployed from its own repo (e.g. the first
tenant's site at `engranatge.com` ships from `engranatge-marketing`). See
`.github/workflows/deploy_*.yml` for the workflow definitions in this repo and
`.env.example.github` for the secrets/vars reference.

---

## Background

The two Batuda apps in this repo share the same deploy pattern (each tenant marketing repo follows the same pattern):

1. Cloudflare DNS record (CNAME → `fra.unikraft.app`, **DNS only** — gray cloud)
2. GitHub Actions workflow (`deploy_<app>.yml`) triggered by tag push or `workflow_dispatch`
3. Workflow probes `kraft cloud service get <name>` to decide between rolling update
   (`--service`) and first-time creation (`--name -d -p`)
4. KraftCloud requests a Let's Encrypt cert during the first `-d <domain>` deploy
5. Cloudflare proxy stays **off** for any host with a KraftCloud cert
   (blocked by [unikraft/kraftkit#2639](https://github.com/unikraft/kraftkit/issues/2639))

---

## Phase 1 — Batuda web app (`apps/internal` → `batuda.co`)

No runtime secrets needed; the workflow only reads `KRAFTCLOUD_TOKEN`.

### DNS

- [x] Cloudflare → batuda.co → DNS → add CNAME `@` → `fra.unikraft.app` (DNS only, gray cloud)
- [x] Wait ~5 min for propagation
- [x] Confirm: `dig +short batuda.co` returns a `fra.unikraft.app` CNAME chain

### Deploy

- [ ] Trigger workflow: `gh workflow run deploy_internal.yml -R guillempuche/batuda`
- [ ] Watch run: `gh run watch -R guillempuche/batuda`
- [ ] Confirm cert issued: `kraft cloud --metro fra certificate list | grep batuda.co`
- [ ] Confirm instance running: `kraft cloud --metro fra instance list | grep batuda-web`
- [ ] Smoke test: `curl -sI https://batuda.co | head -5`

### Optional follow-ups

- [ ] Bump `release:internal` once verified, set up CalVer tag flow
- [ ] Add a basic `/health` route to internal so the workflow's verify step has a real signal
- [ ] Document the web app login flow once Better Auth is wired through the server

---

## Phase 2 — Server (`apps/server` → `api.batuda.co`)

The server depends on external infrastructure (NeonDB, Cloudflare R2, AgentMail) and
references several GitHub secrets/variables that **do not exist yet** in the
`production` environment. Provision those first.

### Provision external services

- [ ] **NeonDB**
  - [ ] Create project `batuda` in EU (Frankfurt) region
  - [ ] Create pooled connection role
  - [ ] Run `pnpm --filter @batuda/domain db:migrate` against the new database
  - [ ] Capture pooled `postgres://…?sslmode=require` URL
- [ ] **Cloudflare R2**
  - [ ] Create bucket `batuda-assets`
  - [ ] Create API token (Object Read/Write, scoped to that bucket)
  - [ ] Capture access key ID, secret, S3-compatible endpoint URL
- [ ] **AgentMail**
  - [ ] Provision tenant + inbox
  - [ ] Capture `EMAIL_API_KEY`
  - [ ] Configure webhook endpoint `https://api.batuda.co/webhooks/email` and capture `EMAIL_WEBHOOK_SECRET`
- [ ] **Better Auth secret**
  - [ ] Generate: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`

### Configure GitHub `production` environment

Reference: `.env.example.github`. All values land in the `production` environment, not the repo.

#### Secrets (`gh secret set <NAME> --env production -R guillempuche/batuda`)

- [ ] `DATABASE_URL` — NeonDB pooled connection string
- [ ] `BETTER_AUTH_SECRET` — generated above
- [ ] `STORAGE_ACCESS_KEY_ID` — R2 access key
- [ ] `STORAGE_SECRET_ACCESS_KEY` — R2 secret
- [ ] `EMAIL_API_KEY` — AgentMail API key
- [ ] `EMAIL_WEBHOOK_SECRET` — AgentMail webhook secret

#### Variables (`gh variable set <NAME> --env production -R guillempuche/batuda --body "<value>"`)

- [ ] `BETTER_AUTH_BASE_URL` = `https://api.batuda.co`
- [ ] `ALLOWED_ORIGINS` = `https://batuda.co,https://engranatge.com` (add each tenant's marketing origin)
- [ ] `STORAGE_ENDPOINT` = `https://<account>.r2.cloudflarestorage.com`
- [ ] `STORAGE_REGION` = `auto`
- [ ] `STORAGE_BUCKET` = `batuda-assets`
- [ ] `EMAIL_PROVIDER` = `agentmail`

### DNS

- [x] Cloudflare → batuda.co → DNS → add CNAME `api` → `fra.unikraft.app` (DNS only)
- [x] Wait ~5 min, confirm `dig +short api.batuda.co`

### Deploy

- [ ] Trigger workflow: `gh workflow run deploy_server.yml -R guillempuche/batuda`
- [ ] Watch run: `gh run watch -R guillempuche/batuda`
- [ ] Confirm cert: `kraft cloud --metro fra certificate list | grep api.batuda.co`
- [ ] Confirm instance: `kraft cloud --metro fra instance list | grep batuda-server`
- [ ] Smoke test: `curl -sf https://api.batuda.co/health`
- [ ] Tail logs once if smoke fails: `kraft cloud --metro fra instance logs <instance-name>`

### Post-deploy verification

- [ ] Hit a real endpoint that touches the database (e.g. company search) from the Batuda web app
- [ ] Trigger an outbound email through AgentMail and confirm it leaves
- [ ] Upload a test recording to R2 via the server, verify it lands in the bucket
- [ ] Confirm cookies set by Better Auth resolve under `.batuda.co`

---

## Phase 3 — Cross-cutting

- [ ] Add a `Verify deployment` step to the internal workflow (mirror the one in `deploy_server.yml`)
- [ ] Decide on alerting: KraftCloud email vs Better Stack vs OpenTelemetry exporter
- [ ] Document the rollback procedure (`kraft cloud instance stop <previous>` + redeploy previous tag)
- [ ] Once both services exist, audit `kraft cloud --metro fra image list` and prune old image versions
