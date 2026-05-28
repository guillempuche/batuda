import { Effect, Layer, ServiceMap } from 'effect'
import type { PoolClient } from 'pg'

import { Forbidden } from '@batuda/controllers'

import { Auth } from '../lib/auth'

// A user's MCP OAuth connection: an OAuth client they've consented to, the org
// its access tokens currently act in (`null` = not yet chosen), and the host of
// its first redirect URI. The host is provenance — the client `name` is
// self-asserted at registration, but the redirect host is where it actually
// sends the user, so the UI can show it rather than trust the name alone.
export interface McpConnection {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string
	readonly organizationId: string | null
	readonly redirectHost: string | null
}

interface ConnectionRow {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string | Date
	readonly organizationId: string | null
	readonly redirectUris: unknown
}

// The host of a client's first registered redirect URI, or null if it has none
// / they're unparseable. Surfaced on the connections page as provenance.
const firstRedirectHost = (redirectUris: unknown): string | null => {
	const uris = Array.isArray(redirectUris) ? redirectUris : []
	const first = uris.find((u): u is string => typeof u === 'string')
	if (first === undefined) return null
	try {
		return new URL(first).host
	} catch {
		return null
	}
}

// Binds a `(user, OAuth client)` connection to the organization its MCP access
// tokens act in. The `/mcp` Bearer path reads `mcp_oauth_org`; single-org users
// are auto-resolved there, multi-org users choose here. Open DCR leaves
// `oauthClient.userId` null, so the user↔client link is `oauthConsent`. These
// reads run on the owner pool but inside an `app_mcp_resolver`-scoped
// transaction, so RLS confines each one to the caller's own rows — a database
// backstop behind the explicit `WHERE userId`, in case a future edit drops it.
export class McpOAuthService extends ServiceMap.Service<McpOAuthService>()(
	'McpOAuthService',
	{
		make: Effect.gen(function* () {
			const auth = yield* Auth

			// Run `fn` in one transaction on the owner pool, scoped to the
			// app_mcp_resolver role with this user's id in `app.current_user_id`.
			// The role's RLS policies key on that GUC, so a query that forgets or
			// botches its `WHERE userId` still can't read or write another user's
			// rows. Infra faults die as defects, keeping callers' error unions clean.
			const withResolverTx = <A>(
				userId: string,
				fn: (client: PoolClient) => Promise<A>,
			): Effect.Effect<A> =>
				Effect.tryPromise(async () => {
					const client = await auth.pool.connect()
					try {
						await client.query('BEGIN')
						await client.query('SET LOCAL ROLE app_mcp_resolver')
						await client.query(
							"SELECT set_config('app.current_user_id', $1, true)",
							[userId],
						)
						try {
							const result = await fn(client)
							await client.query('COMMIT')
							return result
						} catch (error) {
							// Preserve the original failure — a ROLLBACK on a dead
							// connection can throw and would otherwise mask the cause.
							await client.query('ROLLBACK').catch(() => {})
							throw error
						}
					} finally {
						client.release()
					}
				}).pipe(Effect.orDie)

			return {
				// Bind a connection to an org the caller is still a member of. The
				// /mcp path re-checks membership too, so a later departure can't be
				// exploited even if a stale selection lingers. The membership read +
				// the upsert share the resolver scope, and the WITH CHECK policy
				// rejects writing a row for anyone but the caller.
				selectOrg: (
					userId: string,
					clientId: string,
					organizationId: string,
				): Effect.Effect<void, Forbidden> =>
					Effect.gen(function* () {
						const isMember = yield* withResolverTx(userId, async client => {
							const member = await client.query(
								'SELECT 1 FROM member WHERE "userId" = $1 AND "organizationId" = $2 LIMIT 1',
								[userId, organizationId],
							)
							if (member.rowCount === 0) return false
							await client.query(
								`INSERT INTO mcp_oauth_org (user_id, client_id, organization_id, updated_at)
								 VALUES ($1, $2, $3, now())
								 ON CONFLICT (user_id, client_id)
								 DO UPDATE SET organization_id = EXCLUDED.organization_id, updated_at = now()`,
								[userId, clientId, organizationId],
							)
							return true
						})
						if (!isMember)
							return yield* new Forbidden({
								message: 'Not a member of that organization',
							})
					}),

				// The caller's connections: OAuth clients they've consented to, with
				// the org each is currently bound to (LEFT JOIN — null until chosen).
				listConnections: (
					userId: string,
				): Effect.Effect<ReadonlyArray<McpConnection>> =>
					Effect.gen(function* () {
						const result = yield* withResolverTx(userId, client =>
							client.query<ConnectionRow>(
								`SELECT c."clientId"        AS "clientId",
								        oc.name             AS name,
								        oc."redirectUris"   AS "redirectUris",
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
						)
						return result.rows.map(row => ({
							clientId: row.clientId,
							name: row.name,
							createdAt: new Date(row.createdAt).toISOString(),
							organizationId: row.organizationId,
							redirectHost: firstRedirectHost(row.redirectUris),
						}))
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
