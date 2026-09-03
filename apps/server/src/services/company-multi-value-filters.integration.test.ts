// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { enterOrgScope } from '../middleware/org'
import { type CompanyFilters, CompanyService } from './companies'

// Narrowing a company list by several values at once.
//
// Four filters take a list and match any of the values in it, while different
// filters still narrow one another — "everything mid-conversation in Spain" is
// two stages and one country, not a choice between them. Tags are the exception
// and have their own suite; what is pinned here is the four that widen, the
// owner's "nobody has taken this" sentinel, and the rule that an empty list is
// nobody asking rather than a condition nothing can meet.
//
// Country is here too, because it is the one filter whose stored form and asked
// form could differ: the shape says two letters and never said which case.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
let org: { readonly id: string; readonly name: string; readonly slug: string }
const suffix = randomUUID().slice(0, 8)

const ANA = `owner-ana-${suffix}`
const BRUNO = `owner-bruno-${suffix}`

const runtime = ManagedRuntime.make(
	CompanyService.layer.pipe(Layer.provideMerge(PgLive)),
)

// Typed as the service's own filters, so a change to what a filter accepts
// fails here rather than passing through as an untyped bag.
const search = (filters: CompanyFilters) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* CompanyService
			return yield* enterOrgScope(sql, { org })(service.search(filters))
		}).pipe(Effect.orDie),
	)

const seedCompany = (options: {
	readonly name: string
	readonly status: string
	readonly country: string
	readonly ownerId?: string | null
	readonly fitVerdict?: string | null
}) =>
	pool.query(
		`INSERT INTO companies (
			organization_id, slug, name, status, country, owner_id, fit_verdict
		 ) VALUES ($1, $2, $2, $3, $4, $5, $6)`,
		[
			org.id,
			`${options.name}-${suffix}`,
			options.status,
			options.country,
			options.ownerId ?? null,
			options.fitVerdict ?? null,
		],
	)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const orgs = await pool.query<{ id: string; name: string; slug: string }>(
		`SELECT id, name, slug FROM organization WHERE slug = 'taller' LIMIT 1`,
	)
	const row = orgs.rows[0]
	if (!row) throw new Error("taller org missing — run 'pnpm cli seed' first")
	org = row

	// One company per stage the tests ask about, plus one at a stage they never
	// ask about, so a filter that widened too far has something to catch it on.
	await seedCompany({
		name: 'contacted',
		status: 'contacted',
		country: 'ES',
		ownerId: ANA,
		fitVerdict: 'strong_fit',
	})
	await seedCompany({
		name: 'responded',
		status: 'responded',
		country: 'FR',
		ownerId: BRUNO,
		fitVerdict: 'possible_fit',
	})
	await seedCompany({
		name: 'client',
		status: 'client',
		country: 'ES',
		ownerId: null,
		fitVerdict: 'no_fit',
	})
	await seedCompany({
		name: 'unclaimed',
		status: 'contacted',
		country: 'PT',
		ownerId: null,
		fitVerdict: null,
	})
}, 30_000)

afterAll(async () => {
	await pool.query(
		`DELETE FROM companies WHERE organization_id = $1 AND slug LIKE $2`,
		[org.id, `%-${suffix}`],
	)
	await pool.end()
	await runtime.dispose()
})

const mine = (result: { items: ReadonlyArray<{ slug: string }> }) =>
	result.items
		.map(c => c.slug)
		.filter(s => s.endsWith(suffix))
		.sort()

describe('narrowing a company list by several values', () => {
	describe('when two stages are named', () => {
		it('should return companies at either, and none at a third', async () => {
			// GIVEN one company at each of three stages
			// WHEN the search names two of them
			const found = await search({
				status: ['contacted', 'responded'],
				limit: 200,
			})

			// THEN both are returned — naming a second stage widens, unlike naming a
			// second tag, because a company has one stage and cannot be at both
			// AND the third stage stays out
			expect(mine(found)).toEqual([
				`contacted-${suffix}`,
				`responded-${suffix}`,
				`unclaimed-${suffix}`,
			])
		})
	})

	describe('when a stage and a country are named together', () => {
		it('should narrow by both rather than widen to either', async () => {
			// GIVEN two companies at the contacted stage, in different countries
			// WHEN the search names that stage and one of the countries
			const found = await search({
				status: ['contacted'],
				country: ['ES'],
				limit: 200,
			})

			// THEN only the one meeting both comes back. Values inside one filter are
			// alternatives; separate filters are requirements
			expect(mine(found)).toEqual([`contacted-${suffix}`])
		})
	})

	describe('when the list for a filter is empty', () => {
		it('should filter nothing, the same as not asking', async () => {
			// GIVEN a caller whose form had no stage chosen and sent the empty list
			// WHEN the search is run
			const found = await search({ status: [], limit: 200 })

			// THEN every company is returned. An empty list has to read as "nobody
			// asked": treated as a condition, it would match nothing and the screen
			// would say the organisation has no companies
			expect(mine(found)).toHaveLength(4)
		})
	})

	describe('when a filter holds nothing but blanks', () => {
		it('should filter nothing, rather than match nothing', async () => {
			// GIVEN a link with a trailing comma, or a form field the reader emptied
			// WHEN the search is run
			const found = await search({ status: [''], limit: 200 })

			// THEN every company is returned. A blank left in would become `IN ('')`,
			// which matches nothing and reports the organisation as empty — an answer
			// that looks like data rather than like a filter nobody set
			expect(mine(found)).toHaveLength(4)
		})

		it('should still apply the values beside a blank', async () => {
			// GIVEN one real stage and one blank
			const found = await search({ status: ['client', ''], limit: 200 })

			// THEN the blank is dropped and the stage still narrows
			expect(mine(found)).toEqual([`client-${suffix}`])
		})
	})

	describe('when a country is written in lower case', () => {
		it('should find the companies stored under the capitals', async () => {
			// GIVEN two companies stored with country ES
			// WHEN a hand-written link asks for es
			const found = await search({ country: ['es'], limit: 200 })

			// THEN both are found. The two-letter shape never said which case, so the
			// filter raises what it is given to match how the column is written
			expect(mine(found)).toEqual([`client-${suffix}`, `contacted-${suffix}`])
		})
	})

	describe('when the owner asked for is nobody', () => {
		it('should return only the companies no one has taken', async () => {
			// GIVEN two companies with an owner and two without
			// WHEN the search asks for none
			const found = await search({ owner: ['none'], limit: 200 })

			// THEN only the unowned ones come back
			expect(mine(found)).toEqual([`client-${suffix}`, `unclaimed-${suffix}`])
		})
	})

	describe('when an owner and nobody are asked for together', () => {
		it('should return that owner’s companies and the unclaimed ones', async () => {
			// GIVEN Ana owns one company, Bruno owns another, and two are unowned
			// WHEN the search asks for Ana or nobody
			const found = await search({ owner: ['none', ANA], limit: 200 })

			// THEN Ana's company and both unowned ones come back, and Bruno's does
			// not. "What I am working plus what is going spare" is one question, and
			// an owner column holds no value standing for nobody to be matched against
			expect(mine(found)).toEqual([
				`client-${suffix}`,
				`contacted-${suffix}`,
				`unclaimed-${suffix}`,
			])
		})
	})

	describe('when two owners are named', () => {
		it('should return both their companies and leave the unclaimed out', async () => {
			// GIVEN Ana and Bruno own one company each
			// WHEN the search names both
			const found = await search({ owner: [ANA, BRUNO], limit: 200 })

			// THEN only their companies come back — asking for owners is not asking
			// for the ones nobody has
			expect(mine(found)).toEqual([
				`contacted-${suffix}`,
				`responded-${suffix}`,
			])
		})
	})

	describe('when two fit verdicts are named', () => {
		it('should return companies carrying either', async () => {
			// GIVEN three companies with a verdict and one without
			// WHEN the search names two of the verdicts
			const found = await search({
				fitVerdict: ['strong_fit', 'possible_fit'],
				limit: 200,
			})

			// THEN both are returned, and the third verdict and the blank stay out
			expect(mine(found)).toEqual([
				`contacted-${suffix}`,
				`responded-${suffix}`,
			])
		})
	})
})
