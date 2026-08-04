// Live-DB integration test for keeping deleted companies out of the pipeline
// numbers and the daily-planning list. A deleted company is hidden everywhere a
// person looks at companies, so a count that still includes it reports a book of
// business that is not there, and a plan that still includes it sends someone to
// chase a lead that was dropped.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { PipelineService } from './pipeline'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
let orgId: string

// Each case seeds its own company: the slug stays unique per organisation even
// once a row is deleted, so two cases cannot share one.
const SLUG_PREFIX = `deleted-probe-${randomUUID()}`
const slugFor = (name: string) => `${SLUG_PREFIX}-${name}`

const asOrg = { id: '', name: 'fixture', slug: 'fixture', role: 'member' }

// Read as the request path does: role app_user, scoped to this org, so row-level
// security applies exactly as it would in production.
const statusCountFor = (status: string): Promise<number> => {
	const deps = PipelineService.layer.pipe(Layer.provideMerge(PgLive))
	return Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const pipeline = yield* PipelineService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				const summary = yield* pipeline
					.getPipeline()
					.pipe(Effect.provideService(CurrentOrg, { ...asOrg, id: orgId }))
				return summary.statusCounts[status] ?? 0
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)
}

const overdueSlugs = (): Promise<ReadonlyArray<string>> => {
	const deps = PipelineService.layer.pipe(Layer.provideMerge(PgLive))
	return Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const pipeline = yield* PipelineService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				const next = yield* pipeline
					.getNextSteps(50)
					.pipe(Effect.provideService(CurrentOrg, { ...asOrg, id: orgId }))
				return next.overdueCompanies.map(company => company.slug)
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)
}

// A company carrying an overdue next action, so it lands on the planning list
// too, not only in the counts.
const seedCompany = async (slug: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies
			(organization_id, slug, name, status, next_action, next_action_at)
		 VALUES ($1, $2, $2, 'prospect', 'call them', now() - interval '1 day')
		 RETURNING id`,
		[orgId, slug],
	)
	return r.rows[0]!.id
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
})

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE slug LIKE $1`, [
		`${SLUG_PREFIX}%`,
	])
	await pool.end()
})

describe('pipeline reads against a deleted company', () => {
	describe('when a company is deleted', () => {
		it('should drop out of the status counts it was counted in', async () => {
			// GIVEN a live prospect, counted in the pipeline
			const companyId = await seedCompany(slugFor('counts'))
			const before = await statusCountFor('prospect')

			// WHEN it is deleted
			await pool.query(
				`UPDATE companies SET deleted_at = now() WHERE id = $1`,
				[companyId],
			)

			// THEN the count it contributed to goes back down
			expect(await statusCountFor('prospect')).toBe(before - 1)
		})
	})

	describe('when a deleted company still has an overdue next action', () => {
		it('should not appear on the daily planning list', async () => {
			// GIVEN a company overdue for a next action, on the list
			const slug = slugFor('planning')
			const companyId = await seedCompany(slug)
			expect(await overdueSlugs()).toContain(slug)

			// WHEN it is deleted
			await pool.query(
				`UPDATE companies SET deleted_at = now() WHERE id = $1`,
				[companyId],
			)

			// THEN nobody is sent to chase a company that was dropped
			expect(await overdueSlugs()).not.toContain(slug)
		})
	})
})
