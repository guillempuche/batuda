// Exercises manage_contact_channels end-to-end against a real Postgres, driven
// through the real toolkit handlers the way a `tools/call` would, inside the same
// org RLS scope (`enterOrgScope`) the /mcp middleware applies.
//
// This is the only place a refusal can be checked honestly: every request runs
// inside one transaction, and a write Postgres rejects poisons it until something
// rolls back — so a refusal that "works" against an autocommit connection can
// still take the rest of the call down here. Requires $DATABASE_URL.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import type { Tool } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import { applyTestEnv } from '../../test-env'
import { ContactHandlersLive, ContactTools } from './contacts'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
// Namespaces every row this suite creates so cleanup never touches seed data.
const MARKER = `channels-verify-${randomUUID()}-`

type Org = { id: string; name: string; slug: string }
type Tools = typeof ContactTools.tools
type Channel = {
	readonly id: string
	readonly kind: string
	readonly value: string
	readonly label: string | null
	readonly isPrimary: boolean
	readonly verification: string | null
	readonly confidence: number | null
}

const makeRuntime = () =>
	ManagedRuntime.make(PgLive.pipe(Layer.provide(EnvVars.layer)))

let pool: pg.Pool
let runtime: ReturnType<typeof makeRuntime>
let taller: Org
let ownerId: string
let company: string
let pep: string
let other: string

// Runs a tool the way the MCP server does — validate params, run the handler,
// take its single result — inside the org's RLS scope.
const callInOrg = <A, E>(
	body: Effect.Effect<A, E, CurrentOrg | SqlClient.SqlClient>,
): Promise<A> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org: taller, userId: ownerId })(body)
		}),
	)

type ManageParams = Tool.Parameters<Tools['manage_contact_channels']>

const manage = (params: ManageParams): Promise<ReadonlyArray<Channel>> =>
	callInOrg(
		Effect.gen(function* () {
			const toolkit = yield* ContactTools
			const stream = yield* toolkit.handle('manage_contact_channels', params)
			const [first] = yield* Stream.runCollect(stream)
			if (first === undefined) return yield* Effect.die(new Error('no result'))
			return (first.result as { channels: ReadonlyArray<Channel> }).channels
		}).pipe(Effect.provide(ContactHandlersLive)),
	)

// A call carrying something the parameters forbid — what an MCP client can put
// on the wire, and what the schema is there to turn away. Typed loosely on
// purpose: the point is that it never reaches the handler.
const manageRaw = (
	params: Record<string, unknown>,
): Promise<ReadonlyArray<Channel>> => manage(params as ManageParams)

const deleteContact = (id: string): Promise<unknown> =>
	callInOrg(
		Effect.gen(function* () {
			const toolkit = yield* ContactTools
			const stream = yield* toolkit.handle('delete_contact', { id })
			const [first] = yield* Stream.runCollect(stream)
			return first?.result as unknown
		}).pipe(Effect.provide(ContactHandlersLive)),
	)

// What a caller is told when a call is turned away. A refusal is raised as a
// defect carrying wording written for the assistant, so it surfaces here as a
// rejected promise rather than a value.
const refusalFrom = async (call: Promise<unknown>): Promise<string> => {
	try {
		await call
	} catch (error) {
		return String(error)
	}
	throw new Error('expected the call to be refused, but it went through')
}

const rowsOf = async (contactId: string): Promise<ReadonlyArray<string>> => {
	const r = await pool.query<{ address: string }>(
		`SELECT address FROM channels
		 WHERE subject_table = 'contacts' AND subject_id = $1 ORDER BY address`,
		[contactId],
	)
	return r.rows.map(row => row.address)
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	runtime = makeRuntime()

	const org = await pool.query<Org>(
		'SELECT id, name, slug FROM organization WHERE slug = $1 LIMIT 1',
		['taller'],
	)
	if (!org.rows[0])
		throw new Error(
			"taller org missing — run 'pnpm cli db reset && pnpm cli seed'",
		)
	taller = org.rows[0]

	const member = await pool.query<{ userId: string }>(
		'SELECT "userId" FROM member WHERE "organizationId" = $1 LIMIT 1',
		[taller.id],
	)
	if (!member.rows[0])
		throw new Error("taller has no members — run 'pnpm cli seed'")
	ownerId = member.rows[0].userId

	const c = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, $3) RETURNING id`,
		[taller.id, `${MARKER}co`, `${MARKER}Fusteria`],
	)
	company = c.rows[0]!.id

	const people = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, name)
		 VALUES ($1, $2, $3), ($1, $2, $4) RETURNING id`,
		[taller.id, company, `${MARKER}Pep`, `${MARKER}Berta`],
	)
	pep = people.rows[0]!.id
	other = people.rows[1]!.id
}, 30_000)

afterAll(async () => {
	await pool.query(
		`DELETE FROM channels WHERE subject_id IN (SELECT id FROM contacts WHERE name LIKE $1)`,
		[`${MARKER}%`],
	)
	await pool.query(`DELETE FROM channels WHERE subject_id = $1`, [company])
	await pool.query(`DELETE FROM contacts WHERE name LIKE $1`, [`${MARKER}%`])
	await pool.query(`DELETE FROM companies WHERE slug = $1`, [`${MARKER}co`])
	await runtime.dispose()
	await pool.end()
})

describe('managing one person’s ways of being reached', () => {
	describe('when addresses are added, named, elected and removed one at a time', () => {
		it('should do each in turn and hand back what is on file', async () => {
			// GIVEN a person with nothing on file
			expect(await manage({ action: 'list', contact_id: pep })).toEqual([])

			// WHEN an address is added
			const added = await manage({
				action: 'add',
				contact_id: pep,
				kind: 'email',
				value: 'pep@fusteria.cat',
			})
			expect(added.map(c => c.value)).toEqual(['pep@fusteria.cat'])

			// AND a second one is added and made the one mail goes to
			const both = await manage({
				action: 'add',
				contact_id: pep,
				kind: 'email',
				value: 'comandes@fusteria.cat',
				label: 'comandes',
				is_primary: true,
			})
			expect(both.filter(c => c.isPrimary).map(c => c.value)).toEqual([
				'comandes@fusteria.cat',
			])

			// AND the name given by mistake is taken back off
			const orders = both.find(c => c.value === 'comandes@fusteria.cat')!
			const unnamed = await manage({
				action: 'update',
				contact_id: pep,
				channel_id: orders.id,
				label: null,
			})
			expect(unnamed.find(c => c.id === orders.id)?.label).toBeNull()

			// AND it is removed
			const left = await manage({
				action: 'remove',
				contact_id: pep,
				channel_id: orders.id,
			})

			// THEN only the first is left, and it holds the default the removed one
			// was carrying rather than the person being left with none
			expect(left.map(c => c.value)).toEqual(['pep@fusteria.cat'])
			expect(left[0]?.isPrimary).toBe(true)
		})
	})

	describe('when an address is corrected onto one the person already holds', () => {
		it('should refuse, keep both, and leave the call able to answer', async () => {
			// GIVEN the state the issue reports: a typo and its correction both on
			// file, where the obvious repair is to rename one onto the other
			await manage({
				action: 'add',
				contact_id: pep,
				kind: 'email',
				value: 'p@fusteria.cat',
			})
			const before = await manage({ action: 'list', contact_id: pep })
			const typo = before.find(c => c.value === 'p@fusteria.cat')!

			// WHEN the typo is renamed onto the address already there
			const refusal = await refusalFrom(
				manage({
					action: 'update',
					contact_id: pep,
					channel_id: typo.id,
					value: 'pep@fusteria.cat',
				}),
			)

			// THEN it is turned away in words that say what to do instead...
			expect(refusal).toContain('pep@fusteria.cat')
			expect(refusal).toContain('Remove')
			// ...both addresses are still there, neither quietly eaten...
			expect(await rowsOf(pep)).toEqual(['p@fusteria.cat', 'pep@fusteria.cat'])
			// ...and the next call on the same connection still answers, which a
			// rejected write left unrolled-back would have made impossible
			expect((await manage({ action: 'list', contact_id: pep })).length).toBe(2)
		})
	})

	describe('when an address could never be one of its kind', () => {
		it('should refuse it rather than store it', async () => {
			// GIVEN a phone number offered as an email
			// WHEN it is added
			const refusal = await refusalFrom(
				manage({
					action: 'add',
					contact_id: pep,
					kind: 'email',
					value: '+34 972 100 200',
				}),
			)
			// THEN it is turned away and nothing is written
			expect(refusal).toContain('valid email')
			expect(await rowsOf(pep)).not.toContain('+34 972 100 200')
		})
	})
})

describe('a channel that is not this person’s', () => {
	describe('when it belongs to somebody else in the same organisation', () => {
		it('should say so rather than edit them', async () => {
			// GIVEN an address on another person
			const hers = await manage({
				action: 'add',
				contact_id: other,
				kind: 'email',
				value: 'berta@fusteria.cat',
			})
			const id = hers[0]!.id

			// WHEN it is edited through the first person
			const refusal = await refusalFrom(
				manage({
					action: 'update',
					contact_id: pep,
					channel_id: id,
					value: 'canviada@fusteria.cat',
				}),
			)

			// THEN the caller is told, rather than reading back an unchanged list and
			// being unable to tell a wrong id from a write that did nothing
			expect(refusal).toContain(id)
			expect(await rowsOf(other)).toEqual(['berta@fusteria.cat'])
		})
	})

	describe('when it belongs to a company', () => {
		it('should refuse — every channel of every subject lives in one table', async () => {
			// GIVEN a company mailbox
			const ch = await pool.query<{ id: string }>(
				`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address)
				 VALUES ($1, 'companies', $2, 'email', 'hola@fusteria.cat') RETURNING id`,
				[taller.id, company],
			)
			const id = ch.rows[0]!.id

			// WHEN it is removed through a person
			const refusal = await refusalFrom(
				manage({ action: 'remove', contact_id: pep, channel_id: id }),
			)

			// THEN it is refused and the company keeps its mailbox
			expect(refusal).toContain(id)
			const after = await pool.query(`SELECT id FROM channels WHERE id = $1`, [
				id,
			])
			expect(after.rowCount).toBe(1)
		})
	})

	describe('when the person belongs to another organisation', () => {
		it('should say there is no such person, in the words a stranger would get', async () => {
			// GIVEN a contact id from outside this organisation
			const outsider = await pool.query<{ id: string }>(
				`SELECT id FROM contacts WHERE organization_id <> $1 LIMIT 1`,
				[taller.id],
			)
			expect(outsider.rows[0]).toBeDefined()
			const id = outsider.rows[0]!.id

			// WHEN their channels are asked for
			const refusal = await refusalFrom(
				manage({ action: 'list', contact_id: id }),
			)

			// THEN it says there is no such person — the same answer an id that
			// never existed gets, so it tells a caller nothing about another
			// organisation. Handing back an empty list instead read as "this person
			// has no addresses", which is a different and wrong thing to believe.
			expect(refusal).toContain(id)
		})
	})
})

describe('how far an address is trusted', () => {
	describe('when a caller tries to say an address is good', () => {
		it('should refuse the word outright', async () => {
			// GIVEN 'deliverable' is the one verdict that opens the send path
			const list = await manage({ action: 'list', contact_id: pep })
			// WHEN a caller offers it
			const refusal = await refusalFrom(
				manageRaw({
					action: 'update',
					contact_id: pep,
					channel_id: list[0]!.id,
					verification: 'deliverable',
				}),
			)
			// THEN it never reaches the handler — only a check that reached the
			// mailbox may say this
			expect(refusal.length).toBeGreaterThan(0)
			expect(list[0]?.verification).not.toBe('deliverable')
		})
	})

	describe('when a verdict is withdrawn by hand', () => {
		it('should record it and drop the score that came with the old one', async () => {
			// GIVEN an address a check called deliverable, with a score behind it
			const list = await manage({ action: 'list', contact_id: pep })
			const target = list.find(c => c.value === 'pep@fusteria.cat')!
			await pool.query(
				`UPDATE channels SET verification = 'deliverable', confidence = 95 WHERE id = $1`,
				[target.id],
			)

			// WHEN somebody who thinks it is wrong marks it undeliverable
			const after = await manage({
				action: 'update',
				contact_id: pep,
				channel_id: target.id,
				verification: 'undeliverable',
			})

			// THEN the verdict is theirs and the old score goes with the claim it
			// belonged to, rather than lending weight to a new one
			const updated = after.find(c => c.id === target.id)
			expect(updated?.verification).toBe('undeliverable')
			expect(updated?.confidence).toBeNull()
		})
	})

	describe('when a verdict is offered to any action but update', () => {
		it('should say which action sets it', async () => {
			// GIVEN adding a channel, where a verdict would apply or not depending on
			// whether the address was already on file — which the caller cannot see
			const refusal = await refusalFrom(
				manage({
					action: 'add',
					contact_id: pep,
					kind: 'email',
					value: 'nova@fusteria.cat',
					verification: 'risky',
				}),
			)
			// THEN it is refused with the action that does set it named
			expect(refusal).toContain('update')
		})
	})
})

describe('deleting a person', () => {
	describe('when they had an address that had bounced', () => {
		it('should take their channels with them rather than leave the block behind', async () => {
			// GIVEN somebody whose mailbox the send gate is holding back
			const c = await pool.query<{ id: string }>(
				`INSERT INTO contacts (organization_id, company_id, name)
				 VALUES ($1, $2, $3) RETURNING id`,
				[taller.id, company, `${MARKER}Rebot`],
			)
			const doomed = c.rows[0]!.id
			await pool.query(
				`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, status)
				 VALUES ($1, 'contacts', $2, 'email', 'rebot@fusteria.cat', 'bounced')`,
				[taller.id, doomed],
			)

			// WHEN they are deleted
			await deleteContact(doomed)

			// THEN nothing of theirs is left answering. A channel names its subject
			// by plain columns with no foreign key, so rows left behind would go on
			// blocking that address for the whole organisation with nobody to lift
			// it from.
			expect(await rowsOf(doomed)).toEqual([])
		})
	})
})

describe('an action missing what it needs', () => {
	describe('when add names no address', () => {
		it('should say what is missing rather than report success', async () => {
			// GIVEN an add with the kind but no value — half a call
			const refusal = await refusalFrom(
				manageRaw({ action: 'add', contact_id: pep, kind: 'email' }),
			)
			// THEN it names both arguments. It used to fall through to the list at
			// the end and come back as a success, which reads exactly like asking
			// for the list — so the caller reports an address it never added.
			expect(refusal).toContain('kind')
			expect(refusal).toContain('value')
		})
	})

	describe('when remove names no channel', () => {
		it('should say which argument it wanted and where to find it', async () => {
			const refusal = await refusalFrom(
				manageRaw({ action: 'remove', contact_id: pep }),
			)
			expect(refusal).toContain('channel_id')
		})
	})
})

describe('a verdict that was written down rather than found out', () => {
	describe('when it is taken back off', () => {
		it('should leave the address reading as one nobody has checked', async () => {
			// GIVEN an address carrying a verdict, and a score alongside it — the
			// state the repair migration left every unrecognised word in
			const list = await manage({ action: 'list', contact_id: pep })
			const target = list.find(c => c.kind === 'email')!
			await pool.query(
				`UPDATE channels SET verification = 'risky', confidence = 55 WHERE id = $1`,
				[target.id],
			)

			// WHEN somebody who knows it was never a check removes it
			const after = await manage({
				action: 'update',
				contact_id: pep,
				channel_id: target.id,
				verification: null,
			})

			// THEN nothing is claimed about the address either way, and the score
			// goes with the verdict it belonged to. Marking it "unverified" instead
			// would have recorded a check that came back with nothing, which is a
			// different thing and not what happened.
			const cleared = after.find(c => c.id === target.id)
			expect(cleared?.verification).toBeNull()
			expect(cleared?.confidence).toBeNull()
		})
	})

	describe('when a caller still tries to call an address good', () => {
		it('should refuse, clearing or not', async () => {
			const list = await manage({ action: 'list', contact_id: pep })
			const refusal = await refusalFrom(
				manageRaw({
					action: 'update',
					contact_id: pep,
					channel_id: list[0]!.id,
					verification: 'deliverable',
				}),
			)
			expect(refusal.length).toBeGreaterThan(0)
			const after = await manage({ action: 'list', contact_id: pep })
			expect(after.find(c => c.id === list[0]!.id)?.verification).not.toBe(
				'deliverable',
			)
		})
	})
})

describe('vouching for an address without saying which one', () => {
	describe('when the call names no channel', () => {
		it('should refuse and name where to find one', async () => {
			// GIVEN vouching is the documented way past a send held back by a
			// verdict, and a caller that has not said which address it means
			// WHEN it vouches with no channel_id
			const refusal = await refusalFrom(
				manageRaw({ action: 'vouch', contact_id: pep }),
			)

			// THEN it is turned away, and told where a channel_id comes from.
			// Handing back the ordinary list instead reads as success: the caller
			// sends again, is stopped by the same verdict, and vouches again —
			// the loop this whole surface exists to avoid
			expect(refusal).toContain('channel_id is required')
			expect(refusal).toContain('manage_contact_channels')
		})

		it('should leave every address exactly as vouched-for as it was', async () => {
			// GIVEN what stands behind the person's addresses now. A vouch is
			// recorded as status='valid', which the tool's own shape does not
			// carry, so this reads the column the vouch would have written.
			const vouchedFor = async (): Promise<ReadonlyArray<string>> => {
				const r = await pool.query<{ address: string }>(
					`SELECT address FROM channels
					 WHERE subject_table = 'contacts' AND subject_id = $1
					   AND status = 'valid' ORDER BY address`,
					[pep],
				)
				return r.rows.map(row => row.address)
			}
			const before = await vouchedFor()

			// WHEN a vouch arrives naming no channel
			await refusalFrom(manageRaw({ action: 'vouch', contact_id: pep }))

			// THEN nothing was vouched for on the way past — a refusal that had
			// already written something would be worse than the loop
			expect(await vouchedFor()).toEqual(before)
		})
	})
})
