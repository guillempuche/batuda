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
import { riskyRecipientFor } from '../mcp/tools/email'
import { patchChannel, vouchForChannel, withdrawVouch } from './channels'
import { recipientAddresses } from './recipient-address'

// The second question an assistant's send asks: "is there anything recorded
// against an address this is going to, that nobody has stood behind?"
//
// It used to be asked of a *person*, and only of the one address they send from
// by default — so a message to somebody's second address was judged by the
// verdict on their first, and a message that named nobody was never judged at
// all. Naming a contact is optional, so that last case is an ordinary send.
//
// The guard is called here rather than copied. A test that re-states the query
// passes just as happily once the code it protects stops matching it.
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

const run = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
	effect.pipe(Effect.provide(PgLive), Effect.runPromise)

// What the send path does: fold whatever the caller wrote into bare addresses,
// then ask the guard about them.
const stopsTheSend = (org: string, ...written: ReadonlyArray<string>) =>
	run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* riskyRecipientFor(sql, org, recipientAddresses(...written))
		}),
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

const channelIdFor = async (address: string, subject = 'contacts') => {
	const r = await pool.query<{ id: string }>(
		`SELECT id FROM channels WHERE organization_id = $1 AND lower(address) = $2 AND subject_table = $3`,
		[ORG, address.toLowerCase(), subject],
	)
	return r.rows[0]!.id
}

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
		for (const table of ['channels', 'contacts', 'sites', 'companies']) {
			await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org])
		}
	}
	await pool.end()
})

describe('judging a send by the address it is going to', () => {
	describe('when the address belongs to a company rather than a person', () => {
		it('should stop the send, though no contact could have named it', async () => {
			expect((await stopsTheSend(ORG, COMPANY_MAILBOX))?.verification).toBe(
				'undeliverable',
			)
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

			// THEN nothing came back — a send to a company mailbox went unjudged
			expect(oldWay.rows).toHaveLength(0)
		})
	})

	describe('when the message goes to a person’s second address', () => {
		it('should read that address, not their default one', async () => {
			expect((await stopsTheSend(ORG, SECOND_ADDRESS))?.verification).toBe(
				'risky',
			)
		})

		it('should have been judged by the wrong address before', async () => {
			// GIVEN the old lookup: whichever address is default, regardless of
			// where the message was going
			const oldWay = await pool.query<{ verification: string }>(
				`SELECT verification FROM channels
				 WHERE subject_table = 'contacts' AND subject_id = $1 AND channel = 'email'
				 ORDER BY is_primary DESC NULLS LAST
				 LIMIT 1`,
				[contactId],
			)

			// THEN it answered for the default address — clearing a send to the
			// second one on evidence about a different mailbox entirely
			expect(oldWay.rows[0]?.verification).toBe('deliverable')
		})
	})

	describe('when the caller writes the recipient the way a mail client shows it', () => {
		it('should still recognise the address', async () => {
			// GIVEN a display name wrapped around a mailbox that is missing. The
			// mail server delivers this form; compared whole it matched nothing, so
			// the message went out unjudged.
			const stopped = await stopsTheSend(
				ORG,
				`Comandes Fustes Pla <${COMPANY_MAILBOX.toUpperCase()}>`,
			)
			expect(stopped?.address).toBe(COMPANY_MAILBOX)
		})

		it('should recognise each address in a comma-separated list', async () => {
			const stopped = await stopsTheSend(
				ORG,
				`ningu@fustespla.example, ${COMPANY_MAILBOX}`,
			)
			expect(stopped?.address).toBe(COMPANY_MAILBOX)
		})
	})

	describe('when only the verdicts that settle nothing are present', () => {
		it('should let the send go out unremarked', async () => {
			// GIVEN a catch-all domain and a cleared address: one learned nothing
			// about the mailbox, the other answered
			expect(
				await stopsTheSend(ORG, CATCH_ALL_ADDRESS, PRIMARY_ADDRESS),
			).toBeNull()
		})
	})

	describe('when the verdict was recorded for a different organisation', () => {
		it('should not be reachable from this one', async () => {
			expect(await stopsTheSend(ORG, OTHER_ORG_ADDRESS)).toBeNull()
		})
	})

	describe('when nobody has checked the address', () => {
		it('should find nothing, so the send goes out', async () => {
			expect(await stopsTheSend(ORG, 'fresc@fustespla.example')).toBeNull()
		})
	})

	describe('when the address belongs to a branch rather than the company', () => {
		it('should name the company that owns it, not just the branch', async () => {
			// GIVEN a branch with its own mailbox that a check ruled out
			const branchMailbox = 'girona@fustespla.example'
			const site = await pool.query<{ id: string }>(
				`INSERT INTO sites (organization_id, company_id, name)
				 VALUES ($1, $2, 'Girona') RETURNING id`,
				[ORG, companyId],
			)
			await pool.query(
				`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, verification)
				 VALUES ($1, 'sites', $2, 'email', $3, 'undeliverable')`,
				[ORG, site.rows[0]!.id, branchMailbox],
			)

			// THEN the stop carries the company as well as the branch. A branch is
			// managed through its company, so the branch id alone is not enough to
			// name the call that lifts this — and a caller handed only that makes a
			// call that fails.
			const stopped = await stopsTheSend(ORG, branchMailbox)
			expect(stopped?.subjectTable).toBe('sites')
			expect(stopped?.subjectId).toBe(site.rows[0]!.id)
			expect(stopped?.owningCompanyId).toBe(companyId)
		})
	})
})

describe('an address somebody has stood behind', () => {
	describe('when the verdict would otherwise stop the send', () => {
		it('should let it through once vouched, without touching the verdict', async () => {
			expect(await stopsTheSend(ORG, COMPANY_MAILBOX)).not.toBeNull()

			await pool.query(
				`UPDATE channels SET status = 'valid', status_updated_at = now()
				 WHERE organization_id = $1 AND lower(address) = $2`,
				[ORG, COMPANY_MAILBOX],
			)

			// THEN the send goes out — and what the check found is still on file,
			// because a person standing behind an address does not turn a failed
			// probe into a successful one
			expect(await stopsTheSend(ORG, COMPANY_MAILBOX)).toBeNull()
			const after = await pool.query<{ verification: string }>(
				`SELECT verification FROM channels WHERE organization_id = $1 AND lower(address) = $2`,
				[ORG, COMPANY_MAILBOX],
			)
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
			expect(await stopsTheSend(ORG, COMPANY_MAILBOX)).toBeNull()
		})
	})

	describe('when the address is then corrected to a different one', () => {
		it('should not carry the vouch onto the new address', async () => {
			// GIVEN a vouched address, and a different address that a check found
			// wanting somewhere else in the organisation
			const vouched = 'renamed@fustespla.example'
			await seedChannel(ORG, 'contacts', contactId, vouched, null)
			await pool.query(
				`UPDATE channels SET status = 'valid' WHERE organization_id = $1 AND lower(address) = $2`,
				[ORG, vouched],
			)

			// WHEN the address is put right — the very flow the tool advertises
			await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* patchChannel(
						sql,
						ORG,
						{ table: 'contacts', id: contactId },
						yield* Effect.promise(() => channelIdFor(vouched)),
						{ value: SECOND_ADDRESS.replace('n.pla', 'n.pla2') },
					)
				}),
			)

			// THEN the vouch does not follow. Somebody stood behind one mailbox,
			// not behind this row for good, and carrying it over would clear
			// whatever a check had found about the new address.
			const moved = await pool.query<{ status: string }>(
				`SELECT status FROM channels WHERE organization_id = $1 AND lower(address) = $2`,
				[ORG, SECOND_ADDRESS.replace('n.pla', 'n.pla2')],
			)
			expect(moved.rows[0]?.status).toBe('unknown')
		})
	})
})

describe('what a vouch will not do', () => {
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

			expect(await vouch(await channelIdFor(bounced))).toBe('suppressed')

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

	describe('when somebody changes their mind', () => {
		it('should take the vouch back and let the verdict stop the send again', async () => {
			// GIVEN an address a check ruled out, that somebody then vouched for
			const reconsidered = 'reconsidered@fustespla.example'
			await seedChannel(
				ORG,
				'contacts',
				contactId,
				reconsidered,
				'undeliverable',
			)
			const id = await channelIdFor(reconsidered)
			expect(await vouch(id, 'they said it was fine')).toBe('vouched')
			expect(await stopsTheSend(ORG, reconsidered)).toBeNull()

			// WHEN the vouch is taken back
			const outcome = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* withdrawVouch(
						sql,
						ORG,
						{ table: 'contacts', id: contactId },
						id,
					)
				}),
			)

			// THEN the address is back to nobody having stood behind it, and the
			// check's finding — which was never overwritten — stops the send again
			expect(outcome).toBe('withdrawn')
			expect((await stopsTheSend(ORG, reconsidered))?.verification).toBe(
				'undeliverable',
			)
		})

		it('should refuse to dress up a bounce as a withdrawn vouch', async () => {
			// GIVEN an address that hard-bounced — nobody vouched for it, so there
			// is nothing here to take back, and this must not become a second way
			// to clear a block
			const bounced = 'retornat@fustespla.example'
			const outcome = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* withdrawVouch(
						sql,
						ORG,
						{ table: 'contacts', id: contactId },
						yield* Effect.promise(() => channelIdFor(bounced)),
					)
				}),
			)
			expect(outcome).toBe('not_vouched')

			const after = await pool.query<{ status: string }>(
				`SELECT status FROM channels WHERE organization_id = $1 AND lower(address) = $2`,
				[ORG, bounced],
			)
			expect(after.rows[0]?.status).toBe('bounced')
		})
	})

	describe('when the address is merely unproven', () => {
		it('should record the vouch and what it rested on', async () => {
			const unproven = 'provisional@fustespla.example'
			await seedChannel(ORG, 'contacts', contactId, unproven, 'risky')
			expect(
				await vouch(
					await channelIdFor(unproven),
					'confirmed on the phone with Núria',
				),
			).toBe('vouched')

			const after = await pool.query<{ status: string; reason: string }>(
				`SELECT status, status_reason AS reason FROM channels
				 WHERE organization_id = $1 AND lower(address) = $2`,
				[ORG, unproven],
			)
			expect(after.rows[0]?.status).toBe('valid')
			expect(after.rows[0]?.reason).toBe('confirmed on the phone with Núria')
		})
	})
})
