// Pins how the /mcp middleware resolves an org API key: key → org's agent +
// org (from the key's metadata) → scoped session, the org isolation that
// yields, and the fail-closed rejections. The JSON-RPC envelope wiring is
// covered by the boot test.
//
// The full env must be set before the Auth layer builds.
const env: Record<string, string> = {
	NODE_ENV: 'test',
	DATABASE_URL: 'postgres://batuda:batuda@localhost:5433/batuda',
	BETTER_AUTH_SECRET: '00000000000000000000000000000000',
	BETTER_AUTH_BASE_URL: 'http://localhost:3010',
	ALLOWED_ORIGINS: 'http://localhost:3010',
	APP_PUBLIC_URL: 'http://localhost:3010',
	STORAGE_ENDPOINT: 'http://localhost:9000',
	STORAGE_REGION: 'auto',
	STORAGE_ACCESS_KEY_ID: 'batuda',
	STORAGE_SECRET_ACCESS_KEY: 'batuda-secret',
	STORAGE_BUCKET: 'batuda-assets',
	EMAIL_PROVIDER: 'local-inbox',
	EMAIL_CREDENTIAL_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
	EMAIL_PROVIDER_TRANSACTIONAL: 'local',
	GEOCODER_PROVIDER: 'nominatim',
	RESEARCH_PROVIDER_SEARCH: 'stub',
	RESEARCH_PROVIDER_SCRAPE: 'stub',
	RESEARCH_PROVIDER_EXTRACT: 'stub',
	RESEARCH_PROVIDER_DISCOVER: 'stub',
	RESEARCH_PROVIDER_REGISTRY_ES: 'stub',
	RESEARCH_PROVIDER_REPORT_ES: 'none',
	RESEARCH_LLM_AGENT_PROVIDERS: 'stub',
	RESEARCH_LLM_EXTRACT_PROVIDERS: 'stub',
	RESEARCH_LLM_WRITER_PROVIDERS: 'stub',
	RESEARCH_DEFAULT_BUDGET_CENTS: '100',
	RESEARCH_DEFAULT_PAID_BUDGET_CENTS: '500',
	RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS: '200',
	RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS: '2000',
	RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS: '10000',
	RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL: '3',
	RESEARCH_MAX_CONCURRENCY_FANOUT: '3',
	RESEARCH_CONFIRM_THRESHOLD_FANOUT: '10',
}
for (const [k, v] of Object.entries(env)) process.env[k] ??= v

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

// Mints a key (ApiKeyService), verifies it (the middleware's first step), then
// — for a valid org key — resolves the org from metadata and runs `body`
// inside enterOrgScope as the agent, exactly as the /mcp middleware would.
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

describe('MCP API-key auth resolution', () => {
	describe('a valid org key', () => {
		it('should resolve to its org + agent and scope reads to that org', async () => {
			// GIVEN a key minted for the taller org
			const created = await runtime.runPromise(
				Effect.gen(function* () {
					const svc = yield* ApiKeyService
					return yield* svc.create(taller.id, { name: 'mcp-key' })
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

			// AND entering that scope as the agent reads only taller's marker
			// company, never restaurant's (RLS isolation)
			// Result columns are camelCase (PgClient transformResultNames).
			const orgIds = await runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, {
						org: taller,
						userId: resolved.referenceId ?? '',
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
					return yield* svc.create(taller.id, { name: 'mcp-revoke' })
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
					return yield* svc.create(taller.id, { name: 'mcp-rl-seed' })
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
})
