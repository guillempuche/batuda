// Live-DB integration test for research_cache per-organization isolation
// (migration 0009). Earlier, key_hash was the sole primary key, so two orgs
// whose runs hashed alike collided and could read each other's cached result.
// This pins that two orgs may now hold the SAME key_hash as distinct rows, and
// that app_user only ever sees its own org's cache row.
//
// Prereq: `pnpm cli services up` + `pnpm cli db reset && pnpm cli db migrate`.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const ORG_A = `rc-orgA-${randomUUID()}`
const ORG_B = `rc-orgB-${randomUUID()}`
const USER = `rc-u1-${randomUUID()}`
// The SAME content key in both orgs — without org in the key it would collide.
const KEY = `rc-key-${randomUUID()}`

let pool: pg.Pool
let runA = ''
let runB = ''

const asAppUser = async <T>(
	orgId: string,
	fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
	const client = await pool.connect()
	try {
		await client.query('BEGIN')
		await client.query('SET LOCAL ROLE app_user')
		await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
			orgId,
		])
		await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [
			USER,
		])
		const result = await fn(client)
		await client.query('ROLLBACK')
		return result
	} finally {
		client.release()
	}
}

const seedRun = async (orgId: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by)
		 VALUES ($1, 'rc query', 'succeeded', $2) RETURNING id`,
		[orgId, USER],
	)
	return r.rows[0]?.id ?? ''
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	runA = await seedRun(ORG_A)
	runB = await seedRun(ORG_B)
	// Two cache rows sharing one key_hash — only possible with the composite PK.
	for (const [org, run] of [
		[ORG_A, runA],
		[ORG_B, runB],
	] as const) {
		await pool.query(
			`INSERT INTO research_cache (key_hash, organization_id, user_id, research_id, expires_at)
			 VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
			[KEY, org, USER, run],
		)
	}
})

afterAll(async () => {
	await pool.query(
		`DELETE FROM research_cache WHERE organization_id = ANY($1::text[])`,
		[[ORG_A, ORG_B]],
	)
	await pool.query(
		`DELETE FROM research_runs WHERE organization_id = ANY($1::text[])`,
		[[ORG_A, ORG_B]],
	)
	await pool.end()
})

describe('research_cache org isolation', () => {
	describe('when two orgs cache a result under the same key_hash', () => {
		it('should keep them as separate rows, not a collision', async () => {
			// GIVEN both orgs cached a result under the same key_hash
			// WHEN the shared key is read at table-owner level
			const rows = await pool.query<{ organization_id: string }>(
				`SELECT organization_id FROM research_cache WHERE key_hash = $1 ORDER BY organization_id`,
				[KEY],
			)
			// THEN both rows coexist — the composite PK removed the collision
			// [0009_research_cache_org_isolation.ts — PRIMARY KEY (organization_id, key_hash)]
			expect(rows.rows.map(r => r.organization_id).sort()).toEqual(
				[ORG_A, ORG_B].sort(),
			)
		})
	})

	describe('when an org reads the shared key_hash under app_user', () => {
		it("should expose only org A's own cache row", () =>
			asAppUser(ORG_A, async client => {
				// GIVEN org A and org B share a key_hash
				// WHEN org A reads it under RLS
				const rows = await client.query<{ research_id: string }>(
					`SELECT research_id FROM research_cache WHERE key_hash = $1`,
					[KEY],
				)
				// THEN it sees only its own row, never org B's
				expect(rows.rows).toHaveLength(1)
				expect(rows.rows[0]?.research_id).toBe(runA)
				// [0009_research_cache_org_isolation.ts — org_isolation_research_cache]
			}))

		it("should expose only org B's own cache row", () =>
			asAppUser(ORG_B, async client => {
				// GIVEN the same shared key_hash
				// WHEN org B reads it under RLS
				const rows = await client.query<{ research_id: string }>(
					`SELECT research_id FROM research_cache WHERE key_hash = $1`,
					[KEY],
				)
				// THEN it sees only its own row, never org A's
				expect(rows.rows).toHaveLength(1)
				expect(rows.rows[0]?.research_id).toBe(runB)
			}))
	})
})
