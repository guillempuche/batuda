// Pins how the /mcp middleware resolves an org API key: key → its org + the
// creating member (from the key's metadata) → a session scoped to that member,
// the org isolation that yields, and the fail-closed rejections. The JSON-RPC
// envelope wiring is covered by the boot test.

import { randomUUID } from 'node:crypto'

import type { PgClient } from '@effect/sql-pg'
import { type Config, Effect, Layer, ManagedRuntime } from 'effect'
import { SqlClient, type SqlError } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { Auth } from '../lib/auth'
import { EnvVars } from '../lib/env'
import { enterOrgScope } from '../middleware/org'
import { ApiKeyService } from '../services/api-keys'
import { applyTestEnv } from '../test-env'

// Config has no defaults; set the required env before any layer reads it.
applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const AGENT_EMAIL_LIKE = 'agent+%@keys.batuda.internal'
const FIXTURE_SLUG = `mcp-keyauth-${randomUUID()}`

type Org = { id: string; name: string; slug: string }

let pool: pg.Pool
let runtime: ManagedRuntime.ManagedRuntime<
	ApiKeyService | Auth | SqlClient.SqlClient | PgClient.PgClient,
	Config.ConfigError | SqlError.SqlError
>
let taller: Org
let restaurant: Org
let tallerMemberId: string

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

// A real member of the org — the key creator a real /mcp key would carry.
const memberIdOf = async (orgId: string): Promise<string> => {
	const r = await pool.query<{ userId: string }>(
		'SELECT "userId" FROM member WHERE "organizationId" = $1 ORDER BY "userId" LIMIT 1',
		[orgId],
	)
	const id = r.rows[0]?.userId
	if (!id) throw new Error(`${orgId} has no members — run 'pnpm cli seed'`)
	return id
}

// One marker company per org, so a scoped read can prove isolation.
const seedCompany = async (orgId: string) => {
	await pool.query(
		`INSERT INTO companies (organization_id, slug, name) VALUES ($1, $2, $2)`,
		[orgId, FIXTURE_SLUG],
	)
}

const cleanup = async () => {
	await pool.query('DELETE FROM companies WHERE slug = $1', [FIXTURE_SLUG])
	await pool.query(
		`DELETE FROM apikey WHERE "referenceId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
		[AGENT_EMAIL_LIKE],
	)
	await pool.query('DELETE FROM "user" WHERE email LIKE $1', [AGENT_EMAIL_LIKE])
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	taller = await orgBySlug('taller')
	restaurant = await orgBySlug('restaurant')
	tallerMemberId = await memberIdOf(taller.id)
	await cleanup()
	await seedCompany(taller.id)
	await seedCompany(restaurant.id)
	runtime = ManagedRuntime.make(
		Layer.provideMerge(
			ApiKeyService.layer,
			Layer.mergeAll(Auth.layer, PgLive),
		).pipe(Layer.provide(EnvVars.layer)),
	)
}, 60_000)

afterAll(async () => {
	await cleanup()
	await runtime.dispose()
	await pool.end()
})

// Verifies a key the way the /mcp middleware does as its first step, surfacing
// what the result carries (validity, org, the key's agent owner, rate-limit
// error). Creator resolution is exercised separately via `resolveCreator`.
interface ResolveResult {
	readonly valid: boolean
	readonly orgId: string | null
	readonly referenceId: string | null
	readonly errorCode: string | null
	readonly tryAgainIn: number | null
}

const verify = (key: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const { instance } = yield* Auth
			const verified = yield* Effect.promise(() =>
				instance.api.verifyApiKey({ body: { key } }),
			)
			const orgId = verified.valid
				? ((verified.key?.metadata as { organizationId?: string } | null)
						?.organizationId ?? null)
				: null
			const error = verified.error as {
				code?: string
				details?: { tryAgainIn?: number }
			} | null
			return {
				valid: verified.valid,
				orgId,
				referenceId: verified.key?.referenceId ?? null,
				errorCode: error?.code ?? null,
				tryAgainIn: error?.details?.tryAgainIn ?? null,
			} satisfies ResolveResult
		}),
	)

// Mirrors the /mcp middleware's creator resolution: verify, read the creator id
// from the key's metadata, and confirm a live membership in the org. Returns the
// creator's user id, or null when the key has no creator or the creator is not
// (or no longer) a member.
const resolveCreator = (orgId: string, key: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const { instance } = yield* Auth
			const verified = yield* Effect.promise(() =>
				instance.api.verifyApiKey({ body: { key } }),
			)
			if (!verified.valid || !verified.key) return null
			const createdByUserId = (
				verified.key.metadata as { createdByUserId?: string } | null
			)?.createdByUserId
			if (!createdByUserId) return null
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ id: string }>`
				SELECT u.id FROM "user" u
				JOIN member m ON m."userId" = u.id AND m."organizationId" = ${orgId}
				WHERE u.id = ${createdByUserId} LIMIT 1
			`
			return rows[0]?.id ?? null
		}),
	)

describe('MCP API-key auth resolution', () => {
	describe('a valid org key', () => {
		it('should attribute to the creating member and scope reads to its org', async () => {
			// GIVEN a key minted for the taller org
			const created = await runtime.runPromise(
				Effect.gen(function* () {
					const svc = yield* ApiKeyService
					return yield* svc.create(taller.id, tallerMemberId, {
						name: 'mcp-key',
					})
				}),
			)

			// WHEN the key is verified (the middleware's resolution step)
			const resolved = await verify(created.key)

			// THEN it is valid and carries taller's org id + the org's agent user
			expect(resolved.valid).toBe(true)
			expect(resolved.orgId).toBe(taller.id)
			const agent = await pool.query<{ id: string }>(
				'SELECT id FROM "user" WHERE lower(email) = lower($1)',
				[`agent+${taller.id}@keys.batuda.internal`],
			)
			expect(resolved.referenceId).toBe(agent.rows[0]?.id)
			// AND it attributes to the creating member, still a live member
			expect(await resolveCreator(taller.id, created.key)).toBe(tallerMemberId)

			// AND entering that scope as the creating member reads only taller's marker
			// company, never restaurant's (RLS isolation)
			// Result columns are camelCase (PgClient transformResultNames).
			const orgIds = await runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, {
						org: taller,
						userId: tallerMemberId,
					})(
						Effect.gen(function* () {
							const rows = yield* sql<{ organizationId: string }>`
								SELECT organization_id FROM companies WHERE slug = ${FIXTURE_SLUG}
							`
							return rows.map(r => r.organizationId)
						}),
					)
				}),
			)
			expect(orgIds).toEqual([taller.id])
		})
	})

	describe('invalid, unknown, or revoked keys', () => {
		it('should be rejected (valid:false), failing closed', async () => {
			// GIVEN a garbage key and a minted-then-deleted key
			const garbage = await verify('batuda_not-a-real-key')

			const created = await runtime.runPromise(
				Effect.gen(function* () {
					const svc = yield* ApiKeyService
					return yield* svc.create(taller.id, tallerMemberId, {
						name: 'mcp-revoke',
					})
				}),
			)
			const id = created.id
			await runtime.runPromise(
				Effect.gen(function* () {
					const svc = yield* ApiKeyService
					return yield* svc.delete(taller.id, id)
				}),
			)
			const revoked = await verify(created.key)

			// THEN neither verifies
			expect(garbage.valid).toBe(false)
			expect(revoked.valid).toBe(false)
		})
	})

	describe('a rate-limited key', () => {
		it('should fail closed with RATE_LIMITED and a retry hint once over its window', async () => {
			// GIVEN taller's agent user (the owner every taller key references)
			await runtime.runPromise(
				Effect.gen(function* () {
					const svc = yield* ApiKeyService
					return yield* svc.create(taller.id, tallerMemberId, {
						name: 'mcp-rl-seed',
					})
				}),
			)
			const agentRow = await pool.query<{ id: string }>(
				'SELECT id FROM "user" WHERE lower(email) = lower($1)',
				[`agent+${taller.id}@keys.batuda.internal`],
			)
			const agentId = agentRow.rows[0]?.id as string

			// AND a key for it capped at 2 requests in a long window (minted
			// directly so the cap is small regardless of the env defaults)
			const limitedKey = await runtime.runPromise(
				Effect.gen(function* () {
					const { instance } = yield* Auth
					const created = yield* Effect.promise(() =>
						instance.api.createApiKey({
							body: {
								userId: agentId,
								name: 'mcp-rl',
								metadata: { organizationId: taller.id },
								rateLimitEnabled: true,
								rateLimitMax: 2,
								rateLimitTimeWindow: 60_000,
							},
						}),
					)
					return created.key
				}),
			)

			// WHEN it is verified three times inside the window
			const first = await verify(limitedKey)
			const second = await verify(limitedKey)
			const third = await verify(limitedKey)

			// THEN the first two pass and the third is throttled with the code +
			// retry hint the /mcp branch maps to a 429 + Retry-After
			expect(first.valid).toBe(true)
			expect(second.valid).toBe(true)
			expect(third.valid).toBe(false)
			expect(third.errorCode).toBe('RATE_LIMITED')
			expect(typeof third.tryAgainIn).toBe('number')
			expect(Math.ceil((third.tryAgainIn ?? 0) / 1000)).toBeGreaterThan(0)
		})
	})

	describe('a key whose creator is no longer a member', () => {
		it('should resolve no creator, so the middleware rejects it', async () => {
			// GIVEN a taller key stamped with a creator id that has no taller
			// membership (a member who has since left, or never belonged)
			const exMemberId = randomUUID()
			const created = await runtime.runPromise(
				Effect.gen(function* () {
					const svc = yield* ApiKeyService
					return yield* svc.create(taller.id, exMemberId, {
						name: 'mcp-ex-member',
					})
				}),
			)
			// WHEN resolving the creator against taller
			// THEN no live membership → null (the middleware answers 403)
			expect(await resolveCreator(taller.id, created.key)).toBeNull()
		})
	})

	describe('a key with no creator in its metadata', () => {
		it('should resolve no creator, so the middleware rejects it', async () => {
			// GIVEN a key minted directly without a createdByUserId; there is no
			// backward-compat fallback to the org agent
			await runtime.runPromise(
				Effect.gen(function* () {
					const svc = yield* ApiKeyService
					return yield* svc.create(taller.id, tallerMemberId, {
						name: 'mcp-nocreator-seed',
					})
				}),
			)
			const agentRow = await pool.query<{ id: string }>(
				'SELECT id FROM "user" WHERE lower(email) = lower($1)',
				[`agent+${taller.id}@keys.batuda.internal`],
			)
			const key = await runtime.runPromise(
				Effect.gen(function* () {
					const { instance } = yield* Auth
					const created = yield* Effect.promise(() =>
						instance.api.createApiKey({
							body: {
								userId: agentRow.rows[0]?.id as string,
								name: 'mcp-nocreator',
								metadata: { organizationId: taller.id },
							},
						}),
					)
					return created.key
				}),
			)
			// WHEN resolving the creator
			// THEN none (no createdByUserId) → null (the middleware answers 403)
			expect(await resolveCreator(taller.id, key)).toBeNull()
		})
	})
})
