// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for the country list behind the companies filter.
//
// The filter used to be built from whichever companies were on the page being
// read, so a country further down the list could not be filtered for at all.
// What is pinned here is that the list covers every company an organisation
// has, says each country once, stays inside the organisation, and never offers
// a country nobody trades with.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
const ORG = `countries-org-${randomUUID()}`
const OTHER_ORG = `countries-other-${randomUUID()}`

const seedCompany = async (
	name: string,
	country: string | null,
	organizationId = ORG,
): Promise<void> => {
	await pool.query(
		`INSERT INTO companies (organization_id, slug, name, country)
		 VALUES ($1, $2, $3, $4)`,
		[organizationId, `${name}-${randomUUID()}`, name, country],
	)
}

// The query the service runs.
const countriesOf = async (
	organizationId: string,
): Promise<ReadonlyArray<string>> => {
	const r = await pool.query<{ country: string }>(
		`SELECT DISTINCT country FROM companies
		 WHERE organization_id = $1 AND country IS NOT NULL AND country <> ''
		 ORDER BY country`,
		[organizationId],
	)
	return r.rows.map(row => row.country)
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	await seedCompany('Serralleria', 'ES')
	await seedCompany('Fusteria', 'ES')
	await seedCompany('Menuiserie', 'FR')
	await seedCompany('Nowhere', null)
	await seedCompany('Blank', '')
	await seedCompany('Officina', 'IT', OTHER_ORG)
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE organization_id = ANY($1)`, [
		[ORG, OTHER_ORG],
	])
	await pool.end()
})

describe('the countries an organisation trades with', () => {
	describe('when several companies share a country', () => {
		it('should offer that country once, not once per company', async () => {
			// GIVEN two Spanish companies and one French one
			// WHEN the filter asks what it can offer
			const countries = await countriesOf(ORG)

			// THEN Spain appears once, and the list is ordered
			expect(countries).toStrictEqual(['ES', 'FR'])
		})
	})

	describe('when a company has no country recorded', () => {
		it('should be left out rather than offered as an empty choice', async () => {
			// GIVEN one company with NULL and one with an empty string
			const countries = await countriesOf(ORG)

			// THEN neither reaches the filter, which has nothing to filter by
			expect(countries).not.toContain(null)
			expect(countries).not.toContain('')
		})
	})

	describe('when another organisation trades somewhere else', () => {
		it('should not leak that country into this list', async () => {
			// GIVEN an Italian company belonging to a different organisation
			const countries = await countriesOf(ORG)

			// THEN this organisation is never offered a country it does not trade with
			expect(countries).not.toContain('IT')
			// AND the other organisation sees only its own
			expect(await countriesOf(OTHER_ORG)).toStrictEqual(['IT'])
		})
	})

	describe('when an organisation has no companies at all', () => {
		it('should come back empty rather than failing', async () => {
			// GIVEN an organisation nothing was ever filed under
			const countries = await countriesOf(`countries-empty-${randomUUID()}`)

			// THEN the filter simply has nothing to offer
			expect(countries).toStrictEqual([])
		})
	})
})
