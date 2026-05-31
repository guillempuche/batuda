# Runbooks

Operational procedures for production. Add a new section per procedure.

## Rotating `BETTER_AUTH_SECRET`

`BETTER_AUTH_SECRET` does double duty: it signs sessions/cookies **and** it
encrypts the JWKS private key Better Auth uses to sign OAuth / MCP / web-chat
access tokens. Because of that second role you **cannot rotate the secret on
its own** — the stored signing key was encrypted with the *old* secret, and
Better Auth keeps trying to decrypt it with the new one and fails
(`BetterAuthError: Failed to decrypt private key`), so every token sign breaks
until the key is cleared. It does **not** self-heal: a still-valid key is
reused, never regenerated (mechanism in
`docs/repos/better-auth/packages/better-auth/src/plugins/jwt/sign.ts`; tracked
in issue #59).

### Procedure (do these together, during low traffic)

1. **Update the secret** in the production environment (deploy secret /
   KraftCloud env), then deploy.
2. **Clear the JWKS** so a fresh signing key is minted with the new secret on
   the next request — run against the production database (Neon console / psql):
   ```sql
   DELETE FROM jwks;
   ```
3. **Verify**: exercise an endpoint that signs a token (or run the
   `oauth-auth` integration tests) — no "Failed to decrypt" errors.

### Impact to expect

- Clearing `jwks` invalidates the old signing key, so **access tokens signed
  with it stop verifying** until clients refresh. The prod access-token TTL is
  short (`OAUTH_ACCESS_TOKEN_TTL_SECONDS`, 900s), so the window is small —
  still, prefer a quiet moment.
- Sessions/cookies signed with the old secret also invalidate (users re-login).

### Avoiding the coupling later (optional)

- Set the jwt plugin's `rotationInterval` so keys expire and regenerate on a
  schedule, or
- weigh `jwks.disablePrivateKeyEncryption` — removes the secret↔key coupling
  but stores the signing private key **unencrypted** in the DB.
