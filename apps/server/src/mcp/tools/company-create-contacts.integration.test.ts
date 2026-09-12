// Live-DB integration test for the people a company brings with it when an
// assistant creates it. Driven through the real toolkit handlers the way a
// `tools/call` would, inside the same org RLS scope (`enterOrgScope`) the /mcp
// middleware applies.
//
// One call writes the company and the people its pages name, and a company
// already on file comes back with the answer — so neither needs a lookup of its
// own.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Cause, Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CurrentOrg } from '@batuda/controllers'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import { CompanyService } from '../../services/companies'
import { Geocoder } from '../../services/geocoder'
import { applyTestEnv } from '../../test-env'
import { CurrentUser } from '../current-user'
import { isToolMessage } from '../tool-message'
import { CompanyHandlersLive, CompanyTools } from './companies'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string

// Every name this suite creates carries the marker, so teardown can find its rows
// whatever web address they ended up under.
const MARKER = `lead-people-${randomUUID()}`

type Org = { id: string; name: string; slug: string }

const Handlers = CompanyHandlersLive.pipe(
	Layer.provide(CompanyService.layer),
	Layer.provide(TimelineActivityService.layer),
	Layer.provide(Geocoder.layer),
	Layer.provide(FetchHttpClient.layer),
)
const makeRuntime = () =>
	ManagedRuntime.make(PgLive.pipe(Layer.provide(EnvVars.layer)))

let pool: pg.Pool
let runtime: ReturnType<typeof makeRuntime>
let org: Org
let actorId: string

type Outcome =
	| { ok: true; result: Record<string, unknown> | null }
	| { ok: false; message: string }

// What the tool actually said. A stringified cause carries stack frames and SQL,
// so a check against that passes on almost any error.
const toolMessageOf = (cause: Cause.Cause<unknown>): string => {
	const spoken = Cause.squash(cause)
	return isToolMessage(spoken)
		? spoken.message
		: `not a message written for the caller: ${String(spoken)}`
}

const runInOrg = <A, E>(
	body: Effect.Effect<A, E, CurrentOrg | SqlClient.SqlClient>,
): Promise<A> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org, userId: actorId })(body)
		}),
	)

const actor = () => ({
	userId: actorId,
	email: `${actorId}@verify.local`,
	name: 'Verifier',
	isAgent: true,
})

const collect = <E, R>(
	stream: Stream.Stream<{ readonly result: unknown }, E, R>,
): Effect.Effect<Outcome, never, R> =>
	Stream.runCollect(stream).pipe(
		Effect.map(([first]) => ({
			ok: true as const,
			result: (first?.result ?? null) as Record<string, unknown> | null,
		})),
		Effect.catchCause(cause =>
			Effect.succeed({ ok: false as const, message: toolMessageOf(cause) }),
		),
	)

type Offered = {
	readonly name: string
	readonly taxId?: string
	readonly location?: string
	readonly contacts?: ReadonlyArray<{
		readonly name: string
		readonly role?: string
	}>
}

const createCompanies = (companies: ReadonlyArray<Offered>): Promise<Outcome> =>
	runInOrg(
		Effect.gen(function* () {
			const toolkit = yield* CompanyTools
			return yield* collect(
				yield* toolkit.handle('create_companies', { companies }),
			)
		}).pipe(
			Effect.provideService(CurrentUser, actor()),
			Effect.provide(Handlers),
			Effect.catchCause(cause =>
				Effect.succeed({ ok: false as const, message: toolMessageOf(cause) }),
			),
		),
	)

// A refused call must not read as an empty answer. Everything below goes through
// here, so a refusal fails the test by its own words rather than as a row that
// never arrived.
const resultOf = (outcome: Outcome): Record<string, unknown> => {
	if (!outcome.ok) throw new Error(outcome.message)
	return outcome.result ?? {}
}

const rowsOf = (outcome: Outcome, key: string): ReadonlyArray<unknown> => {
	const value = resultOf(outcome)[key]
	return Array.isArray(value) ? value : []
}

const peopleAdded = (outcome: Outcome): number =>
	Number(resultOf(outcome)['contacts_added'])

const createdSlug = (outcome: Outcome): string =>
	String((rowsOf(outcome, 'created')[0] as { slug?: unknown }).slug)

// Read straight from the table rather than from what the tool answered: the point
// is what is on file for somebody to open, not what the call said it did.
const peopleOn = async (
	slug: string,
): Promise<ReadonlyArray<{ name: string; role: string | null }>> => {
	const found = await pool.query<{ name: string; role: string | null }>(
		`SELECT c.name, c.role FROM contacts c
			JOIN companies co ON co.id = c.company_id
			WHERE co.organization_id = $1 AND co.slug = $2 AND c.deleted_at IS NULL
			ORDER BY c.name`,
		[org.id, slug],
	)
	return found.rows
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	runtime = makeRuntime()
	const o = await pool.query<Org>(
		`SELECT id, name, slug FROM organization WHERE slug = 'taller' LIMIT 1`,
	)
	const row = o.rows[0]
	if (!row) throw new Error("taller org missing — run 'pnpm cli seed'")
	org = row
	const m = await pool.query<{ userId: string }>(
		'SELECT "userId" FROM member WHERE "organizationId" = $1 LIMIT 1',
		[org.id],
	)
	actorId = m.rows[0]!.userId
})

afterAll(async () => {
	await pool.query(
		`DELETE FROM contacts WHERE company_id IN (
			SELECT id FROM companies WHERE name LIKE $1
		)`,
		[`%${MARKER}%`],
	)
	await pool.query('DELETE FROM companies WHERE name LIKE $1', [`%${MARKER}%`])
	await runtime.dispose()
	await pool.end()
})

describe('create_companies — the people a company brings with it', () => {
	describe('when a new company is offered with the people its pages name', () => {
		it('should write them as contacts carrying their job titles', async () => {
			// GIVEN a company nobody has yet, offered with two people read off its
			// own team page
			const name = `Egein Enginyeria ${MARKER}`

			// WHEN it is created in one call
			const result = await createCompanies([
				{
					name,
					contacts: [
						{ name: 'David Garrido', role: 'CEO - Enginyer Industrial' },
						{ name: 'Mariona Garrido', role: 'CFO' },
					],
				},
			])

			// THEN the company lands with both of them on it, titles as the page gave
			// them
			expect(rowsOf(result, 'created')).toHaveLength(1)
			expect(peopleAdded(result)).toBe(2)
			const slug = createdSlug(result)
			expect(await peopleOn(slug)).toEqual([
				{ name: 'David Garrido', role: 'CEO - Enginyer Industrial' },
				{ name: 'Mariona Garrido', role: 'CFO' },
			])
		})

		it('should leave the part they play in a purchase unsaid', async () => {
			// GIVEN a company offered with somebody who has a job title
			const name = `Fusteria Cap Buying ${MARKER}`

			// WHEN it is created
			const result = await createCompanies([
				{ name, contacts: [{ name: 'Rosa López', role: 'Enginyera' }] },
			])

			// THEN nothing is recorded about who holds the budget. A page gives a job
			// title and no more, and a guess here is read later as somebody's finding
			const slug = createdSlug(result)
			const buyingRoles = await pool.query<{ buyingRole: string | null }>(
				`SELECT c.buying_role AS "buyingRole" FROM contacts c
					JOIN companies co ON co.id = c.company_id
					WHERE co.organization_id = $1 AND co.slug = $2`,
				[org.id, slug],
			)
			expect(buyingRoles.rows).toEqual([{ buyingRole: null }])
		})
	})

	describe('when a job title is offered blank', () => {
		it('should store no title rather than a blank one', async () => {
			// GIVEN a person whose title the caller had nothing to put in
			const name = `Tallers Sense Titol ${MARKER}`

			// WHEN the company is created with them
			const result = await createCompanies([
				{ name, contacts: [{ name: 'Joan Sense', role: '   ' }] },
			])

			// THEN the title is absent, not blank. Blank passes every check for
			// having a title, so the two spellings stop meaning the same thing
			const slug = createdSlug(result)
			expect(await peopleOn(slug)).toEqual([{ name: 'Joan Sense', role: null }])
		})
	})

	describe('when the same person is offered twice', () => {
		it('should write them once, accents and all', async () => {
			// GIVEN one person written two ways, and a third entry repeating the first
			const name = `Solà Consultors ${MARKER}`

			// WHEN the company is created
			const result = await createCompanies([
				{
					name,
					contacts: [
						{ name: 'Mercè Solà', role: 'Directora' },
						{ name: 'Merce Sola' },
						{ name: 'Mercè Solà' },
					],
				},
			])

			// THEN one person is on file. The same person is written with an accent one
			// time and without it the next, and three rows for one person is worse
			// than a missing accent
			expect(peopleAdded(result)).toBe(1)
			const slug = createdSlug(result)
			expect(await peopleOn(slug)).toEqual([
				{ name: 'Mercè Solà', role: 'Directora' },
			])
		})
	})

	describe('when the company is already on file under its registration number', () => {
		it('should add the newly found people to it and hand back the company', async () => {
			// GIVEN a company on file, created under one trading name
			const taxId = `B${String(Date.now()).slice(-8)}`
			const first = await createCompanies([
				{
					name: `Acme ${MARKER}`,
					taxId,
					contacts: [{ name: 'Anna Prat', role: 'Gerent' }],
				},
			])
			const filedUnder = createdSlug(first)

			// WHEN the same firm arrives again under a different trading name — a
			// different web address — with somebody new on it
			const second = await createCompanies([
				{
					name: `Acme Logistics SL ${MARKER}`,
					taxId,
					contacts: [
						{ name: 'Anna Prat', role: 'Gerent' },
						{ name: 'Pere Nou', role: "Cap d'obres" },
					],
				},
			])

			// THEN no second company is written, the new person lands on the one
			// already here, and the one already on it is not written again
			expect(rowsOf(second, 'created')).toHaveLength(0)
			expect(peopleAdded(second)).toBe(1)
			expect(await peopleOn(filedUnder)).toEqual([
				{ name: 'Anna Prat', role: 'Gerent' },
				{ name: 'Pere Nou', role: "Cap d'obres" },
			])

			// AND the skip carries the company itself. The slug reported is the one
			// that was sent, which on a number match is not the one the company is
			// filed under — so without the company there is nothing to look up
			const skipped = rowsOf(second, 'skipped')
			expect(skipped).toHaveLength(1)
			const skip = skipped[0] as {
				slug?: unknown
				matched_on?: unknown
				company?: { slug?: unknown; id?: unknown }
			}
			expect(skip.matched_on).toBe('tax_id')
			expect(skip.company?.slug).toBe(filedUnder)
			expect(skip.slug).not.toBe(filedUnder)
			expect(typeof skip.company?.id).toBe('string')
		})
	})

	describe('when a company is already on file under the same web address', () => {
		it('should write nobody onto it and still hand it back', async () => {
			// GIVEN a company on file with one person
			const name = `Talleres Garcia ${MARKER}`
			const first = await createCompanies([
				{
					name,
					location: 'Girona',
					contacts: [{ name: 'Jordi Garcia', role: 'Propietari' }],
				},
			])
			const filedUnder = createdSlug(first)

			// WHEN a company of the same name somewhere else is sent, with its own
			// people
			const second = await createCompanies([
				{
					name,
					location: 'Sevilla',
					contacts: [{ name: 'Lucía Ramos', role: 'Administradora' }],
				},
			])

			// THEN nobody is written. A web address is folded from the name, so two
			// unrelated firms reduce to one — and writing here would file Sevilla's
			// people under Girona's company and report it as done
			expect(rowsOf(second, 'created')).toHaveLength(0)
			expect(peopleAdded(second)).toBe(0)
			expect(await peopleOn(filedUnder)).toEqual([
				{ name: 'Jordi Garcia', role: 'Propietari' },
			])

			// AND the caller is handed the company it collided with, so it can see
			// for itself that this is a different firm
			const skip = rowsOf(second, 'skipped')[0] as {
				matched_on?: unknown
				company?: { slug?: unknown; location?: unknown }
			}
			expect(skip.matched_on).toBe('slug')
			expect(skip.company?.slug).toBe(filedUnder)
			expect(skip.company?.location).toBe('Girona')
		})
	})

	describe('when one firm appears twice in a call under its own number', () => {
		it("should take the second entry's people onto the first", async () => {
			// GIVEN one firm sent twice in a single list — the same name, so the same
			// web address — carrying its registration number both times, with a
			// different person read off each page
			const taxId = `B${String(Date.now()).slice(-8)}`
			const name = `Doble Registre ${MARKER}`

			// WHEN the batch is created
			const result = await createCompanies([
				{
					name,
					taxId,
					contacts: [{ name: 'Primera Persona', role: 'Gerent' }],
				},
				{ name, taxId, contacts: [{ name: 'Segona Persona', role: 'Tècnic' }] },
			])

			// THEN one company lands carrying both people. The number settles that the
			// two entries are one firm, so the second entry's people are its people —
			// reading the web address first would call this a repeat and lose them
			expect(rowsOf(result, 'created')).toHaveLength(1)
			expect(peopleAdded(result)).toBe(2)
			const slug = createdSlug(result)
			expect(await peopleOn(slug)).toEqual([
				{ name: 'Primera Persona', role: 'Gerent' },
				{ name: 'Segona Persona', role: 'Tècnic' },
			])
			const skip = rowsOf(result, 'skipped')[0] as { matched_on?: unknown }
			expect(skip.matched_on).toBe('tax_id_in_request')
		})
	})

	describe('when a company appears twice in one call', () => {
		it("should keep the first entry's people and count them once", async () => {
			// GIVEN the same company twice in one list, each time with one person
			const name = `Dues Vegades ${MARKER}`

			// WHEN the batch is created
			const result = await createCompanies([
				{ name, contacts: [{ name: 'Primer Nom', role: 'Gerent' }] },
				{ name, contacts: [{ name: 'Segon Nom', role: 'Tècnic' }] },
			])

			// THEN one company lands with the first entry's person. The second is a
			// mistake in the list, and its web address is the only thing saying the
			// two entries are one company
			expect(rowsOf(result, 'created')).toHaveLength(1)
			expect(peopleAdded(result)).toBe(1)
			const slug = createdSlug(result)
			expect(await peopleOn(slug)).toEqual([
				{ name: 'Primer Nom', role: 'Gerent' },
			])
			const skip = rowsOf(result, 'skipped')[0] as { matched_on?: unknown }
			expect(skip.matched_on).toBe('slug_in_request')
		})
	})
})
