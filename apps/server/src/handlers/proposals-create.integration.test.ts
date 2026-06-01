// PgLive reads DATABASE_URL via Config at layer-build time. Default to
// the docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

describe('proposals INSERT — RLS contract', () => {
	let pool: pg.Pool
	let orgId: string
	const seededProposalIds: string[] = []
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
		for (const id of seededProposalIds) {
			await pool.query(`DELETE FROM proposals WHERE id = $1::uuid`, [id])
		}
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

	const seedCompany = async (client: pg.PoolClient): Promise<string> => {
		const id = randomUUID()
		const slug = `proposals-test-${id}`
		await client.query(
			`INSERT INTO companies (id, organization_id, slug, name)
			 VALUES ($1::uuid, $2, $3, 'Proposals Test Co')`,
			[id, orgId, slug],
		)
		seededCompanyIds.push(id)
		return id
	}

	describe('when the create INSERT includes organization_id', () => {
		it('should pass the org_isolation_proposals WITH CHECK clause as app_user', async () => {
			// GIVEN app.current_org_id = taller.id and SET ROLE app_user
			// WHEN INSERT INTO proposals runs with organization_id=taller.id
			//      (mirrors handlers/proposals.ts post-fix shape)
			// THEN the policy approves the row
			// [handlers/proposals.ts — create handler INSERT shape]
			const id = randomUUID()
			seededProposalIds.push(id)

			const inserted = await withOrgScope(async client => {
				const companyId = await seedCompany(client)
				const result = await client.query<{
					id: string
					organization_id: string
					title: string
				}>(
					`INSERT INTO proposals (
						id,
						organization_id,
						company_id, title, line_items
					) VALUES (
						$1::uuid,
						$2,
						$3::uuid, 'Test Proposal', '[]'::jsonb
					)
					RETURNING id, organization_id, title`,
					[id, orgId, companyId],
				)
				return result.rows[0]
			})

			expect(inserted?.id).toBe(id)
			expect(inserted?.organization_id).toBe(orgId)
			expect(inserted?.title).toBe('Test Proposal')
		})
	})

	describe('when the INSERT omits organization_id (the pre-fix shape)', () => {
		it('should fail because the column is NOT NULL', async () => {
			// GIVEN the pre-fix INSERT — no organization_id column in the list
			// WHEN it runs as app_user with app.current_org_id set
			// THEN the INSERT fails because organization_id is NOT NULL with no default
			//      (this is the bug commit 2 fixes — proves the fix is load-bearing)
			// [handlers/proposals.ts (pre-fix) — sql.insert(_.payload) omitted org_id]
			const id = randomUUID()

			await expect(
				withOrgScope(async client => {
					const companyId = await seedCompany(client)
					await client.query(
						`INSERT INTO proposals (
							id,
							company_id, title, line_items
						) VALUES (
							$1::uuid,
							$2::uuid, 'Bug Repro', '[]'::jsonb
						)`,
						[id, companyId],
					)
				}),
			).rejects.toThrow(
				/null value in column "organization_id"|row.level security/i,
			)
		})
	})
})
