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
