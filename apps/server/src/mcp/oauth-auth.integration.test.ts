// Pins the OAuth (web-chat) path for /mcp: a JWT access token minted by the
// Authorization Server is audience-bound to the /mcp resource, verifies against
// the JWKS, and resolves to an org (explicit per-client selection re-checked
// against live membership, else single-org auto-pick). Also covers the
// org-selection service. The Bearer branch's resolution + RLS scoping is
// reproduced here exactly as the /mcp middleware runs it (the middleware's
// hard-coded HTTP jwksUrl makes the wired branch a boot-only concern); tokens
// are minted via `auth.api.signJWT` and verified against `auth.api.getJwks()`,
// the same keypair the resource server uses.

import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

import type { PgClient } from '@effect/sql-pg'
import { verifyAccessToken, verifyJwsAccessToken } from 'better-auth/oauth2'
import { type Config, Effect, Layer, ManagedRuntime } from 'effect'
import { SqlClient, type SqlError } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { Auth } from '../lib/auth'
import { enterOrgScope, enterUserScope } from '../middleware/org'
import { gcAbandonedClients } from '../plugins/oauth-client-gc'
import { McpOAuthService } from '../services/mcp-oauth'
import { applyTestEnv } from '../test-env'

// Config has no defaults; set the required env before any layer reads it.
applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const BASE_URL = process.env['BETTER_AUTH_BASE_URL'] as string
const AUDIENCE = `${BASE_URL}/mcp`
const FIXTURE_SLUG = `mcp-oauth-${randomUUID()}`
const USER_EMAIL_LIKE = 'oauth-test+%@keys.batuda.internal'
// One OAuth client id shared by the cases; resolution keys `mcp_oauth_org` on it.
const CLIENT_ID = `mcp-client-${randomUUID()}`

type Org = { id: string; name: string; slug: string }

let pool: pg.Pool
let runtime: ManagedRuntime.ManagedRuntime<
	McpOAuthService | Auth | SqlClient.SqlClient | PgClient.PgClient,
	Config.ConfigError | SqlError.SqlError
>
let taller: Org
let restaurant: Org
let singleOrgUserId: string
let multiOrgUserId: string
let nonMemberUserId: string

const orgBySlug = async (slug: string): Promise<Org> => {
	const result = await pool.query<Org>(
		'SELECT id, name, slug FROM organization WHERE slug = $1 LIMIT 1',
		[slug],
	)
	const row = result.rows[0]
	if (!row)
		throw new Error(
			`${slug} org missing — run 'pnpm cli db reset && pnpm cli seed'`,
		)
	return row
}

// One marker company per org, so a scoped read can prove isolation.
const seedCompany = async (orgId: string) => {
	await pool.query(
		`INSERT INTO companies (organization_id, slug, name) VALUES ($1, $2, $2)`,
		[orgId, FIXTURE_SLUG],
	)
}

// Create a passwordless test user (via the admin createUser escape hatch) and
// return its id. Better Auth lowercases the stored email.
const createUser = async (label: string): Promise<string> => {
	const email = `oauth-test+${label}-${randomUUID()}@keys.batuda.internal`
	await runtime.runPromise(
		Effect.gen(function* () {
			const auth = yield* Auth
			yield* Effect.promise(() =>
				auth.instance.api.createUser({ body: { email, name: label } }),
			)
		}),
	)
	const rows = await pool.query<{ id: string }>(
		'SELECT id FROM "user" WHERE lower(email) = lower($1) LIMIT 1',
		[email],
	)
	const id = rows.rows[0]?.id
	if (!id) throw new Error(`fixture user ${label} missing after create`)
	return id
}

const addMember = (userId: string, organizationId: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const auth = yield* Auth
			yield* Effect.promise(() =>
				auth.instance.api.addMember({
					body: { userId, organizationId, role: 'member' },
				}),
			)
		}),
	)

// Mint an access token via the AS's jwt plugin — same keypair the resource
// server verifies against. The real oauth-provider token carries the client as
// `azp`; `verifyAccessToken` rewrites it to `client_id`, so mint `azp` (not
// `client_id`) to exercise that rewrite the resolution depends on.
const mintToken = (opts: {
	readonly sub: string
	readonly clientId?: string
	readonly audience?: string
	readonly issuer?: string
	readonly expiresInSeconds?: number
}): Promise<string> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const auth = yield* Auth
			const now = Math.floor(Date.now() / 1000)
			const result = yield* Effect.promise(() =>
				auth.instance.api.signJWT({
					body: {
						payload: {
							sub: opts.sub,
							azp: opts.clientId ?? CLIENT_ID,
							aud: opts.audience ?? AUDIENCE,
							iss: opts.issuer ?? BASE_URL,
							iat: now,
							exp: now + (opts.expiresInSeconds ?? 600),
						},
					},
				}),
			)
			return (result as { token: string }).token
		}),
	)

type BearerOutcome =
	| { readonly kind: 'scoped'; readonly orgIds: ReadonlyArray<string> }
	| { readonly kind: 'challenge' }
	| { readonly kind: 'forbidden'; readonly code: number }
	| { readonly kind: 'fallthrough' }

// Reproduces the /mcp middleware's Bearer resolution: verify (JWKS + audience +
// issuer) → user → memberships → selection (re-checked vs membership) →
// auto-pick → enter org scope and read the marker companies (RLS proof).
const resolveBearer = (token: string): Promise<BearerOutcome> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const auth = yield* Auth
			const sql = yield* SqlClient.SqlClient
			// Mirror the `verifyAccessToken` wrapper the /mcp middleware uses: a
			// non-JWS bearer (JWSInvalid/TypeError) is opaque → fall through; an
			// expired/invalid/wrong-audience JWT throws → challenge.
			const verified = yield* Effect.tryPromise({
				try: () =>
					verifyJwsAccessToken(token, {
						jwksFetch: () => auth.instance.api.getJwks(),
						// Pinned to EdDSA to match the /mcp middleware verify exactly.
						verifyOptions: {
							audience: AUDIENCE,
							issuer: BASE_URL,
							algorithms: ['EdDSA'],
						},
					}),
				catch: error => error,
			}).pipe(
				Effect.match({
					onSuccess: payload => ({ tag: 'payload' as const, payload }),
					onFailure: error => {
						const name = error instanceof Error ? error.name : ''
						return name === 'JWSInvalid' || name === 'TypeError'
							? { tag: 'opaque' as const }
							: { tag: 'invalid' as const }
					},
				}),
			)
			if (verified.tag === 'invalid')
				return { kind: 'challenge' } satisfies BearerOutcome
			if (verified.tag === 'opaque')
				return { kind: 'fallthrough' } satisfies BearerOutcome
			const payload = verified.payload
			const userId = typeof payload.sub === 'string' ? payload.sub : ''
			const clientId =
				typeof payload['client_id'] === 'string' ? payload['client_id'] : ''
			const userRows = yield* sql<{ id: string }>`
				SELECT id FROM "user" WHERE id = ${userId} LIMIT 1
			`.pipe(Effect.orDie)
			if (!userRows[0]) return { kind: 'challenge' } satisfies BearerOutcome
			// Mirror the middleware: read memberships + selection under the
			// resolver role so the suite exercises the same RLS-scoped path.
			const { orgIds, selectedOrgId } = yield* enterUserScope(
				sql,
				userId,
			)(
				Effect.gen(function* () {
					const memberships = yield* sql<{ organizationId: string }>`
						SELECT "organizationId" FROM member WHERE "userId" = ${userId}
					`
					const selection = yield* sql<{ organizationId: string }>`
						SELECT organization_id FROM mcp_oauth_org
						WHERE user_id = ${userId} AND client_id = ${clientId} LIMIT 1
					`
					return {
						orgIds: memberships.map(m => m.organizationId),
						selectedOrgId: selection[0]?.organizationId,
					}
				}),
			)
			if (orgIds.length === 0)
				return { kind: 'forbidden', code: -32002 } satisfies BearerOutcome
			const orgId =
				selectedOrgId && orgIds.includes(selectedOrgId)
					? selectedOrgId
					: orgIds.length === 1
						? orgIds[0]
						: undefined
			if (!orgId)
				return { kind: 'forbidden', code: -32002 } satisfies BearerOutcome
			const orgRows = yield* sql<Org>`
				SELECT id, name, slug FROM "organization" WHERE id = ${orgId} LIMIT 1
			`.pipe(Effect.orDie)
			const org = orgRows[0]
			if (!org)
				return { kind: 'forbidden', code: -32003 } satisfies BearerOutcome
			const readOrgIds = yield* enterOrgScope(sql, { org, userId })(
				sql<{ organizationId: string }>`
					SELECT organization_id FROM companies WHERE slug = ${FIXTURE_SLUG}
				`.pipe(Effect.map(rows => rows.map(r => r.organizationId))),
			)
			return { kind: 'scoped', orgIds: readOrgIds } satisfies BearerOutcome
		}),
	)

const setSelection = (userId: string, organizationId: string) =>
	pool.query(
		`INSERT INTO mcp_oauth_org (user_id, client_id, organization_id, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (user_id, client_id)
		 DO UPDATE SET organization_id = EXCLUDED.organization_id, updated_at = now()`,
		[userId, CLIENT_ID, organizationId],
	)

const seedConsentedClient = async (
	userId: string,
	clientId: string,
	name: string,
) => {
	await pool.query(
		`INSERT INTO "oauthClient" (id, "clientId", "redirectUris", name)
		 VALUES ($1, $2, '[]'::jsonb, $3) ON CONFLICT DO NOTHING`,
		[randomUUID(), clientId, name],
	)
	await pool.query(
		`INSERT INTO "oauthConsent" (id, "clientId", "userId", scopes, "createdAt", "updatedAt")
		 VALUES ($1, $2, $3, '["openid"]'::jsonb, now(), now())`,
		[randomUUID(), clientId, userId],
	)
}

const fixtureUserIds = () => [singleOrgUserId, multiOrgUserId, nonMemberUserId]

const deleteFixtureRows = async () => {
	const ids = fixtureUserIds()
	await pool.query('DELETE FROM mcp_oauth_org WHERE user_id = ANY($1)', [ids])
	await pool.query('DELETE FROM "oauthConsent" WHERE "userId" = ANY($1)', [ids])
	await pool.query(`DELETE FROM "oauthClient" WHERE name = 'mcp-oauth-test'`)
}

const cleanup = async () => {
	await pool.query('DELETE FROM companies WHERE slug = $1', [FIXTURE_SLUG])
	await pool.query(
		`DELETE FROM mcp_oauth_org WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE $1)`,
		[USER_EMAIL_LIKE],
	)
	await pool.query(
		`DELETE FROM "oauthConsent" WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
		[USER_EMAIL_LIKE],
	)
	await pool.query(`DELETE FROM "oauthClient" WHERE name = 'mcp-oauth-test'`)
	await pool.query(
		`DELETE FROM member WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
		[USER_EMAIL_LIKE],
	)
	await pool.query('DELETE FROM "user" WHERE email LIKE $1', [USER_EMAIL_LIKE])
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	taller = await orgBySlug('taller')
	restaurant = await orgBySlug('restaurant')
	await cleanup()
	await seedCompany(taller.id)
	await seedCompany(restaurant.id)
	runtime = ManagedRuntime.make(
		Layer.provideMerge(
			McpOAuthService.layer,
			Layer.mergeAll(Auth.layer, PgLive),
		),
	)
	singleOrgUserId = await createUser('single')
	multiOrgUserId = await createUser('multi')
	nonMemberUserId = await createUser('none')
	await addMember(singleOrgUserId, taller.id)
	await addMember(multiOrgUserId, taller.id)
	await addMember(multiOrgUserId, restaurant.id)
}, 60_000)

afterEach(async () => {
	await deleteFixtureRows()
})

afterAll(async () => {
	await cleanup()
	await runtime.dispose()
	await pool.end()
})

describe('OAuth access token verification', () => {
	describe('the wired verifyAccessToken over a real JWKS endpoint', () => {
		// The other cases use the in-process verifyJwsAccessToken; the /mcp
		// middleware instead calls verifyAccessToken with a jwksUrl it fetches
		// over HTTP. Exercise that exact production call so a Better Auth change
		// to the fetch/verify contract fails here rather than at runtime.
		it('should verify a token fetched from an HTTP JWKS endpoint', async () => {
			// GIVEN the AS's JWKS served over HTTP, as the resource server fetches it
			const jwks = await runtime.runPromise(
				Effect.gen(function* () {
					const auth = yield* Auth
					return yield* Effect.promise(() => auth.instance.api.getJwks())
				}),
			)
			const server = createServer((_req, res) => {
				res.setHeader('content-type', 'application/json')
				res.end(JSON.stringify(jwks))
			})
			await new Promise<void>(resolve =>
				server.listen(0, '127.0.0.1', () => resolve()),
			)
			try {
				const address = server.address()
				const port = address && typeof address === 'object' ? address.port : 0

				// WHEN the wired call verifies a freshly minted token
				const token = await mintToken({ sub: singleOrgUserId })
				const payload = await verifyAccessToken(token, {
					jwksUrl: `http://127.0.0.1:${port}/jwks`,
					verifyOptions: {
						audience: AUDIENCE,
						issuer: BASE_URL,
						algorithms: ['EdDSA'],
					},
				})

				// THEN it returns the payload, with azp rewritten to client_id
				expect(payload?.sub).toBe(singleOrgUserId)
				expect(payload?.['client_id']).toBe(CLIENT_ID)
			} finally {
				await new Promise<void>(resolve => server.close(() => resolve()))
			}
		})
	})

	describe('a token minted for the /mcp resource', () => {
		it('should verify and expose the subject + client id', async () => {
			// GIVEN a token for the single-org user, audience-bound to /mcp
			const token = await mintToken({ sub: singleOrgUserId })

			// WHEN it is verified against the AS JWKS with the /mcp audience
			const payload = await runtime.runPromise(
				Effect.gen(function* () {
					const auth = yield* Auth
					return yield* Effect.promise(() =>
						verifyJwsAccessToken(token, {
							jwksFetch: () => auth.instance.api.getJwks(),
							verifyOptions: { audience: AUDIENCE, issuer: BASE_URL },
						}),
					)
				}),
			)

			// THEN the claims carry the subject and client id the RS reads
			expect(payload.sub).toBe(singleOrgUserId)
			expect(payload['client_id']).toBe(CLIENT_ID)
			expect(payload.aud).toBe(AUDIENCE)
		})
	})

	describe('a token minted for a different audience', () => {
		it('should fail /mcp verification (wrong audience)', async () => {
			// GIVEN a token whose audience is the bare origin, not /mcp
			const token = await mintToken({
				sub: singleOrgUserId,
				audience: BASE_URL,
			})

			// WHEN the /mcp resource server verifies it (audience = <origin>/mcp)
			const outcome = await resolveBearer(token)

			// THEN it is rejected, never scoped
			expect(outcome.kind).toBe('challenge')
		})
	})

	describe('an expired token', () => {
		it('should fail verification', async () => {
			// GIVEN a token that expired ten seconds ago
			const token = await mintToken({
				sub: singleOrgUserId,
				expiresInSeconds: -10,
			})

			// WHEN it is verified
			const outcome = await resolveBearer(token)

			// THEN it is rejected
			expect(outcome.kind).toBe('challenge')
		})
	})

	describe('a non-OAuth bearer token', () => {
		it('should fall through rather than challenge', async () => {
			// GIVEN an opaque, non-JWT bearer (e.g. a session token)
			// WHEN the Bearer branch tries to verify it as a JWT
			const outcome = await resolveBearer('not-a-jwt-opaque-string')

			// THEN verification yields nothing and control falls through to cookie
			expect(outcome.kind).toBe('fallthrough')
		})
	})
})

describe('OAuth Bearer org resolution', () => {
	describe('a single-org user with no selection', () => {
		it('should auto-pick the lone org and scope reads to it', async () => {
			// GIVEN a valid token for a user who belongs only to taller
			const token = await mintToken({ sub: singleOrgUserId })

			// WHEN the Bearer path resolves and reads marker companies under scope
			const outcome = await resolveBearer(token)

			// THEN it scopes to taller and reads only taller's marker (RLS isolation)
			expect(outcome).toEqual({ kind: 'scoped', orgIds: [taller.id] })
		})
	})

	describe('a multi-org user with no selection', () => {
		it('should refuse with a select-an-org error', async () => {
			// GIVEN a valid token for a user in taller AND restaurant, no selection
			const token = await mintToken({ sub: multiOrgUserId })

			// WHEN the Bearer path resolves
			const outcome = await resolveBearer(token)

			// THEN it refuses (no org entered) with the select-an-org code
			expect(outcome).toEqual({ kind: 'forbidden', code: -32002 })
		})
	})

	describe('a multi-org user with a live selection', () => {
		it('should scope to the selected org only', async () => {
			// GIVEN the multi-org user selected restaurant for this client
			await setSelection(multiOrgUserId, restaurant.id)
			const token = await mintToken({ sub: multiOrgUserId })

			// WHEN the Bearer path resolves
			const outcome = await resolveBearer(token)

			// THEN it scopes to restaurant and reads only restaurant's marker
			expect(outcome).toEqual({ kind: 'scoped', orgIds: [restaurant.id] })
		})
	})

	describe('a selection that is no longer a live membership', () => {
		it('should ignore the stale selection and auto-pick the live org', async () => {
			// GIVEN a stale selection pointing at restaurant, where the single-org
			// user is NOT a member (only taller)
			await setSelection(singleOrgUserId, restaurant.id)
			const token = await mintToken({ sub: singleOrgUserId })

			// WHEN the Bearer path resolves
			const outcome = await resolveBearer(token)

			// THEN the stale restaurant selection is ignored and it reads only
			// taller — never the org the user no longer belongs to
			expect(outcome).toEqual({ kind: 'scoped', orgIds: [taller.id] })
		})
	})

	describe('a token whose user belongs to no organization', () => {
		it('should refuse', async () => {
			// GIVEN a valid token for a user with zero memberships
			const token = await mintToken({ sub: nonMemberUserId })

			// WHEN the Bearer path resolves
			const outcome = await resolveBearer(token)

			// THEN it refuses
			expect(outcome).toEqual({ kind: 'forbidden', code: -32002 })
		})
	})

	describe('a token whose subject is not a known user', () => {
		it('should challenge', async () => {
			// GIVEN a valid token whose subject does not resolve to a user row
			const token = await mintToken({ sub: `ghost-${randomUUID()}` })

			// WHEN the Bearer path resolves
			const outcome = await resolveBearer(token)

			// THEN it challenges (user no longer available)
			expect(outcome.kind).toBe('challenge')
		})
	})
})

describe('McpOAuthService.selectOrg', () => {
	describe('the caller is a member of the target org', () => {
		it('should upsert the connection binding', async () => {
			// GIVEN the single-org user is a member of taller
			// WHEN selectOrg binds the connection to taller
			await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					yield* service.selectOrg(singleOrgUserId, CLIENT_ID, taller.id)
				}),
			)

			// THEN a mcp_oauth_org row maps (user, client) → taller
			const rows = await pool.query<{ organization_id: string }>(
				'SELECT organization_id FROM mcp_oauth_org WHERE user_id = $1 AND client_id = $2',
				[singleOrgUserId, CLIENT_ID],
			)
			expect(rows.rows[0]?.organization_id).toBe(taller.id)
		})

		it('should overwrite an existing binding on conflict', async () => {
			// GIVEN the multi-org user already bound this client to taller
			await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					yield* service.selectOrg(multiOrgUserId, CLIENT_ID, taller.id)
					// WHEN they re-bind it to restaurant
					yield* service.selectOrg(multiOrgUserId, CLIENT_ID, restaurant.id)
				}),
			)

			// THEN exactly one row remains, now pointing at restaurant
			const rows = await pool.query<{ organization_id: string }>(
				'SELECT organization_id FROM mcp_oauth_org WHERE user_id = $1 AND client_id = $2',
				[multiOrgUserId, CLIENT_ID],
			)
			expect(rows.rowCount).toBe(1)
			expect(rows.rows[0]?.organization_id).toBe(restaurant.id)
		})
	})

	describe('the caller is not a member of the target org', () => {
		it('should fail with Forbidden and write nothing', async () => {
			// GIVEN the non-member user picks restaurant
			// WHEN selectOrg runs
			const error = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* Effect.flip(
						service.selectOrg(nonMemberUserId, CLIENT_ID, restaurant.id),
					)
				}),
			)

			// THEN it is Forbidden and no binding was written
			expect(error._tag).toBe('Forbidden')
			const rows = await pool.query(
				'SELECT 1 FROM mcp_oauth_org WHERE user_id = $1 AND client_id = $2',
				[nonMemberUserId, CLIENT_ID],
			)
			expect(rows.rowCount).toBe(0)
		})
	})
})

describe('McpOAuthService.listConnections', () => {
	describe('the caller has no consented clients', () => {
		it('should return an empty list', async () => {
			// GIVEN a user with no oauthConsent rows
			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(singleOrgUserId)
				}),
			)

			// THEN it is empty
			expect(connections).toEqual([])
		})
	})

	describe('a consented client bound to an org', () => {
		it('should return the connection with its organization', async () => {
			// GIVEN a consented client and a binding to taller
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelection(singleOrgUserId, taller.id)

			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(singleOrgUserId)
				}),
			)

			// THEN the connection carries the client + its bound org
			expect(connections).toHaveLength(1)
			expect(connections[0]?.clientId).toBe(CLIENT_ID)
			expect(connections[0]?.organizationId).toBe(taller.id)
		})
	})

	describe('a consented client with no org chosen', () => {
		it('should return a null organization', async () => {
			// GIVEN a consented client but no selection
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')

			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(multiOrgUserId)
				}),
			)

			// THEN the connection's organization is null (unbound)
			expect(connections).toHaveLength(1)
			expect(connections[0]?.organizationId).toBeNull()
		})
	})
})

describe('RLS backstop on the resolver role', () => {
	// The connections and /mcp reads run as app_mcp_resolver with the caller's id
	// in app.current_user_id. These prove the policies isolate by user at the
	// database — the guarantee behind the explicit WHERE in McpOAuthService and
	// the /mcp resolution, should a future edit ever drop it.
	//
	// The `rls-a`/`rls-b` (users) + `rls-c` (client) rows are synthetic ids that
	// the email/slug-keyed cleanup wouldn't catch; each case stays inside its own
	// BEGIN…ROLLBACK so nothing persists past the test.

	it("should hide another user's mcp_oauth_org rows even without a WHERE", async () => {
		const client = await pool.connect()
		try {
			// GIVEN two users each hold a connection binding
			await client.query('BEGIN')
			await client.query(
				`INSERT INTO mcp_oauth_org (user_id, client_id, organization_id)
				 VALUES ('rls-a', 'rls-c', $1), ('rls-b', 'rls-c', $1)`,
				[taller.id],
			)
			// WHEN the resolver reads as user A
			await client.query('SET LOCAL ROLE app_mcp_resolver')
			await client.query(
				"SELECT set_config('app.current_user_id', 'rls-a', true)",
			)
			const all = await client.query<{ user_id: string }>(
				'SELECT user_id FROM mcp_oauth_org',
			)
			const reachForB = await client.query(
				"SELECT 1 FROM mcp_oauth_org WHERE user_id = 'rls-b'",
			)
			// THEN only A's row is visible, even reaching for B's directly
			expect(all.rows.every(r => r.user_id === 'rls-a')).toBe(true)
			expect(reachForB.rowCount).toBe(0)
		} finally {
			await client.query('ROLLBACK')
			client.release()
		}
	})

	it('should reject writing a row for another user', async () => {
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			// GIVEN the resolver scoped to user A
			await client.query('SET LOCAL ROLE app_mcp_resolver')
			await client.query(
				"SELECT set_config('app.current_user_id', 'rls-a', true)",
			)
			// WHEN it inserts a row owned by user B, THEN the WITH CHECK rejects it
			await expect(
				client.query(
					`INSERT INTO mcp_oauth_org (user_id, client_id, organization_id)
					 VALUES ('rls-b', 'rls-c', $1)`,
					[taller.id],
				),
			).rejects.toThrow(/row-level security/i)
		} finally {
			await client.query('ROLLBACK')
			client.release()
		}
	})

	it("should expose only the current user's memberships", async () => {
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			// GIVEN the seeded member table spans several users
			// WHEN the resolver reads member as the single-org user
			await client.query('SET LOCAL ROLE app_mcp_resolver')
			await client.query("SELECT set_config('app.current_user_id', $1, true)", [
				singleOrgUserId,
			])
			const rows = await client.query<{ userId: string }>(
				'SELECT "userId" FROM member',
			)
			// THEN every visible membership is that user's own
			expect(rows.rowCount).toBeGreaterThan(0)
			expect(rows.rows.every(r => r.userId === singleOrgUserId)).toBe(true)
		} finally {
			await client.query('ROLLBACK')
			client.release()
		}
	})
})

describe('abandoned OAuth client GC', () => {
	it('should delete only never-consented clients past the grace window', async () => {
		const old = `gc-old-${randomUUID()}`
		const recent = `gc-recent-${randomUUID()}`
		const consented = `gc-consented-${randomUUID()}`
		try {
			// GIVEN an old + a recent never-consented client, and an old consented one
			await pool.query(
				`INSERT INTO "oauthClient" (id, "clientId", "redirectUris", name, "createdAt")
				 VALUES ($1, $1, '[]'::jsonb, 'gc', '2000-01-01'),
				        ($2, $2, '[]'::jsonb, 'gc', now()),
				        ($3, $3, '[]'::jsonb, 'gc', '2000-01-01')`,
				[old, recent, consented],
			)
			await pool.query(
				`INSERT INTO "oauthConsent" (id, "clientId", "userId", scopes, "createdAt", "updatedAt")
				 VALUES ($1, $2, $3, '["openid"]'::jsonb, now(), now())`,
				[randomUUID(), consented, singleOrgUserId],
			)
			// WHEN the GC runs with a 7-day grace window
			const deleted = await gcAbandonedClients(pool, 7)
			// THEN only the old never-consented client is gone
			const rows = await pool.query<{ clientId: string }>(
				'SELECT "clientId" FROM "oauthClient" WHERE "clientId" = ANY($1)',
				[[old, recent, consented]],
			)
			const ids = rows.rows.map(r => r.clientId)
			expect(deleted).toBeGreaterThanOrEqual(1)
			expect(ids).not.toContain(old)
			expect(ids).toContain(recent)
			expect(ids).toContain(consented)
		} finally {
			await pool.query(
				'DELETE FROM "oauthConsent" WHERE "clientId" = ANY($1)',
				[[old, recent, consented]],
			)
			await pool.query('DELETE FROM "oauthClient" WHERE "clientId" = ANY($1)', [
				[old, recent, consented],
			])
		}
	})
})
