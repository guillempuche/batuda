// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isRiskyEmailVerdict } from '../mcp/tools/email'

// SQL-contract test for the second question an assistant's send asks: "is there
// a deliverability verdict recorded against any address this is going to?"
//
// It used to be asked of a *person*, and only of the one address they send from
// by default — so a message to somebody's second address was judged by the
// verdict on their first, and a message that named nobody was never judged at
// all. Naming a contact is optional, so that last case is an ordinary send.
//
// What is pinned here is that the address-keyed lookup finds a verdict wherever
// it is recorded — on a company mailbox, on a person's non-default address —
// that it cannot reach across organisations, and that it is blind to case. The
// separate question of which verdicts are worth stopping for lives in
// ../mcp/tools/email.test.ts; the two meet in the last block below.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
const ORG = `verdict-org-${randomUUID()}`
const OTHER_ORG = `verdict-other-${randomUUID()}`

const COMPANY_MAILBOX = 'comandes@fustespla.example'
const PRIMARY_ADDRESS = 'nuria@fustespla.example'
const SECOND_ADDRESS = 'n.pla@fustespla.example'
const CATCH_ALL_ADDRESS = 'info@grupmarti.example'
const OTHER_ORG_ADDRESS = 'shared@agency.example'

let companyId: string
let contactId: string

// The query the send guard runs: keyed on the addresses and the organisation,
// with no idea whose they are.
const verdictsFor = (org: string, addresses: ReadonlyArray<string>) =>
	pool.query<{ address: string; verification: string }>(
		`SELECT lower(address) AS address, verification FROM channels
		 WHERE organization_id = $1
		   AND channel = 'email'
		   AND lower(address) = ANY($2)
		   AND verification IS NOT NULL`,
		[org, addresses.map(a => a.trim().toLowerCase())],
	)

const seedChannel = (
	org: string,
	subjectTable: 'companies' | 'contacts',
	subjectId: string,
	address: string,
	verification: string | null,
	isPrimary = false,
) =>
	pool.query(
		`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, verification, is_primary)
		 VALUES ($1, $2, $3, 'email', $4, $5, $6)`,
		[org, subjectTable, subjectId, address, verification, isPrimary],
	)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })

	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Fustes Pla') RETURNING id`,
		[ORG, `fustes-pla-${randomUUID()}`],
	)
	companyId = company.rows[0]!.id

	const contact = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, name)
		 VALUES ($1, $2, 'Núria Pla') RETURNING id`,
		[ORG, companyId],
	)
	contactId = contact.rows[0]!.id

	// A company mailbox nobody owns, with the mailbox reported missing.
	await seedChannel(
		ORG,
		'companies',
		companyId,
		COMPANY_MAILBOX,
		'undeliverable',
	)
	// The person's default address, cleared by a check…
	await seedChannel(
		ORG,
		'contacts',
		contactId,
		PRIMARY_ADDRESS,
		'deliverable',
		true,
	)
	// …and a second one of theirs that a check found wanting.
	await seedChannel(ORG, 'contacts', contactId, SECOND_ADDRESS, 'risky')
	// An address on a domain that answers to every name.
	await seedChannel(ORG, 'companies', companyId, CATCH_ALL_ADDRESS, 'catch_all')

	// The same-looking address, carrying a verdict, but for somebody else.
	const otherCompany = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Other Co') RETURNING id`,
		[OTHER_ORG, `other-co-${randomUUID()}`],
	)
	await seedChannel(
		OTHER_ORG,
		'companies',
		otherCompany.rows[0]!.id,
		OTHER_ORG_ADDRESS,
		'undeliverable',
	)
}, 30_000)

afterAll(async () => {
	for (const org of [ORG, OTHER_ORG]) {
		for (const table of ['channels', 'contacts', 'companies']) {
			await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org])
		}
	}
	await pool.end()
})

describe('a verdict looked up by the address being written to', () => {
	describe('when the address belongs to a company rather than a person', () => {
		it('should be found, so the send can stop and ask', async () => {
			// GIVEN a company mailbox reported missing, owned by nobody
			// WHEN the guard asks about it
			const found = await verdictsFor(ORG, [COMPANY_MAILBOX])

			// THEN it is found, even though no contact could have named it
			expect(found.rows).toHaveLength(1)
			expect(found.rows[0]?.verification).toBe('undeliverable')
		})

		it('should have been invisible to a lookup that needed a contact', async () => {
			// GIVEN the same address, asked for the old way: by contact
			const oldWay = await pool.query(
				`SELECT verification FROM channels
				 WHERE subject_table = 'contacts'
				   AND organization_id = $1
				   AND channel = 'email'
				   AND lower(address) = $2`,
				[ORG, COMPANY_MAILBOX],
			)

			// THEN nothing comes back — a send to a company mailbox went unjudged
			expect(oldWay.rows).toHaveLength(0)
		})
	})

	describe('when the message goes to a person’s second address', () => {
		it('should read the verdict on that address, not on their default one', async () => {
			// GIVEN somebody whose default address is cleared but whose second one
			// a check found wanting
			const found = await verdictsFor(ORG, [SECOND_ADDRESS])

			// THEN the address actually being written to is the one judged
			expect(found.rows[0]?.verification).toBe('risky')
		})

		it('should have been judged by the wrong address before', async () => {
			// GIVEN the old lookup: whichever of the person's addresses is default,
			// regardless of where the message was going
			const oldWay = await pool.query<{ verification: string }>(
				`SELECT verification FROM channels
				 WHERE subject_table = 'contacts'
				   AND subject_id = $1
				   AND channel = 'email'
				 ORDER BY is_primary DESC NULLS LAST
				 LIMIT 1`,
				[contactId],
			)

			// THEN it answered for the default address — clearing a send to the
			// second one on evidence about a different mailbox entirely
			expect(oldWay.rows[0]?.verification).toBe('deliverable')
		})
	})

	describe('when several addresses are written to at once', () => {
		it('should find the one with something recorded against it, in any case', async () => {
			// GIVEN a message to an address nobody has checked and one reported
			// missing, the latter written in capitals
			const found = await verdictsFor(ORG, [
				'ningu@fustespla.example',
				COMPANY_MAILBOX.toUpperCase(),
			])

			// THEN the recorded one is caught whatever case it was written in
			expect(found.rows).toHaveLength(1)
			expect(found.rows[0]?.address).toBe(COMPANY_MAILBOX)
		})
	})

	describe('when the verdict was recorded for a different organisation', () => {
		it('should not be reachable from this one', async () => {
			// GIVEN an address carrying a verdict under another organisation
			const found = await verdictsFor(ORG, [OTHER_ORG_ADDRESS])

			// THEN one organisation's evidence never speaks for another's
			expect(found.rows).toHaveLength(0)
		})
	})

	describe('when nobody has checked the address', () => {
		it('should find nothing, so the send goes out unremarked', async () => {
			const found = await verdictsFor(ORG, ['fresc@fustespla.example'])
			expect(found.rows).toHaveLength(0)
		})
	})

	describe('when the lookup meets the question of which verdicts matter', () => {
		it('should stop only on the address carrying evidence against it', async () => {
			// GIVEN a message to a catch-all domain and to a missing mailbox
			const found = await verdictsFor(ORG, [
				CATCH_ALL_ADDRESS,
				COMPANY_MAILBOX,
				PRIMARY_ADDRESS,
			])

			// THEN all three verdicts are on file
			expect(found.rows).toHaveLength(3)

			// AND only the missing mailbox stops the send: a catch-all domain
			// answers to every name, so its check settled nothing about this address
			const stopping = found.rows.filter(row =>
				isRiskyEmailVerdict(row.verification),
			)
			expect(stopping.map(row => row.address)).toEqual([COMPANY_MAILBOX])
		})
	})
})
