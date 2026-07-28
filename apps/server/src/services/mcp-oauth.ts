import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import type { PoolClient } from 'pg'

import { BadRequest, Forbidden, NotFound } from '@batuda/controllers'

import { Auth } from '../lib/auth'

// Who may cut off someone else's assistant. An owner or an admin acts for the
// whole organization; everyone else may only manage their own connections.
const MANAGING_ROLES: ReadonlySet<string> = new Set(['owner', 'admin'])

// An organization a connection has been cut off from. `blockedBySelf` marks a
// block the person placed on their own connection — that one lifts when they
// choose the organization again; an owner's does not.
export interface McpConnectionBlock {
	readonly organizationId: string
	readonly blockedBySelf: boolean
}

// A user's MCP OAuth connection: an OAuth client they've consented to, the
// orgs its access tokens may act in (empty until chosen), and the host of
// its first redirect URI. The host is provenance — the client `name` is
// self-asserted at registration, but the redirect host is where it actually
// sends the user, so the UI can show it rather than trust the name alone.
export interface McpConnection {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string
	// Where the connection can act right now.
	readonly organizationIds: ReadonlyArray<string>
	// Everything ever chosen for it, blocked organizations included.
	readonly chosenOrganizationIds: ReadonlyArray<string>
	readonly blocks: ReadonlyArray<McpConnectionBlock>
	readonly redirectHost: string | null
}

interface ConnectionRow {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string | Date
	readonly organizationIds: ReadonlyArray<string> | null
	readonly chosenOrganizationIds: ReadonlyArray<string> | null
	readonly redirectUris: unknown
}

interface RevocationRow {
	readonly clientId: string
	readonly organizationId: string
	readonly revokedByUserId: string
}

// One connection as an owner or an admin sees it: whose it is, what tool last
// used it, and when. Unlike the personal list this spans every member of the
// organization.
export interface OrgMcpConnection {
	readonly clientId: string
	readonly userId: string
	readonly memberName: string | null
	readonly memberEmail: string
	readonly name: string | null
	readonly createdAt: string
	readonly redirectHost: string | null
	readonly client: {
		readonly name: string | null
		readonly version: string | null
	} | null
	readonly lastUsedAt: string | null
	// Set when this organization has cut the connection off. `boundHere` says
	// whether the member it belongs to has still chosen this organization, which
	// decides whether lifting the block hands access back or only clears a record.
	readonly block: {
		readonly byUserId: string
		readonly byName: string | null
		readonly at: string
		readonly boundHere: boolean
	} | null
}

interface OrgConnectionRow {
	readonly clientId: string
	readonly userId: string
	readonly createdAt: string | Date
	readonly name: string | null
	readonly redirectUris: unknown
	readonly memberName: string | null
	readonly memberEmail: string
	// Whether its owner picked this organization for it, and whether they
	// picked any organization at all — together these say if it reaches here.
	readonly boundHere: boolean
	readonly hasAnySelection: boolean
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
export class McpOAuthService extends Context.Service<McpOAuthService>()(
	'McpOAuthService',
	{
		make: Effect.gen(function* () {
			const auth = yield* Auth
			// Revoking runs on the ordinary request connection, not the owner
			// pool: it needs the active organization the request already set, so
			// the database itself can refuse a write aimed at a different one.
			const sql = yield* SqlClient.SqlClient

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
				// Record the organizations a connection may act in, as chosen when
				// the assistant is approved. The full target list is applied
				// atomically: rows for orgs in the list are upserted, rows for orgs
				// not in the list are deleted. Every org in the list must be a live
				// membership — a single missing one rejects the whole call and
				// writes nothing, so a partial submission can't widen what the
				// connection can later reach. The /mcp path re-checks membership
				// too, so a later departure can't be exploited even if a stale row
				// lingers.
				//
				// Taking an organization away is NOT done here — see
				// `revokeConnection`. This call only ever grants.
				selectOrgs: (
					userId: string,
					clientId: string,
					organizationIds: ReadonlyArray<string>,
				): Effect.Effect<void, Forbidden | BadRequest> =>
					Effect.gen(function* () {
						// An empty list is a mistake, not a way to remove access: no
						// chosen org reads as "nobody has chosen yet", which grants
						// every org the person belongs to. Taking access away is
						// `revokeConnection`.
						if (organizationIds.length === 0) {
							return yield* new BadRequest({
								message:
									'Select at least one organization; use revoke to remove access.',
							})
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
							// Approving the connection for an org again lifts a block
							// this same person placed on it. A block placed by an owner
							// is left alone, so nobody can re-admit themselves to an org
							// they were removed from.
							await client.query(
								`DELETE FROM mcp_oauth_revocation
								 WHERE user_id = $1 AND client_id = $2
								   AND organization_id = ANY($3::text[])
								   AND revoked_by_user_id = $1`,
								[userId, clientId, organizationIds as string[]],
							)
							return true
						})
						if (!ok)
							return yield* new Forbidden({
								message: 'Not a member of every requested organization',
							})
					}),

				// Every assistant connection that can currently reach this
				// organization's data, whoever set it up. Owners and admins use it to
				// answer "what can get at our CRM right now?" — a question the
				// per-person list cannot answer.
				//
				// Two reads rather than one join: the consent records are only
				// readable on Better Auth's own database pool (the ordinary request
				// role has no grant on them at all), while the tool and block records
				// are organization-scoped and read as the request role, so each stays
				// behind the strongest isolation it has. The two reads are not one
				// transaction, so a change landing between them shows up in one and
				// not the other until the page is loaded again.
				listOrgConnections: (
					orgId: string,
					actorUserId: string,
				): Effect.Effect<ReadonlyArray<OrgMcpConnection>, Forbidden> =>
					Effect.gen(function* () {
						// The active organization already confines `member`, so the user
						// id alone finds this person's role. No row at all means they are
						// not in this organization, refused like the wrong role.
						const actor = yield* sql<{ role: string | null }>`
							SELECT role FROM member WHERE "userId" = ${actorUserId} LIMIT 1
						`.pipe(Effect.orDie)
						const role = actor[0]?.role ?? null
						if (role === null || !MANAGING_ROLES.has(role)) {
							return yield* new Forbidden({
								message:
									'Only an owner or an admin can see the organization’s connections.',
							})
						}

						const rows = yield* Effect.tryPromise(() =>
							auth.pool.query<OrgConnectionRow>(
								`SELECT c."clientId"        AS "clientId",
								        c."userId"          AS "userId",
								        c."createdAt"       AS "createdAt",
								        oc.name             AS name,
								        oc."redirectUris"   AS "redirectUris",
								        u.name              AS "memberName",
								        u.email             AS "memberEmail",
								        (sel.organization_id IS NOT NULL) AS "boundHere",
								        EXISTS (
								          SELECT 1 FROM mcp_oauth_org_membership any_sel
								          WHERE any_sel.user_id = c."userId"
								            AND any_sel.client_id = c."clientId"
								        )                   AS "hasAnySelection"
								 FROM "oauthConsent" c
								 JOIN "oauthClient" oc ON oc."clientId" = c."clientId"
								 JOIN member m ON m."userId" = c."userId"
								                AND m."organizationId" = $1
								 JOIN "user" u ON u.id = c."userId"
								 LEFT JOIN mcp_oauth_org_membership sel
								   ON sel.user_id = c."userId"
								  AND sel.client_id = c."clientId"
								  AND sel.organization_id = $1
								 ORDER BY u.email, c."createdAt" DESC`,
								[orgId],
							),
						).pipe(
							Effect.orDie,
							Effect.map(r => r.rows),
						)

						// Blocks and tool names live on organization-scoped tables, so
						// these run as the request role and the database confines them
						// to this organization on their own.
						const revoked = yield* sql<{
							userId: string
							clientId: string
							revokedByUserId: string
							revokedAt: Date
						}>`
							SELECT user_id AS "userId", client_id AS "clientId",
							       revoked_by_user_id AS "revokedByUserId",
							       revoked_at AS "revokedAt"
							FROM mcp_oauth_revocation
						`.pipe(Effect.orDie)
						// Only removals someone else made belong here. One a person made
						// on their own connection is theirs to undo, and they already can
						// by choosing the organization again in their own list — showing
						// it to an owner would invite undoing a decision that was never
						// the organization's to make.
						const orgBlockByKey = new Map(
							revoked
								.filter(r => r.revokedByUserId !== r.userId)
								.map(r => [`${r.userId}:${r.clientId}`, r]),
						)
						const revokedKeys = new Set(
							revoked.map(r => `${r.userId}:${r.clientId}`),
						)

						const seen = yield* sql<{
							principalId: string
							userId: string
							clientName: string | null
							clientVersion: string | null
							lastSeenAt: Date | null
						}>`
							SELECT principal_id AS "principalId", user_id AS "userId",
							       client_name AS "clientName",
							       client_version AS "clientVersion",
							       last_seen_at AS "lastSeenAt"
							FROM mcp_client_seen WHERE principal_kind = 'oauth'
						`.pipe(Effect.orDie)
						const seenByKey = new Map(
							seen.map(s => [`${s.userId}:${s.principalId}`, s]),
						)

						// Who raised each block, by name. Read on the owner pool like the
						// connections above: the people table is not organization-scoped,
						// so reading it as the request role would be an identity lookup
						// nothing confines.
						const blockerIds = [
							...new Set(
								[...orgBlockByKey.values()].map(b => b.revokedByUserId),
							),
						]
						// Their email stands in when they never set a name, so somebody
						// still present is never reported as gone.
						const blockerNames = new Map<string, string>()
						if (blockerIds.length > 0) {
							const blockers = yield* Effect.tryPromise(() =>
								auth.pool.query<{
									id: string
									name: string | null
									email: string
								}>('SELECT id, name, email FROM "user" WHERE id = ANY($1)', [
									blockerIds,
								]),
							).pipe(
								Effect.orDie,
								Effect.map(r => r.rows),
							)
							for (const b of blockers)
								blockerNames.set(b.id, b.name ?? b.email)
						}

						return (
							rows
								// Mirror how a request is judged: a connection scoped to this
								// organization counts, and so does one nobody has scoped at
								// all, because that falls back to every organization its owner
								// belongs to. A connection this organization has cut off is
								// listed too — it is the only place someone can see what was
								// stopped here, and lift it.
								.filter(row => {
									const key = `${row.userId}:${row.clientId}`
									const stoppedHere = orgBlockByKey.has(key)
									const reachesHere =
										!revokedKeys.has(key) &&
										(row.boundHere || !row.hasAnySelection)
									return stoppedHere || reachesHere
								})
								.map(row => {
									const key = `${row.userId}:${row.clientId}`
									const tool = seenByKey.get(key)
									const block = orgBlockByKey.get(key)
									return {
										clientId: row.clientId,
										userId: row.userId,
										memberName: row.memberName,
										memberEmail: row.memberEmail,
										name: row.name,
										createdAt: new Date(row.createdAt).toISOString(),
										redirectHost: firstRedirectHost(row.redirectUris),
										client: tool
											? { name: tool.clientName, version: tool.clientVersion }
											: null,
										lastUsedAt: tool?.lastSeenAt
											? new Date(tool.lastSeenAt).toISOString()
											: null,
										block: block
											? {
													byUserId: block.revokedByUserId,
													byName:
														blockerNames.get(block.revokedByUserId) ?? null,
													at: new Date(block.revokedAt).toISOString(),
													boundHere: row.boundHere,
												}
											: null,
									}
								})
						)
					}),

				// Cut a connection off from one organization. Everyone may do this
				// to their own connections; only an owner or an admin may do it to
				// someone else's, and only within the organization the request is
				// already acting in.
				//
				// This records a block rather than deleting the person's choice, and
				// the /mcp path reads blocks alongside choices on every call, so the
				// connection is stopped from its very next request. Nothing has to
				// expire or be called back for it to take effect.
				revokeConnection: (
					orgId: string,
					actorUserId: string,
					targetUserId: string,
					clientId: string,
				): Effect.Effect<void, Forbidden | NotFound> =>
					Effect.gen(function* () {
						if (targetUserId !== actorUserId) {
							// The active organization already confines `member`, so the
							// user id alone identifies the row. A missing row means the
							// actor isn't in this org at all, which fails the same way as
							// the wrong role.
							const actor = yield* sql<{ role: string | null }>`
								SELECT role FROM member WHERE "userId" = ${actorUserId} LIMIT 1
							`.pipe(Effect.orDie)
							const role = actor[0]?.role ?? null
							if (role === null || !MANAGING_ROLES.has(role)) {
								return yield* new Forbidden({
									message:
										'Only an owner or an admin can revoke another member’s connection.',
								})
							}
						}

						// The person whose connection this is must belong to the
						// organization being revoked from, or there is nothing here to
						// cut off.
						const target = yield* sql<{ userId: string }>`
							SELECT "userId" FROM member WHERE "userId" = ${targetUserId} LIMIT 1
						`.pipe(Effect.orDie)
						if (target.length === 0) {
							return yield* new NotFound({
								entity: 'mcpConnection',
								id: clientId,
							})
						}

						// Re-revoking is not an error — it refreshes who cut it off and
						// when, which is what an owner overriding a member's own block
						// should do.
						// Cutting your own connection off must not rewrite who made a
						// removal somebody else made. Otherwise the person a removal was
						// aimed at could make it read as their own, and everything that
						// asks "did they make this themselves?" — choosing the
						// organization again, allowing it back — would then let them
						// straight past it. An owner or an admin still takes the record
						// over, which is what lets them override a member's own removal.
						yield* sql`
							INSERT INTO mcp_oauth_revocation
								(user_id, client_id, organization_id, revoked_at, revoked_by_user_id)
							VALUES (${targetUserId}, ${clientId}, ${orgId}, now(), ${actorUserId})
							ON CONFLICT (user_id, client_id, organization_id)
							DO UPDATE SET
								revoked_at = now(),
								revoked_by_user_id = CASE
									WHEN ${actorUserId} = ${targetUserId}
									 AND mcp_oauth_revocation.revoked_by_user_id <> ${targetUserId}
									THEN mcp_oauth_revocation.revoked_by_user_id
									ELSE ${actorUserId}
								END
						`.pipe(Effect.orDie)
					}),

				// Let a connection this organization cut off work here again. Only an
				// owner or an admin may, and only for the organization the request is
				// already acting in.
				//
				// It clears the removal and nothing else. That is deliberate: the
				// person's own choice of organizations is theirs, so this can only
				// take away the obstacle in front of a choice they already made —
				// never make one for them. That is also why a connection that has not
				// chosen this organization is refused rather than cleared: clearing it
				// would hand the assistant back every organization that person belongs
				// to, including ones this organization has no say over.
				restoreConnection: (
					orgId: string,
					actorUserId: string,
					targetUserId: string,
					clientId: string,
				): Effect.Effect<void, Forbidden | NotFound> =>
					Effect.gen(function* () {
						// The active organization already confines `member`, so the user
						// id alone identifies the row. No row means the actor is not in
						// this organization at all, refused like the wrong role.
						const actor = yield* sql<{ role: string | null }>`
							SELECT role FROM member WHERE "userId" = ${actorUserId} LIMIT 1
						`.pipe(Effect.orDie)
						const role = actor[0]?.role ?? null
						if (role === null || !MANAGING_ROLES.has(role)) {
							return yield* new Forbidden({
								message:
									'Only an owner or an admin can allow a connection back into the organization.',
							})
						}

						const blockRows = yield* sql<{ revokedByUserId: string }>`
							SELECT revoked_by_user_id AS "revokedByUserId"
							FROM mcp_oauth_revocation
							WHERE user_id = ${targetUserId}
							  AND client_id = ${clientId}
							  AND organization_id = ${orgId}
							LIMIT 1
						`.pipe(Effect.orDie)
						const block = blockRows[0]

						// Nothing to allow back. Saying so beats reporting success for a
						// call that changed nothing, which would also write a record of a
						// removal being lifted that never was.
						if (block === undefined) {
							return yield* new NotFound({
								entity: 'mcpConnection',
								id: clientId,
							})
						}

						// A removal someone made on their own connection is their own
						// decision, and they undo it themselves by choosing the
						// organization again. The organization can override it by removing
						// the connection itself, but it cannot quietly switch somebody's
						// assistant back on for them.
						if (block.revokedByUserId === targetUserId) {
							return yield* new Forbidden({
								message:
									'This connection was removed by the person it belongs to, so only they can put it back.',
							})
						}

						// Nobody undoes a removal somebody else made against them. Without
						// this an owner or an admin who was cut off could let their own
						// assistant straight back in, which is the one thing recording who
						// made the removal exists to prevent.
						if (targetUserId === actorUserId) {
							return yield* new Forbidden({
								message:
									'Someone else removed this connection, so it cannot be allowed back by the person it was removed from.',
							})
						}

						// The person whose connection this is must belong to the
						// organization, or there is nothing here to allow back.
						const target = yield* sql<{ userId: string }>`
							SELECT "userId" FROM member WHERE "userId" = ${targetUserId} LIMIT 1
						`.pipe(Effect.orDie)
						if (target.length === 0) {
							return yield* new NotFound({
								entity: 'mcpConnection',
								id: clientId,
							})
						}

						// Read on the owner pool, like the connection list: the request
						// role has no grant on the choices table at all.
						const chosen = yield* Effect.tryPromise(() =>
							auth.pool.query(
								`SELECT 1 FROM mcp_oauth_org_membership
								 WHERE user_id = $1 AND client_id = $2 AND organization_id = $3`,
								[targetUserId, clientId, orgId],
							),
						).pipe(Effect.orDie)
						// Counted from the rows themselves: the driver's own count is
						// allowed to be absent, and an absent one is not zero, so reading
						// it here would wave the call through.
						if (chosen.rows.length === 0) {
							return yield* new Forbidden({
								message:
									'This assistant is not set to work in this organization, so there is nothing to allow back. Its owner has to choose this organization first.',
							})
						}

						// Name the organization rather than leaning on the request's own
						// scope alone. The database confines this to the acting
						// organization as a backstop, but a row it hides is silently
						// skipped rather than refused, and a caller on the role that
						// bypasses those checks would otherwise clear the removal in
						// every organization at once.
						yield* sql`
							DELETE FROM mcp_oauth_revocation
							WHERE user_id = ${targetUserId}
							  AND client_id = ${clientId}
							  AND organization_id = ${orgId}
						`.pipe(Effect.orDie)
					}),

				// The caller's connections: OAuth clients they've consented to,
				// with the orgs each is currently bound to (empty until chosen).
				// Aggregated with array_agg so one row per connection carries the
				// full org list, instead of one row per (connection, org).
				//
				// Removals are read on their own rather than joined to the choices,
				// because a connection can be cut off from an organization it was
				// never chosen for, and a join hanging off the choice would miss that
				// removal entirely. Both reads share one transaction, so they cannot
				// disagree.
				listConnections: (
					userId: string,
				): Effect.Effect<ReadonlyArray<McpConnection>> =>
					Effect.gen(function* () {
						const { connections, revocations } = yield* withResolverTx(
							userId,
							async client => {
								const connections = await client.query<ConnectionRow>(
									`SELECT c."clientId"            AS "clientId",
									        oc.name               AS name,
									        oc."redirectUris"     AS "redirectUris",
									        c."createdAt"         AS "createdAt",
									        COALESCE(
									          array_agg(sel.organization_id ORDER BY sel.organization_id)
									          FILTER (WHERE sel.organization_id IS NOT NULL
										            AND rev.organization_id IS NULL),
									          ARRAY[]::text[]
									        )                    AS "organizationIds",
									        COALESCE(
									          array_agg(sel.organization_id ORDER BY sel.organization_id)
									          FILTER (WHERE sel.organization_id IS NOT NULL),
									          ARRAY[]::text[]
									        )                    AS "chosenOrganizationIds"
									 FROM "oauthConsent" c
									 JOIN "oauthClient" oc ON oc."clientId" = c."clientId"
									 LEFT JOIN mcp_oauth_org_membership sel
									   ON sel.user_id = c."userId" AND sel.client_id = c."clientId"
									 -- An organization the connection has been cut off from is left
									 -- out of what it can reach, but kept in what was chosen: the
									 -- choice survives the removal so it can be put back.
									 LEFT JOIN mcp_oauth_revocation rev
									   ON rev.user_id = sel.user_id
									  AND rev.client_id = sel.client_id
									  AND rev.organization_id = sel.organization_id
									 WHERE c."userId" = $1
									 GROUP BY c."clientId", oc.name, oc."redirectUris", c."createdAt"
									 ORDER BY c."createdAt" DESC`,
									[userId],
								)
								const revocations = await client.query<RevocationRow>(
									`SELECT client_id          AS "clientId",
									        organization_id    AS "organizationId",
									        revoked_by_user_id AS "revokedByUserId"
									 FROM mcp_oauth_revocation
									 WHERE user_id = $1`,
									[userId],
								)
								return { connections, revocations }
							},
						)
						const blocksByClient = new Map<string, Array<McpConnectionBlock>>()
						for (const row of revocations.rows) {
							const blocks = blocksByClient.get(row.clientId) ?? []
							blocks.push({
								organizationId: row.organizationId,
								blockedBySelf: row.revokedByUserId === userId,
							})
							blocksByClient.set(row.clientId, blocks)
						}
						return connections.rows.map(row => ({
							clientId: row.clientId,
							name: row.name,
							createdAt: new Date(row.createdAt).toISOString(),
							organizationIds: row.organizationIds ?? [],
							chosenOrganizationIds: row.chosenOrganizationIds ?? [],
							blocks: blocksByClient.get(row.clientId) ?? [],
							redirectHost: firstRedirectHost(row.redirectUris),
						}))
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
