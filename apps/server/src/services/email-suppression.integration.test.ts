// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SQL-contract test for the question the send gate asks before every email:
// "has this address hard-bounced or reported spam?"
//
// It used to be asked of a *person* — "is this contact's address suppressed?" —
// and only when the send named one. Two ordinary ways of writing an email name
// no person at all: replying to a thread that arrived from a shared mailbox
// (inbound mail deliberately invents nobody for a role address), and the "email
// this company" button. Both skipped the check entirely, so a company mailbox
// that hard-bounced was written to again, and again.
//
// The rows this seeds are the ones that used to be unreachable: a bounced address
// belonging to a company rather than to a person. What is pinned is that the
// address-keyed lookup finds them, that the old contact-keyed one could not, and
// that the lookup cannot reach across organisations.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
const ORG = `supp-org-${randomUUID()}`
const OTHER_ORG = `supp-other-${randomUUID()}`
const COMPANY_MAILBOX = 'hola@tallerpuig.example'
const PERSON_ADDRESS = 'dolors@tallerpuig.example'
const OTHER_ORG_ADDRESS = 'shared@agency.example'

let companyId: string

// The query the send gate runs: keyed on the address and the organisation, with
// no idea whose address it is.
const suppressionFor = (org: string, recipients: ReadonlyArray<string>) =>
	pool.query<{ status: string; contact_id: string | null }>(
		`SELECT status,
		        CASE WHEN subject_table = 'contacts' THEN subject_id END AS contact_id
		 FROM channels
		 WHERE organization_id = $1
		   AND channel = 'email'
		   AND lower(address) = ANY($2)
		   AND status IN ('bounced', 'complained')
		 LIMIT 1`,
		[org, recipients.map(r => r.toLowerCase())],
	)

const seedChannel = (
	org: string,
	subjectTable: 'companies' | 'contacts',
	subjectId: string,
	address: string,
	status: string,
) =>
	pool.query(
		`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, status)
		 VALUES ($1, $2, $3, 'email', $4, $5)`,
		[org, subjectTable, subjectId, address, status],
	)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })

	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Taller Puig') RETURNING id`,
		[ORG, `taller-puig-${randomUUID()}`],
	)
	companyId = company.rows[0]!.id

	const contact = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, name)
		 VALUES ($1, $2, 'Dolors Puig') RETURNING id`,
		[ORG, companyId],
	)

	// The case the old check could not see: a company's own mailbox, bounced,
	// belonging to nobody.
	await seedChannel(ORG, 'companies', companyId, COMPANY_MAILBOX, 'bounced')
	// A person's address, bounced — the case that always worked.
	await seedChannel(
		ORG,
		'contacts',
		contact.rows[0]!.id,
		PERSON_ADDRESS,
		'complained',
	)
	// The same-looking address, bounced, but for somebody else entirely.
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
		'bounced',
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

describe('suppression keyed on the address rather than on a person', () => {
	describe('when the bounced address belongs to a company, not a person', () => {
		it('should be found, so the send is blocked', async () => {
			// GIVEN a company mailbox that hard-bounced and belongs to nobody
			// WHEN the gate asks about it
			const found = await suppressionFor(ORG, [COMPANY_MAILBOX])

			// THEN it is found and the send can be refused
			expect(found.rows).toHaveLength(1)
			expect(found.rows[0]?.status).toBe('bounced')
			// AND there is no person to name in the refusal, which is precisely why
			// the old check — which needed one — never ran for this address
			expect(found.rows[0]?.contact_id).toBeNull()
		})

		it('should have been invisible to a lookup that needed a contact', async () => {
			// GIVEN the same address, asked for the old way: by contact
			const oldWay = await pool.query(
				`SELECT status FROM channels
				 WHERE subject_table = 'contacts'
				   AND organization_id = $1
				   AND channel = 'email'
				   AND lower(address) = $2
				   AND status IN ('bounced', 'complained')`,
				[ORG, COMPANY_MAILBOX],
			)

			// THEN nothing comes back — this is the hole, stated as a test
			expect(oldWay.rows).toHaveLength(0)
		})
	})

	describe('when the bounced address belongs to a person', () => {
		it('should still be found, and still name them', async () => {
			// GIVEN a person's address that reported spam
			const found = await suppressionFor(ORG, [PERSON_ADDRESS])

			// THEN the case that already worked keeps working, and the refusal can
			// still say who it was about
			expect(found.rows[0]?.status).toBe('complained')
			expect(found.rows[0]?.contact_id).not.toBeNull()
		})
	})

	describe('when several recipients are named at once', () => {
		it('should block on any one of them being suppressed', async () => {
			// GIVEN a send addressed to a good address and a bounced one
			const found = await suppressionFor(ORG, [
				'someone@elsewhere.example',
				COMPANY_MAILBOX.toUpperCase(),
			])

			// THEN the bounced one is caught, whatever case it was written in
			expect(found.rows).toHaveLength(1)
		})
	})

	describe('when an address bounced for a different organisation', () => {
		it('should not block this one', async () => {
			// GIVEN an address suppressed under another organisation entirely
			const found = await suppressionFor(ORG, [OTHER_ORG_ADDRESS])

			// THEN one company's bounce never speaks for another's
			expect(found.rows).toHaveLength(0)
		})
	})

	describe('when the address was never suppressed', () => {
		it('should find nothing, so the send proceeds', async () => {
			const found = await suppressionFor(ORG, ['fine@tallerpuig.example'])
			expect(found.rows).toHaveLength(0)
		})
	})
})
