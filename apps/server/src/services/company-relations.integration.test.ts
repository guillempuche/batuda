// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for how two companies are recorded as belonging together.
//
// A pairing is stored once, from the owned side, and read from both — so opening
// either company shows it. What is pinned here is that both directions come back,
// that the two things nobody means (a company paired with itself, and the same
// pairing recorded twice) are refused by the database rather than by whoever
// happens to call it, and that removing a company takes its pairings with it.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
const ORG = `rel-org-${randomUUID()}`
let holding: string
let subsidiary: string

const seedCompany = async (name: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, $3) RETURNING id`,
		[ORG, `${name}-${randomUUID()}`, name],
	)
	return r.rows[0]!.id
}

const relate = (company: string, related: string, kind: string) =>
	pool.query(
		`INSERT INTO company_relations (organization_id, company_id, related_company_id, kind)
		 VALUES ($1, $2, $3, $4)`,
		[ORG, company, related, kind],
	)

// Both directions, the way the company detail reads them.
const relationsOf = (companyId: string) =>
	pool.query<{ direction: string; kind: string; name: string }>(
		`SELECT 'outgoing' AS direction, r.kind, c2.name
		 FROM company_relations r JOIN companies c2 ON c2.id = r.related_company_id
		 WHERE r.company_id = $1 AND r.organization_id = $2
		 UNION ALL
		 SELECT 'incoming' AS direction, r.kind, c2.name
		 FROM company_relations r JOIN companies c2 ON c2.id = r.company_id
		 WHERE r.related_company_id = $1 AND r.organization_id = $2`,
		[companyId, ORG],
	)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	holding = await seedCompany('Holding')
	subsidiary = await seedCompany('Subsidiary')
	await relate(subsidiary, holding, 'parent')
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.end()
})

describe('recording that two companies belong together', () => {
	describe('when the pairing is stored from the owned side', () => {
		it('should be visible from the owned company', async () => {
			// GIVEN a subsidiary recorded as having a parent
			const rows = (await relationsOf(subsidiary)).rows

			// THEN it reads as pointing outward at its holding
			expect(rows).toStrictEqual([
				{ direction: 'outgoing', kind: 'parent', name: 'Holding' },
			])
		})

		it('should be visible from the owning company too, with no second row', async () => {
			// GIVEN the same single stored pairing
			const rows = (await relationsOf(holding)).rows

			// THEN the holding sees it from the other end — a mirror row is never
			// written, so the two can never drift apart
			expect(rows).toStrictEqual([
				{ direction: 'incoming', kind: 'parent', name: 'Subsidiary' },
			])
			const stored = await pool.query(
				`SELECT id FROM company_relations WHERE organization_id = $1`,
				[ORG],
			)
			expect(stored.rows).toHaveLength(1)
		})
	})

	describe('when the same pairing is recorded twice', () => {
		it('should be refused — recorded twice is not a second fact', async () => {
			await expect(relate(subsidiary, holding, 'parent')).rejects.toThrow()
		})

		it('should still allow a different kind between the same two', async () => {
			// GIVEN a holding that also bought the company outright
			await relate(subsidiary, holding, 'acquired_by')

			// THEN both statements stand, because they say different things
			const kinds = (await relationsOf(subsidiary)).rows.map(r => r.kind).sort()
			expect(kinds).toStrictEqual(['acquired_by', 'parent'])
		})
	})

	describe('when a company is paired with itself', () => {
		it('should be refused', async () => {
			await expect(relate(holding, holding, 'parent')).rejects.toThrow()
		})
	})

	describe('when one of the companies is deleted', () => {
		it('should take the pairing with it, leaving no dangling half', async () => {
			// GIVEN a third company franchised from the holding
			const franchisee = await seedCompany('Franchisee')
			await relate(franchisee, holding, 'franchise_of')
			expect((await relationsOf(holding)).rows).toHaveLength(3)

			// WHEN that company is removed
			await pool.query(`DELETE FROM companies WHERE id = $1`, [franchisee])

			// THEN the pairing goes too, rather than pointing at nothing
			expect((await relationsOf(holding)).rows).toHaveLength(2)
		})
	})
})
