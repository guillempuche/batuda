// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, Result } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, describe, expect, it } from 'vitest'

import {
	makeProviderQuotaLayer,
	ProviderQuota,
	type QuotaExhausted,
} from '@batuda/research'

import { PgLive } from '../db/client.js'

// Provider quota gates a research run's provider calls (start_research /
// research_sync): usage is read from `provider_usage`, the ceiling from
// `provider_quotas`. Because the SQL client
// camelCases result keys, reading those rows must use the camelCase names — the
// snake_case spelling reads back undefined, which silently reports zero usage
// and an undefined ceiling, so the gate never fires. These tests prove the
// module actually reads the seeded config and usage against real Postgres.

const seededUsers: string[] = []

const seedQuota = (opts: {
	userId: string
	provider: string
	total: number
	unit: string
	usedThisMonth?: number
}): Promise<void> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				INSERT INTO provider_quotas (
					user_id, provider, billing_model, sync_mode, quota_total, quota_unit
				) VALUES (
					${opts.userId}, ${opts.provider}, 'monthly_plan', 'manual',
					${opts.total}, ${opts.unit}
				)
				ON CONFLICT (user_id, provider) DO UPDATE SET
					quota_total = EXCLUDED.quota_total, quota_unit = EXCLUDED.quota_unit
			`
			if (opts.usedThisMonth != null) {
				yield* sql`
					INSERT INTO provider_usage (user_id, provider, period_start, units_consumed)
					VALUES (
						${opts.userId}, ${opts.provider},
						date_trunc('month', now())::date, ${opts.usedThisMonth}
					)
					ON CONFLICT (user_id, provider, period_start) DO UPDATE SET
						units_consumed = EXCLUDED.units_consumed
				`
			}
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)

interface QuotaSvc {
	readonly check: (
		provider: string,
		units: number,
	) => Effect.Effect<void, QuotaExhausted>
	readonly consume: (
		provider: string,
		units: number,
	) => Effect.Effect<void, QuotaExhausted>
	readonly remaining: (
		provider: string,
	) => Effect.Effect<{ total: number; used: number; unit: string }>
}

// Drive one ProviderQuota method for the seeded user against real Postgres.
const withQuota = <A>(
	userId: string,
	use: (quota: QuotaSvc) => Effect.Effect<A, QuotaExhausted>,
): Promise<Result.Result<A, QuotaExhausted>> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const quota = yield* ProviderQuota
			return yield* Effect.result(use(quota))
		}).pipe(
			Effect.provide(
				makeProviderQuotaLayer({ userId }).pipe(Layer.provide(PgLive)),
			),
		) as Effect.Effect<Result.Result<A, QuotaExhausted>, never, never>,
	)

const freshUser = (): string => {
	const id = `quota-it-${randomUUID()}`
	seededUsers.push(id)
	return id
}

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			for (const userId of seededUsers) {
				yield* sql`DELETE FROM provider_usage WHERE user_id = ${userId}`
				yield* sql`DELETE FROM provider_quotas WHERE user_id = ${userId}`
			}
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('ProviderQuota — reads the configured quota and usage', () => {
	describe('when a quota is configured with no usage yet', () => {
		it('should report the configured total and zero used', async () => {
			// GIVEN a provider with a 10-credit quota and no usage this period
			const userId = freshUser()
			await seedQuota({
				userId,
				provider: 'search',
				total: 10,
				unit: 'credits',
			})

			// WHEN the remaining allowance is read
			const result = await withQuota(userId, quota => quota.remaining('search'))

			// THEN the seeded ceiling and unit come through and usage is zero —
			//   reading the snake_case keys would have returned undefined/NaN here
			expect(Result.isSuccess(result)).toBe(true)
			if (Result.isSuccess(result)) {
				expect(result.success).toEqual({ total: 10, used: 0, unit: 'credits' })
			}
		})
	})

	describe('when usage already exists this period', () => {
		it('should subtract recorded usage from the ceiling', async () => {
			// GIVEN a 10-credit quota with 8 already consumed this month
			const userId = freshUser()
			await seedQuota({
				userId,
				provider: 'scrape',
				total: 10,
				unit: 'pages',
				usedThisMonth: 8,
			})

			// WHEN the remaining allowance is read
			const result = await withQuota(userId, quota => quota.remaining('scrape'))

			// THEN used reflects the recorded usage (proves the usage row is read)
			expect(Result.isSuccess(result)).toBe(true)
			if (Result.isSuccess(result)) {
				expect(result.success).toEqual({ total: 10, used: 8, unit: 'pages' })
			}
		})
	})

	describe('when a check would exceed the remaining allowance', () => {
		it('should pass under the limit and fail over it with QuotaExhausted', async () => {
			// GIVEN a 10-unit quota with 8 already used (2 remaining)
			const userId = freshUser()
			await seedQuota({
				userId,
				provider: 'extract',
				total: 10,
				unit: 'calls',
				usedThisMonth: 8,
			})

			// WHEN a 2-unit check runs (fits) and a 3-unit check runs (exceeds)
			const underLimit = await withQuota(userId, quota =>
				quota.check('extract', 2),
			)
			const overLimit = await withQuota(userId, quota =>
				quota.check('extract', 3),
			)

			// THEN the fitting check passes and the exceeding one is refused with the
			//   real remaining count — the gate only works if usage/ceiling are read
			expect(Result.isSuccess(underLimit)).toBe(true)
			expect(Result.isFailure(overLimit)).toBe(true)
			if (Result.isFailure(overLimit)) {
				expect(overLimit.failure._tag).toBe('QuotaExhausted')
				expect(overLimit.failure.remaining).toBe(2)
				expect(overLimit.failure.unit).toBe('calls')
			}
		})
	})

	describe('when consume records usage', () => {
		it('should increment the usage the next read sees', async () => {
			// GIVEN a 10-credit quota with no usage yet
			const userId = freshUser()
			await seedQuota({
				userId,
				provider: 'discover',
				total: 10,
				unit: 'credits',
			})

			// WHEN 4 units are consumed
			const consumed = await withQuota(userId, quota =>
				quota.consume('discover', 4),
			)
			const after = await withQuota(userId, quota =>
				quota.remaining('discover'),
			)

			// THEN the recorded usage is 4 (proves the write + read agree)
			expect(Result.isSuccess(consumed)).toBe(true)
			expect(Result.isSuccess(after)).toBe(true)
			if (Result.isSuccess(after)) {
				expect(after.success).toEqual({ total: 10, used: 4, unit: 'credits' })
			}
		})
	})
})
