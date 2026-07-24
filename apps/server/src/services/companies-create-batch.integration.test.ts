// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for the batch INSERT that CompanyService.createMany runs
// from the create_companies MCP tool: one INSERT per row, each with
// `ON CONFLICT (organization_id, slug) DO NOTHING RETURNING *`, so a duplicate
// slug is skipped rather than failing the whole batch. Pins that the conflict
// target names the real unique constraint (organization_id, slug); a wrong
// target would either error or stop skipping duplicates, and this catches both.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

describe('companies batch INSERT — ON CONFLICT contract', () => {
	let pool: pg.Pool
	let orgId: string
	const seededCompanyIds: string[] = []

	beforeAll(async () => {
		pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
		await pool.query('GRANT app_user TO CURRENT_USER')

		const orgs = await pool.query<{ id: string }>(
			`SELECT id FROM organization WHERE slug = $1 LIMIT 1`,
			['taller'],
		)
		const oid = orgs.rows[0]?.id
		if (!oid) {
			throw new Error(
				"taller org missing — run 'pnpm cli db reset && pnpm cli seed' first",
			)
		}
		orgId = oid
	})

	afterAll(async () => {
		for (const id of seededCompanyIds) {
			await pool.query(`DELETE FROM companies WHERE id = $1::uuid`, [id])
		}
		await pool.end()
	})

	const withOrgScope = async <T>(
		body: (client: pg.PoolClient) => Promise<T>,
	): Promise<T> => {
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			await client.query('SET LOCAL ROLE app_user')
			await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
				orgId,
			])
			const result = await body(client)
			await client.query('COMMIT')
			return result
		} catch (err) {
			await client.query('ROLLBACK')
			throw err
		} finally {
			client.release()
		}
	}

	const insertOnConflict = (
		client: pg.PoolClient,
		id: string,
		slug: string,
		name: string,
	) =>
		client.query<{ id: string }>(
			`INSERT INTO companies (id, organization_id, slug, name)
			 VALUES ($1::uuid, $2, $3, $4)
			 ON CONFLICT (organization_id, slug) DO NOTHING
			 RETURNING id`,
			[id, orgId, slug, name],
		)

	describe('when a batch contains a slug that already exists', () => {
		it('should insert the new rows and skip the duplicate', async () => {
			const suffix = randomUUID()
			const slugA = `batch-a-${suffix}`
			const slugB = `batch-b-${suffix}`
			const idA = randomUUID()
			const idB = randomUUID()
			const idDup = randomUUID()
			seededCompanyIds.push(idA, idB)

			const outcome = await withOrgScope(async client => {
				const a = await insertOnConflict(client, idA, slugA, 'Company A')
				const b = await insertOnConflict(client, idB, slugB, 'Company B')
				// A second row reusing slugA — the conflict case the batch must survive.
				const dup = await insertOnConflict(
					client,
					idDup,
					slugA,
					'Company A dup',
				)
				const count = await client.query<{ n: string }>(
					`SELECT COUNT(*)::text AS n FROM companies
					 WHERE organization_id = $1 AND slug = ANY($2)`,
					[orgId, [slugA, slugB]],
				)
				return {
					landedA: a.rows.length,
					landedB: b.rows.length,
					landedDup: dup.rows.length,
					total: Number(count.rows[0]?.n),
				}
			})

			// THEN both distinct slugs land, the duplicate returns no row (skipped), and
			// exactly the two distinct companies exist — the batch did not fail on it
			expect(outcome.landedA).toBe(1)
			expect(outcome.landedB).toBe(1)
			expect(outcome.landedDup).toBe(0)
			expect(outcome.total).toBe(2)
		})
	})
})
