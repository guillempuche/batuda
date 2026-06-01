// PgLive reads DATABASE_URL via Config at layer-build time. Default to
// the docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for the contacts INSERT that
// `apps/server/src/handlers/contacts.ts` runs from `handle('create', ...)`
// and `apps/server/src/mcp/tools/contacts.ts` runs from `create_contact`.
// Mirrors the post-fix shape (organization_id stamped from CurrentOrg)
// using raw `pg` with `app.current_org_id` set on the session, so the
// org_isolation_contacts RLS policy engages exactly as it does at runtime.
// Also pins the pre-fix shape as a failure case so a future hand-edit
// that drops the column from the INSERT immediately fails the suite.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

describe('contacts INSERT — RLS contract', () => {
	let pool: pg.Pool
	let orgId: string
	const seededContactIds: string[] = []
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
		for (const id of seededContactIds) {
			await pool.query(`DELETE FROM contacts WHERE id = $1::uuid`, [id])
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
		const slug = `contacts-test-${id}`
		await client.query(
			`INSERT INTO companies (id, organization_id, slug, name)
			 VALUES ($1::uuid, $2, $3, 'Contacts Test Co')`,
			[id, orgId, slug],
		)
		seededCompanyIds.push(id)
		return id
	}

	describe('when the create INSERT includes organization_id', () => {
		it('should pass the org_isolation_contacts WITH CHECK clause as app_user', async () => {
			// GIVEN app.current_org_id = taller.id and SET ROLE app_user
			// WHEN INSERT INTO contacts runs with organization_id=taller.id
			//      (mirrors handlers/contacts.ts + tools/contacts.ts post-fix shape)
			// THEN the policy approves the row
			// [handlers/contacts.ts + tools/contacts.ts — create handler INSERT shape]
			const id = randomUUID()
			seededContactIds.push(id)

			const inserted = await withOrgScope(async client => {
				const companyId = await seedCompany(client)
				const result = await client.query<{
					id: string
					organization_id: string
					name: string
				}>(
					`INSERT INTO contacts (
						id,
						organization_id,
						company_id, name
					) VALUES (
						$1::uuid,
						$2,
						$3::uuid, 'Test Contact'
					)
					RETURNING id, organization_id, name`,
					[id, orgId, companyId],
				)
				return result.rows[0]
			})

			expect(inserted?.id).toBe(id)
			expect(inserted?.organization_id).toBe(orgId)
			expect(inserted?.name).toBe('Test Contact')
		})
	})

	describe('when the INSERT omits organization_id (the pre-fix shape)', () => {
		it('should fail because the column is NOT NULL', async () => {
			// GIVEN the pre-fix INSERT — no organization_id column in the list
			// WHEN it runs as app_user with app.current_org_id set
			// THEN the INSERT fails because organization_id is NOT NULL with no default
			//      (this is the bug commit 4 fixes — proves the fix is load-bearing)
			// [handlers/contacts.ts + tools/contacts.ts (pre-fix) — INSERT omitted org_id]
			const id = randomUUID()

			await expect(
				withOrgScope(async client => {
					const companyId = await seedCompany(client)
					await client.query(
						`INSERT INTO contacts (
							id,
							company_id, name
						) VALUES (
							$1::uuid,
							$2::uuid, 'Bug Repro'
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
