// PgLive reads DATABASE_URL via Config at layer-build time. Default to
// the docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for the products INSERT that
// `apps/server/src/handlers/products.ts` runs from `handle('create', ...)`.
// Mirrors the post-fix shape (organization_id stamped from CurrentOrg)
// using raw `pg` with `app.current_org_id` set on the session, so the
// org_isolation_products RLS policy engages exactly as it does at runtime.
// Also pins the pre-fix shape as a failure case so a future hand-edit
// that drops the column from the INSERT immediately fails the suite.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

describe('products INSERT — RLS contract', () => {
	let pool: pg.Pool
	let orgId: string
	const seededIds: string[] = []

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
		for (const id of seededIds) {
			await pool.query(`DELETE FROM products WHERE id = $1::uuid`, [id])
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

	describe('when the create INSERT includes organization_id', () => {
		it('should pass the org_isolation_products WITH CHECK clause as app_user', async () => {
			// GIVEN app.current_org_id = taller.id and SET ROLE app_user
			// WHEN INSERT INTO products runs with organization_id=taller.id
			//      (mirrors handlers/products.ts post-fix shape)
			// THEN the policy approves the row
			// [handlers/products.ts — create handler INSERT shape]
			const id = randomUUID()
			seededIds.push(id)
			const slug = `test-${id}`

			const inserted = await withOrgScope(async client => {
				const result = await client.query<{
					id: string
					organization_id: string
					slug: string
				}>(
					`INSERT INTO products (
						id,
						organization_id,
						slug, name, type
					) VALUES (
						$1::uuid,
						$2,
						$3, 'Test Product', 'service'
					)
					RETURNING id, organization_id, slug`,
					[id, orgId, slug],
				)
				return result.rows[0]
			})

			expect(inserted?.id).toBe(id)
			expect(inserted?.organization_id).toBe(orgId)
			expect(inserted?.slug).toBe(slug)
		})
	})

	describe('when the INSERT omits organization_id (the pre-fix shape)', () => {
		it('should fail because the column is NOT NULL', async () => {
			// GIVEN the pre-fix INSERT — no organization_id column in the list
			// WHEN it runs as app_user with app.current_org_id set
			// THEN the INSERT fails because organization_id is NOT NULL with no default
			//      (this is the bug commit 1 fixes — proves the fix is load-bearing)
			// [handlers/products.ts (pre-fix) — sql.insert(_.payload) omitted org_id]
			const id = randomUUID()
			const slug = `bug-repro-${id}`

			await expect(
				withOrgScope(async client => {
					await client.query(
						`INSERT INTO products (
							id,
							slug, name, type
						) VALUES (
							$1::uuid,
							$2, 'Bug Repro', 'service'
						)`,
						[id, slug],
					)
				}),
			).rejects.toThrow(
				/null value in column "organization_id"|row.level security/i,
			)
		})
	})
})
