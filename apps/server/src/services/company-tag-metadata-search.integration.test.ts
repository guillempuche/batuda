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

// Finding a company by a tag it carries, or by something written under its
// `metadata`.
//
// Both could be written through the ordinary tools and neither could be searched
// for, so they were write-only in practice: a set marked with a tag could only be
// picked out again by an accident of the data, such as being the only rows in
// their country.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
let org: { readonly id: string; readonly name: string; readonly slug: string }
const suffix = randomUUID().slice(0, 8)

const runtime = ManagedRuntime.make(
	CompanyService.layer.pipe(Layer.provideMerge(PgLive)),
)

const search = (filters: CompanyFilters) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* CompanyService
			return yield* enterOrgScope(sql, { org })(service.search(filters))
		}).pipe(Effect.orDie),
	)

const facets = (filters: CompanyFilters) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* CompanyService
			return yield* enterOrgScope(sql, { org })(service.facets(filters))
		}).pipe(Effect.orDie),
	)

const seedCompany = (
	slug: string,
	tags: ReadonlyArray<string>,
	metadata: Record<string, unknown> | null,
) =>
	pool.query(
		`INSERT INTO companies (organization_id, slug, name, country, tags, metadata)
		 VALUES ($1, $2, $3, 'ES', $4, $5)`,
		[
			org.id,
			slug,
			slug,
			tags,
			metadata === null ? null : JSON.stringify(metadata),
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

	// One company in the podcast set and shortlisted, one only in the podcast
	// set, and one in neither — so a two-tag search has something to exclude.
	await seedCompany(`both-${suffix}`, ['podcast', 'shortlist'], {
		seam: 'invoicing',
	})
	await seedCompany(`podcast-only-${suffix}`, ['podcast'], { seam: 'payroll' })
	await seedCompany(`untagged-${suffix}`, [], null)
}, 30_000)

afterAll(async () => {
	await pool.query(
		`DELETE FROM companies WHERE organization_id = $1 AND slug LIKE $2`,
		[org.id, `%-${suffix}`],
	)
	await pool.end()
	await runtime.dispose()
})

const slugsIn = (result: { items: ReadonlyArray<{ slug: string }> }) =>
	result.items.map(c => c.slug).filter(s => s.endsWith(suffix))

describe('finding a company by a tag it carries', () => {
	describe('when one tag is given', () => {
		it('should return every company carrying it and no others', async () => {
			// GIVEN three companies, two of them tagged for the podcast
			// WHEN the search asks for that tag
			const found = await search({ tags: ['podcast'], limit: 200 })

			// THEN both tagged companies come back
			// AND the untagged one stays out
			expect(slugsIn(found)).toContain(`both-${suffix}`)
			expect(slugsIn(found)).toContain(`podcast-only-${suffix}`)
			expect(slugsIn(found)).not.toContain(`untagged-${suffix}`)
		})
	})

	describe('when a second tag is given', () => {
		it('should narrow to companies carrying both, not widen to either', async () => {
			// GIVEN one company carrying both tags and one carrying only the first
			// WHEN the search names both
			const found = await search({
				tags: ['podcast', 'shortlist'],
				limit: 200,
			})

			// THEN only the company carrying both comes back — naming another tag is
			// how a list is narrowed, so matching either would be the wrong answer
			expect(slugsIn(found)).toEqual([`both-${suffix}`])
		})
	})

	describe('when the list of tags is empty', () => {
		it('should filter nothing, the same as not asking', async () => {
			// GIVEN a caller that read no tags from its form and sent the empty list
			const found = await search({ tags: [], limit: 200 })

			// THEN the untagged company is still there — an empty list is not a
			// condition nothing can satisfy
			expect(slugsIn(found)).toContain(`untagged-${suffix}`)
		})
	})

	describe('when a blank slipped into the list of tags', () => {
		it('should ignore the blank rather than find nothing at all', async () => {
			// GIVEN a caller that read its tags from a form and sent a stray empty one
			const found = await search({ tags: ['podcast', '  '], limit: 200 })

			// THEN the real tag still narrows the list. Asking for a blank tag as
			// well would find nothing, since no company carries one — a silent
			// nothing, where the caller only meant "podcast"
			expect(slugsIn(found)).toContain(`both-${suffix}`)
			expect(slugsIn(found)).toContain(`podcast-only-${suffix}`)
			expect(slugsIn(found)).not.toContain(`untagged-${suffix}`)
		})
	})

	describe('when a tag nobody used is given', () => {
		it('should return nothing rather than everything', async () => {
			// WHEN the search asks for a tag no company carries
			const found = await search({ tags: [`absent-${suffix}`], limit: 200 })

			// THEN none of this suite's companies come back
			expect(slugsIn(found)).toEqual([])
		})
	})

	describe('when the same filter is asked of the value counts', () => {
		it('should count the same companies the search returns', async () => {
			// GIVEN the tag search above, which finds two companies, both in Spain
			const found = await search({ tags: ['podcast'], limit: 200 })
			const counted = await facets({ tags: ['podcast'] })

			// THEN Spain's count is at least what the search returned for it, so a
			// count offered as a way to narrow cannot promise more than the list has
			const spain = counted.country.find(entry => entry.value === 'ES')
			expect(spain?.count ?? 0).toBeGreaterThanOrEqual(slugsIn(found).length)
		})
	})
})

describe('finding a company by something written under metadata', () => {
	describe('when a key and a value are given', () => {
		it('should return only the company holding that pair', async () => {
			// GIVEN two companies whose metadata names a different seam each
			// WHEN the search asks for one of them
			const found = await search({
				metadataKey: 'seam',
				metadataValue: 'invoicing',
				limit: 200,
			})

			// THEN only the company holding that pair comes back
			expect(slugsIn(found)).toEqual([`both-${suffix}`])
		})
	})

	describe('when only the key is given', () => {
		it('should filter nothing, since half a pair asks a different question', async () => {
			// GIVEN a key with no value beside it
			const found = await search({ metadataKey: 'seam', limit: 200 })

			// THEN the company with no metadata at all is still listed — a key alone
			// would ask whether anything was written there, which is not this filter
			expect(slugsIn(found)).toContain(`untagged-${suffix}`)
		})
	})
})
