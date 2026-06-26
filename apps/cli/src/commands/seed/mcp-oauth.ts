import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'

import type { SeedCtx } from './shared'

// Seeds mock MCP OAuth connections so the /settings/mcp/connections page has
// something to render during local dev and the /debug-apps flow. Without this,
// the page always shows the empty state and the multi-org chip UI can't be
// exercised without running a real OAuth dance.
//
// Two clients are seeded:
//   - "ChatGPT" (redirect host chatgpt.com) — bound to both taller + restaurant,
//     so the multi-org chip UI with per-org remove is visible.
//   - "Claude" (redirect host claude.ai) — bound to only taller, so the
//     single-org-per-connection case is also covered.
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

		// Clean up any prior seed rows (idempotent re-runs).
		yield* sql`DELETE FROM mcp_oauth_org_membership WHERE user_id = ${aliceId} AND client_id LIKE 'mock-%'`
		yield* sql`DELETE FROM "oauthConsent" WHERE "userId" = ${aliceId} AND "clientId" LIKE 'mock-%'`
		yield* sql`DELETE FROM "oauthClient" WHERE "clientId" LIKE 'mock-%'`

		for (const client of MOCK_CLIENTS) {
			const redirectUrisJson = JSON.stringify(client.redirectUris)
			// Register the mock OAuth client.
			yield* sql`
				INSERT INTO "oauthClient" (id, "clientId", "redirectUris", name, "createdAt", "updatedAt")
				VALUES (${randomUUID()}, ${client.clientId}, ${redirectUrisJson}::jsonb, ${client.name}, now(), now())
			`

			// Record consent (Alice approved this client).
			yield* sql`
				INSERT INTO "oauthConsent" (id, "clientId", "userId", scopes, "createdAt", "updatedAt")
				VALUES (${randomUUID()}, ${client.clientId}, ${aliceId}, '["openid"]'::jsonb, now(), now())
			`
		}

		// ChatGPT → authorized for both orgs (multi-org chip UI).
		yield* sql`
			INSERT INTO mcp_oauth_org_membership (user_id, client_id, organization_id, updated_at)
			VALUES
				(${aliceId}, 'mock-chatgpt-client', ${tallerOrgId}, now()),
				(${aliceId}, 'mock-chatgpt-client', ${restaurantOrgId}, now())
			ON CONFLICT (user_id, client_id, organization_id) DO NOTHING
		`

		// Claude → authorized for only taller (single-org-per-connection case).
		yield* sql`
			INSERT INTO mcp_oauth_org_membership (user_id, client_id, organization_id, updated_at)
			VALUES (${aliceId}, 'mock-claude-client', ${tallerOrgId}, now())
			ON CONFLICT (user_id, client_id, organization_id) DO NOTHING
		`

		yield* Effect.logInfo(
			'  mcp-oauth: seeded 2 mock connections (ChatGPT multi-org, Claude single-org)',
		)
	})
