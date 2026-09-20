// Live-DB integration test for the paid-action queue: lookups a run offered to
// pay for, unnested from every run's findings and waiting on a person. Run
// scoped to app_user + an org GUC so row-level security isolates the fixtures
// from the rest of the database.
//
// The estimate is what most of this covers. A run writes that figure itself, so
// "a number" in JSON arrives as 0.05 and 5.0 as readily as 5, and reading it
// straight into a whole number of cents used to fail the entire query — one run
// with a fraction in it took the queue down for a whole organisation.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'

import { queryPendingPaidActions } from '@batuda/research'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `paid-org-${randomUUID()}`
const OTHER_ORG = `paid-other-${randomUUID()}`

let pool: pg.Pool

const action = (over: Record<string, unknown>) => ({
	id: randomUUID(),
	tool: 'discover_contacts',
	args: {},
	reason: 'needs a named contact',
	...over,
})

// Seed from JSON text rather than a value, because some of the shapes worth
// testing cannot survive a round trip through JavaScript: 5.0 is written back
// out as 5, and it is precisely the trailing ".0" that the database later hands
// to the cast. Everything that does survive goes through `seedRun` below.
const seedRunRaw = async (
	findingsJson: string,
	over: { status?: string; org?: string; createdAt?: string } = {},
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_runs (organization_id, query, status, created_by, findings, created_at)
		 VALUES ($1, 'q', $2, 'u1', $3::jsonb, $4) RETURNING id`,
		[
			over.org ?? ORG,
			over.status ?? 'succeeded',
			findingsJson,
			over.createdAt ?? '2026-01-01T00:00:00Z',
		],
	)
	return r.rows[0]!.id
}

const seedRun = (
	findings: unknown,
	over: { status?: string; org?: string; createdAt?: string } = {},
): Promise<string> => seedRunRaw(JSON.stringify(findings), over)

interface Filters {
	researchId?: string
	limit?: number
	offset?: number
	count?: 'exact' | 'none'
}

// Query as app_user with the org GUC set, so RLS scopes the read to ORG.
const listScoped = (filters: Filters = {}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${ORG}, true)`
				return yield* queryPendingPaidActions(sql, filters)
			}),
		)
	}).pipe(Effect.provide(PgLive), Effect.orDie, Effect.runPromise)

// One run holding one action, read back — the shape nearly every case below
// wants. Each gets its own run so the fixtures cannot interfere.
//
// The row itself is asserted here rather than shrugged off with `?? null`: a
// price that reads as absent and a lookup that never came back at all are very
// different failures, and collapsing them would let a query returning nothing
// pass every case that expects no estimate.
const estimateOf = async (estimated_cents: unknown): Promise<number | null> => {
	const runId = await seedRun({
		pending_paid_actions: [action({ estimated_cents })],
	})
	const page = await listScoped({ researchId: runId })
	expect(page.items).toHaveLength(1)
	return page.items[0]!.estimatedCents
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	// Let the connection role switch to app_user for the RLS-scoped reads.
	await pool.query('GRANT app_user TO CURRENT_USER')
})

describe('queryPendingPaidActions', () => {
	describe('when a run priced a lookup in something other than whole cents', () => {
		it('should round a part of a cent up rather than reading it as free', async () => {
			// GIVEN a lookup a run priced below a single cent
			// WHEN the queue is read
			// THEN it is listed as costing something, because it does
			expect(await estimateOf(0.05)).toBe(1)
		})

		it('should read a whole number written as a decimal as that number', async () => {
			// GIVEN 5.0 as the run actually wrote it — seeded as text, because
			// JavaScript cannot hold the trailing ".0" that causes the trouble
			const runId = await seedRunRaw(
				`{"pending_paid_actions":[{"id":"${randomUUID()}","tool":"discover_contacts","args":{},"estimated_cents":5.0}]}`,
			)

			// WHEN the queue is read
			// THEN it reads as five cents, and the query does not fail
			const page = await listScoped({ researchId: runId })
			expect(page.items[0]?.estimatedCents).toBe(5)
		})

		it('should hold a figure too large for the estimate inside what it can carry', async () => {
			// GIVEN a price far past what the estimate can hold
			// WHEN the queue is read
			// THEN it is capped instead of failing the whole queue
			expect(await estimateOf(99999999999)).toBe(2147483647)
			expect(await estimateOf(-99999999999)).toBe(-2147483648)
		})

		it('should keep a whole number of cents exactly as written', async () => {
			// GIVEN figures that are already countable
			// THEN they pass through untouched, zero included
			expect(await estimateOf(29)).toBe(29)
			expect(await estimateOf(0)).toBe(0)
			expect(await estimateOf(2147483647)).toBe(2147483647)
		})

		it('should not claim a price from something that is not a number', async () => {
			// GIVEN a price written as text, as a flag, as a shape, or not at all
			// THEN the queue reports no estimate rather than inventing one
			expect(await estimateOf('12')).toBe(null)
			expect(await estimateOf(true)).toBe(null)
			expect(await estimateOf({ amount: 5 })).toBe(null)
			expect(await estimateOf([5])).toBe(null)
			expect(await estimateOf(null)).toBe(null)
		})

		it('should report no estimate when the run never wrote one', async () => {
			// GIVEN an action with no price on it at all
			const runId = await seedRun({
				pending_paid_actions: [{ id: randomUUID(), tool: 'x', args: {} }],
			})

			// THEN the action is still listed, with nothing where a price would be
			const page = await listScoped({ researchId: runId })
			expect(page.items[0]?.estimatedCents).toBe(null)
		})
	})

	describe('when a run holds several lookups at once', () => {
		it('should list one that cannot be priced beside one that can', async () => {
			// GIVEN a run whose lookups include a fraction, a whole number and a
			// figure that is not a number
			const runId = await seedRun({
				pending_paid_actions: [
					action({ estimated_cents: 0.05 }),
					action({ estimated_cents: 29 }),
					action({ estimated_cents: 'free' }),
				],
			})

			// WHEN the queue is read
			// THEN every one is there — a single unreadable price no longer takes
			// the others down with it
			const page = await listScoped({ researchId: runId })
			expect(page.items).toHaveLength(3)
			expect(new Set(page.items.map(i => i.estimatedCents))).toEqual(
				new Set([1, 29, null]),
			)
		})
	})

	describe('when deciding which lookups are still waiting', () => {
		it('should list only the ones nobody has answered yet', async () => {
			// GIVEN lookups in each state a run records
			const runId = await seedRun({
				pending_paid_actions: [
					action({ status: 'pending', reason: 'waiting' }),
					action({ status: 'approved', reason: 'done' }),
					action({ status: 'skipped', reason: 'no' }),
					action({ status: 'unsupported', reason: 'not real' }),
				],
			})

			// THEN only the one still waiting is offered for a decision
			const page = await listScoped({ researchId: runId })
			expect(page.items).toHaveLength(1)
			expect(page.items[0]?.reason).toBe('waiting')
		})

		it('should count a lookup with no status written as waiting', async () => {
			// GIVEN the shape a run writes first, before any status is stamped
			const runId = await seedRun({
				pending_paid_actions: [
					{ tool: 'discover_contacts', args: {}, reason: 'fresh' },
					{ tool: 'discover_contacts', args: {}, status: null },
				],
			})

			// THEN both are waiting — an absent status and a null one read alike
			const page = await listScoped({ researchId: runId })
			expect(page.items).toHaveLength(2)
		})

		it('should show a lookup that was never stamped with an id', async () => {
			// GIVEN an action written before ids were stamped, so it has none
			const runId = await seedRun({
				pending_paid_actions: [{ tool: 'discover_contacts', args: {} }],
			})

			// THEN it still shows, so a run stuck waiting is at least visible,
			// even though nothing can be resolved against it
			const page = await listScoped({ researchId: runId })
			expect(page.items[0]?.actionId).toBe(null)
		})

		it('should leave out a run that was deleted', async () => {
			// GIVEN a deleted run still holding a waiting lookup
			const runId = await seedRun(
				{ pending_paid_actions: [action({ estimated_cents: 5 })] },
				{ status: 'deleted' },
			)

			// THEN it offers nothing to decide
			const page = await listScoped({ researchId: runId })
			expect(page.items).toHaveLength(0)
		})
	})

	describe('when the findings hold no usable list', () => {
		it('should read a run whose list is missing, empty or the wrong shape', async () => {
			// GIVEN runs whose paid-action list is absent, empty, an object or text
			const ids = await Promise.all([
				seedRun({ summary: 'none' }),
				seedRun({ pending_paid_actions: [] }),
				seedRun({ pending_paid_actions: { tool: 'x' } }),
				seedRun({ pending_paid_actions: 'nope' }),
				seedRun({ pending_paid_actions: null }),
			])

			// THEN each contributes nothing and none of them fails the read
			for (const id of ids) {
				const page = await listScoped({ researchId: id })
				expect(page.items).toHaveLength(0)
			}
		})

		it('should survive a list holding things that are not actions', async () => {
			// GIVEN a list of bare values rather than objects
			const runId = await seedRun({
				pending_paid_actions: ['oops', 7, null],
			})

			// THEN they surface as empty rows rather than failing the query, so a
			// run that wrote nonsense is still visible to whoever must clear it
			const page = await listScoped({ researchId: runId })
			expect(page.items).toHaveLength(3)
			expect(page.items[0]?.tool).toBe('')
			expect(page.items[0]?.estimatedCents).toBe(null)
			expect(page.items[0]?.actionId).toBe(null)
		})

		it('should fall back to an empty set of arguments', async () => {
			// GIVEN actions whose args are an object, text, a list, or absent
			const runId = await seedRun({
				pending_paid_actions: [
					action({ args: { q: 'a' } }),
					action({ args: 'nope' }),
					action({ args: [1] }),
					{ id: randomUUID(), tool: 'discover_contacts' },
				],
			})

			// THEN only the real object survives; the rest read as no arguments
			const page = await listScoped({ researchId: runId })
			const args = page.items.map(i => JSON.stringify(i.args)).sort()
			expect(args).toEqual(['{"q":"a"}', '{}', '{}', '{}'])
		})
	})

	describe('when naming the company or person a run was about', () => {
		it('should name the one subject a run is anchored to', async () => {
			// GIVEN a run linked to exactly one company
			const runId = await seedRun({
				pending_paid_actions: [action({ estimated_cents: 5 })],
			})
			const company = await pool.query<{ id: string }>(
				`INSERT INTO companies (organization_id, name, slug)
				 VALUES ($1, 'Sola SL', $2) RETURNING id`,
				[ORG, `sola-${randomUUID()}`],
			)
			const companyId = company.rows[0]!.id
			await pool.query(
				`INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
				 VALUES ($1, $2, 'companies', $3, 'input')`,
				[ORG, runId, companyId],
			)

			// THEN the decision can be made without opening the run
			const page = await listScoped({ researchId: runId })
			expect(page.items[0]?.subjectTable).toBe('companies')
			expect(page.items[0]?.subjectId).toBe(companyId)
			expect(page.items[0]?.subjectName).toBe('Sola SL')
		})

		it('should name nobody when a run is about several', async () => {
			// GIVEN a run linked to two companies
			const runId = await seedRun({
				pending_paid_actions: [action({ estimated_cents: 5 })],
			})
			for (const name of ['One SL', 'Two SL']) {
				const c = await pool.query<{ id: string }>(
					`INSERT INTO companies (organization_id, name, slug)
					 VALUES ($1, $2, $3) RETURNING id`,
					[ORG, name, `c-${randomUUID()}`],
				)
				await pool.query(
					`INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
					 VALUES ($1, $2, 'companies', $3, 'input')`,
					[ORG, runId, c.rows[0]!.id],
				)
			}

			// THEN none is picked at random and presented as the subject
			const page = await listScoped({ researchId: runId })
			expect(page.items[0]?.subjectTable).toBe(null)
			expect(page.items[0]?.subjectName).toBe(null)
		})

		it('should name nobody when a run is anchored to nothing', async () => {
			// GIVEN a run with no links at all
			const runId = await seedRun({
				pending_paid_actions: [action({ estimated_cents: 5 })],
			})

			// THEN the lookup still shows, with no subject against it
			const page = await listScoped({ researchId: runId })
			expect(page.items).toHaveLength(1)
			expect(page.items[0]?.subjectName).toBe(null)
		})
	})

	describe('when the queue is read a page at a time', () => {
		it('should say there is more without handing back the row that proves it', async () => {
			// GIVEN a run holding five waiting lookups
			const runId = await seedRun({
				pending_paid_actions: [1, 2, 3, 4, 5].map(n =>
					action({ estimated_cents: n }),
				),
			})

			// WHEN two are asked for
			// THEN two come back, and the caller is told more are waiting
			const first = await listScoped({ researchId: runId, limit: 2 })
			expect(first.items).toHaveLength(2)
			expect(first.hasMore).toBe(true)

			// AND the last page says there is nothing after it
			const last = await listScoped({ researchId: runId, limit: 2, offset: 4 })
			expect(last.items).toHaveLength(1)
			expect(last.hasMore).toBe(false)
		})

		it('should total the queue only when asked to', async () => {
			// GIVEN a run holding five waiting lookups
			const runId = await seedRun({
				pending_paid_actions: [1, 2, 3, 4, 5].map(n =>
					action({ estimated_cents: n }),
				),
			})

			// THEN an exact count reports every match, not just the page
			const exact = await listScoped({
				researchId: runId,
				limit: 2,
				count: 'exact',
			})
			expect(exact.total).toBe(5)

			// AND counting is skipped unless it was asked for
			const none = await listScoped({ researchId: runId, limit: 2 })
			expect(none.total).toBe(null)
		})

		it('should hold a nonsensical page size to something it can run', async () => {
			// GIVEN page sizes below, above and between what is allowed
			const runId = await seedRun({
				pending_paid_actions: [1, 2, 3].map(n =>
					action({ estimated_cents: n }),
				),
			})

			// THEN each is brought into range rather than reaching the database
			await expect(
				listScoped({ researchId: runId, limit: 0 }),
			).resolves.toBeTruthy()
			await expect(
				listScoped({ researchId: runId, limit: -5, offset: -1 }),
			).resolves.toBeTruthy()
			await expect(
				listScoped({ researchId: runId, limit: 10_000 }),
			).resolves.toBeTruthy()
		})
	})

	describe('when another organisation has a queue of its own', () => {
		it('should show nothing of it, even a price that cannot be read', async () => {
			// GIVEN another organisation holding a lookup priced in a fraction
			const theirs = await seedRun(
				{ pending_paid_actions: [action({ estimated_cents: 0.05 })] },
				{ org: OTHER_ORG },
			)

			// WHEN this organisation reads its queue
			// THEN their run is not in it, and asking for it directly finds nothing
			const page = await listScoped({ researchId: theirs })
			expect(page.items).toHaveLength(0)
		})
	})
})
