// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { isRiskyEmailVerdict } from '../mcp/tools/email'
import { vouchForChannel } from './channels'

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
	pool.query<{ address: string; verification: string | null; status: string }>(
		`SELECT lower(address) AS address, verification, status
		 FROM channels
		 WHERE organization_id = $1
		   AND channel = 'email'
		   AND lower(address) = ANY($2)
		   AND (verification IS NOT NULL OR status = 'valid')
		 ORDER BY lower(address)`,
		[org, addresses.map(a => a.trim().toLowerCase())],
	)

// The decision the guard makes on those rows: a vouch settles the address, so
// it is collected across every row before any verdict is allowed to stop a send.
const stopsTheSend = (
	rows: ReadonlyArray<{
		address: string
		verification: string | null
		status: string
	}>,
) => {
	const vouchedFor = new Set(
		rows.filter(row => row.status === 'valid').map(row => row.address),
	)
	return (
		rows.find(
			row =>
				!vouchedFor.has(row.address) && isRiskyEmailVerdict(row.verification),
		) ?? null
	)
}

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
			expect(stopsTheSend(found.rows)?.address).toBe(COMPANY_MAILBOX)
		})
	})
})

describe('an address somebody has stood behind', () => {
	describe('when the verdict would otherwise stop the send', () => {
		it('should let it through once vouched, without touching the verdict', async () => {
			// GIVEN a missing mailbox, which stops a send
			expect(
				stopsTheSend((await verdictsFor(ORG, [COMPANY_MAILBOX])).rows),
			).not.toBeNull()

			// WHEN somebody records that they stand behind it
			await pool.query(
				`UPDATE channels SET status = 'valid', status_updated_at = now()
				 WHERE organization_id = $1 AND lower(address) = $2`,
				[ORG, COMPANY_MAILBOX],
			)

			// THEN the send goes out
			const after = await verdictsFor(ORG, [COMPANY_MAILBOX])
			expect(stopsTheSend(after.rows)).toBeNull()

			// AND what the check found is still on file, because a person standing
			// behind an address does not turn a failed probe into a successful one
			expect(after.rows[0]?.verification).toBe('undeliverable')
		})
	})

	describe('when the same address sits on two records and one is vouched', () => {
		it('should settle the address, not just the row', async () => {
			// GIVEN the vouched company mailbox recorded a second time against a
			// person, still carrying the verdict that stops a send
			await seedChannel(
				ORG,
				'contacts',
				contactId,
				COMPANY_MAILBOX,
				'undeliverable',
			)

			// THEN the vouch on the other row still clears it: it is one mailbox,
			// and somebody stood behind the address rather than behind a row
			const found = await verdictsFor(ORG, [COMPANY_MAILBOX])
			expect(found.rows.length).toBeGreaterThan(1)
			expect(stopsTheSend(found.rows)).toBeNull()
		})
	})

	describe('when nothing was ever wrong with the address', () => {
		it('should need no vouch at all', async () => {
			// GIVEN an address nobody has checked and nobody has vouched for
			const found = await verdictsFor(ORG, ['fresc@fustespla.example'])

			// THEN it never reached the guard in the first place
			expect(found.rows).toHaveLength(0)
			expect(stopsTheSend(found.rows)).toBeNull()
		})
	})
})

describe('what a vouch will not do', () => {
	const run = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
		effect.pipe(Effect.provide(PgLive), Effect.runPromise)

	const vouch = (channelId: string, reason?: string) =>
		run(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				return yield* vouchForChannel(
					sql,
					ORG,
					{ table: 'contacts', id: contactId },
					channelId,
					reason,
				)
			}),
		)

	const channelIdFor = async (address: string) => {
		const r = await pool.query<{ id: string }>(
			`SELECT id FROM channels WHERE organization_id = $1 AND lower(address) = $2 AND subject_table = 'contacts'`,
			[ORG, address],
		)
		return r.rows[0]!.id
	}

	describe('when the address hard-bounced', () => {
		it('should refuse, and leave the block exactly where it was', async () => {
			// GIVEN a person's address that hard-bounced. The bounce lives in the
			// same column a vouch writes, so writing one here would not merely
			// disagree with the bounce — it would lift it for the whole organisation
			const bounced = 'retornat@fustespla.example'
			await seedChannel(ORG, 'contacts', contactId, bounced, 'deliverable')
			await pool.query(
				`UPDATE channels SET status = 'bounced', status_reason = 'mailbox unavailable'
				 WHERE organization_id = $1 AND lower(address) = $2`,
				[ORG, bounced],
			)

			// WHEN somebody tries to stand behind it anyway
			const outcome = await vouch(await channelIdFor(bounced))

			// THEN it is refused
			expect(outcome).toBe('suppressed')

			// AND the bounce is untouched, so the send path still refuses outright
			const after = await pool.query<{ status: string; reason: string }>(
				`SELECT status, status_reason AS reason FROM channels
				 WHERE organization_id = $1 AND lower(address) = $2`,
				[ORG, bounced],
			)
			expect(after.rows[0]?.status).toBe('bounced')
			expect(after.rows[0]?.reason).toBe('mailbox unavailable')
		})
	})

	describe('when the channel is not an email address', () => {
		it('should refuse, since nothing holds a phone number back', async () => {
			await pool.query(
				`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address)
				 VALUES ($1, 'contacts', $2, 'phone', '+34600111222')`,
				[ORG, contactId],
			)
			const r = await pool.query<{ id: string }>(
				`SELECT id FROM channels WHERE organization_id = $1 AND channel = 'phone'`,
				[ORG],
			)
			expect(await vouch(r.rows[0]!.id)).toBe('not_email')
		})
	})

	describe('when the channel belongs to somebody else', () => {
		it('should answer as if it were not there', async () => {
			// GIVEN a channel id that is real but hangs off the company, not this
			// person — an id alone only proves a row exists, not whose it is
			const r = await pool.query<{ id: string }>(
				`SELECT id FROM channels WHERE organization_id = $1 AND subject_table = 'companies' LIMIT 1`,
				[ORG],
			)
			expect(await vouch(r.rows[0]!.id)).toBe('not_found')
		})
	})

	describe('when the address is merely unproven', () => {
		it('should record the vouch and what it rested on', async () => {
			const outcome = await vouch(
				await channelIdFor(SECOND_ADDRESS),
				'confirmed on the phone with Núria',
			)
			expect(outcome).toBe('vouched')

			const after = await pool.query<{ status: string; reason: string }>(
				`SELECT status, status_reason AS reason FROM channels
				 WHERE organization_id = $1 AND lower(address) = $2 AND subject_table = 'contacts'`,
				[ORG, SECOND_ADDRESS],
			)
			expect(after.rows[0]?.status).toBe('valid')
			expect(after.rows[0]?.reason).toBe('confirmed on the phone with Núria')
		})
	})
})
