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
import {
	addChannel,
	deleteChannel,
	patchChannel,
	subjectChannelsOf,
} from './channels'

// Which address a message actually leaves for.
//
// A company used to have one mailbox, so "the" address was never in question.
// With several, `is_primary` is the answer, and two of them for one kind means
// the answer is whichever the sort surfaces first. Pinned here: marking one
// stands the others down, and touching an address that is already on file —
// which is what labelling one does — never moves the default by itself.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
const ORG = `primary-org-${randomUUID()}`
let company: string

const run = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
	effect.pipe(Effect.provide(PgLive), Effect.runPromise)

const add = (address: string, isPrimary?: boolean, label?: string) =>
	run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* addChannel(
				sql,
				ORG,
				{ table: 'companies', id: company },
				{
					kind: 'email',
					value: address,
					...(label === undefined ? {} : { label }),
					...(isPrimary === undefined ? {} : { is_primary: isPrimary }),
				},
			)
		}),
	) as Promise<{ readonly id: string }>

const subject = () => ({ table: 'companies' as const, id: company })

const patch = (
	id: string,
	change: Parameters<typeof patchChannel>[4],
): Promise<unknown> =>
	run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* patchChannel(sql, ORG, subject(), id, change)
		}),
	)

// The refusal message when a write is turned away, or null when it went through.
const patchRefusal = (
	id: string,
	change: Parameters<typeof patchChannel>[4],
): Promise<string | null> =>
	run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* patchChannel(sql, ORG, subject(), id, change)
			return null
		}).pipe(Effect.catchTag('BadRequest', e => Effect.succeed(e.message))),
	)

const remove = (id: string): Promise<boolean> =>
	run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* deleteChannel(sql, ORG, subject(), id)
		}),
	) as Promise<boolean>

const idOf = async (address: string): Promise<string> => {
	const rows = await pool.query<{ id: string }>(
		`SELECT id FROM channels WHERE address = $1 AND subject_id = $2`,
		[address, company],
	)
	return rows.rows[0]!.id
}

const primaries = async (): Promise<ReadonlyArray<string>> => {
	const r = await pool.query<{ address: string }>(
		`SELECT address FROM channels
		 WHERE subject_table = 'companies' AND subject_id = $1
		   AND channel = 'email' AND is_primary
		 ORDER BY address`,
		[company],
	)
	return r.rows.map(row => row.address)
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	const c = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Neteges Pla') RETURNING id`,
		[ORG, `neteges-pla-${randomUUID()}`],
	)
	company = c.rows[0]!.id
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM channels WHERE organization_id = $1`, [ORG])
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.end()
})

describe('the address a company is written to by default', () => {
	describe('when a second address of the same kind is made the default', () => {
		it('should leave exactly one, standing the old one down', async () => {
			// GIVEN one mailbox holding the default
			await add('comandes@netegespla.cat', true)
			expect(await primaries()).toEqual(['comandes@netegespla.cat'])
			// WHEN a second is made the default
			await add('factures@netegespla.cat', true)
			// THEN only the second is, so where mail goes is never ambiguous
			expect(await primaries()).toEqual(['factures@netegespla.cat'])
		})
	})

	describe('when an address already on file is given a name', () => {
		it('should not move the default by itself', async () => {
			// GIVEN a mailbox that holds the default
			const before = await primaries()
			expect(before).toEqual(['factures@netegespla.cat'])
			// WHEN somebody labels that same address, saying nothing about defaults
			await add('factures@netegespla.cat', undefined, 'factures')
			// THEN it still holds it — labelling is not a decision about sending
			expect(await primaries()).toEqual(['factures@netegespla.cat'])
			const labelled = await pool.query<{ label: string }>(
				`SELECT label FROM channels WHERE address = $1 AND subject_id = $2`,
				['factures@netegespla.cat', company],
			)
			expect(labelled.rows[0]?.label).toBe('factures')
		})
	})

	describe('when a new address arrives saying nothing about defaults', () => {
		it('should not become the default and should not disturb the current one', async () => {
			// GIVEN a company that already has a default mailbox
			// WHEN an unrelated address is recorded with nothing said
			await add('rrhh@netegespla.cat')
			// THEN the standing default is untouched and the newcomer is not one
			expect(await primaries()).toEqual(['factures@netegespla.cat'])
		})
	})

	describe('when the default is handed over by editing a channel', () => {
		it('should stand the previous one down', async () => {
			// GIVEN a mailbox that is not the default
			const id = await idOf('rrhh@netegespla.cat')
			// WHEN it is marked the default
			await patch(id, { is_primary: true })
			// THEN it is the only one
			expect(await primaries()).toEqual(['rrhh@netegespla.cat'])
		})
	})

	describe('when a different kind is made the default', () => {
		it('should leave the mailbox default alone', async () => {
			// GIVEN a company whose default mailbox is settled
			// WHEN a phone number is made the default phone
			await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* addChannel(
						sql,
						ORG,
						{ table: 'companies', id: company },
						{ kind: 'phone', value: '+34 972 100 200', is_primary: true },
					)
				}),
			)
			// THEN the mailbox default is untouched — each kind has its own
			expect(await primaries()).toEqual(['rrhh@netegespla.cat'])
		})
	})
})

describe('naming a company mailbox so two can be told apart', () => {
	describe('when each of two mailboxes is given a name', () => {
		it('should hand both back under their own names', async () => {
			// GIVEN two mailboxes of the same kind, each named
			await add('comptabilitat@netegespla.cat', false, 'comptabilitat')
			await add('rrhh@netegespla.cat', undefined, 'recursos humans')
			// WHEN the company's ways of being reached are read
			const rows = (await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* subjectChannelsOf(sql, {
						table: 'companies',
						id: company,
					})
				}),
			)) as ReadonlyArray<{
				readonly value: string
				readonly label: string | null
				readonly subjectTable: string
			}>
			// THEN each carries the name somebody gave it
			const byAddress = new Map(rows.map(r => [r.value, r.label]))
			expect(byAddress.get('comptabilitat@netegespla.cat')).toBe(
				'comptabilitat',
			)
			expect(byAddress.get('rrhh@netegespla.cat')).toBe('recursos humans')
			// AND they say plainly what they hang off, rather than posing as a person's
			expect(rows.every(r => r.subjectTable === 'companies')).toBe(true)
		})
	})

	describe('when a name was given by mistake', () => {
		it('should be able to take it back off', async () => {
			// GIVEN a mailbox carrying a name
			const id = await idOf('comptabilitat@netegespla.cat')
			// WHEN the name is cleared
			await patch(id, { label: null })
			// THEN it carries none, rather than being stuck with the wrong one
			const after = await pool.query<{ label: string | null }>(
				`SELECT label FROM channels WHERE id = $1`,
				[id],
			)
			expect(after.rows[0]?.label).toBeNull()
		})
	})
})

describe('putting a wrong address right', () => {
	describe('when it is renamed onto one already on file', () => {
		it('should refuse rather than merge, and leave both where they were', async () => {
			// GIVEN two mailboxes, one of them a near-miss of the other — the state
			// somebody is in when they typed an address wrong and re-entered it
			await add('w@netegespla.cat')
			await add('wattie@netegespla.cat')
			const wrong = await idOf('w@netegespla.cat')

			// WHEN the wrong one is renamed onto the right one
			const refusal = await patchRefusal(wrong, {
				value: 'wattie@netegespla.cat',
			})

			// THEN it is turned away in words that name the address and say what to
			// do instead, rather than dying as a fault or silently eating a row
			expect(refusal).toContain('wattie@netegespla.cat')
			expect(refusal).toContain('Remove')
			const rows = await pool.query<{ address: string }>(
				`SELECT address FROM channels
				 WHERE subject_id = $1 AND address LIKE '%@netegespla.cat'
				   AND address IN ('w@netegespla.cat', 'wattie@netegespla.cat')
				 ORDER BY address`,
				[company],
			)
			expect(rows.rows.map(r => r.address)).toEqual([
				'w@netegespla.cat',
				'wattie@netegespla.cat',
			])
		})

		it('should leave the transaction it was refused inside still usable', async () => {
			// GIVEN a refusal raised inside a transaction the caller opened — which
			// is every request, since the org scope wraps each one in one. Postgres
			// will not accept another statement on a transaction whose last write it
			// rejected, so this has to be asked inside the same one to mean anything.
			const wrong = await idOf('w@netegespla.cat')

			const after = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							const refusal = yield* patchChannel(sql, ORG, subject(), wrong, {
								value: 'wattie@netegespla.cat',
							}).pipe(
								Effect.catchTag('BadRequest', e => Effect.succeed(e.message)),
							)
							// WHEN the same transaction is asked something else
							const rows = yield* subjectChannelsOf(sql, subject())
							return { refusal, count: rows.length }
						}),
					)
				}),
			)

			// THEN the refusal came back in words and the transaction carried on —
			// without the savepoint around the attempt, this second statement is the
			// one that dies
			expect(String(after.refusal)).toContain('wattie@netegespla.cat')
			expect(after.count).toBeGreaterThan(0)
		})
	})

	describe('when only the kind is changed', () => {
		it('should judge the address on the kind it is being given', async () => {
			// GIVEN a phone number stored as a phone
			await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* addChannel(sql, ORG, subject(), {
						kind: 'phone',
						value: '+34 972 100 201',
					})
				}),
			)
			const id = await idOf('+34 972 100 201')

			// WHEN somebody retypes its kind as email, saying nothing about the value
			const refusal = await patchRefusal(id, { kind: 'email' })

			// THEN it is refused — checking only when the address moves would let a
			// phone number into the send path carrying no verdict against it, which
			// is the one state the send gate lets straight through
			expect(refusal).toContain('valid email')
			const after = await pool.query<{ channel: string }>(
				`SELECT channel FROM channels WHERE id = $1`,
				[id],
			)
			expect(after.rows[0]?.channel).toBe('phone')
		})
	})

	describe('when an address that bounced stops being an email', () => {
		it('should take the block with it rather than leave it on a phone row', async () => {
			// GIVEN a mailbox the send gate is holding back
			await add('rebotat@netegespla.cat')
			const id = await idOf('rebotat@netegespla.cat')
			await pool.query(
				`UPDATE channels SET status = 'bounced', status_reason = 'mailbox unavailable',
				 soft_bounce_count = 3, verification = 'undeliverable' WHERE id = $1`,
				[id],
			)

			// WHEN it is retyped as a website, which needs no mailbox
			await patch(id, { kind: 'website', value: 'netegespla.cat' })

			// THEN nothing is left claiming a bounce on a row that is no longer an
			// address, where no screen would ever show it
			const after = await pool.query<{
				status: string
				status_reason: string | null
				soft_bounce_count: number
				verification: string | null
			}>(
				`SELECT status, status_reason, soft_bounce_count, verification
				 FROM channels WHERE id = $1`,
				[id],
			)
			expect(after.rows[0]).toMatchObject({
				status: 'unknown',
				status_reason: null,
				soft_bounce_count: 0,
				verification: null,
			})
		})
	})
})

// Its own company, because "the oldest one left" is only readable when the
// mailboxes on file are the ones the test put there.
describe('who holds the default once the one holding it is gone', () => {
	let firm: string
	const at = () => ({ table: 'companies' as const, id: firm })

	const addTo = (address: string, isPrimary?: boolean) =>
		run(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				return yield* addChannel(sql, ORG, at(), {
					kind: 'email',
					value: address,
					...(isPrimary === undefined ? {} : { is_primary: isPrimary }),
				})
			}),
		) as Promise<{ readonly id: string }>

	const defaultsOf = async (kind: string): Promise<ReadonlyArray<string>> => {
		const r = await pool.query<{ address: string }>(
			`SELECT address FROM channels
			 WHERE subject_table = 'companies' AND subject_id = $1
			   AND channel = $2 AND is_primary
			 ORDER BY address`,
			[firm, kind],
		)
		return r.rows.map(row => row.address)
	}

	beforeAll(async () => {
		const c = await pool.query<{ id: string }>(
			`INSERT INTO companies (organization_id, slug, name)
			 VALUES ($1, $2, 'Handover SL') RETURNING id`,
			[ORG, `handover-${randomUUID()}`],
		)
		firm = c.rows[0]!.id
	})

	describe('when the default address is removed', () => {
		it('should hand it to the oldest one left of that kind', async () => {
			// GIVEN three mailboxes with the newest holding the default
			await addTo('un@handover.cat')
			await addTo('dos@handover.cat')
			const newest = await addTo('tres@handover.cat', true)
			expect(await defaultsOf('email')).toEqual(['tres@handover.cat'])

			// WHEN the one holding it is removed
			const removed = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* deleteChannel(sql, ORG, at(), newest.id)
				}),
			)
			expect(removed).toBe(true)

			// THEN the oldest survivor takes it, rather than the kind being left with
			// none and every reader picking a different address
			expect(await defaultsOf('email')).toEqual(['un@handover.cat'])
		})
	})

	describe('when the default moves to another kind', () => {
		it('should leave one default in each kind, not two in one and none in the other', async () => {
			// GIVEN a mailbox holding the email default, and another email behind it
			const rows = await pool.query<{ id: string }>(
				`SELECT id FROM channels WHERE address = $1 AND subject_id = $2`,
				['un@handover.cat', firm],
			)
			// WHEN that row is retyped as a website
			await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* patchChannel(sql, ORG, at(), rows.rows[0]!.id, {
						kind: 'website',
						value: 'handover.cat',
					})
				}),
			)

			// THEN the mailboxes it left behind elect one of their own...
			expect(await defaultsOf('email')).toEqual(['dos@handover.cat'])
			// ...and it is the only default among the websites it joined
			expect(await defaultsOf('website')).toEqual(['handover.cat'])
		})
	})
})

describe('reading the same addresses twice', () => {
	describe('when two addresses of a kind are read twice', () => {
		it('should hand them back in the same order both times', async () => {
			// GIVEN more than one mailbox, none of which is the newest default
			// WHEN the ways of being reached are read twice
			const read = async () =>
				(
					(await run(
						Effect.gen(function* () {
							const sql = yield* SqlClient.SqlClient
							return yield* subjectChannelsOf(sql, subject())
						}),
					)) as ReadonlyArray<{ readonly value: string }>
				).map(r => r.value)

			// THEN the order is the same — without a tiebreak the rows sort equal and
			// two readers can each name a different address as "the" one
			expect(await read()).toEqual(await read())
		})
	})
})

describe('a channel that belongs to somebody else', () => {
	let otherCompany: string
	let otherChannel: string

	beforeAll(async () => {
		const c = await pool.query<{ id: string }>(
			`INSERT INTO companies (organization_id, slug, name)
			 VALUES ($1, $2, 'Forn Vidal') RETURNING id`,
			[ORG, `forn-vidal-${randomUUID()}`],
		)
		otherCompany = c.rows[0]!.id
		const ch = await pool.query<{ id: string }>(
			`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address)
			 VALUES ($1, 'companies', $2, 'email', 'hola@fornvidal.cat') RETURNING id`,
			[ORG, otherCompany],
		)
		otherChannel = ch.rows[0]!.id
	})

	describe('when it is edited through a subject that does not own it', () => {
		it('should answer nothing and leave the address alone', async () => {
			// GIVEN a mailbox belonging to another company in the same organisation
			// WHEN it is edited through this company
			const result = await patch(otherChannel, { value: 'altre@fornvidal.cat' })

			// THEN nothing happens — an id only proves a row exists, and every
			// channel of every company, branch and person lives in one table
			expect(result).toBeUndefined()
			const after = await pool.query<{ address: string }>(
				`SELECT address FROM channels WHERE id = $1`,
				[otherChannel],
			)
			expect(after.rows[0]?.address).toBe('hola@fornvidal.cat')
		})
	})

	describe('when it is removed through a subject that does not own it', () => {
		it('should say no row went and leave it there', async () => {
			// GIVEN the same mailbox
			// WHEN a removal is asked through this company
			expect(await remove(otherChannel)).toBe(false)
			// THEN it is still on file, and the caller can tell a wrong id from a
			// removal that already happened
			const after = await pool.query(`SELECT id FROM channels WHERE id = $1`, [
				otherChannel,
			])
			expect(after.rowCount).toBe(1)
		})
	})
})

describe('the two ways a kind is left with nobody holding the default', () => {
	describe('when the address holding it is simply unmarked', () => {
		it('should hand it to another rather than leave the kind headless', async () => {
			// GIVEN a kind whose default is settled, with another address behind it
			const firm = await pool.query<{ id: string }>(
				`INSERT INTO companies (organization_id, slug, name)
				 VALUES ($1, $2, 'Unmark SL') RETURNING id`,
				[ORG, `unmark-${randomUUID()}`],
			)
			const at = { table: 'companies' as const, id: firm.rows[0]!.id }
			const first = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* addChannel(sql, ORG, at, {
						kind: 'email',
						value: 'un@unmark.cat',
					})
					return yield* addChannel(sql, ORG, at, {
						kind: 'email',
						value: 'dos@unmark.cat',
						is_primary: true,
					})
				}),
			)

			// WHEN whoever holds it is unmarked, rather than another being marked
			await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* patchChannel(
						sql,
						ORG,
						at,
						(first as { readonly id: string }).id,
						{ is_primary: false },
					)
				}),
			)

			// THEN somebody still holds it. Left with none, the compose box, the card
			// and the send gate each pick a different address — and a different one
			// again on the next load.
			const held = await pool.query<{ address: string }>(
				`SELECT address FROM channels
				 WHERE subject_id = $1 AND channel = 'email' AND is_primary`,
				[at.id],
			)
			expect(held.rows.map(r => r.address)).toEqual(['un@unmark.cat'])
		})
	})
})

describe('how a kind is spelled when it is stored', () => {
	describe('when a caller names one with a capital', () => {
		it('should store the one spelling everything else reads by', async () => {
			// GIVEN somebody adds an address calling its kind "Email"
			const firm = await pool.query<{ id: string }>(
				`INSERT INTO companies (organization_id, slug, name)
				 VALUES ($1, $2, 'Case SL') RETURNING id`,
				[ORG, `case-${randomUUID()}`],
			)
			const at = { table: 'companies' as const, id: firm.rows[0]!.id }
			await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* addChannel(sql, ORG, at, {
						kind: '  Email ',
						value: 'hola@case.cat',
					})
				}),
			)

			// THEN it is filed as an email. Stored as typed, it would pass the check
			// that an address looks like an email — that one folds the case — and
			// then be invisible to the send gate, which asks for channel = 'email'.
			const stored = await pool.query<{ channel: string }>(
				`SELECT channel FROM channels WHERE subject_id = $1`,
				[at.id],
			)
			expect(stored.rows.map(r => r.channel)).toEqual(['email'])
		})
	})
})

describe('a bounce that a capital letter could have washed off', () => {
	describe('when an email row is retyped with the same kind, capitalised', () => {
		it('should keep the bounce record, because nothing actually changed', async () => {
			// GIVEN a mailbox the send gate is holding back
			const firm = await pool.query<{ id: string }>(
				`INSERT INTO companies (organization_id, slug, name)
				 VALUES ($1, $2, 'Launder SL') RETURNING id`,
				[ORG, `launder-${randomUUID()}`],
			)
			const at = { table: 'companies' as const, id: firm.rows[0]!.id }
			const added = (await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* addChannel(sql, ORG, at, {
						kind: 'email',
						value: 'rebot@launder.cat',
					})
				}),
			)) as { readonly id: string }
			await pool.query(
				`UPDATE channels SET status = 'bounced', status_reason = 'mailbox unavailable',
				 soft_bounce_count = 3, verification = 'undeliverable' WHERE id = $1`,
				[added.id],
			)

			// WHEN somebody sets its kind to "Email"
			await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* patchChannel(sql, ORG, at, added.id, { kind: 'Email' })
				}),
			)

			// THEN it is still an email and still held back. Read as typed, "Email"
			// is not "email", so this counted as leaving email — which clears the
			// bounce, the verdict and the counter, and files the row under a kind
			// the send gate does not look at. One call, and a dead address is clean
			// and invisible.
			const after = await pool.query<{
				channel: string
				status: string
				verification: string | null
				soft_bounce_count: number
			}>(
				`SELECT channel, status, verification, soft_bounce_count
				 FROM channels WHERE id = $1`,
				[added.id],
			)
			expect(after.rows[0]).toMatchObject({
				channel: 'email',
				status: 'bounced',
				verification: 'undeliverable',
				soft_bounce_count: 3,
			})
		})
	})
})
