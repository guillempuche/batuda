// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for a branch holding its own way of being reached and its
// own people: a channel can hang off a branch, a person can name the branch they
// work at without leaving the company, and closing a branch keeps its people —
// still with the company — rather than deleting them.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
const ORG = `site-org-${randomUUID()}`
let company: string
let girona: string

const seedSite = async (name: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO sites (organization_id, company_id, name)
		 VALUES ($1, $2, $3) RETURNING id`,
		[ORG, company, name],
	)
	return r.rows[0]!.id
}

const seedContact = async (
	name: string,
	siteId: string | null,
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, site_id, name)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		[ORG, company, siteId, name],
	)
	return r.rows[0]!.id
}

const addChannel = (
	subjectTable: string,
	subjectId: string,
	address: string,
	label: string | null,
) =>
	pool.query(
		`INSERT INTO channels
			(organization_id, subject_table, subject_id, channel, address, label)
		 VALUES ($1, $2, $3, 'phone', $4, $5)`,
		[ORG, subjectTable, subjectId, address, label],
	)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	const c = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Neteges Pla') RETURNING id`,
		[ORG, `neteges-pla-${randomUUID()}`],
	)
	company = c.rows[0]!.id
	girona = await seedSite('Botiga de Girona')
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM channels WHERE organization_id = $1`, [ORG])
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.end()
})

describe('a branch holding its own way of being reached', () => {
	describe('when a phone number is recorded against the branch', () => {
		it('should store it against the branch rather than the company', async () => {
			// GIVEN a company and one of its branches
			// WHEN a number is recorded against the branch
			await addChannel('sites', girona, '+34 972 100 201', 'taulell')
			// THEN it belongs to the branch, under the name somebody gave it,
			// and the company's own list is untouched
			const branch = await pool.query<{ address: string; label: string }>(
				`SELECT address, label FROM channels
				 WHERE subject_table = 'sites' AND subject_id = $1`,
				[girona],
			)
			expect(branch.rows).toHaveLength(1)
			expect(branch.rows[0]?.address).toBe('+34 972 100 201')
			expect(branch.rows[0]?.label).toBe('taulell')

			const onCompany = await pool.query(
				`SELECT 1 FROM channels
				 WHERE subject_table = 'companies' AND subject_id = $1`,
				[company],
			)
			expect(onCompany.rowCount).toBe(0)
		})
	})

	describe('when the subject is a table channels do not belong to', () => {
		it('should be refused by the database, not by whoever called it', async () => {
			// GIVEN a way of reaching something that is not a company, person or branch
			// WHEN it is stored
			// THEN the database refuses it
			await expect(
				addChannel('invoices', randomUUID(), '+34 900 000 000', null),
			).rejects.toThrow(/channels_subject_table_check/)
		})
	})
})

describe('a person naming the branch they work at', () => {
	describe('when somebody works at one branch', () => {
		it('should record the branch beside the company, not instead of it', async () => {
			// GIVEN a person who works at the Girona branch
			const laia = await seedContact('Laia Llopis', girona)
			// WHEN their row is read
			const r = await pool.query<{ companyId: string; siteId: string }>(
				`SELECT company_id AS "companyId", site_id AS "siteId"
				 FROM contacts WHERE id = $1`,
				[laia],
			)
			// THEN they belong to both — the branch says where, the company says whose
			expect(r.rows[0]?.siteId).toBe(girona)
			expect(r.rows[0]?.companyId).toBe(company)
		})
	})

	describe('when somebody covers the whole company', () => {
		it('should leave the branch unsaid rather than guessing one', async () => {
			// GIVEN a person recorded without a branch — the ordinary case
			const roving = await seedContact('Pere Roving', null)
			// WHEN their row is read
			const r = await pool.query<{ siteId: string | null }>(
				`SELECT site_id AS "siteId" FROM contacts WHERE id = $1`,
				[roving],
			)
			// THEN no branch is claimed for them
			expect(r.rows[0]?.siteId).toBeNull()
		})
	})

	describe('when the branch they worked at closes', () => {
		it('should keep the person, still with the company', async () => {
			// GIVEN a branch with somebody working at it
			const closing = await seedSite('Botiga de Salt')
			const marc = await seedContact('Marc Serra', closing)
			// WHEN the branch is removed
			await pool.query(`DELETE FROM sites WHERE id = $1`, [closing])
			// THEN the person survives with no branch, rather than being deleted
			const r = await pool.query<{ siteId: string | null; companyId: string }>(
				`SELECT site_id AS "siteId", company_id AS "companyId"
				 FROM contacts WHERE id = $1`,
				[marc],
			)
			expect(r.rowCount).toBe(1)
			expect(r.rows[0]?.siteId).toBeNull()
			expect(r.rows[0]?.companyId).toBe(company)
		})
	})
})
