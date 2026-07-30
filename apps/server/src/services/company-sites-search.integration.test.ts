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
import { CompanyService } from './companies'

// Finding a company by drawing a rectangle on the map.
//
// A company used to be one place, so the search read its single pin. A chain
// registered in Barcelona was therefore invisible to a rep drawing a box around
// Tarragona, however many shops it had there. Each branch is a row now, and the
// search looks at those too.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
let org: { readonly id: string; readonly name: string; readonly slug: string }
const suffix = randomUUID().slice(0, 8)

// Barcelona and Tarragona, far enough apart that one box cannot hold both.
const BARCELONA = { lat: 41.3874, lng: 2.1686 }
const TARRAGONA = { lat: 41.1189, lng: 1.2445 }
const TARRAGONA_BOX = {
	minLat: 41.0,
	maxLat: 41.25,
	minLng: 1.0,
	maxLng: 1.4,
}

const runtime = ManagedRuntime.make(
	CompanyService.layer.pipe(Layer.provideMerge(PgLive)),
)

const search = (filters: Record<string, unknown>) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const service = yield* CompanyService
			return yield* enterOrgScope(sql, { org })(service.search(filters))
		}).pipe(Effect.orDie),
	)

const seedCompany = async (
	slug: string,
	coords: { lat: number; lng: number } | null,
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, latitude, longitude)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		[org.id, slug, slug, coords?.lat ?? null, coords?.lng ?? null],
	)
	return r.rows[0]!.id
}

const seedSite = (
	companyId: string,
	name: string,
	coords: { lat: number; lng: number },
) =>
	pool.query(
		`INSERT INTO sites (organization_id, company_id, name, latitude, longitude)
		 VALUES ($1, $2, $3, $4, $5)`,
		[org.id, companyId, name, coords.lat, coords.lng],
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

	// A chain: registered in Barcelona, with a shop in Tarragona.
	const chain = await seedCompany(`chain-${suffix}`, BARCELONA)
	await seedSite(chain, 'Tarragona shop', TARRAGONA)
	// A company that is only in Barcelona, with no branches.
	await seedCompany(`bcn-only-${suffix}`, BARCELONA)
	// A company already sitting in Tarragona, with no branches.
	await seedCompany(`tgn-only-${suffix}`, TARRAGONA)
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

describe('finding a company by a rectangle on the map', () => {
	describe('when a chain has a branch inside the box', () => {
		it('should find it, though its own pin is in another city', async () => {
			// GIVEN a box drawn around Tarragona
			const found = await search({ ...TARRAGONA_BOX, limit: 100 })

			// THEN the chain comes back on the strength of its Tarragona shop — this
			// is the case that was invisible before
			expect(slugsIn(found)).toContain(`chain-${suffix}`)
			// AND so does the company that is simply there
			expect(slugsIn(found)).toContain(`tgn-only-${suffix}`)
		})

		it('should not sweep in a company that is only somewhere else', async () => {
			// GIVEN the same box
			const found = await search({ ...TARRAGONA_BOX, limit: 100 })

			// THEN a Barcelona-only company stays out, so the branch rule widened the
			// search rather than breaking it
			expect(slugsIn(found)).not.toContain(`bcn-only-${suffix}`)
		})

		it('should return each company once, however many branches match', async () => {
			// GIVEN a second Tarragona shop for the same chain
			const chain = await pool.query<{ id: string }>(
				`SELECT id FROM companies WHERE organization_id = $1 AND slug = $2`,
				[org.id, `chain-${suffix}`],
			)
			await seedSite(chain.rows[0]!.id, 'Tarragona depot', {
				lat: TARRAGONA.lat + 0.01,
				lng: TARRAGONA.lng + 0.01,
			})

			// WHEN the box is searched
			const found = await search({ ...TARRAGONA_BOX, limit: 100 })

			// THEN the company appears once, not once per branch
			expect(slugsIn(found).filter(s => s === `chain-${suffix}`)).toHaveLength(
				1,
			)
		})
	})

	describe('when only one edge of the box is given', () => {
		it('should narrow rather than match nothing', async () => {
			// GIVEN only a northern edge, above Barcelona
			const found = await search({ maxLat: 41.2, limit: 100 })

			// THEN everything south of it comes back, by its own pin or a branch
			expect(slugsIn(found)).toContain(`tgn-only-${suffix}`)
			expect(slugsIn(found)).toContain(`chain-${suffix}`)
			expect(slugsIn(found)).not.toContain(`bcn-only-${suffix}`)
		})
	})
})
