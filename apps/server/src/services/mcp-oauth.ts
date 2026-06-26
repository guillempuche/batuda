import { Effect, Layer, ServiceMap } from 'effect'
import type { PoolClient } from 'pg'

import { Forbidden } from '@batuda/controllers'

import { Auth } from '../lib/auth'

// A user's MCP OAuth connection: an OAuth client they've consented to, the
// orgs its access tokens may act in (empty until chosen), and the host of
// its first redirect URI. The host is provenance — the client `name` is
// self-asserted at registration, but the redirect host is where it actually
// sends the user, so the UI can show it rather than trust the name alone.
export interface McpConnection {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string
	readonly organizationIds: ReadonlyArray<string>
	readonly redirectHost: string | null
}

interface ConnectionRow {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string | Date
	readonly organizationIds: ReadonlyArray<string> | null
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

// Binds a `(user, OAuth client)` connection to the set of organizations its
// MCP access tokens may act in. The `/mcp` Bearer path reads
// `mcp_oauth_org_membership`; single-org users are auto-resolved there,
// multi-org users pick one or more orgs here and then send an
// `X-Batuda-Organization-Id` hint per request. Open DCR leaves
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
				// Set the set of organizations a connection may act in. The full
				// target list is applied atomically: rows for orgs in the list are
				// upserted, rows for orgs not in the list are deleted. Every org in
				// the list must be a live membership — a single missing one rejects
				// the whole call and writes nothing, so a partial submission can't
				// widen what the connection can later reach. The /mcp path re-checks
				// membership too, so a later departure can't be exploited even if a
				// stale row lingers.
				selectOrgs: (
					userId: string,
					clientId: string,
					organizationIds: ReadonlyArray<string>,
				): Effect.Effect<void, Forbidden> =>
					Effect.gen(function* () {
						// An empty list is a valid "unbind everything" — no membership
						// check needed, just delete the caller's rows for this client.
						if (organizationIds.length === 0) {
							yield* withResolverTx(userId, async client => {
								await client.query(
									`DELETE FROM mcp_oauth_org_membership
									 WHERE user_id = $1 AND client_id = $2`,
									[userId, clientId],
								)
							})
							return
						}
						const ok = yield* withResolverTx(userId, async client => {
							// Verify membership for every requested org in one read.
							// RLS confines member to the caller's rows, so this can't
							// accidentally count another user's membership.
							const member = await client.query(
								`SELECT "organizationId" FROM member
								 WHERE "userId" = $1 AND "organizationId" = ANY($2)`,
								[userId, organizationIds as string[]],
							)
							if (member.rowCount !== organizationIds.length) {
								return false
							}
							// Upsert the requested orgs and delete the rest in one
							// transaction. The membership check above ran inside the
							// same resolver scope, so the WITH CHECK policy holds.
							const values = organizationIds
								.map((_, i) => `($1, $2, $${i + 3}::text, now())`)
								.join(', ')
							await client.query(
								`INSERT INTO mcp_oauth_org_membership
								     (user_id, client_id, organization_id, updated_at)
								 VALUES ${values}
								 ON CONFLICT (user_id, client_id, organization_id)
								 DO UPDATE SET updated_at = now()`,
								[userId, clientId, ...organizationIds] as string[],
							)
							await client.query(
								`DELETE FROM mcp_oauth_org_membership
								 WHERE user_id = $1 AND client_id = $2
								   AND organization_id <> ALL($3::text[])`,
								[userId, clientId, organizationIds as string[]],
							)
							return true
						})
						if (!ok)
							return yield* new Forbidden({
								message: 'Not a member of every requested organization',
							})
					}),

				// The caller's connections: OAuth clients they've consented to,
				// with the orgs each is currently bound to (empty until chosen).
				// Aggregated with array_agg so one row per connection carries the
				// full org list, instead of one row per (connection, org).
				listConnections: (
					userId: string,
				): Effect.Effect<ReadonlyArray<McpConnection>> =>
					Effect.gen(function* () {
						const result = yield* withResolverTx(userId, client =>
							client.query<ConnectionRow>(
								`SELECT c."clientId"            AS "clientId",
								        oc.name               AS name,
								        oc."redirectUris"     AS "redirectUris",
								        c."createdAt"         AS "createdAt",
								        COALESCE(
								          array_agg(sel.organization_id ORDER BY sel.organization_id)
								          FILTER (WHERE sel.organization_id IS NOT NULL),
								          ARRAY[]::text[]
								        )                    AS "organizationIds"
								 FROM "oauthConsent" c
								 JOIN "oauthClient" oc ON oc."clientId" = c."clientId"
								 LEFT JOIN mcp_oauth_org_membership sel
								   ON sel.user_id = c."userId" AND sel.client_id = c."clientId"
								 WHERE c."userId" = $1
								 GROUP BY c."clientId", oc.name, oc."redirectUris", c."createdAt"
								 ORDER BY c."createdAt" DESC`,
								[userId],
							),
						)
						return result.rows.map(row => ({
							clientId: row.clientId,
							name: row.name,
							createdAt: new Date(row.createdAt).toISOString(),
							organizationIds: row.organizationIds ?? [],
							redirectHost: firstRedirectHost(row.redirectUris),
						}))
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
