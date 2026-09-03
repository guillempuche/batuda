// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterEach, describe, expect, it } from 'vitest'

import { PgLive } from './client.js'
import putFiltersRight from './migrations/0068_company_country_case_and_tag_index'

// Putting the rows already stored in step with two rules the filters lean on.
//
// Both rules turn a value away where it is written from now on, so the only way
// a bad one exists is that it was written before — which means the repair itself
// is the only thing standing between those companies and a filter that cannot
// find them. It cannot be shown without a real database: the point is what the
// UPDATE does to rows, and the suite runs after the migration has already been
// applied, so every fixture here is written the way the old rules allowed.

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(
		effect.pipe(Effect.provide(PgLive), Effect.orDie) as Effect.Effect<A>,
	)

const withSql = <A, E>(
	f: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* f(sql)
	})

const orgs: Array<string> = []

// Written straight in, past the schemas: these are the shapes the rules now
// refuse, and the whole question is what happens to them.
const seedCompany = (
	orgId: string,
	country: string | null,
	tags: ReadonlyArray<string> | null,
) =>
	withSql(sql =>
		Effect.gen(function* () {
			const rows = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name, country, tags)
				VALUES (${orgId}, ${`co-${randomUUID()}`}, 'Seeded', ${country},
					${tags}::text[])
				RETURNING id
			`
			return rows[0]?.id as string
		}),
	)

const readCompany = (id: string) =>
	withSql(
		sql => sql<{ country: string | null; tags: ReadonlyArray<string> | null }>`
			SELECT country, tags FROM companies WHERE id = ${id}
		`,
	)

afterEach(async () => {
	for (const orgId of orgs.splice(0))
		await run(
			withSql(
				sql => sql`DELETE FROM companies WHERE organization_id = ${orgId}`,
			),
		)
})

describe('putting company countries and tags in step with the filters', () => {
	describe('when a country was stored in lower case', () => {
		it('should raise it, so the one spelling the filter asks for finds it', async () => {
			// GIVEN a company written before the rule raised what it was given
			const org = `filters-${randomUUID()}`
			orgs.push(org)
			const id = await run(seedCompany(org, 'es', null))

			// WHEN the rows are put in step
			await run(putFiltersRight)

			// THEN it carries the spelling every reader compares against
			const [row] = await run(readCompany(id))
			expect(row?.country).toBe('ES')
		})
	})

	describe('when the stored country is not a code at all', () => {
		it('should leave it alone rather than shout it back', async () => {
			// GIVEN somebody typed a country name into a field that wanted a code
			const org = `filters-${randomUUID()}`
			orgs.push(org)
			const id = await run(seedCompany(org, 'Spain', null))

			// WHEN the rows are put in step
			await run(putFiltersRight)

			// THEN it reads as it was written. Raising it cannot be undone and
			// would not make it findable either, so it is left for a person
			const [row] = await run(readCompany(id))
			expect(row?.country).toBe('Spain')
		})
	})

	describe('when a tag holds a comma', () => {
		it('should split it into the tags it was meant to be', async () => {
			// GIVEN a tag written as one value, back when a comma was allowed —
			// several tags travel as one comma-separated value, so this one comes
			// back as two tags nobody carries and the company stops being findable
			const org = `filters-${randomUUID()}`
			orgs.push(org)
			const id = await run(seedCompany(org, null, ['Barcelona, Sants', 'hvac']))

			// WHEN the rows are put in step
			await run(putFiltersRight)

			// THEN it is the two tags it plainly meant, and the others are untouched
			const [row] = await run(readCompany(id))
			expect([...(row?.tags ?? [])].sort()).toStrictEqual([
				'Barcelona',
				'Sants',
				'hvac',
			])
		})

		it('should drop the blank ends and any duplicate the split creates', async () => {
			// GIVEN a comma tag whose halves are padded, and one of which the
			// company already carries on its own
			const org = `filters-${randomUUID()}`
			orgs.push(org)
			const id = await run(seedCompany(org, null, [' hvac , olot ', 'hvac']))

			// WHEN the rows are put in step
			await run(putFiltersRight)

			// THEN each tag appears once, with nothing hanging off its ends
			const [row] = await run(readCompany(id))
			expect([...(row?.tags ?? [])].sort()).toStrictEqual(['hvac', 'olot'])
		})
	})

	describe('when there was nothing wrong with the row', () => {
		it('should leave it exactly as it was', async () => {
			// GIVEN a company already written the way the rules now require
			const org = `filters-${randomUUID()}`
			orgs.push(org)
			const id = await run(seedCompany(org, 'FR', ['hvac', 'olot']))

			// WHEN the rows are put in step
			await run(putFiltersRight)

			// THEN nothing about it moves
			const [row] = await run(readCompany(id))
			expect(row?.country).toBe('FR')
			expect([...(row?.tags ?? [])].sort()).toStrictEqual(['hvac', 'olot'])
		})
	})

	describe('when it is run a second time', () => {
		it('should change nothing it changed the first time', async () => {
			// GIVEN rows that needed both repairs, already repaired once
			const org = `filters-${randomUUID()}`
			orgs.push(org)
			const id = await run(seedCompany(org, 'pt', ['a, b']))
			await run(putFiltersRight)
			const [afterOnce] = await run(readCompany(id))

			// WHEN it runs again
			await run(putFiltersRight)

			// THEN the row reads the same. A repair that moved on every run would
			// keep splitting values that were never meant to be split
			const [afterTwice] = await run(readCompany(id))
			expect(afterTwice?.country).toBe(afterOnce?.country)
			expect([...(afterTwice?.tags ?? [])].sort()).toStrictEqual(
				[...(afterOnce?.tags ?? [])].sort(),
			)
		})
	})
})
