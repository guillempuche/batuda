// Live-DB integration test for the research half of the daily-planning list.
// Research takes minutes, so whoever asked for it is rarely still waiting when
// it lands — this list is how a finished run gets noticed at all, so what it
// holds and leaves out is worth pinning against real rows and real row-level
// security.
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
let companyId: string

const COMPANY_SLUG = `next-steps-${randomUUID()}`

// Pending proposals, shaped the way a run writes them into its findings.
const findingsWithPending = (count: number) =>
	JSON.stringify({
		proposed_updates: Array.from({ length: count }, (_, i) => ({
			id: `pu-${i}`,
			status: 'pending',
			subject_table: 'companies',
			subject_id: companyId,
		})),
	})

const insertRun = async (options: {
	readonly status: string
	readonly findings?: string
	readonly linkCompany?: boolean
}) => {
	const id = randomUUID()
	await pool.query(
		`INSERT INTO research_runs (id, organization_id, query, status, created_by, findings, completed_at)
		 VALUES ($1, $2, 'next steps probe', $3, 'u-fixture', $4::jsonb, now())`,
		[id, orgId, options.status, options.findings ?? '{}'],
	)
	if (options.linkCompany !== false) {
		await pool.query(
			`INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
			 VALUES ($1, $2, 'companies', $3, 'input')`,
			[orgId, id, companyId],
		)
	}
	return id
}

// Read the list as the request path does: role app_user, scoped to this org, so
// row-level security applies exactly as it would in production.
const awaitingReview = (): Promise<
	ReadonlyArray<{
		readonly id: string
		readonly pendingUpdateCount: number
		readonly companyId: string | null
	}>
> => {
	const deps = PipelineService.layer.pipe(Layer.provideMerge(PgLive))
	return Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const pipeline = yield* PipelineService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				const next = yield* pipeline.getNextSteps(50).pipe(
					Effect.provideService(CurrentOrg, {
						id: orgId,
						name: 'fixture',
						slug: 'fixture',
						role: 'member',
					}),
				)
				return next.researchAwaitingReview
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)
}

const idsAwaiting = async () => (await awaitingReview()).map(run => run.id)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const org = await pool.query<{ id: string }>(
		`SELECT id FROM organization LIMIT 1`,
	)
	const id = org.rows[0]?.id
	if (!id) throw new Error('no organization seeded — run the integration setup')
	orgId = id
	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name) VALUES ($1, $2, $2) RETURNING id`,
		[orgId, COMPANY_SLUG],
	)
	companyId = company.rows[0]!.id
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM research_links WHERE subject_id = $1::uuid`, [
		companyId,
	])
	await pool.query(`DELETE FROM research_runs WHERE created_by = 'u-fixture'`)
	await pool.query(`DELETE FROM companies WHERE id = $1::uuid`, [companyId])
	await pool.end()
})

describe('PipelineService research awaiting review', () => {
	describe('when a finished run proposes changes', () => {
		it('should list it with how many changes are waiting', async () => {
			// GIVEN a run that finished and wants to make two changes to a company
			const id = await insertRun({
				status: 'succeeded',
				findings: findingsWithPending(2),
			})

			// WHEN the planning list is read
			const listed = (await awaitingReview()).find(run => run.id === id)

			// THEN the run is on it, with the number of changes waiting, so whoever
			// reads the list knows there is something to decide
			expect(listed?.pendingUpdateCount).toBe(2)
		})

		it('should drop it once every change has been dealt with', async () => {
			// GIVEN a run whose one proposed change has since been applied
			const id = await insertRun({
				status: 'succeeded',
				findings: findingsWithPending(1),
			})
			await pool.query(
				`UPDATE research_runs
				 SET findings = jsonb_set(findings, '{proposed_updates,0,status}', '"applied"')
				 WHERE id = $1::uuid`,
				[id],
			)

			// WHEN the list is read again
			// THEN it is gone, so a decided run stops asking for attention
			expect(await idsAwaiting()).not.toContain(id)
		})
	})

	describe('when a run ended badly', () => {
		it('should list it even with nothing to decide', async () => {
			// GIVEN runs that failed, found nothing usable, and came back with an
			// answer flagged as shaky — none of them proposing changes
			const ids = []
			for (const status of [
				'failed',
				'no_reliable_data',
				'succeeded_low_confidence',
			]) {
				ids.push(await insertRun({ status }))
			}

			// WHEN the list is read
			const listed = await idsAwaiting()

			// THEN each is on it: the run itself is the thing needing a look
			for (const id of ids) {
				expect(listed).toContain(id)
			}
		})
	})

	describe('when nothing is waiting on a person', () => {
		it('should leave out a clean run and one still working', async () => {
			// GIVEN a run that succeeded with nothing to decide, and one still
			// working that has already written changes it means to propose
			const clean = await insertRun({ status: 'succeeded' })
			const working = await insertRun({
				status: 'running',
				findings: findingsWithPending(3),
			})

			// WHEN the list is read
			const listed = await idsAwaiting()

			// THEN neither is on it — the first needs nothing, and the second has
			// not finished, so asking a person to review it would be premature
			expect(listed).not.toContain(clean)
			expect(listed).not.toContain(working)
		})

		it('should leave out a deleted run', async () => {
			// GIVEN a run someone removed, which still carries proposed changes
			const id = await insertRun({
				status: 'deleted',
				findings: findingsWithPending(1),
			})

			// WHEN the list is read
			// THEN it stays off, matching everywhere else a deleted run is hidden
			expect(await idsAwaiting()).not.toContain(id)
		})
	})

	describe('when the run belongs to no single company', () => {
		it('should still list it rather than hide it', async () => {
			// GIVEN a freeform or scan run, which is linked to no company
			const id = await insertRun({
				status: 'succeeded',
				findings: findingsWithPending(1),
				linkCompany: false,
			})

			// WHEN the list is read
			const listed = (await awaitingReview()).find(run => run.id === id)

			// THEN it is there with no company attached — these are exactly the runs
			// nobody is watching, so dropping them would hide the worst case
			expect(listed).toBeDefined()
			expect(listed?.companyId).toBeNull()
		})
	})
})
