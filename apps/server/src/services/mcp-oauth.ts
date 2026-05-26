import { Effect, Layer, ServiceMap } from 'effect'

import { Forbidden } from '@batuda/controllers'

import { Auth } from '../lib/auth'

// A user's MCP OAuth connection: an OAuth client they've consented to, plus the
// organization its access tokens currently act in (`null` = not yet chosen).
export interface McpConnection {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string
	readonly organizationId: string | null
}

interface ConnectionRow {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string | Date
	readonly organizationId: string | null
}

// Binds a `(user, OAuth client)` connection to the organization its MCP access
// tokens act in. The `/mcp` Bearer path reads `mcp_oauth_org`; single-org users
// are auto-resolved there, multi-org users choose here. All access goes through
// Better Auth's owner pool — `app_user` has no grants on these tables
// (migrations/0006) — and open DCR leaves `oauthClient.userId` null, so the
// user↔client link is `oauthConsent`.
export class McpOAuthService extends ServiceMap.Service<McpOAuthService>()(
	'McpOAuthService',
	{
		make: Effect.gen(function* () {
			const auth = yield* Auth

			return {
				// Bind a connection to an org the caller is still a member of. The
				// /mcp path re-checks membership too, so a later departure can't be
				// exploited even if a stale selection lingers.
				selectOrg: (
					userId: string,
					clientId: string,
					organizationId: string,
				): Effect.Effect<void, Forbidden> =>
					Effect.gen(function* () {
						const member = yield* Effect.tryPromise(() =>
							auth.pool.query(
								'SELECT 1 FROM member WHERE "userId" = $1 AND "organizationId" = $2 LIMIT 1',
								[userId, organizationId],
							),
						).pipe(Effect.orDie)
						if (member.rowCount === 0)
							return yield* new Forbidden({
								message: 'Not a member of that organization',
							})
						yield* Effect.tryPromise(() =>
							auth.pool.query(
								`INSERT INTO mcp_oauth_org (user_id, client_id, organization_id, updated_at)
								 VALUES ($1, $2, $3, now())
								 ON CONFLICT (user_id, client_id)
								 DO UPDATE SET organization_id = EXCLUDED.organization_id, updated_at = now()`,
								[userId, clientId, organizationId],
							),
						).pipe(Effect.orDie)
					}),

				// The caller's connections: OAuth clients they've consented to, with
				// the org each is currently bound to (LEFT JOIN — null until chosen).
				listConnections: (
					userId: string,
				): Effect.Effect<ReadonlyArray<McpConnection>> =>
					Effect.gen(function* () {
						const result = yield* Effect.tryPromise(() =>
							auth.pool.query<ConnectionRow>(
								`SELECT c."clientId"        AS "clientId",
								        oc.name             AS name,
								        c."createdAt"       AS "createdAt",
								        sel.organization_id AS "organizationId"
								 FROM "oauthConsent" c
								 JOIN "oauthClient" oc ON oc."clientId" = c."clientId"
								 LEFT JOIN mcp_oauth_org sel
								   ON sel.user_id = c."userId" AND sel.client_id = c."clientId"
								 WHERE c."userId" = $1
								 ORDER BY c."createdAt" DESC`,
								[userId],
							),
						).pipe(Effect.orDie)
						return result.rows.map(row => ({
							clientId: row.clientId,
							name: row.name,
							createdAt: new Date(row.createdAt).toISOString(),
							organizationId: row.organizationId,
						}))
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
