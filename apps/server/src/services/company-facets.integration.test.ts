// Live-DB integration test for the values a company search can be narrowed by.
//
// Those values and the rows are read from one predicate, so what these tests
// pin is the relationship between them: a value carries the count the same
// search would find, and a value with nothing behind it is still named rather
// than dropped.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'
import { foldLabel, slugFromLabel } from '@batuda/domain'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { type CompanyFilters, CompanyService } from './companies'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
let orgId: string
let otherOrgId: string

const TAG = `facets-${randomUUID().slice(0, 8)}`

// Written the way the product writes one, through the same two helpers: the
// filter resolves a trade by its folded name, so a fixture that folded it any
// other way would be looked up and missed.
const tradeSlug = (name: string): string => slugFromLabel(`${TAG} ${name}`)

const insertTrade = async (
	name: string,
	organizationId: string,
): Promise<string> => {
	const label = `${TAG} ${name}`
	const r = await pool.query<{ id: string }>(
		`INSERT INTO company_industries (organization_id, label, slug, folded_key)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		[organizationId, label, slugFromLabel(label), foldLabel(label)],
	)
	const id = r.rows[0]?.id
	if (id === undefined) throw new Error(`trade ${label} was not written`)
	return id
}

const insertCompany = async (options: {
	readonly name: string
	readonly status: string
	readonly country: string | null
	readonly tradeId: string
	readonly deleted?: boolean
	readonly organizationId?: string
}): Promise<void> => {
	const slug = `${TAG}-${options.name}`
	await pool.query(
		`INSERT INTO companies (
			organization_id, slug, name, status, country, industry_id, deleted_at
		 ) VALUES ($1, $2, $2, $3, $4, $5, CASE WHEN $6 THEN now() ELSE NULL END)`,
		[
			options.organizationId ?? orgId,
			slug,
			options.status,
			options.country,
			options.tradeId,
			options.deleted ?? false,
		],
	)
}

const deps = CompanyService.layer.pipe(Layer.provideMerge(PgLive))

// Read the way a request does: role app_user, scoped to this org, so row-level
// security applies exactly as it would in production.
const facetsFor = (filters: CompanyFilters) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const companies = yield* CompanyService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				return yield* companies.facets(filters).pipe(
					Effect.provideService(CurrentOrg, {
						id: orgId,
						name: 'fixture',
						slug: 'fixture',
						role: 'member' as const,
					}),
				)
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)

// Only this suite's own rows; the seeded organisation has others.
const mine = <T extends { readonly count: number }>(
	rows: ReadonlyArray<T>,
	pick: (row: T) => string,
): ReadonlyArray<readonly [string, number]> =>
	rows
		.filter(r => pick(r).startsWith(TAG) || COUNTRIES.includes(pick(r)))
		.map(r => [pick(r), r.count] as const)

// Countries this suite owns. Chosen so the seeded data uses none of them.
const COUNTRIES = ['PT', 'IT', 'FR', 'JP']

let binTrade: string
let quietTrade: string
let busyTrade: string

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const orgs = await pool.query<{ id: string }>(
		`SELECT id FROM organization ORDER BY id LIMIT 2`,
	)
	const first = orgs.rows[0]?.id
	const second = orgs.rows[1]?.id
	if (first === undefined || second === undefined)
		throw new Error('two organizations must be seeded — run the setup')
	orgId = first
	otherOrgId = second

	binTrade = await insertTrade('bin', orgId)
	quietTrade = await insertTrade('quiet', orgId)
	busyTrade = await insertTrade('busy', orgId)
	const otherTrade = await insertTrade('other', otherOrgId)

	// One company per case: in the bin, live but a different stage, and live in
	// the stage the tests filter to. Plus one in a second organisation.
	await insertCompany({
		name: 'binned',
		status: 'prospect',
		country: 'PT',
		tradeId: binTrade,
		deleted: true,
	})
	await insertCompany({
		name: 'client',
		status: 'client',
		country: 'IT',
		tradeId: quietTrade,
	})
	await insertCompany({
		name: 'prospect',
		status: 'prospect',
		country: 'FR',
		tradeId: busyTrade,
	})
	// Live, and in a country nothing in this organisation is in — so only the
	// organisation boundary can keep it out of these counts.
	await insertCompany({
		name: 'stranger',
		status: 'prospect',
		country: 'JP',
		tradeId: otherTrade,
		organizationId: otherOrgId,
	})
	// A second company in France, so the country has to be named once rather
	// than once per company on it.
	await insertCompany({
		name: 'second-prospect',
		status: 'prospect',
		country: 'FR',
		tradeId: busyTrade,
	})
	// One with no country and one with an empty string: both are absences that
	// must never be offered as something to narrow by.
	await insertCompany({
		name: 'nowhere',
		status: 'prospect',
		country: null,
		tradeId: busyTrade,
	})
	await insertCompany({
		name: 'blank',
		status: 'prospect',
		country: '',
		tradeId: busyTrade,
	})
}, 60_000)

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE slug LIKE $1`, [`${TAG}-%`])
	await pool.query(`DELETE FROM company_industries WHERE slug LIKE $1`, [
		`${TAG}-%`,
	])
	await pool.end()
})

describe('company filter options', () => {
	describe('when nothing is filtered', () => {
		it('should leave out what only a deleted company has', async () => {
			// GIVEN a country and a trade carried only by a company in the bin

			// WHEN the options are read with the bin out of view
			const facets = await facetsFor({})

			// THEN neither is offered — narrowing by one could only empty the list
			expect(mine(facets.country, c => c.value)).toEqual([
				['FR', 2],
				['IT', 1],
			])
			expect(mine(facets.industry, i => i.slug).map(([s]) => s)).toEqual([
				tradeSlug('busy'),
				tradeSlug('quiet'),
			])
		})

		it('should name a country once, however many companies are on it', async () => {
			// GIVEN two companies in France

			// WHEN the options are read
			const facets = await facetsFor({})

			// THEN France is one entry carrying the count, not an entry per company
			expect(facets.country.filter(c => c.value === 'FR')).toEqual([
				{ value: 'FR', count: 2 },
			])
		})

		it('should leave out a company with no country rather than offer a blank', async () => {
			// GIVEN one company with no country and one with an empty string

			// WHEN the options are read
			const facets = await facetsFor({})

			// THEN neither becomes a choice. The response promises a string for every
			// entry, so a missing country would not merely read as a blank — it would
			// fail to decode and take the whole answer down with it.
			expect(facets.country.map(c => c.value)).not.toContain(null)
			expect(facets.country.map(c => c.value)).not.toContain('')
		})

		it('should count each option only within its own organisation', async () => {
			// GIVEN a second organisation holding a live company in Japan, on a trade
			// of its own — neither of which this organisation has at all

			// WHEN this organisation's options are read
			const facets = await facetsFor({})

			// THEN neither is offered. Japan is the load-bearing half: nothing else
			// about this company would keep it out, so only the organisation
			// boundary can.
			expect(facets.country.map(c => c.value)).not.toContain('JP')
			expect(facets.industry.map(i => i.slug)).not.toContain(tradeSlug('other'))
		})
	})

	describe('when the list is narrowed to one stage', () => {
		it('should count the options that stage has, and zero for the rest', async () => {
			// GIVEN one prospect in France and one client in Italy

			// WHEN the options are read for prospects
			const facets = await facetsFor({ status: 'prospect' })

			// THEN both countries are still returned, and only France has anything
			// behind it — a zero says the value exists but finds nothing here, which
			// is what lets a caller go on offering a choice that has gone empty
			expect(mine(facets.country, c => c.value)).toEqual([
				['FR', 2],
				['IT', 0],
			])
			expect(mine(facets.industry, i => i.slug)).toEqual([
				[tradeSlug('busy'), 4],
				[tradeSlug('quiet'), 0],
			])
		})
	})

	describe('when the bin is what is being looked at', () => {
		it('should offer what the deleted companies have, and only that', async () => {
			// GIVEN the only deleted company is a Portuguese one on the bin trade

			// WHEN the options are read for the bin
			const facets = await facetsFor({ deleted: 'only' })

			// THEN its country and trade are the ones on offer
			expect(mine(facets.country, c => c.value)).toEqual([['PT', 1]])
			expect(mine(facets.industry, i => i.slug)).toEqual([
				[tradeSlug('bin'), 1],
			])
		})
	})

	describe('when a country is already chosen', () => {
		it('should still offer the other countries, so a second can be picked', async () => {
			// GIVEN France is the chosen country

			// WHEN the options are read
			const facets = await facetsFor({ country: 'FR' })

			// THEN the countries are counted as though nothing were chosen — counting
			// them under their own filter would leave every other one reading zero
			// and there would be no way to switch
			expect(mine(facets.country, c => c.value)).toEqual([
				['FR', 2],
				['IT', 1],
			])

			// AND the trades are narrowed to that country, since that filter is not
			// their own
			expect(mine(facets.industry, i => i.slug)).toEqual([
				[tradeSlug('busy'), 2],
				[tradeSlug('quiet'), 0],
			])
		})
	})

	describe('when a trade is already chosen', () => {
		it('should still offer the other trades, so a second can be picked', async () => {
			// GIVEN the busy trade is chosen

			// WHEN the options are read
			const facets = await facetsFor({ industry: tradeSlug('busy') })

			// THEN the trades ignore their own filter, while the countries respect it
			expect(mine(facets.industry, i => i.slug)).toEqual([
				[tradeSlug('busy'), 4],
				[tradeSlug('quiet'), 1],
			])
			expect(mine(facets.country, c => c.value)).toEqual([
				['FR', 2],
				['IT', 0],
			])
		})
	})
})
