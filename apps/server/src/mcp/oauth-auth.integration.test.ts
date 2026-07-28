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
// One OAuth client id shared by the cases; resolution keys `mcp_oauth_org_membership` on it.
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
let adminUserId: string
let ownerUserId: string

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
// `hint` mirrors the X-Batuda-Organization-Id header the middleware reads.
const resolveBearer = (token: string, hint?: string): Promise<BearerOutcome> =>
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
			// Mirror the middleware: read memberships + the per-client authorized
			// org set under the resolver role so the suite exercises the same
			// RLS-scoped path.
			const { orgIds, selectedOrgIds, revokedOrgIds } = yield* enterUserScope(
				sql,
				userId,
			)(
				Effect.gen(function* () {
					const memberships = yield* sql<{ organizationId: string }>`
						SELECT "organizationId" FROM member WHERE "userId" = ${userId}
					`
					const selection = yield* sql<{ organizationId: string }>`
						SELECT organization_id FROM mcp_oauth_org_membership
						WHERE user_id = ${userId} AND client_id = ${clientId}
					`
					const revoked = yield* sql<{ organizationId: string }>`
						SELECT organization_id FROM mcp_oauth_revocation
						WHERE user_id = ${userId} AND client_id = ${clientId}
					`
					return {
						orgIds: memberships.map(m => m.organizationId),
						selectedOrgIds: selection.map(s => s.organizationId),
						revokedOrgIds: revoked.map(r => r.organizationId),
					}
				}),
			)
			if (orgIds.length === 0)
				return { kind: 'forbidden', code: -32002 } satisfies BearerOutcome
			// Mirror the middleware: narrow the selection to live memberships.
			// A connection nobody has touched falls back to live orgs; a bound
			// connection where every row is stale is rejected, not widened —
			// silently widening would be a privilege escalation. Untouched
			// counts revocations too, so cutting off the last authorized org
			// denies the connection instead of handing it every org.
			const liveSelectedOrgIds = selectedOrgIds.filter(id =>
				orgIds.includes(id),
			)
			const isUntouched =
				selectedOrgIds.length === 0 && revokedOrgIds.length === 0
			const allowedOrgIds = (isUntouched ? orgIds : liveSelectedOrgIds).filter(
				id => !revokedOrgIds.includes(id),
			)
			if (allowedOrgIds.length === 0)
				return { kind: 'forbidden', code: -32002 } satisfies BearerOutcome
			// Mirror the middleware: a valid hint always wins; without a hint,
			// a single authorized org auto-resolves; an unauthorized hint is
			// rejected so the client can't reach an org it never consented to.
			const orgId = hint
				? allowedOrgIds.includes(hint)
					? hint
					: undefined
				: allowedOrgIds.length === 1
					? allowedOrgIds[0]
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

// Set the per-connection authorized org set directly. Mirrors what
// McpOAuthService.selectOrgs writes, so tests that need a specific binding can
// stage it without going through the service.
const setSelections = async (
	userId: string,
	organizationIds: ReadonlyArray<string>,
) => {
	await pool.query(
		`DELETE FROM mcp_oauth_org_membership
		 WHERE user_id = $1 AND client_id = $2`,
		[userId, CLIENT_ID],
	)
	if (organizationIds.length > 0) {
		await pool.query(
			`INSERT INTO mcp_oauth_org_membership (user_id, client_id, organization_id, updated_at)
			 SELECT $1, $2, org_id, now() FROM unnest($3::text[]) AS t(org_id)
			 ON CONFLICT (user_id, client_id, organization_id) DO NOTHING`,
			[userId, CLIENT_ID, organizationIds as string[]],
		)
	}
}

// Record that a connection has been cut off from these orgs, without going
// through the service — `revokedBy` defaults to the connection's own owner so
// callers must opt in to staging an owner-issued block.
const setRevocations = async (
	userId: string,
	organizationIds: ReadonlyArray<string>,
	revokedBy: string = userId,
) => {
	await pool.query(
		'DELETE FROM mcp_oauth_revocation WHERE user_id = $1 AND client_id = $2',
		[userId, CLIENT_ID],
	)
	if (organizationIds.length > 0) {
		await pool.query(
			`INSERT INTO mcp_oauth_revocation
				(user_id, client_id, organization_id, revoked_at, revoked_by_user_id)
			 SELECT $1, $2, org_id, now(), $4 FROM unnest($3::text[]) AS t(org_id)`,
			[userId, CLIENT_ID, organizationIds as string[], revokedBy],
		)
	}
}

// Stage the note of which tool last used a connection, as a request would.
const recordSeen = async (
	org: Org,
	userId: string,
	clientId: string,
	clientName: string,
) => {
	await pool.query(
		`INSERT INTO mcp_client_seen
			(organization_id, principal_kind, principal_id, user_id, client_name, last_seen_at)
		 VALUES ($1, 'oauth', $2, $3, $4, now())
		 ON CONFLICT (organization_id, principal_kind, principal_id, user_id)
		 DO UPDATE SET client_name = EXCLUDED.client_name, last_seen_at = now()`,
		[org.id, clientId, userId, clientName],
	)
}

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

const fixtureUserIds = () => [
	singleOrgUserId,
	multiOrgUserId,
	nonMemberUserId,
	adminUserId,
]

const deleteFixtureRows = async () => {
	const ids = fixtureUserIds()
	await pool.query(
		'DELETE FROM mcp_oauth_org_membership WHERE user_id = ANY($1)',
		[ids],
	)
	await pool.query('DELETE FROM mcp_oauth_revocation WHERE user_id = ANY($1)', [
		ids,
	])
	await pool.query('DELETE FROM mcp_client_seen WHERE user_id = ANY($1)', [ids])
	await pool.query('DELETE FROM "oauthConsent" WHERE "userId" = ANY($1)', [ids])
	await pool.query(`DELETE FROM "oauthClient" WHERE name = 'mcp-oauth-test'`)
}

const cleanup = async () => {
	// The JWKS signing key is stored encrypted with BETTER_AUTH_SECRET. CI clones
	// its database from a parent whose key was encrypted with a different secret,
	// so this run can't decrypt it — and Better Auth reuses a still-valid key
	// rather than regenerating one. Clear it so the first sign mints a fresh key
	// with this run's secret. Safe: the suite is sequential (fileParallelism:false)
	// and this is the only file that signs JWTs.
	await pool.query('DELETE FROM jwks')
	await pool.query('DELETE FROM companies WHERE slug = $1', [FIXTURE_SLUG])
	await pool.query(
		`DELETE FROM mcp_oauth_org_membership WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE $1)`,
		[USER_EMAIL_LIKE],
	)
	await pool.query(
		`DELETE FROM mcp_oauth_revocation WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE $1)`,
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
	adminUserId = await createUser('admin')
	ownerUserId = await createUser('owner')
	await addMember(singleOrgUserId, taller.id)
	await addMember(multiOrgUserId, taller.id)
	await addMember(multiOrgUserId, restaurant.id)
	await addMember(adminUserId, taller.id)
	await addMember(ownerUserId, taller.id)
	// Promote after the fact: addMember always joins as a plain member, and the
	// revoke tests need one person who can act for the whole organization. Two
	// of them, so a removal can be made by somebody other than the person it
	// lands on even when that person manages the organization themselves.
	await pool.query(
		`UPDATE member SET role = 'admin' WHERE "userId" = $1 AND "organizationId" = $2`,
		[adminUserId, taller.id],
	)
	await pool.query(
		`UPDATE member SET role = 'owner' WHERE "userId" = $1 AND "organizationId" = $2`,
		[ownerUserId, taller.id],
	)
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

			// WHEN the Bearer path resolves without a hint
			const outcome = await resolveBearer(token)

			// THEN it refuses (no org entered) with the select-an-org code
			expect(outcome).toEqual({ kind: 'forbidden', code: -32002 })
		})

		it('should start working once they narrow the connection to one org', async () => {
			// GIVEN that same refused connection, narrowed to a single organization
			// through the call the settings screen makes — not by staging rows, so
			// this covers the whole path a person actually takes out of the refusal
			const token = await mintToken({ sub: multiOrgUserId })
			await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.selectOrgs(multiOrgUserId, CLIENT_ID, [
						taller.id,
					])
				}),
			)

			// WHEN the Bearer path resolves again, still without a hint — assistants
			// cannot send one, which is why narrowing has to be enough on its own
			const outcome = await resolveBearer(token)

			// THEN it resolves to the chosen organization
			expect(outcome).toEqual({ kind: 'scoped', orgIds: [taller.id] })
		})
	})

	describe('a multi-org user whose last selected org was revoked', () => {
		it('should refuse rather than fall back to every org they belong to', async () => {
			// GIVEN the multi-org user's connection has no org left selected and
			// a block recorded for restaurant
			await setSelections(multiOrgUserId, [])
			await setRevocations(multiOrgUserId, [restaurant.id])
			const token = await mintToken({ sub: multiOrgUserId })

			// WHEN the Bearer path resolves
			const outcome = await resolveBearer(token)

			// THEN it refuses — the block keeps this from reading as "nobody has
			// chosen yet", which would hand the connection every org the user
			// belongs to instead of closing it
			expect(outcome).toEqual({ kind: 'forbidden', code: -32002 })
		})
	})

	describe('a multi-org user revoked from one org but not the other', () => {
		it('should keep working in the org that was left alone', async () => {
			// GIVEN both orgs authorized, then taller cut off
			await setSelections(multiOrgUserId, [taller.id, restaurant.id])
			await setRevocations(multiOrgUserId, [taller.id])
			const token = await mintToken({ sub: multiOrgUserId })

			// WHEN the Bearer path resolves with no hint
			const outcome = await resolveBearer(token)

			// THEN restaurant is the only one left, so it auto-picks it
			expect(outcome).toEqual({ kind: 'scoped', orgIds: [restaurant.id] })
		})

		it('should refuse a hint pointing at the revoked org', async () => {
			// GIVEN both orgs authorized, then taller cut off
			await setSelections(multiOrgUserId, [taller.id, restaurant.id])
			await setRevocations(multiOrgUserId, [taller.id])
			const token = await mintToken({ sub: multiOrgUserId })

			// WHEN the assistant explicitly asks for the revoked org
			const outcome = await resolveBearer(token, taller.id)

			// THEN it is refused — a hint can only pick among what is allowed
			expect(outcome).toEqual({ kind: 'forbidden', code: -32002 })
		})
	})

	describe('a single-org user whose only org was revoked', () => {
		it('should refuse instead of auto-picking that org', async () => {
			// GIVEN the single-org user never picked an org (auto-resolution) and
			// was then cut off from it
			await setSelections(singleOrgUserId, [])
			await setRevocations(singleOrgUserId, [taller.id])
			const token = await mintToken({ sub: singleOrgUserId })

			// WHEN the Bearer path resolves
			const outcome = await resolveBearer(token)

			// THEN auto-resolution does not resurrect the connection
			expect(outcome).toEqual({ kind: 'forbidden', code: -32002 })
		})
	})

	describe('a multi-org user with a single-org selection', () => {
		it('should scope to the selected org only', async () => {
			// GIVEN the multi-org user authorized restaurant for this client
			await setSelections(multiOrgUserId, [restaurant.id])
			const token = await mintToken({ sub: multiOrgUserId })

			// WHEN the Bearer path resolves (one authorized org → auto-pick)
			const outcome = await resolveBearer(token)

			// THEN it scopes to restaurant and reads only restaurant's marker
			expect(outcome).toEqual({ kind: 'scoped', orgIds: [restaurant.id] })
		})
	})

	describe('a multi-org user with a multi-org selection and no hint', () => {
		it('should refuse (ambiguous) with a select-an-org error', async () => {
			// GIVEN the multi-org user authorized both taller and restaurant
			await setSelections(multiOrgUserId, [taller.id, restaurant.id])
			const token = await mintToken({ sub: multiOrgUserId })

			// WHEN the Bearer path resolves without a hint
			const outcome = await resolveBearer(token)

			// THEN it refuses — the client must say which org per request
			expect(outcome).toEqual({ kind: 'forbidden', code: -32002 })
		})
	})

	describe('a multi-org user with a multi-org selection and a valid hint', () => {
		it('should scope to the hinted org only', async () => {
			// GIVEN the multi-org user authorized both taller and restaurant
			await setSelections(multiOrgUserId, [taller.id, restaurant.id])
			const token = await mintToken({ sub: multiOrgUserId })

			// WHEN the Bearer path resolves with a hint pointing at taller
			const outcome = await resolveBearer(token, taller.id)

			// THEN it scopes to taller and reads only taller's marker
			expect(outcome).toEqual({ kind: 'scoped', orgIds: [taller.id] })
		})
	})

	describe('a multi-org user with a multi-org selection and an unauthorized hint', () => {
		it('should refuse (hint outside the authorized set)', async () => {
			// GIVEN the multi-org user authorized only restaurant
			await setSelections(multiOrgUserId, [restaurant.id])
			const token = await mintToken({ sub: multiOrgUserId })

			// WHEN the Bearer path resolves with a hint pointing at taller
			// (a live membership, but not authorized for this connection)
			const outcome = await resolveBearer(token, taller.id)

			// THEN it refuses — a hint is only valid within the authorized set.
			// The single authorized org auto-picks only when no hint is sent;
			// an explicit-but-unauthorized hint is rejected so the client can't
			// reach an org it never consented to.
			expect(outcome).toEqual({ kind: 'forbidden', code: -32002 })
		})
	})

	describe('a selection that is no longer a live membership', () => {
		it('should reject rather than widen to other live orgs', async () => {
			// GIVEN a stale selection pointing at restaurant, where the single-org
			// user is NOT a member (only taller)
			await setSelections(singleOrgUserId, [restaurant.id])
			const token = await mintToken({ sub: singleOrgUserId })

			// WHEN the Bearer path resolves
			const outcome = await resolveBearer(token)

			// THEN it refuses — the connection was deliberately scoped to
			// restaurant, and the user is no longer a member. It does NOT fall
			// back to taller (a live org the connection was never authorized
			// for), because silently widening would be a privilege escalation.
			expect(outcome).toEqual({ kind: 'forbidden', code: -32002 })
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

describe('McpOAuthService.selectOrgs', () => {
	describe('the caller is a member of every target org', () => {
		it('should upsert the full set of authorized orgs', async () => {
			// GIVEN the single-org user is a member of taller
			// WHEN selectOrgs authorizes the connection for taller
			await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					yield* service.selectOrgs(singleOrgUserId, CLIENT_ID, [taller.id])
				}),
			)

			// THEN exactly one membership row maps (user, client) → taller
			const rows = await pool.query<{ organization_id: string }>(
				'SELECT organization_id FROM mcp_oauth_org_membership WHERE user_id = $1 AND client_id = $2',
				[singleOrgUserId, CLIENT_ID],
			)
			expect(rows.rows.map(r => r.organization_id)).toEqual([taller.id])
		})

		it('should replace the prior set atomically', async () => {
			// GIVEN the multi-org user authorized both taller and restaurant
			await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					yield* service.selectOrgs(multiOrgUserId, CLIENT_ID, [
						taller.id,
						restaurant.id,
					])
				}),
			)
			// WHEN they re-bind to only restaurant
			await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					yield* service.selectOrgs(multiOrgUserId, CLIENT_ID, [restaurant.id])
				}),
			)

			// THEN exactly one row remains, pointing at restaurant (taller dropped)
			const rows = await pool.query<{ organization_id: string }>(
				'SELECT organization_id FROM mcp_oauth_org_membership WHERE user_id = $1 AND client_id = $2 ORDER BY organization_id',
				[multiOrgUserId, CLIENT_ID],
			)
			expect(rows.rows.map(r => r.organization_id)).toEqual([restaurant.id])
		})

		it('should reject an empty list and leave the binding untouched', async () => {
			// GIVEN the single-org user has a binding to taller
			await setSelections(singleOrgUserId, [taller.id])
			// WHEN selectOrgs is called with an empty list
			const error = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* Effect.flip(
						service.selectOrgs(singleOrgUserId, CLIENT_ID, []),
					)
				}),
			)

			// THEN it is BadRequest — an empty list would read downstream as
			// "nobody has chosen yet" and widen the connection to every org the
			// user belongs to, so removal goes through revokeConnection instead
			expect(error._tag).toBe('BadRequest')
			// AND the existing binding is still there
			const rows = await pool.query<{ organization_id: string }>(
				'SELECT organization_id FROM mcp_oauth_org_membership WHERE user_id = $1 AND client_id = $2',
				[singleOrgUserId, CLIENT_ID],
			)
			expect(rows.rows.map(r => r.organization_id)).toEqual([taller.id])
		})
	})

	describe('the caller is not a member of every target org', () => {
		it('should fail with Forbidden and write nothing', async () => {
			// GIVEN the non-member user authorizes restaurant (not a member)
			// WHEN selectOrgs runs
			const error = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* Effect.flip(
						service.selectOrgs(nonMemberUserId, CLIENT_ID, [restaurant.id]),
					)
				}),
			)

			// THEN it is Forbidden and no binding was written
			expect(error._tag).toBe('Forbidden')
			const rows = await pool.query(
				'SELECT 1 FROM mcp_oauth_org_membership WHERE user_id = $1 AND client_id = $2',
				[nonMemberUserId, CLIENT_ID],
			)
			expect(rows.rowCount).toBe(0)
		})

		it('should reject a mixed list if any org is not a membership', async () => {
			// GIVEN the single-org user (member of taller) submits both taller
			// and restaurant (not a member)
			const error = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* Effect.flip(
						service.selectOrgs(singleOrgUserId, CLIENT_ID, [
							taller.id,
							restaurant.id,
						]),
					)
				}),
			)

			// THEN it is Forbidden and no binding was written — a partial
			// submission can't widen what the connection can later reach.
			expect(error._tag).toBe('Forbidden')
			const rows = await pool.query(
				'SELECT 1 FROM mcp_oauth_org_membership WHERE user_id = $1 AND client_id = $2',
				[singleOrgUserId, CLIENT_ID],
			)
			expect(rows.rowCount).toBe(0)
		})
	})
})

// Revoking runs on the ordinary request connection, so these drive it through
// enterOrgScope exactly as the HTTP handler does — which is also what puts the
// active organization in place for the table's WITH CHECK.
const revokeScoped = (
	org: Org,
	actorUserId: string,
	targetUserId: string,
	clientId: string,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const service = yield* McpOAuthService
		return yield* enterOrgScope(sql, { org, userId: actorUserId })(
			service.revokeConnection(org.id, actorUserId, targetUserId, clientId),
		)
	})

const revokeAs = (
	org: Org,
	actorUserId: string,
	targetUserId: string,
	clientId: string = CLIENT_ID,
) => runtime.runPromise(revokeScoped(org, actorUserId, targetUserId, clientId))

// The failure the caller expects, rather than a rejected promise.
const revokeAsError = (
	org: Org,
	actorUserId: string,
	targetUserId: string,
	clientId: string = CLIENT_ID,
) =>
	runtime.runPromise(
		Effect.flip(revokeScoped(org, actorUserId, targetUserId, clientId)),
	)

const restoreScoped = (
	org: Org,
	actorUserId: string,
	targetUserId: string,
	clientId: string,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const service = yield* McpOAuthService
		return yield* enterOrgScope(sql, { org, userId: actorUserId })(
			service.restoreConnection(org.id, actorUserId, targetUserId, clientId),
		)
	})

const restoreAs = (
	org: Org,
	actorUserId: string,
	targetUserId: string,
	clientId: string = CLIENT_ID,
) => runtime.runPromise(restoreScoped(org, actorUserId, targetUserId, clientId))

// The failure the caller expects, rather than a rejected promise.
const restoreAsError = (
	org: Org,
	actorUserId: string,
	targetUserId: string,
	clientId: string = CLIENT_ID,
) =>
	runtime.runPromise(
		Effect.flip(restoreScoped(org, actorUserId, targetUserId, clientId)),
	)

const readRevocations = async (userId: string) => {
	const rows = await pool.query<{
		organization_id: string
		revoked_by_user_id: string
	}>(
		`SELECT organization_id, revoked_by_user_id FROM mcp_oauth_revocation
		 WHERE user_id = $1 ORDER BY organization_id`,
		[userId],
	)
	return rows.rows
}

const listOrgAs = (org: Org, actorUserId: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* McpOAuthService
			return yield* enterOrgScope(sql, { org, userId: actorUserId })(
				service.listOrgConnections(org.id, actorUserId),
			)
		}),
	)

const listOrgAsError = (org: Org, actorUserId: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* McpOAuthService
			return yield* enterOrgScope(sql, { org, userId: actorUserId })(
				Effect.flip(service.listOrgConnections(org.id, actorUserId)),
			)
		}),
	)

describe('McpOAuthService.listOrgConnections', () => {
	describe('a plain member asking', () => {
		it('should be refused', async () => {
			// GIVEN a member of taller who is neither owner nor admin
			// WHEN they ask what can reach the organization
			const error = await listOrgAsError(taller, singleOrgUserId)

			// THEN it is refused — hiding the page would not be enough on its own
			expect(error._tag).toBe('Forbidden')
		})
	})

	describe('an admin asking', () => {
		it('should include another member’s connection with its tool', async () => {
			// GIVEN a colleague's connection scoped to taller, last used from a
			// known tool
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [taller.id])
			await recordSeen(taller, singleOrgUserId, CLIENT_ID, 'ChatGPT')

			// WHEN an admin of taller asks
			const rows = await listOrgAs(taller, adminUserId)

			// THEN the colleague's connection is listed, named, and attributed
			const row = rows.find(r => r.userId === singleOrgUserId)
			expect(row).toBeDefined()
			expect(row?.clientId).toBe(CLIENT_ID)
			expect(row?.client?.name).toBe('ChatGPT')
			expect(row?.lastUsedAt).not.toBeNull()
		})

		it('should include a connection nobody has scoped yet', async () => {
			// GIVEN a connection with no organization chosen, which falls back to
			// every organization its owner belongs to — so it does reach this one
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [])

			// WHEN an admin asks
			const rows = await listOrgAs(taller, adminUserId)

			// THEN it is shown, because it can in fact reach this organization
			expect(rows.some(r => r.userId === singleOrgUserId)).toBe(true)
		})

		it('should show a connection that was cut off, and say who cut it off', async () => {
			// GIVEN a colleague's connection that an admin already revoked
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [taller.id])
			await setRevocations(singleOrgUserId, [taller.id], adminUserId)

			// WHEN an admin asks
			const rows = await listOrgAs(taller, adminUserId)

			// THEN it is listed as cut off rather than left out. This is the only
			// place the organization can see what it stopped and allow it back, so
			// hiding it would make the removal permanent
			const row = rows.find(r => r.userId === singleOrgUserId)
			expect(row?.block?.byUserId).toBe(adminUserId)
			// AND it still wants this organization, so allowing it back would
			// hand the assistant its access rather than tidy a record away
			expect(row?.block?.boundHere).toBe(true)
		})

		it('should leave out a connection its own owner cut off', async () => {
			// GIVEN a colleague who cut their own connection off from taller
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [taller.id])
			await setRevocations(singleOrgUserId, [taller.id], singleOrgUserId)

			// WHEN an admin asks
			const rows = await listOrgAs(taller, adminUserId)

			// THEN it is not here. That removal is the colleague's own decision,
			// reversible from their own list, and not the organization's to undo
			expect(rows.some(r => r.userId === singleOrgUserId)).toBe(false)
		})

		it('should not show a connection belonging to another organization', async () => {
			// GIVEN a connection scoped only to restaurant
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(multiOrgUserId, [restaurant.id])

			// WHEN an admin of taller asks
			const rows = await listOrgAs(taller, adminUserId)

			// THEN taller's admin sees nothing of it. This read runs on the pool
			// that bypasses row-level security, so the organization predicate is
			// the only thing keeping the two apart
			expect(rows.some(r => r.userId === multiOrgUserId)).toBe(false)
		})
	})
})

describe('McpOAuthService.revokeConnection', () => {
	describe('a member revoking their own connection', () => {
		it('should record the block against the acting organization', async () => {
			// GIVEN the single-org user's connection is authorized for taller
			await setSelections(singleOrgUserId, [taller.id])

			// WHEN they revoke it themselves
			await revokeAs(taller, singleOrgUserId, singleOrgUserId)

			// THEN the block names them as the one who raised it
			expect(await readRevocations(singleOrgUserId)).toEqual([
				{ organization_id: taller.id, revoked_by_user_id: singleOrgUserId },
			])
		})

		it('should leave the original choice in place', async () => {
			// GIVEN an authorized connection
			await setSelections(singleOrgUserId, [taller.id])

			// WHEN it is revoked
			await revokeAs(taller, singleOrgUserId, singleOrgUserId)

			// THEN the selection row survives — the block is what denies access,
			// so deleting the choice would be both redundant and lossy
			const rows = await pool.query<{ organization_id: string }>(
				'SELECT organization_id FROM mcp_oauth_org_membership WHERE user_id = $1 AND client_id = $2',
				[singleOrgUserId, CLIENT_ID],
			)
			expect(rows.rows.map(r => r.organization_id)).toEqual([taller.id])
		})
	})

	describe('an admin revoking another member’s connection', () => {
		it('should record the block against the admin', async () => {
			// GIVEN the single-org user's connection is authorized for taller
			await setSelections(singleOrgUserId, [taller.id])

			// WHEN an admin of taller revokes it
			await revokeAs(taller, adminUserId, singleOrgUserId)

			// THEN the block is attributed to the admin, which is what stops the
			// member from lifting it later
			expect(await readRevocations(singleOrgUserId)).toEqual([
				{ organization_id: taller.id, revoked_by_user_id: adminUserId },
			])
		})
	})

	describe('a plain member revoking someone else’s connection', () => {
		it('should fail with Forbidden and write nothing', async () => {
			// GIVEN the single-org user's connection is authorized for taller
			await setSelections(singleOrgUserId, [taller.id])

			// WHEN another plain member of taller tries to revoke it
			const error = await revokeAsError(taller, multiOrgUserId, singleOrgUserId)

			// THEN it is refused and no block is recorded
			expect(error._tag).toBe('Forbidden')
			expect(await readRevocations(singleOrgUserId)).toEqual([])
		})
	})

	describe('revoking for someone who is not in the organization', () => {
		it('should fail with NotFound', async () => {
			// WHEN an admin revokes for a user who belongs to no organization
			const error = await revokeAsError(taller, adminUserId, nonMemberUserId)

			// THEN there is nothing to cut off
			expect(error._tag).toBe('NotFound')
			expect(await readRevocations(nonMemberUserId)).toEqual([])
		})
	})

	describe('re-approving the connection afterwards', () => {
		it('should lift a block the same person raised', async () => {
			// GIVEN the single-org user revoked their own connection
			await setSelections(singleOrgUserId, [taller.id])
			await revokeAs(taller, singleOrgUserId, singleOrgUserId)

			// WHEN they approve the connection for that org again
			await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					yield* service.selectOrgs(singleOrgUserId, CLIENT_ID, [taller.id])
				}),
			)

			// THEN the block is gone — an accidental self-revoke is recoverable
			expect(await readRevocations(singleOrgUserId)).toEqual([])
		})

		it('should NOT let the blocked person overwrite who raised it', async () => {
			// GIVEN an admin cut the single-org user's connection off
			await setSelections(singleOrgUserId, [taller.id])
			await revokeAs(taller, adminUserId, singleOrgUserId)

			// WHEN that person cuts their own connection off as well. Anyone may do
			// that to their own, so it is the one write they can aim at this row
			await revokeAs(taller, singleOrgUserId, singleOrgUserId)

			// THEN the admin still owns the removal. Were it to become theirs, the
			// next line would hand them the way out of a removal they never made
			expect(await readRevocations(singleOrgUserId)).toEqual([
				{ organization_id: taller.id, revoked_by_user_id: adminUserId },
			])

			// AND choosing the organization again still does not clear it
			await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					yield* service.selectOrgs(singleOrgUserId, CLIENT_ID, [taller.id])
				}),
			)
			expect(await readRevocations(singleOrgUserId)).toEqual([
				{ organization_id: taller.id, revoked_by_user_id: adminUserId },
			])
		})

		it('should NOT lift a block an admin raised', async () => {
			// GIVEN an admin cut the single-org user's connection off
			await setSelections(singleOrgUserId, [taller.id])
			await revokeAs(taller, adminUserId, singleOrgUserId)

			// WHEN the member re-approves the connection for that org
			await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					yield* service.selectOrgs(singleOrgUserId, CLIENT_ID, [taller.id])
				}),
			)

			// THEN the admin's block stands, so nobody can re-admit themselves to
			// an organization they were removed from
			expect(await readRevocations(singleOrgUserId)).toEqual([
				{ organization_id: taller.id, revoked_by_user_id: adminUserId },
			])
		})
	})
})

describe('McpOAuthService.restoreConnection', () => {
	describe('an owner allowing back a connection an admin cut off', () => {
		it('should clear the removal', async () => {
			// GIVEN an admin cut the single-org user's connection off from taller
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [taller.id])
			await revokeAs(taller, adminUserId, singleOrgUserId)

			// WHEN the owner allows it back
			await restoreAs(taller, ownerUserId, singleOrgUserId)

			// THEN nothing stands in its way any more
			expect(await readRevocations(singleOrgUserId)).toEqual([])
		})

		it('should let the assistant reach the organization again', async () => {
			// GIVEN a connection cut off from the only organization it has, which
			// leaves it refused on every request
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [taller.id])
			await revokeAs(taller, adminUserId, singleOrgUserId)
			const token = await mintToken({ sub: singleOrgUserId })
			expect(await resolveBearer(token)).toEqual({
				kind: 'forbidden',
				code: -32002,
			})

			// WHEN the owner allows it back
			await restoreAs(taller, ownerUserId, singleOrgUserId)

			// THEN the token resolves again, which is what a lift is for
			expect(await resolveBearer(token)).toEqual({
				kind: 'scoped',
				orgIds: [taller.id],
			})
		})
	})

	describe('a member with no managing role', () => {
		it('should be refused', async () => {
			// GIVEN an admin cut a colleague's connection off
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [taller.id])
			await revokeAs(taller, adminUserId, singleOrgUserId)

			// WHEN a plain member tries to allow back somebody else's connection.
			// Acting on their own would be refused for a second reason, which would
			// let this pass even if the role were never checked
			const error = await restoreAsError(
				taller,
				multiOrgUserId,
				singleOrgUserId,
			)

			// THEN they are refused for the role, and the removal stands
			expect(error._tag).toBe('Forbidden')
			expect(error.message).toContain('owner or an admin')
			expect(await readRevocations(singleOrgUserId)).toEqual([
				{ organization_id: taller.id, revoked_by_user_id: adminUserId },
			])
		})
	})

	describe('someone cut off by another person, acting on themselves', () => {
		it('should be refused even though they manage the organization', async () => {
			// GIVEN the owner cut the admin's own connection off. The admin manages
			// taller, so nothing but this rule stands between them and undoing it
			await seedConsentedClient(adminUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(adminUserId, [taller.id])
			await revokeAs(taller, ownerUserId, adminUserId)

			// WHEN the admin tries to allow their own connection back
			const error = await restoreAsError(taller, adminUserId, adminUserId)

			// THEN they are refused. Recording who made a removal would mean
			// nothing if the person it was aimed at could lift it themselves
			expect(error._tag).toBe('Forbidden')
			expect(error.message).toContain('cannot be allowed back by the person')
			expect(await readRevocations(adminUserId)).toEqual([
				{ organization_id: taller.id, revoked_by_user_id: ownerUserId },
			])
		})
	})

	describe('a connection that never chose this organization', () => {
		it('should be refused rather than cleared', async () => {
			// GIVEN a connection cut off from taller that has chosen nothing, so
			// clearing the removal would hand it every organization its owner
			// belongs to rather than just this one
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(multiOrgUserId, [])
			await revokeAs(taller, adminUserId, multiOrgUserId)

			// WHEN the owner tries to allow it back
			const error = await restoreAsError(taller, ownerUserId, multiOrgUserId)

			// THEN it is refused: this organization can take its own obstacle
			// away, but it cannot make a choice on someone else's behalf
			expect(error._tag).toBe('Forbidden')
			expect(error.message).toContain('not set to work in this organization')
			expect(await readRevocations(multiOrgUserId)).toEqual([
				{ organization_id: taller.id, revoked_by_user_id: adminUserId },
			])
		})
	})

	describe('a removal the member made on their own connection', () => {
		it('should be refused even to an owner', async () => {
			// GIVEN a member who switched their own assistant off in this
			// organization
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [taller.id])
			await revokeAs(taller, singleOrgUserId, singleOrgUserId)

			// WHEN an owner tries to switch it back on for them
			const error = await restoreAsError(taller, ownerUserId, singleOrgUserId)

			// THEN it is refused. The organization may remove a connection, but it
			// does not get to undo somebody's own decision about their assistant
			expect(error._tag).toBe('Forbidden')
			expect(error.message).toContain('removed by the person it belongs to')
			expect(await readRevocations(singleOrgUserId)).toEqual([
				{ organization_id: taller.id, revoked_by_user_id: singleOrgUserId },
			])
		})
	})

	describe('nothing is blocked', () => {
		it('should report that there is nothing to allow back', async () => {
			// GIVEN a connection this organization has not removed
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [taller.id])

			// WHEN an owner tries to allow it back anyway
			const error = await restoreAsError(taller, ownerUserId, singleOrgUserId)

			// THEN it says so rather than reporting success for a call that changed
			// nothing — which would also record a removal being lifted that never was
			expect(error._tag).toBe('NotFound')
		})
	})

	describe('two members stopped for the same assistant', () => {
		it('should allow back only the one named', async () => {
			// GIVEN two people in this organization stopped for the same assistant
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [taller.id])
			await setSelections(multiOrgUserId, [taller.id])
			await revokeAs(taller, adminUserId, singleOrgUserId)
			await revokeAs(taller, adminUserId, multiOrgUserId)

			// WHEN the owner allows one of them back
			await restoreAs(taller, ownerUserId, singleOrgUserId)

			// THEN the other person is untouched. They share an assistant, so a
			// delete that matched on it alone would quietly clear them both
			expect(await readRevocations(singleOrgUserId)).toEqual([])
			expect(await readRevocations(multiOrgUserId)).toEqual([
				{ organization_id: taller.id, revoked_by_user_id: adminUserId },
			])
		})
	})

	describe('a removal recorded by a different organization', () => {
		it('should be left alone', async () => {
			// GIVEN the multi-org user cut off from both organizations — taller by
			// its admin, restaurant by themselves
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(multiOrgUserId, [taller.id, restaurant.id])
			await revokeAs(taller, adminUserId, multiOrgUserId)
			await revokeAs(restaurant, multiOrgUserId, multiOrgUserId)

			// WHEN an owner of taller allows the connection back
			await restoreAs(taller, ownerUserId, multiOrgUserId)

			// THEN only taller's removal goes. One organization never reaches into
			// another's, whatever the request asks for
			expect(await readRevocations(multiOrgUserId)).toEqual([
				{
					organization_id: restaurant.id,
					revoked_by_user_id: multiOrgUserId,
				},
			])
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

	describe('a consented client bound to one org', () => {
		it('should return the connection with that org in organizationIds', async () => {
			// GIVEN a consented client and a binding to taller
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [taller.id])

			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(singleOrgUserId)
				}),
			)

			// THEN the connection carries the client + taller in its org list
			expect(connections).toHaveLength(1)
			expect(connections[0]?.clientId).toBe(CLIENT_ID)
			expect(connections[0]?.organizationIds).toEqual([taller.id])
		})
	})

	describe('a connection cut off from one of its orgs', () => {
		it('should leave that org out of the list', async () => {
			// GIVEN a connection authorized for both orgs, then cut off from taller
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(multiOrgUserId, [taller.id, restaurant.id])
			await setRevocations(multiOrgUserId, [taller.id])

			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(multiOrgUserId)
				}),
			)

			// THEN only the org it can still reach is shown. The choice behind the
			// revoked one is deliberately kept so it can be put back, so listing
			// every choice would tell someone the connection still reaches data it
			// cannot touch
			expect(connections[0]?.organizationIds).toEqual([restaurant.id])
		})
	})

	describe('a consented client bound to multiple orgs', () => {
		it('should return the connection with every bound org', async () => {
			// GIVEN a consented client authorized for both taller and restaurant
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(multiOrgUserId, [taller.id, restaurant.id])

			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(multiOrgUserId)
				}),
			)

			// THEN the connection carries both orgs (sorted, as array_agg does)
			const expected = [restaurant.id, taller.id].sort()
			expect(connections).toHaveLength(1)
			expect(connections[0]?.organizationIds).toEqual(expected)
		})
	})

	describe('a consented client with no org chosen', () => {
		it('should return an empty organizationIds array', async () => {
			// GIVEN a consented client but no selection
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')

			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(multiOrgUserId)
				}),
			)

			// THEN the connection's organizationIds is empty (unbound)
			expect(connections).toHaveLength(1)
			expect(connections[0]?.organizationIds).toEqual([])
		})

		it('should return an empty chosenOrganizationIds array', async () => {
			// GIVEN a consented client but no selection
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')

			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(multiOrgUserId)
				}),
			)

			// THEN nothing has been chosen either — which is what tells the screen
			// this connection reaches every organization rather than none
			expect(connections[0]?.chosenOrganizationIds).toEqual([])
			expect(connections[0]?.blocks).toEqual([])
		})
	})

	describe('a connection cut off by an owner', () => {
		it('should report the block as not raised by the connection owner', async () => {
			// GIVEN a connection authorized for both orgs, cut off from taller by an
			// admin rather than by the person who owns the connection
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(multiOrgUserId, [taller.id, restaurant.id])
			await setRevocations(multiOrgUserId, [taller.id], adminUserId)

			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(multiOrgUserId)
				}),
			)

			// THEN the block is reported as someone else's, so the screen can show it
			// as something this person cannot undo
			expect(connections[0]?.blocks).toEqual([
				{ organizationId: taller.id, blockedBySelf: false },
			])
			// AND the choice behind it survives, even though it is unreachable
			expect(connections[0]?.chosenOrganizationIds).toEqual(
				[restaurant.id, taller.id].sort(),
			)
			expect(connections[0]?.organizationIds).toEqual([restaurant.id])
		})
	})

	describe('a connection the caller cut off themselves', () => {
		it('should report the block as their own', async () => {
			// GIVEN a connection the person cut off from taller themselves
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(multiOrgUserId, [taller.id, restaurant.id])
			await setRevocations(multiOrgUserId, [taller.id])

			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(multiOrgUserId)
				}),
			)

			// THEN it is marked as theirs — the screen offers it back, because
			// choosing that organization again lifts their own block
			expect(connections[0]?.blocks).toEqual([
				{ organizationId: taller.id, blockedBySelf: true },
			])
		})
	})

	describe('a connection stopped in an organization it never chose', () => {
		it('should say the member has not chosen it', async () => {
			// GIVEN a connection stopped here that has chosen nothing
			await seedConsentedClient(singleOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(singleOrgUserId, [])
			await setRevocations(singleOrgUserId, [taller.id], adminUserId)

			// WHEN an admin asks
			const rows = await listOrgAs(taller, adminUserId)

			// THEN the removal is reported as one that would hand nothing back, so
			// the screen can say as much rather than offer an action that is refused
			const row = rows.find(r => r.userId === singleOrgUserId)
			expect(row?.block?.boundHere).toBe(false)
		})
	})

	describe('a connection cut off from an org it never chose', () => {
		it('should still report the block', async () => {
			// GIVEN a connection nobody has scoped, cut off from taller anyway.
			// There is no choice for the removal to hang off, which is exactly the
			// case a join through the chosen organizations cannot see
			await seedConsentedClient(multiOrgUserId, CLIENT_ID, 'mcp-oauth-test')
			await setSelections(multiOrgUserId, [])
			await setRevocations(multiOrgUserId, [taller.id], adminUserId)

			// WHEN listConnections runs
			const connections = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* McpOAuthService
					return yield* service.listConnections(multiOrgUserId)
				}),
			)

			// THEN the block is still reported, so the screen never claims the way is
			// clear while the connection stays shut out
			expect(connections[0]?.chosenOrganizationIds).toEqual([])
			expect(connections[0]?.blocks).toEqual([
				{ organizationId: taller.id, blockedBySelf: false },
			])
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

	it("should hide another user's mcp_oauth_org_membership rows even without a WHERE", async () => {
		const client = await pool.connect()
		try {
			// GIVEN two users each hold a connection binding
			await client.query('BEGIN')
			await client.query(
				`INSERT INTO mcp_oauth_org_membership (user_id, client_id, organization_id)
				 VALUES ('rls-a', 'rls-c', $1), ('rls-b', 'rls-c', $1)`,
				[taller.id],
			)
			// WHEN the resolver reads as user A
			await client.query('SET LOCAL ROLE app_mcp_resolver')
			await client.query(
				"SELECT set_config('app.current_user_id', 'rls-a', true)",
			)
			const all = await client.query<{ user_id: string }>(
				'SELECT user_id FROM mcp_oauth_org_membership',
			)
			const reachForB = await client.query(
				"SELECT 1 FROM mcp_oauth_org_membership WHERE user_id = 'rls-b'",
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
					`INSERT INTO mcp_oauth_org_membership (user_id, client_id, organization_id)
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
