// ApiKeyService runs against the real `Auth` layer (a Better Auth instance +
// its owner pool), so the full env must be present before the layer builds.
// Mirrors apps/server/src/main.boot.test.ts's env block.
const env: Record<string, string> = {
	NODE_ENV: 'test',
	DATABASE_URL: 'postgres://batuda:batuda@localhost:5433/batuda',
	BETTER_AUTH_SECRET: '00000000000000000000000000000000',
	BETTER_AUTH_BASE_URL: 'http://localhost:3010',
	ALLOWED_ORIGINS: 'http://localhost:3010',
	APP_PUBLIC_URL: 'http://localhost:3010',
	API_KEY_RATE_LIMIT_ENABLED: 'true',
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

import { type Config, Effect, Layer, ManagedRuntime } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Auth } from '../lib/auth'
import { EnvVars } from '../lib/env'
import { ApiKeyService } from './api-keys'

const DATABASE_URL = process.env['DATABASE_URL'] as string
// Per-org agent users this feature mints; cleaned up by this exact pattern.
const AGENT_EMAIL_LIKE = 'agent+%@keys.batuda.internal'

let pool: pg.Pool
let runtime: ManagedRuntime.ManagedRuntime<ApiKeyService, Config.ConfigError>
let tallerOrgId: string
let restaurantOrgId: string

const orgIdBySlug = async (slug: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		'SELECT id FROM organization WHERE slug = $1 LIMIT 1',
		[slug],
	)
	const id = r.rows[0]?.id
	if (!id)
		throw new Error(
			`${slug} org missing — run 'pnpm cli db reset && pnpm cli seed'`,
		)
	return id
}

const cleanup = async () => {
	await pool.query(
		`DELETE FROM apikey WHERE "referenceId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
		[AGENT_EMAIL_LIKE],
	)
	await pool.query('DELETE FROM "user" WHERE email LIKE $1', [AGENT_EMAIL_LIKE])
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	tallerOrgId = await orgIdBySlug('taller')
	restaurantOrgId = await orgIdBySlug('restaurant')
	await cleanup()
	runtime = ManagedRuntime.make(
		Layer.provide(
			ApiKeyService.layer,
			Layer.mergeAll(Auth.layer, EnvVars.layer),
		),
	)
}, 60_000)

afterAll(async () => {
	await cleanup()
	await runtime.dispose()
	await pool.end()
})

const create = (orgId: string, name: string, expiresIn?: number) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ApiKeyService
			return yield* svc.create(orgId, { name, expiresIn })
		}),
	)

const list = (orgId: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ApiKeyService
			return yield* svc.list(orgId)
		}),
	)

const getOutcome = (orgId: string, keyId: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ApiKeyService
			return yield* svc.get(orgId, keyId).pipe(
				Effect.match({
					onFailure: e => ({ tag: e._tag }),
					onSuccess: row => ({ tag: 'ok' as const, row }),
				}),
			)
		}),
	)

const deleteOutcome = (orgId: string, keyId: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* ApiKeyService
			return yield* svc.delete(orgId, keyId).pipe(
				Effect.match({
					onFailure: e => e._tag,
					onSuccess: () => 'ok' as const,
				}),
			)
		}),
	)

const apikeyRow = async (id: string) => {
	const r = await pool.query<{
		referenceId: string
		metadata: unknown
		rateLimitEnabled: boolean
	}>(
		'SELECT "referenceId", metadata, "rateLimitEnabled" FROM apikey WHERE id = $1',
		[id],
	)
	return r.rows[0]
}

const agentCount = async (orgId: string) => {
	const r = await pool.query<{ n: number }>(
		'SELECT count(*)::int AS n FROM "user" WHERE lower(email) = lower($1)',
		[`agent+${orgId}@keys.batuda.internal`],
	)
	return r.rows[0]?.n ?? 0
}

describe('ApiKeyService.create', () => {
	describe('for a member of the active org', () => {
		it('should mint a one-time key stamped with the org, agent-owned, and rate-limited', async () => {
			// GIVEN a create for the taller org
			// WHEN the service mints a key
			const created = await create(tallerOrgId, 'ci-create')

			// THEN the plaintext key is returned once, and the row carries the org
			// in metadata, is owned by the org's agent user, and carries the limit
			expect(created.key.length).toBeGreaterThan(0)
			const row = await apikeyRow(created.id)
			// Better Auth stores metadata as a JSON string column.
			const meta =
				typeof row?.metadata === 'string'
					? (JSON.parse(row.metadata) as unknown)
					: row?.metadata
			expect(meta).toMatchObject({ organizationId: tallerOrgId })
			expect(row?.rateLimitEnabled).toBe(true)
			const agentR = await pool.query<{ id: string }>(
				'SELECT id FROM "user" WHERE lower(email) = lower($1)',
				[`agent+${tallerOrgId}@keys.batuda.internal`],
			)
			expect(row?.referenceId).toBe(agentR.rows[0]?.id)
		})
	})

	describe('when keys already exist for the org', () => {
		it('should reuse the single per-org agent user', async () => {
			// GIVEN two creates for the same org
			await create(tallerOrgId, 'ci-agent-a')
			await create(tallerOrgId, 'ci-agent-b')
			// THEN exactly one agent user backs them
			expect(await agentCount(tallerOrgId)).toBe(1)
		})
	})

	describe('with and without a TTL', () => {
		it('should set expiresAt only when expiresIn is given', async () => {
			// GIVEN one key with a 7-day TTL and one without
			const withTtl = await create(tallerOrgId, 'ci-ttl', 7 * 86_400)
			const noTtl = await create(tallerOrgId, 'ci-no-ttl')
			// THEN expiresAt reflects the choice
			expect(withTtl.expiresAt).not.toBeNull()
			expect(noTtl.expiresAt).toBeNull()
		})
	})
})

describe('ApiKeyService.list', () => {
	it("should return only the org's enabled keys, redacted, isolated by org", async () => {
		// GIVEN a key in taller
		const created = await create(tallerOrgId, 'ci-list')

		// WHEN listing taller vs restaurant
		const tallerKeys = await list(tallerOrgId)
		const restaurantKeys = await list(restaurantOrgId)

		// THEN taller sees its key (without the secret) and restaurant does not
		const found = tallerKeys.find(k => k.id === created.id)
		expect(found).toBeDefined()
		expect(found).not.toHaveProperty('key')
		expect(restaurantKeys.some(k => k.id === created.id)).toBe(false)
	})

	describe('for an org that never created a key', () => {
		it('should return [] and mint no agent user', async () => {
			// GIVEN restaurant has created no keys this run
			// WHEN listing
			const keys = await list(restaurantOrgId)
			// THEN it is empty and no agent user was provisioned by the read
			expect(keys).toHaveLength(0)
			expect(await agentCount(restaurantOrgId)).toBe(0)
		})
	})
})

describe('ApiKeyService.get', () => {
	it('should return the redacted key for its own org', async () => {
		// GIVEN a taller key
		const created = await create(tallerOrgId, 'ci-get')
		// WHEN fetched under taller
		const outcome = await getOutcome(tallerOrgId, created.id)
		// THEN it returns the row without the secret
		expect(outcome.tag).toBe('ok')
		if (outcome.tag === 'ok') expect(outcome.row).not.toHaveProperty('key')
	})

	describe('cross-org and unknown ids', () => {
		it('should report NotFound', async () => {
			// GIVEN a taller key
			const created = await create(tallerOrgId, 'ci-get-x')
			// WHEN fetched under restaurant, or with a bogus id under taller
			// THEN both are NotFound (no cross-org read)
			expect((await getOutcome(restaurantOrgId, created.id)).tag).toBe(
				'NotFound',
			)
			expect((await getOutcome(tallerOrgId, 'does-not-exist')).tag).toBe(
				'NotFound',
			)
		})
	})
})

describe('ApiKeyService.delete', () => {
	it("should hard-delete the org's key so it leaves the list", async () => {
		// GIVEN a taller key
		const created = await create(tallerOrgId, 'ci-del')
		// WHEN deleted under taller
		const outcome = await deleteOutcome(tallerOrgId, created.id)
		// THEN it succeeds, the row is gone, and the list excludes it
		expect(outcome).toBe('ok')
		expect(await apikeyRow(created.id)).toBeUndefined()
		expect((await list(tallerOrgId)).some(k => k.id === created.id)).toBe(false)
	})

	describe('cross-org and unknown ids', () => {
		it('should report NotFound and not delete', async () => {
			// GIVEN a taller key
			const created = await create(tallerOrgId, 'ci-del-x')
			// WHEN deleting it under restaurant, or a bogus id under taller
			// THEN NotFound, and the taller key is untouched
			expect(await deleteOutcome(restaurantOrgId, created.id)).toBe('NotFound')
			expect(await deleteOutcome(tallerOrgId, 'does-not-exist')).toBe(
				'NotFound',
			)
			expect(await apikeyRow(created.id)).toBeDefined()
		})
	})
})
