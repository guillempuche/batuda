// Live-DB integration test for the company list's "what needs doing" filter.
//
// The point of this filter is that the dashboard can link into it: a heading
// there reading 65 has to open a list of 65 here. That only holds while both
// sides ask the database the same question, so these tests compare the two
// answers directly rather than restating either rule.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'
import type { AttentionFilter } from '@batuda/domain'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'
import { PipelineService } from './pipeline'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
let orgId: string

const TAG = `attnfilter-${randomUUID().slice(0, 8)}`

const insertCompany = async (options: {
	readonly name: string
	readonly status: string
	readonly nextAction?: string | null
	readonly lastContactedDaysAgo?: number | null
	readonly nextActionInDays?: number | null
}): Promise<void> => {
	const slug = `${TAG}-${options.name}`
	await pool.query(
		`INSERT INTO companies (
			organization_id, slug, name, status, next_action,
			last_contacted_at, next_action_at
		 ) VALUES (
			$1, $2, $2, $3, $4,
			CASE WHEN $5::int IS NULL THEN NULL ELSE now() - ($5::int * interval '1 day') END,
			CASE WHEN $6::int IS NULL THEN NULL ELSE now() + ($6::int * interval '1 day') END
		 )`,
		[
			orgId,
			slug,
			options.status,
			options.nextAction ?? null,
			options.lastContactedDaysAgo ?? null,
			options.nextActionInDays ?? null,
		],
	)
}

const deps = CompanyService.layer.pipe(
	Layer.provideMerge(PipelineService.layer),
	Layer.provideMerge(PgLive),
)

const asMember = {
	id: '',
	name: 'fixture',
	slug: 'fixture',
	role: 'member' as const,
}

// Each read runs the way a request does: role app_user, scoped to this org, so
// row-level security applies exactly as it would in production. Written out per
// helper rather than behind one generic wrapper — a wrapper that takes the body
// as a type parameter loses the success type on the way through, and every
// assertion below then reads as `never`.
const filtered = (attention: AttentionFilter, staleDays?: number) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const companies = yield* CompanyService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				return yield* companies
					.search({
						attention,
						...(staleDays === undefined ? {} : { staleDays }),
						limit: 500,
						count: 'exact',
					})
					.pipe(Effect.provideService(CurrentOrg, { ...asMember, id: orgId }))
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)

const dashboard = (staleDays?: number) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const pipeline = yield* PipelineService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				return yield* pipeline
					.getNextSteps(500, staleDays === undefined ? {} : { staleDays })
					.pipe(Effect.provideService(CurrentOrg, { ...asMember, id: orgId }))
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)

const snapshot = () =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const pipeline = yield* PipelineService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				return yield* pipeline
					.getPipeline()
					.pipe(Effect.provideService(CurrentOrg, { ...asMember, id: orgId }))
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)

const stalePlusStatus = (status: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const companies = yield* CompanyService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				return yield* companies
					.search({
						attention: 'stale',
						status: [status],
						limit: 500,
						count: 'exact',
					})
					.pipe(Effect.provideService(CurrentOrg, { ...asMember, id: orgId }))
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)

const slugsOf = (rows: ReadonlyArray<{ readonly slug: string }>) =>
	[...rows.map(row => row.slug)].sort()

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const org = await pool.query<{ id: string }>(
		`SELECT id FROM organization LIMIT 1`,
	)
	const id = org.rows[0]?.id
	if (!id) throw new Error('no organization seeded — run the integration setup')
	orgId = id

	// One company per reason, so each filter has something of its own to find.
	await insertCompany({
		name: 'missed',
		status: 'proposal',
		nextAction: 'Chase the quote',
		nextActionInDays: -5,
	})
	await insertCompany({
		name: 'quiet',
		status: 'contacted',
		nextAction: 'Send the brochure',
		lastContactedDaysAgo: 40,
	})
	await insertCompany({
		name: 'nothing-planned',
		status: 'responded',
		lastContactedDaysAgo: 1,
	})
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE slug LIKE $1`, [`${TAG}-%`])
	await pool.end()
})

describe('CompanyService attention filter', () => {
	describe('when the dashboard links into the company list', () => {
		it('should return exactly the companies the overdue list holds', async () => {
			// GIVEN the dashboard's own overdue list
			const listed = await filtered('overdue')
			const onDashboard = await dashboard()

			// THEN the filter returns the same companies. Comparing the two answers
			// rather than restating the rule is the point: a heading that says 12
			// has to open a list of 12, and only agreement proves that
			expect(slugsOf(listed.items)).toEqual(
				slugsOf(onDashboard.overdueCompanies),
			)
			expect(listed.total).toBe(onDashboard.counts.overdueCompanies)
		})

		it('should return exactly the companies the quiet list holds', async () => {
			// GIVEN both sides asked at the same threshold
			const listed = await filtered('stale')
			const onDashboard = await dashboard()

			// THEN they agree on every row and on the count
			expect(slugsOf(listed.items)).toEqual(slugsOf(onDashboard.staleCompanies))
			expect(listed.total).toBe(onDashboard.counts.staleCompanies)
		})

		it('should follow the threshold the link carries', async () => {
			// GIVEN a dashboard showing a two-month idea of quiet
			const listed = await filtered('stale', 60)
			const onDashboard = await dashboard(60)

			// THEN the list opened from it uses that same two months, rather than
			// falling back to the default and showing a different set
			expect(slugsOf(listed.items)).toEqual(slugsOf(onDashboard.staleCompanies))
			expect(listed.total).toBe(onDashboard.counts.staleCompanies)
		})

		it('should match the needs-action counter exactly', async () => {
			// GIVEN the counter on the dashboard
			const listed = await filtered('no-next-action')
			const counter = await snapshot()

			// THEN the list holds precisely that many. This one reads the written
			// note rather than the follow-up date and leaves signed clients out, so
			// it is the pairing most likely to drift apart unnoticed
			expect(listed.total).toBe(counter.companiesWithoutNextAction)
		})
	})

	describe('when a filter is asked for on its own', () => {
		it('should find the company put there for it', async () => {
			// GIVEN one company per reason, each set up in beforeAll
			const [overdue, stale, noNext] = await Promise.all([
				filtered('overdue'),
				filtered('stale'),
				filtered('no-next-action'),
			])

			// THEN each filter finds its own. Without this the agreement checks
			// above would still pass on three empty lists
			expect(slugsOf(overdue.items)).toContain(`${TAG}-missed`)
			expect(slugsOf(stale.items)).toContain(`${TAG}-quiet`)
			expect(slugsOf(noNext.items)).toContain(`${TAG}-nothing-planned`)
		})

		it('should leave a company with a plan off the needs-action list', async () => {
			// GIVEN two companies that do have a next step written down
			const noNext = await filtered('no-next-action')

			// THEN neither is asked after, because something is already planned for
			// them — the filter reads the written note, not the date
			expect(slugsOf(noNext.items)).not.toContain(`${TAG}-missed`)
			expect(slugsOf(noNext.items)).not.toContain(`${TAG}-quiet`)
		})
	})

	describe('when the filter is combined with another', () => {
		it('should narrow rather than replace', async () => {
			// GIVEN the quiet list narrowed to one stage of the pipeline
			const all = await filtered('stale')
			const contactedOnly = await stalePlusStatus('contacted')

			// THEN the narrowed list is a subset — the two filters stack, so a
			// reader who arrived from the dashboard can keep filtering from there
			const wider = new Set(slugsOf(all.items))
			for (const slug of slugsOf(contactedOnly.items)) {
				expect(wider).toContain(slug)
			}
			expect(contactedOnly.items.length).toBeLessThanOrEqual(all.items.length)
			expect(slugsOf(contactedOnly.items)).toContain(`${TAG}-quiet`)
		})
	})
})
