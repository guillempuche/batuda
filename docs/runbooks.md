# Runbooks

Operational procedures for production. Add a new section per procedure.

## Rotating `BETTER_AUTH_SECRET`

`BETTER_AUTH_SECRET` does double duty: it signs sessions/cookies **and** it encrypts the JWKS private key Better Auth uses to sign OAuth / MCP / web-chat access tokens. Because of that second role you **cannot rotate the secret on its own** — the stored signing key was encrypted with the *old* secret, and Better Auth keeps trying to decrypt it with the new one and fails (`BetterAuthError: Failed to decrypt private key`), so every token sign breaks until the key is cleared. It does **not** self-heal: unless a key has expired, the existing one is reused and never regenerated, so the broken state persists indefinitely on its own (mechanism in `docs/repos/better-auth/packages/better-auth/src/plugins/jwt/sign.ts:117-132` — the key is only re-minted when it is missing or past its `expiresAt`, and with no rotation configured it has no `expiresAt`; tracked in issue #59).

### Procedure (do these in order, during low traffic)

1. **Update the secret** in the production environment (deploy secret / KraftCloud env), then deploy and confirm the new secret is live.
2. **Clear the JWKS** so a fresh signing key is minted with the new secret on the next request — run against the production database (Neon console / psql):
   ```sql
   DELETE FROM jwks;
   ```
   **Order matters: clear `jwks` only *after* the new secret is live, never before.** If you clear it first, a request landing in the gap re-mints a key encrypted with the *old* secret and you are back to square one. The signing key lives in the shared database, not per-process, so this single statement covers every server and mail-worker instance at once — no per-instance step.
3. **Verify**: hit an endpoint that signs an OAuth / MCP token (or run the `oauth-auth` integration tests) and confirm there are no `Failed to decrypt private key` errors in the logs.

### Impact to expect

- Clearing `jwks` invalidates the old signing key, so **access tokens signed with it stop verifying** until clients refresh. The prod access-token TTL is short (`OAUTH_ACCESS_TOKEN_TTL_SECONDS`, 900s), so the window is small — still, prefer a quiet moment.
- Sessions/cookies signed with the old secret also invalidate (users re-login).

### Avoiding the coupling later (optional)

- Set the jwt plugin's `rotationInterval` so keys expire and regenerate on a schedule, or
- weigh `jwks.disablePrivateKeyEncryption` — removes the secret↔key coupling but stores the signing private key **unencrypted** in the DB.

## Applying database migrations

Where migrations run depends on the environment, and the boundary is deliberate.

**Local / worktree** — `pnpm db:migrate` runs against your local stack, with `DATABASE_URL` from `.env`. It echoes its target first — e.g. `Migration target: "batuda_feature_x" on localhost (local)` — so you can see which database you are about to touch.

**Production** — migrations run **in the deploy pipeline, never from a laptop**: the `Deploy Server` workflow applies them against the prod database immediately before `kraft cloud deploy`. There is intentionally no `db:migrate:prod` script. A required reviewer on the `production-db` GitHub environment gates the `migrate` job specifically, so it pauses for a one-click approval before any prod schema change lands — a final human checkpoint. Routine deploys (web, mail-worker, the server `deploy` job) are not gated. `MIGRATION_DATABASE_URL` lives on `production-db`.

### Connection: schema owner, direct endpoint

Migrations use a **different connection from the app runtime** on two axes, so they get their own secret (`MIGRATION_DATABASE_URL`) rather than reusing `DATABASE_URL`:

- **Role `neondb_owner`**, not the runtime `app_service`. Migrations issue DDL plus `REVOKE`/`GRANT`/`ALTER DEFAULT PRIVILEGES` that wire RLS for `app_user` and `app_mcp_resolver` — only the schema owner may. `app_service` (BYPASSRLS) fails these with permission errors.
- **Direct (unpooled) endpoint.** Neon's pooler is PgBouncer in transaction mode and drops the advisory locks + cross-statement transactions the migrators hold; `migrate.ts` refuses a pooled host outright.

CI gets the same shape for free — its Neon branch is created with `role: neondb_owner` on the action's direct branch URL. Runtime (`DATABASE_URL`) stays `app_service` + pooled-capable; the server `SET LOCAL ROLE app_user` / `app_mcp_resolver` per request for RLS.

### Rolling-deploy compatibility

The deploy is a rolling update — the old instance keeps serving while the new one boots — so each migration must stay **backward-compatible with the running version**. Add the new shape now (a nullable/defaulted column, a new table) and drop or tighten the old shape in a **later** release; renaming or dropping a column the live version still reads breaks requests mid-rollout.

CI enforces this on every PR: `scripts/check-migration-safety.mjs` fails when a newly added migration drops/renames a column, drops a table, truncates, or adds a `NOT NULL` column without a default — unless the file opts in with an `// expand-contract: <reason>` marker. The marker is the deliberate escape hatch for a change that's safe despite the rule (the old reader shipped a release ago, or pre-production with no live instance to break) — it forces you to write down *why* rather than dropping silently.

### Rehearsing and re-running

For a destructive or large change, rehearse on a Neon branch first (branch prod → apply → verify → let the pipeline run it on prod); CI already runs every migration on an ephemeral Neon branch per PR. The migrator is incremental — it records applied migrations and a re-run only applies the pending ones, so a re-run after a partial failure resumes safely.
