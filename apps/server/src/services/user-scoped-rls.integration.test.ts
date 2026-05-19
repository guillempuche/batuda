// Live-DB integration test for the RLS policies added in
// 0003_user_scoped_rls.ts. Verifies that user_research_policy,
// provider_quotas, and provider_usage each enforce row visibility on
// `app.current_user_id` for the app_user role.
//
// Prereq: `pnpm cli services up` so Postgres is reachable on
// $DATABASE_URL, and `pnpm cli db reset && pnpm cli db migrate` so the
// 0003 policies are applied.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

// Per-suite user ids. Random per run so re-running locally without
// `pnpm cli db reset` doesn't trip the PRIMARY KEY on the seeded rows.
const ALICE = `rls-alice-${randomUUID()}`
const BOB = `rls-bob-${randomUUID()}`

let pool: pg.Pool

// Seeds one row per (user_id) in each user-scoped table. Runs as the
// DATABASE_URL owner, which has BYPASSRLS on Neon and is superuser on
// local docker — either way, the FORCE RLS policies don't gate inserts
// at seed time.
const seedRow = async (
	client: pg.PoolClient | pg.Pool,
	userId: string,
): Promise<void> => {
	await client.query(
		`INSERT INTO user_research_policy (user_id) VALUES ($1)
		 ON CONFLICT (user_id) DO NOTHING`,
		[userId],
	)
	await client.query(
		`INSERT INTO provider_quotas
		   (user_id, provider, billing_model, quota_total, quota_unit)
		 VALUES ($1, 'brave-search', 'pay_per_call', 1000, 'request')
		 ON CONFLICT (user_id, provider) DO NOTHING`,
		[userId],
	)
	await client.query(
		`INSERT INTO provider_usage
		   (user_id, provider, period_start, units_consumed)
		 VALUES ($1, 'brave-search', '2026-05-01', 10)
		 ON CONFLICT (user_id, provider, period_start) DO NOTHING`,
		[userId],
	)
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	await seedRow(pool, ALICE)
	await seedRow(pool, BOB)
}, 30_000)

afterAll(async () => {
	// Run as connection owner (no role switch) so RLS doesn't gate the
	// cleanup DELETEs.
	await pool.query(
		`DELETE FROM provider_usage WHERE user_id = ANY($1::text[])`,
		[[ALICE, BOB]],
	)
	await pool.query(
		`DELETE FROM provider_quotas WHERE user_id = ANY($1::text[])`,
		[[ALICE, BOB]],
	)
	await pool.query(
		`DELETE FROM user_research_policy WHERE user_id = ANY($1::text[])`,
		[[ALICE, BOB]],
	)
	await pool.end()
})

// Per-test transaction wrapper: BEGIN, run as the connection owner
// (which can flip into app_user via the GRANT … WITH SET TRUE from
// migration 0002), apply RLS context, run the test fn, ROLLBACK.
const asAppUser = async <T>(
	currentUserId: string,
	fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
	const client = await pool.connect()
	try {
		await client.query('BEGIN')
		await client.query(`SET LOCAL ROLE app_user`)
		await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [
			currentUserId,
		])
		const result = await fn(client)
		await client.query('ROLLBACK')
		return result
	} finally {
		client.release()
	}
}

describe('RLS: user-scoped research tables', () => {
	describe('user_research_policy', () => {
		it("should expose only the current user's row when role=app_user", () =>
			asAppUser(ALICE, async client => {
				// GIVEN alice and bob each have a seeded research policy
				// WHEN we select all rows under alice's GUC
				const rows = await client.query<{ user_id: string }>(
					'SELECT user_id FROM user_research_policy',
				)

				// THEN both seeded rows aren't visible — only alice's is
				expect(rows.rows).toHaveLength(1)
				// AND it's alice's row
				expect(rows.rows[0]?.user_id).toBe(ALICE)
				// [apps/server/src/db/migrations/0003_user_scoped_rls.ts — user_isolation_user_research_policy USING]
			}))

		it('should reject INSERT with a foreign user_id (WITH CHECK)', () =>
			asAppUser(ALICE, async client => {
				// GIVEN role=app_user pinned to alice
				// WHEN attempting to insert a row owned by bob
				const insert = client.query(
					`INSERT INTO user_research_policy (user_id) VALUES ($1)`,
					[BOB],
				)

				// THEN Postgres rejects via the WITH CHECK predicate
				await expect(insert).rejects.toThrow(/row-level security/i)
				// [apps/server/src/db/migrations/0003_user_scoped_rls.ts — WITH CHECK]
			}))

		it("should reject UPDATE against another user's row (USING + WITH CHECK)", () =>
			asAppUser(ALICE, async client => {
				// GIVEN bob's row exists at table-owner level
				// WHEN alice (via app_user) tries to UPDATE bob's row
				const update = await client.query(
					`UPDATE user_research_policy
					 SET budget_cents = 999
					 WHERE user_id = $1`,
					[BOB],
				)

				// THEN the UPDATE matches 0 rows — USING filtered bob out before
				// the UPDATE could even see it; this is the visibility-as-isolation
				// semantics, not an error
				expect(update.rowCount).toBe(0)
				// [apps/server/src/db/migrations/0003_user_scoped_rls.ts — USING blocks cross-user write]
			}))
	})

	describe('provider_quotas', () => {
		it("should expose only the current user's rows", () =>
			asAppUser(ALICE, async client => {
				// GIVEN both users have one provider_quotas row each
				// WHEN selecting under alice's GUC
				const rows = await client.query<{ user_id: string }>(
					'SELECT user_id FROM provider_quotas',
				)

				// THEN every visible row belongs to alice
				expect(rows.rows.every(r => r.user_id === ALICE)).toBe(true)
				// AND alice's row is present
				expect(rows.rows.map(r => r.user_id)).toContain(ALICE)
				// [apps/server/src/db/migrations/0003_user_scoped_rls.ts — user_isolation_provider_quotas USING]
			}))
	})

	describe('provider_usage', () => {
		it("should expose only the current user's rows", () =>
			asAppUser(ALICE, async client => {
				// GIVEN both users have one provider_usage row each
				// WHEN selecting under alice's GUC
				const rows = await client.query<{ user_id: string }>(
					'SELECT user_id FROM provider_usage',
				)

				// THEN every visible row belongs to alice
				expect(rows.rows.every(r => r.user_id === ALICE)).toBe(true)
				// AND alice's row is present
				expect(rows.rows.map(r => r.user_id)).toContain(ALICE)
				// [apps/server/src/db/migrations/0003_user_scoped_rls.ts — user_isolation_provider_usage USING]
			}))
	})

	describe('when app.current_user_id is unset', () => {
		it('should return zero rows from every user-scoped table (fail-closed)', async () => {
			const client = await pool.connect()
			try {
				await client.query('BEGIN')
				await client.query(`SET LOCAL ROLE app_user`)
				// GIVEN role=app_user without setting the GUC — current_setting
				// returns NULL with missing_ok=true, so the predicate is NULL,
				// which RLS treats as failure (fail-closed)

				// WHEN selecting from each user-scoped table
				const policy = await client.query('SELECT 1 FROM user_research_policy')
				const quotas = await client.query('SELECT 1 FROM provider_quotas')
				const usage = await client.query('SELECT 1 FROM provider_usage')

				// THEN all three are empty
				expect(policy.rows).toHaveLength(0)
				expect(quotas.rows).toHaveLength(0)
				expect(usage.rows).toHaveLength(0)
				// [apps/server/src/db/migrations/0003_user_scoped_rls.ts — current_setting(…, true) NULL → predicate false]
			} finally {
				await client.query('ROLLBACK')
				client.release()
			}
		})
	})

	describe('when role is app_service (BYPASSRLS — worker/cron path)', () => {
		it('should expose rows for every user', async () => {
			const client = await pool.connect()
			try {
				await client.query('BEGIN')
				await client.query(`SET LOCAL ROLE app_service`)
				// GIVEN role=app_service, which has BYPASSRLS

				// WHEN selecting from each user-scoped table
				const rows = await client.query<{ user_id: string }>(
					'SELECT user_id FROM user_research_policy WHERE user_id = ANY($1::text[])',
					[[ALICE, BOB]],
				)

				// THEN both alice's and bob's rows are visible
				expect(rows.rows.map(r => r.user_id).sort()).toEqual(
					[ALICE, BOB].sort(),
				)
				// [apps/server/src/db/migrations/0001_initial.ts:40 — CREATE ROLE app_service NOLOGIN BYPASSRLS]
			} finally {
				await client.query('ROLLBACK')
				client.release()
			}
		})
	})
})
