import { Effect } from 'effect'

import { SEED_REFERENCE, type SeedCtx, seedUuid } from './shared'

// Seeds mock MCP OAuth connections so the /settings/mcp/connections page has
// something to render during local dev and the /debug-apps flow. Without this,
// the page always shows the empty state and the multi-org chip UI can't be
// exercised without running a real OAuth dance.
//
// Three clients are seeded:
//   - "ChatGPT" (redirect host chatgpt.com) — bound to both taller + restaurant,
//     so the multi-org chip UI with per-org remove is visible.
//   - "Claude" (redirect host claude.ai) — bound to only taller, so the
//     single-org-per-connection case is also covered.
//   - "Codex" — chosen for both orgs, then cut off from each a different way:
//     taller by Alice herself, restaurant by that organization's owner. Only
//     her own removal can she take back, and nothing else in local dev leaves
//     a connection in either state.
//
// Runs after identities (which create the users + orgs). The OAuth client /
// consent tables are managed by Better Auth but written here directly — the
// AS doesn't expose a "register client + consent" API outside the OAuth flow.

const MOCK_CLIENTS = [
	{
		clientId: 'mock-chatgpt-client',
		name: 'ChatGPT',
		redirectUris: ['https://chatgpt.com/callback'],
	},
	{
		clientId: 'mock-claude-client',
		name: 'Claude',
		redirectUris: ['https://claude.ai/callback'],
	},
	{
		clientId: 'mock-codex-client',
		name: 'Codex',
		redirectUris: ['https://codex.example/callback'],
	},
] as const

export const seedMcpOAuth = (ctx: SeedCtx) =>
	Effect.gen(function* () {
		const { sql, tallerOrgId, restaurantOrgId } = ctx

		// Alice is the multi-org user (member of taller + restaurant) — the
		// right persona to exercise the connections page.
		const aliceRows = yield* sql<{ id: string }>`
			SELECT id FROM "user" WHERE email = 'admin@taller.cat' LIMIT 1
		`
		const aliceId = aliceRows[0]?.id
		if (!aliceId) {
			yield* Effect.logInfo(
				'  mcp-oauth: Alice not found — skipping MCP OAuth seed',
			)
			return
		}

		// Bob owns the restaurant organization, so a removal recorded against him
		// is the real shape of one a member cannot undo.
		const bobRows = yield* sql<{ id: string }>`
			SELECT id FROM "user" WHERE email = 'admin@restaurant.demo' LIMIT 1
		`
		const bobId = bobRows[0]?.id

		// Clean up any prior seed rows (idempotent re-runs).
		yield* sql`DELETE FROM mcp_oauth_revocation WHERE user_id = ${aliceId} AND client_id LIKE 'mock-%'`
		yield* sql`DELETE FROM mcp_oauth_org_membership WHERE user_id = ${aliceId} AND client_id LIKE 'mock-%'`
		yield* sql`DELETE FROM "oauthConsent" WHERE "userId" = ${aliceId} AND "clientId" LIKE 'mock-%'`
		yield* sql`DELETE FROM "oauthClient" WHERE "clientId" LIKE 'mock-%'`

		for (const client of MOCK_CLIENTS) {
			const redirectUrisJson = JSON.stringify(client.redirectUris)
			// Register the mock OAuth client.
			yield* sql`
				INSERT INTO "oauthClient" (id, "clientId", "redirectUris", name, "createdAt", "updatedAt")
				VALUES (${seedUuid('oauth-client', client.clientId)}, ${client.clientId}, ${redirectUrisJson}::jsonb, ${client.name}, ${SEED_REFERENCE}, ${SEED_REFERENCE})
			`

			// Record consent (Alice approved this client).
			yield* sql`
				INSERT INTO "oauthConsent" (id, "clientId", "userId", scopes, "createdAt", "updatedAt")
				VALUES (${seedUuid('oauth-consent', client.clientId)}, ${client.clientId}, ${aliceId}, '["openid"]'::jsonb, ${SEED_REFERENCE}, ${SEED_REFERENCE})
			`
		}

		// ChatGPT → authorized for both orgs (multi-org chip UI).
		yield* sql`
			INSERT INTO mcp_oauth_org_membership (user_id, client_id, organization_id, updated_at)
			VALUES
				(${aliceId}, 'mock-chatgpt-client', ${tallerOrgId}, ${SEED_REFERENCE}),
				(${aliceId}, 'mock-chatgpt-client', ${restaurantOrgId}, ${SEED_REFERENCE})
			ON CONFLICT (user_id, client_id, organization_id) DO NOTHING
		`

		// Claude → authorized for only taller (single-org-per-connection case).
		yield* sql`
			INSERT INTO mcp_oauth_org_membership (user_id, client_id, organization_id, updated_at)
			VALUES (${aliceId}, 'mock-claude-client', ${tallerOrgId}, ${SEED_REFERENCE})
			ON CONFLICT (user_id, client_id, organization_id) DO NOTHING
		`

		// Codex → chosen for both, then cut off from both. The choices are kept
		// under the removals on purpose: that is what lets Alice put back the one
		// she made herself.
		yield* sql`
			INSERT INTO mcp_oauth_org_membership (user_id, client_id, organization_id, updated_at)
			VALUES
				(${aliceId}, 'mock-codex-client', ${tallerOrgId}, ${SEED_REFERENCE}),
				(${aliceId}, 'mock-codex-client', ${restaurantOrgId}, ${SEED_REFERENCE})
			ON CONFLICT (user_id, client_id, organization_id) DO NOTHING
		`
		yield* sql`
			INSERT INTO mcp_oauth_revocation
				(user_id, client_id, organization_id, revoked_at, revoked_by_user_id)
			VALUES (${aliceId}, 'mock-codex-client', ${tallerOrgId}, ${SEED_REFERENCE}, ${aliceId})
			ON CONFLICT (user_id, client_id, organization_id) DO NOTHING
		`
		if (bobId) {
			yield* sql`
				INSERT INTO mcp_oauth_revocation
					(user_id, client_id, organization_id, revoked_at, revoked_by_user_id)
				VALUES (${aliceId}, 'mock-codex-client', ${restaurantOrgId}, ${SEED_REFERENCE}, ${bobId})
				ON CONFLICT (user_id, client_id, organization_id) DO NOTHING
			`
		}

		yield* Effect.logInfo(
			'  mcp-oauth: seeded 3 mock connections (ChatGPT multi-org, Claude single-org, Codex blocked)',
		)
	})
