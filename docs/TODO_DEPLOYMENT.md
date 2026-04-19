# TODO — Deployment

Remaining work to bring `apps/internal` (Forja CRM) and `apps/server` (API) live on KraftCloud.

The public marketing site at `engranatge.com` is deployed from the separate
`engranatge-marketing` repo. See `.github/workflows/deploy_*.yml` for the workflow
definitions in this repo and `.env.example.github` for the secrets/vars reference.

---

## Background

The two CRM apps in this repo share the same deploy pattern (the marketing repo follows the same pattern):

1. Cloudflare DNS record (CNAME → `fra.unikraft.app`, **DNS only** — gray cloud)
2. GitHub Actions workflow (`deploy_<app>.yml`) triggered by tag push or `workflow_dispatch`
3. Workflow probes `kraft cloud service get <name>` to decide between rolling update
   (`--service`) and first-time creation (`--name -d -p`)
4. KraftCloud requests a Let's Encrypt cert during the first `-d <domain>` deploy
5. Cloudflare proxy stays **off** for any host with a KraftCloud cert
   (blocked by [unikraft/kraftkit#2639](https://github.com/unikraft/kraftkit/issues/2639))

---

## Phase 1 — Forja (`apps/internal` → `forja.engranatge.com`)

No runtime secrets needed; the workflow only reads `KRAFTCLOUD_TOKEN`.

### DNS

- [x] Cloudflare → engranatge.com → DNS → add CNAME `forja` → `fra.unikraft.app` (DNS only, gray cloud)
- [x] Wait ~5 min for propagation
- [x] Confirm: `dig +short forja.engranatge.com` returns a `fra.unikraft.app` CNAME chain

### Deploy

- [ ] Trigger workflow: `gh workflow run deploy_internal.yml -R guillempuche/engranatge`
- [ ] Watch run: `gh run watch -R guillempuche/engranatge`
- [ ] Confirm cert issued: `kraft cloud --metro fra certificate list | grep forja.engranatge.com`
- [ ] Confirm instance running: `kraft cloud --metro fra instance list | grep engranatge-internal`
- [ ] Smoke test: `curl -sI https://forja.engranatge.com | head -5`

### Optional follow-ups

- [ ] Bump `release:internal` once verified, set up CalVer tag flow
- [ ] Add a basic `/health` route to internal so the workflow's verify step has a real signal
- [ ] Document Forja login flow once Better Auth is wired through the server

---

## Phase 2 — Server (`apps/server` → `api.engranatge.com`)

The server depends on external infrastructure (NeonDB, Cloudflare R2, AgentMail) and
references several GitHub secrets/variables that **do not exist yet** in the
`production` environment. Provision those first.

### Provision external services

- [ ] **NeonDB**
  - [ ] Create project `engranatge` in EU (Frankfurt) region
  - [ ] Create pooled connection role
  - [ ] Run `pnpm --filter @engranatge/domain db:migrate` against the new database
  - [ ] Capture pooled `postgres://…?sslmode=require` URL
- [ ] **Cloudflare R2**
  - [ ] Create bucket `engranatge-recordings`
  - [ ] Create API token (Object Read/Write, scoped to that bucket)
  - [ ] Capture access key ID, secret, S3-compatible endpoint URL
- [ ] **AgentMail**
  - [ ] Provision tenant + inbox
  - [ ] Capture `EMAIL_API_KEY`
  - [ ] Configure webhook endpoint `https://api.engranatge.com/webhooks/email` and capture `EMAIL_WEBHOOK_SECRET`
- [ ] **Better Auth secret**
  - [ ] Generate: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`

### Configure GitHub `production` environment

Reference: `.env.example.github`. All values land in the `production` environment, not the repo.

#### Secrets (`gh secret set <NAME> --env production -R guillempuche/engranatge`)

- [ ] `DATABASE_URL` — NeonDB pooled connection string
- [ ] `BETTER_AUTH_SECRET` — generated above
- [ ] `STORAGE_ACCESS_KEY_ID` — R2 access key
- [ ] `STORAGE_SECRET_ACCESS_KEY` — R2 secret
- [ ] `EMAIL_API_KEY` — AgentMail API key
- [ ] `EMAIL_WEBHOOK_SECRET` — AgentMail webhook secret

#### Variables (`gh variable set <NAME> --env production -R guillempuche/engranatge --body "<value>"`)

- [ ] `BETTER_AUTH_BASE_URL` = `https://api.engranatge.com`
- [ ] `ALLOWED_ORIGINS` = `https://forja.engranatge.com,https://engranatge.com`
- [ ] `STORAGE_ENDPOINT` = `https://<account>.r2.cloudflarestorage.com`
- [ ] `STORAGE_REGION` = `auto`
- [ ] `STORAGE_BUCKET` = `engranatge-recordings`
- [ ] `EMAIL_PROVIDER` = `agentmail`

### DNS

- [x] Cloudflare → engranatge.com → DNS → add CNAME `api` → `fra.unikraft.app` (DNS only)
- [x] Wait ~5 min, confirm `dig +short api.engranatge.com`

### Deploy

- [ ] Trigger workflow: `gh workflow run deploy_server.yml -R guillempuche/engranatge`
- [ ] Watch run: `gh run watch -R guillempuche/engranatge`
- [ ] Confirm cert: `kraft cloud --metro fra certificate list | grep api.engranatge.com`
- [ ] Confirm instance: `kraft cloud --metro fra instance list | grep engranatge-server`
- [ ] Smoke test: `curl -sf https://api.engranatge.com/health`
- [ ] Tail logs once if smoke fails: `kraft cloud --metro fra instance logs <instance-name>`

### Post-deploy verification

- [ ] Hit a real endpoint that touches the database (e.g. company search) from Forja
- [ ] Trigger an outbound email through AgentMail and confirm it leaves
- [ ] Upload a test recording to R2 via the server, verify it lands in the bucket
- [ ] Confirm cookies set by Better Auth resolve under `.engranatge.com`

---

## Phase 3 — Cross-cutting

- [ ] Add a `Verify deployment` step to the internal workflow (mirror the one in `deploy_server.yml`)
- [ ] Decide on alerting: KraftCloud email vs Better Stack vs OpenTelemetry exporter
- [ ] Document the rollback procedure (`kraft cloud instance stop <previous>` + redeploy previous tag)
- [ ] Once both services exist, audit `kraft cloud --metro fra image list` and prune old image versions
