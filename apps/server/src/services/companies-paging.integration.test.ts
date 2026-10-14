// Live-DB integration test for paging through the company list.
//
// Every company here shares the same priority, update time and last contact,
// so the only thing telling them apart is their id. Without it in the order,
// Postgres may hand back the tied rows in a different order on each page, and
// walking the pages skips some companies and repeats others.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'
import type { CompanySort } from '@batuda/domain'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'
import { PipelineService } from './pipeline'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
let orgId: string

// The name search matches on this, which keeps the seeded companies out.
const TAG = `paging${randomUUID().slice(0, 8)}`
const COMPANIES = 23
const PAGE = 4

const deps = CompanyService.layer.pipe(
	Layer.provideMerge(PipelineService.layer),
	Layer.provideMerge(PgLive),
)

const pageOf = (sort: CompanySort | undefined, offset: number) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const companies = yield* CompanyService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				return yield* companies
					.search({
						query: TAG,
						...(sort === undefined ? {} : { sort }),
						limit: PAGE,
						offset,
					})
					.pipe(
						Effect.provideService(CurrentOrg, {
							id: orgId,
							name: 'fixture',
							slug: 'fixture',
							role: 'member',
						}),
					)
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)

const walkAllPages = async (sort: CompanySort | undefined) => {
	const ids: Array<string> = []
	for (let offset = 0; offset < COMPANIES + PAGE; offset += PAGE) {
		const page = await pageOf(sort, offset)
		ids.push(...page.items.map(company => company.id))
	}
	return ids
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const org = await pool.query<{ id: string }>(
		`SELECT id FROM organization LIMIT 1`,
	)
	const id = org.rows[0]?.id
	if (!id) throw new Error('no organization seeded — run the integration setup')
	orgId = id

	// One timestamp and one name for all of them, so every sort ties on
	// everything but the id.
	await pool.query(
		`INSERT INTO companies (
			organization_id, slug, name, status, priority,
			last_contacted_at, updated_at, created_at
		 )
		 SELECT $1, $2 || '-' || n, $2, 'prospect', 2,
			'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
		 FROM generate_series(1, $3::int) AS n`,
		[orgId, TAG, COMPANIES],
	)
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE slug LIKE $1`, [`${TAG}-%`])
	await pool.end()
})

describe('CompanyService search paging', () => {
	const sorts: ReadonlyArray<CompanySort | undefined> = [
		undefined,
		'name',
		'recent_contact',
		'recent_update',
	]

	for (const sort of sorts) {
		describe(`when every company ties on the ${sort ?? 'default'} order`, () => {
			it('should hand back each company exactly once across the pages', async () => {
				// GIVEN companies indistinguishable by anything the order names
				// WHEN the list is walked one small page at a time
				const ids = await walkAllPages(sort)

				// THEN every company turns up, and none of them twice — a repeat
				// means another one was skipped and never shown to anybody
				expect(ids).toHaveLength(COMPANIES)
				expect(new Set(ids).size).toBe(COMPANIES)
			})
		})
	}
})
