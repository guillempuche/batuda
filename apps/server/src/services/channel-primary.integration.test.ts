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
import { addChannel, patchChannel, subjectChannelsOf } from './channels'

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
			const rows = await pool.query<{ id: string }>(
				`SELECT id FROM channels WHERE address = $1 AND subject_id = $2`,
				['rrhh@netegespla.cat', company],
			)
			const id = rows.rows[0]!.id
			// WHEN it is marked the default
			await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* patchChannel(sql, id, { is_primary: true })
				}),
			)
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
			const rows = await pool.query<{ id: string }>(
				`SELECT id FROM channels WHERE address = $1 AND subject_id = $2`,
				['comptabilitat@netegespla.cat', company],
			)
			const id = rows.rows[0]!.id
			// WHEN the name is cleared
			await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* patchChannel(sql, id, { label: null })
				}),
			)
			// THEN it carries none, rather than being stuck with the wrong one
			const after = await pool.query<{ label: string | null }>(
				`SELECT label FROM channels WHERE id = $1`,
				[id],
			)
			expect(after.rows[0]?.label).toBeNull()
		})
	})
})
