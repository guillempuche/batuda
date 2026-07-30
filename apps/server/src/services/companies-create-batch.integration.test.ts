// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { normalizeTaxId } from './companies'

// SQL-contract test for the batch INSERT that CompanyService.createMany runs
// from the create_companies MCP tool: one INSERT per row, each with
// `ON CONFLICT (organization_id, slug) DO NOTHING RETURNING *`, so a duplicate
// slug is skipped rather than failing the whole batch. Pins that the conflict
// target names the real unique constraint (organization_id, slug); a wrong
// target would either error or stop skipping duplicates, and this catches both.
//
// It also pins the second identity a company is deduped on: its registration
// number. That one cannot ride on `ON CONFLICT` — a statement watches for one
// conflict only — so it is a lookup before the insert, and the lookup has to
// compare numbers the way the index stores them (punctuation out, letters up) or
// the same company written two ways lands twice.
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

	// The pre-insert lookup createMany runs for a company that carries a number,
	// written exactly as the service writes it.
	const findByTaxId = (client: pg.PoolClient, taxId: string) =>
		client.query<{ id: string }>(
			`SELECT id FROM companies
			 WHERE organization_id = $1
			   AND tax_id IS NOT NULL
			   AND upper(regexp_replace(tax_id, '[^A-Za-z0-9]', '', 'g')) = $2
			 LIMIT 1`,
			[orgId, normalizeTaxId(taxId)],
		)

	const insertWithTaxId = (
		client: pg.PoolClient,
		id: string,
		slug: string,
		name: string,
		taxId: string,
	) =>
		client.query<{ id: string }>(
			`INSERT INTO companies (id, organization_id, slug, name, tax_id)
			 VALUES ($1::uuid, $2, $3, $4, $5)
			 ON CONFLICT (organization_id, slug) DO NOTHING
			 RETURNING id`,
			[id, orgId, slug, name, taxId],
		)

	describe('when the same company arrives under a different trading name', () => {
		it('should be found by its registration number however it is punctuated', async () => {
			const suffix = randomUUID()
			const idFirst = randomUUID()
			seededCompanyIds.push(idFirst)
			// The digits are unique per run so a repeat run cannot collide with itself
			const digits = `${Date.now()}`.slice(-8)

			const outcome = await withOrgScope(async client => {
				// GIVEN a company already on file under one name and one spelling
				const first = await insertWithTaxId(
					client,
					idFirst,
					`taxid-first-${suffix}`,
					'Acme SL',
					`B-${digits}`,
				)
				// WHEN the same firm arrives again under another trading name, with the
				// number written without punctuation and in lower case
				const foundSameNumber = await findByTaxId(client, `b${digits}`)
				// AND a genuinely different company's number is looked up
				const foundOther = await findByTaxId(client, `B-${digits}9`)
				return {
					landedFirst: first.rows.length,
					matchedSame: foundSameNumber.rows[0]?.id,
					matchedOther: foundOther.rows.length,
				}
			})

			// THEN the first landed, the differently-spelled repeat resolves to that
			// same row — so createMany skips it instead of creating a second company
			expect(outcome.landedFirst).toBe(1)
			expect(outcome.matchedSame).toBe(idFirst)
			// AND a different number finds nothing, so the match is not just "any
			// company with a number"
			expect(outcome.matchedOther).toBe(0)
		})
	})

	describe('when a company carries no registration number', () => {
		it('should not be matched by the number lookup at all', async () => {
			const suffix = randomUUID()
			const id = randomUUID()
			seededCompanyIds.push(id)

			const outcome = await withOrgScope(async client => {
				// GIVEN a company on file with no number (the common case today)
				await insertOnConflict(
					client,
					id,
					`taxid-none-${suffix}`,
					'No Number SL',
				)
				// WHEN a number that normalizes to nothing is looked up, as would
				// happen if a punctuation-only value reached the query
				return (await findByTaxId(client, '--')).rows.length
			})

			// THEN nothing matches, so a blank number can never collapse two companies
			expect(outcome).toBe(0)
		})
	})
})
