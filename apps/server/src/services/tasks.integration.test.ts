// Integration test for TaskService.create. Verifies the service stamps the
// active org's id on insert — the regression guard for the bug where the
// HTTP handler and MCP tool both omitted organization_id (TEXT NOT NULL,
// no DB default), so every create failed the not-null / org_isolation RLS
// WITH CHECK under role app_user. Also pins the RLS facets the stamp
// relies on: cross-org writes are rejected and created rows stay isolated.
//
// Prereq: `pnpm cli services up` (Postgres on $DATABASE_URL) and seeded
// `taller` + `restaurant` orgs (`pnpm cli db reset && pnpm cli seed`).

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../db/client'
import {
	type TaskDayBoundaries,
	type TaskFilters,
	type TaskPage,
	TaskService,
} from './tasks'
import { TimelineActivityService } from './timeline-activity'

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const TALLER_SLUG = 'taller'
const RESTAURANT_SLUG = 'restaurant'
const FIXTURE_TITLE = 'taskservice-create-fixture'

let pool: pg.Pool
let tallerOrgId: string
let restaurantOrgId: string

const orgIdBySlug = async (slug: string): Promise<string> => {
	const rows = await pool.query<{ id: string }>(
		`SELECT id FROM organization WHERE slug = $1 LIMIT 1`,
		[slug],
	)
	const id = rows.rows[0]?.id
	if (!id) {
		throw new Error(
			`${slug} org missing — run 'pnpm cli db reset && pnpm cli seed' before this test`,
		)
	}
	return id
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	// `SET LOCAL ROLE app_user` (below) needs the connecting user to be a
	// member of app_user — idempotent on already-granted dev containers.
	await pool.query('GRANT app_user TO CURRENT_USER')
	tallerOrgId = await orgIdBySlug(TALLER_SLUG)
	restaurantOrgId = await orgIdBySlug(RESTAURANT_SLUG)
}, 30_000)

afterAll(async () => {
	// Run as the connecting superuser (no role switch) so RLS doesn't gate
	// cleanup. timeline_activity has no FK to tasks, so clear it and the
	// task_events trail by the fixture title before the tasks themselves.
	await pool.query(
		`DELETE FROM timeline_activity WHERE entity_type = 'task' AND entity_id IN (SELECT id FROM tasks WHERE title = $1)`,
		[FIXTURE_TITLE],
	)
	await pool.query(
		`DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE title = $1)`,
		[FIXTURE_TITLE],
	)
	await pool.query(`DELETE FROM tasks WHERE title = $1`, [FIXTURE_TITLE])
	await pool.end()
})

// Runs TaskService.create as role app_user with app.current_org_id = `gucOrg`
// and CurrentOrg = `currentOrg` — the role + GUC OrgMiddleware establishes
// per request — so org_isolation engages exactly as in production. The
// transaction commits on success; afterAll removes the fixture rows.
const createWith = (
	gucOrg: string,
	currentOrg: string,
	data: Record<string, unknown> = {
		type: 'follow_up',
		title: FIXTURE_TITLE,
		status: 'open',
	},
) => {
	const deps = Layer.mergeAll(
		TaskService.layer,
		Layer.succeed(CurrentOrg, {
			id: currentOrg,
			name: 'fixture',
			slug: 'fixture',
		}),
	).pipe(
		// TaskService now records onto the timeline, so it needs
		// TimelineActivityService; both resolve their SqlClient from PgLive.
		Layer.provideMerge(TimelineActivityService.layer),
		Layer.provideMerge(PgLive),
	)

	return Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const tasks = yield* TaskService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${gucOrg}, true)`
				return yield* tasks.create(data, { id: null, kind: 'user' })
			}),
		)
	}).pipe(Effect.provide(deps), Effect.runPromise)
}

// Reads task ids carrying the fixture title visible under `org`'s GUC.
const visibleTaskIds = async (org: string): Promise<ReadonlyArray<string>> => {
	const client = await pool.connect()
	try {
		await client.query('BEGIN')
		await client.query('SET LOCAL ROLE app_user')
		await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
			org,
		])
		const rows = await client.query<{ id: string }>(
			`SELECT id FROM tasks WHERE title = $1`,
			[FIXTURE_TITLE],
		)
		await client.query('ROLLBACK')
		return rows.rows.map(r => r.id)
	} finally {
		client.release()
	}
}

// Reads the stored organization_id for a task, under `org`'s GUC. The service
// return no longer carries organization_id (the API never exposes it), so the
// stamp is asserted straight from the persisted row.
const orgIdOf = async (taskId: string, org: string): Promise<string | null> => {
	const client = await pool.connect()
	try {
		await client.query('BEGIN')
		await client.query('SET LOCAL ROLE app_user')
		await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
			org,
		])
		const rows = await client.query<{ organization_id: string }>(
			`SELECT organization_id FROM tasks WHERE id = $1`,
			[taskId],
		)
		await client.query('ROLLBACK')
		return rows.rows[0]?.organization_id ?? null
	} finally {
		client.release()
	}
}

describe('TaskService.create', () => {
	describe('when invoked as app_user with a matching active org', () => {
		it('should stamp organization_id from CurrentOrg', async () => {
			// GIVEN role=app_user pinned to the taller org
			// WHEN a company-less task is created through the service
			const rows = await createWith(tallerOrgId, tallerOrgId)
			const taskId = rows[0]?.id
			expect(taskId).toBeDefined()

			// THEN the persisted row carries the active org id
			expect(await orgIdOf(taskId as string, tallerOrgId)).toBe(tallerOrgId)
			// AND the company-less task persisted with a null company_id
			expect(rows[0]?.companyId).toBeNull()
			expect(rows[0]?.title).toBe(FIXTURE_TITLE)
		})
	})

	describe('when CurrentOrg disagrees with the active-org GUC', () => {
		it('should be rejected by org_isolation (cannot forge a cross-org task)', async () => {
			// GIVEN role=app_user pinned to taller but CurrentOrg = restaurant
			// WHEN create stamps the restaurant org while the GUC says taller
			const create = createWith(tallerOrgId, restaurantOrgId)

			// THEN the WITH CHECK predicate rejects the insert
			await expect(create).rejects.toThrow()
			// AND no restaurant-org fixture row leaked into taller's space
			expect(await visibleTaskIds(restaurantOrgId)).toHaveLength(0)
			// [apps/server/src/db/migrations/0001_initial.ts — org_isolation_tasks WITH CHECK]
		})
	})

	describe('when a created task is read under a different org', () => {
		it('should be visible to its own org and hidden from another', async () => {
			// GIVEN a task created under the taller org
			await createWith(tallerOrgId, tallerOrgId)

			// WHEN reading the fixture under each org's GUC
			const tallerVisible = await visibleTaskIds(tallerOrgId)
			const restaurantVisible = await visibleTaskIds(restaurantOrgId)

			// THEN taller sees it and restaurant does not (org_isolation USING)
			expect(tallerVisible.length).toBeGreaterThan(0)
			expect(restaurantVisible).toHaveLength(0)
			// [apps/server/src/db/migrations/0001_initial.ts — org_isolation_tasks USING]
		})
	})
})

const listWith = (
	org: string,
	filters: TaskFilters,
	pageOverrides: Partial<TaskPage> = {},
) => {
	const deps = Layer.mergeAll(
		TaskService.layer,
		Layer.succeed(CurrentOrg, { id: org, name: 'fixture', slug: 'fixture' }),
	).pipe(
		// TaskService now records onto the timeline, so it needs
		// TimelineActivityService; both resolve their SqlClient from PgLive.
		Layer.provideMerge(TimelineActivityService.layer),
		Layer.provideMerge(PgLive),
	)
	// These tests are about what the totals say, so they ask to be counted. A
	// caller that does not ask gets null back, which is the point of the flag.
	const page: TaskPage = {
		sort: 'due',
		limit: 100,
		offset: 0,
		count: 'exact',
		...pageOverrides,
	}

	return Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const tasks = yield* TaskService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${org}, true)`
				return yield* tasks.list(filters, page)
			}),
		)
	}).pipe(Effect.provide(deps), Effect.runPromise)
}

describe('TaskService.list', () => {
	describe('when filtering by completed status', () => {
		it('should treat completed=false as open work, excluding done AND cancelled', async () => {
			// GIVEN one open, one done, and one cancelled task for a unique assignee
			const assignee = `list-fixture-${randomUUID()}`
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: FIXTURE_TITLE,
				status: 'open',
				assigneeId: assignee,
			})
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: FIXTURE_TITLE,
				status: 'done',
				completedAt: new Date(),
				assigneeId: assignee,
			})
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: FIXTURE_TITLE,
				status: 'cancelled',
				assigneeId: assignee,
			})

			// WHEN listing that assignee's open work
			const rows = (
				await listWith(tallerOrgId, {
					assigneeId: assignee,
					completed: false,
				})
			).items as ReadonlyArray<{ status: string }>

			// THEN only the open task returns — a cancelled task is not "open work"
			expect(rows.map(r => r.status)).toEqual(['open'])
			// [apps/server/src/services/tasks.ts — completed=false → NOT IN ('done','cancelled')]
		})

		it('should map completed=true to status=done', async () => {
			// GIVEN an open and a done task for a unique assignee
			const assignee = `list-fixture-${randomUUID()}`
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: FIXTURE_TITLE,
				status: 'open',
				assigneeId: assignee,
			})
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: FIXTURE_TITLE,
				status: 'done',
				completedAt: new Date(),
				assigneeId: assignee,
			})

			// WHEN listing completed tasks for that assignee
			const rows = (
				await listWith(tallerOrgId, {
					assigneeId: assignee,
					completed: true,
				})
			).items as ReadonlyArray<{ status: string }>

			// THEN only the done task returns
			expect(rows.map(r => r.status)).toEqual(['done'])
		})
	})

	describe('when reporting how many tasks match', () => {
		it('should count every match, not just the ones on the page', async () => {
			// GIVEN three tasks for a unique assignee
			const assignee = `page-fixture-${randomUUID()}`
			for (const title of ['first', 'second', 'third']) {
				await createWith(tallerOrgId, tallerOrgId, {
					type: 'follow_up',
					title: `${FIXTURE_TITLE} ${title}`,
					status: 'open',
					assigneeId: assignee,
				})
			}

			// WHEN asking for a page that holds only one of them
			const page = await listWith(
				tallerOrgId,
				{ assigneeId: assignee },
				{ limit: 1, offset: 0 },
			)

			// THEN the page carries one task but reports all three as matching
			expect(page.items).toHaveLength(1)
			expect(page.total).toBe(3)
			expect(page.limit).toBe(1)
			expect(page.offset).toBe(0)
		})

		it('should say more follow without being asked to count', async () => {
			// GIVEN three tasks for a unique assignee
			const assignee = `page-fixture-${randomUUID()}`
			for (const title of ['first', 'second', 'third']) {
				await createWith(tallerOrgId, tallerOrgId, {
					type: 'follow_up',
					title,
					status: 'open',
					assigneeId: assignee,
				})
			}

			// WHEN asking for a page that holds one of them, uncounted
			const page = await listWith(
				tallerOrgId,
				{ assigneeId: assignee },
				{ limit: 1, offset: 0, count: 'none' },
			)

			// THEN nothing is counted, and yet the page still knows more follow.
			//      This is what lets a list that never asks for a total reach the
			//      end of itself at all.
			expect(page.total).toBeNull()
			expect(page.items).toHaveLength(1)
			expect(page.hasMore).toBe(true)
		})

		it('should not claim more when the page ends exactly on the last match', async () => {
			// GIVEN two tasks for a unique assignee
			const assignee = `page-fixture-${randomUUID()}`
			for (const title of ['first', 'second']) {
				await createWith(tallerOrgId, tallerOrgId, {
					type: 'follow_up',
					title,
					status: 'open',
					assigneeId: assignee,
				})
			}

			// WHEN asking for exactly as many rows as there are
			const page = await listWith(
				tallerOrgId,
				{ assigneeId: assignee },
				{ limit: 2, offset: 0, count: 'none' },
			)

			// THEN the list ends here. Getting this wrong by one costs a wasted
			// round trip that comes back empty, on every list, every time.
			expect(page.items).toHaveLength(2)
			expect(page.hasMore).toBe(false)
		})

		it('should hand back only the rows asked for when more exist', async () => {
			// GIVEN three tasks for a unique assignee
			const assignee = `page-fixture-${randomUUID()}`
			for (const title of ['first', 'second', 'third']) {
				await createWith(tallerOrgId, tallerOrgId, {
					type: 'follow_up',
					title,
					status: 'open',
					assigneeId: assignee,
				})
			}

			// WHEN asking for two of them
			const page = await listWith(
				tallerOrgId,
				{ assigneeId: assignee },
				{ limit: 2, offset: 0, count: 'none' },
			)

			// THEN two come back, not the spare row fetched to answer "is there
			// more" — that one is dropped before anybody sees it
			expect(page.items).toHaveLength(2)
			expect(page.hasMore).toBe(true)
		})

		it('should still report the total for a page past the last match', async () => {
			// GIVEN two tasks for a unique assignee
			const assignee = `page-fixture-${randomUUID()}`
			for (const title of ['first', 'second']) {
				await createWith(tallerOrgId, tallerOrgId, {
					type: 'follow_up',
					title: `${FIXTURE_TITLE} ${title}`,
					status: 'open',
					assigneeId: assignee,
				})
			}

			// WHEN asking for a page that starts beyond them
			const page = await listWith(
				tallerOrgId,
				{ assigneeId: assignee },
				{ limit: 10, offset: 50 },
			)

			// THEN the page is empty but still reports both as matching, so
			// "past the end" stays distinguishable from "nothing matches"
			expect(page.items).toHaveLength(0)
			expect(page.total).toBe(2)
		})

		it('should report nothing matching when the filters exclude everything', async () => {
			// GIVEN an assignee with no tasks at all
			const assignee = `page-fixture-${randomUUID()}`

			// WHEN listing their work
			const page = await listWith(tallerOrgId, { assigneeId: assignee })

			// THEN both the page and the total are empty
			expect(page.items).toHaveLength(0)
			expect(page.total).toBe(0)
		})

		it('should report nothing matching for a page past an empty result', async () => {
			// GIVEN an assignee with no tasks at all
			const assignee = `page-fixture-${randomUUID()}`

			// WHEN asking for a page beyond the (empty) result
			const page = await listWith(
				tallerOrgId,
				{ assigneeId: assignee },
				{ limit: 10, offset: 50 },
			)

			// THEN the separate count agrees there is genuinely nothing
			expect(page.items).toHaveLength(0)
			expect(page.total).toBe(0)
		})
	})

	describe('when a shelf is asked for without the day it refers to', () => {
		it('should go on hiding sleeping tasks rather than returning everything', async () => {
			// GIVEN one awake and one sleeping task for a unique assignee
			const assignee = `shelf-fixture-${randomUUID()}`
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} awake`,
				status: 'open',
				assigneeId: assignee,
				dueAt: new Date(),
			})
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} sleeping`,
				status: 'open',
				assigneeId: assignee,
				dueAt: new Date(),
				snoozedUntil: new Date(Date.now() + 3 * DAY_MS),
			})

			// WHEN a shelf is named but the day edges it needs are missing, so no
			// shelf can actually be applied
			const page = await listWith(tallerOrgId, {
				assigneeId: assignee,
				shelf: 'today',
			})

			// THEN the ordinary rule that hides sleeping work still holds — naming
			// a shelf must not switch every other filter off
			expect(page.total).toBe(1)
			expect(
				(page.items as ReadonlyArray<{ title: string }>).map(r =>
					r.title.split(' ').pop(),
				),
			).toEqual(['awake'])
		})
	})

	describe('when listing one shelf of the inbox', () => {
		it('should return only the tasks nobody has dated for noDue', async () => {
			// GIVEN one dated and one undated task for a unique assignee
			const assignee = `shelf-fixture-${randomUUID()}`
			const boundaries = boundariesAround(Date.now())
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} dated`,
				status: 'open',
				assigneeId: assignee,
				dueAt: new Date(),
			})
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} undated`,
				status: 'open',
				assigneeId: assignee,
			})

			// WHEN asking for the shelf of undated work
			const rows = (
				await listWith(tallerOrgId, {
					assigneeId: assignee,
					shelf: 'noDue',
					boundaries,
				})
			).items as ReadonlyArray<{ dueAt: unknown }>

			// THEN only the undated task comes back
			expect(rows).toHaveLength(1)
			expect(rows[0]?.dueAt).toBeNull()
		})

		it('should keep a task due earlier today on today rather than overdue', async () => {
			// GIVEN a task that was due this morning, with the day already underway
			const assignee = `shelf-fixture-${randomUUID()}`
			const boundaries = boundariesAround(Date.now())
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} this morning`,
				status: 'open',
				assigneeId: assignee,
				dueAt: new Date(Date.parse(boundaries.todayStart) + 3600_000),
			})

			// WHEN asking for each of the two shelves it could fall on
			const today = await listWith(tallerOrgId, {
				assigneeId: assignee,
				shelf: 'today',
				boundaries,
			})
			const overdue = await listWith(tallerOrgId, {
				assigneeId: assignee,
				shelf: 'overdue',
				boundaries,
			})

			// THEN the day it is due decides, so an hour late is not yet late
			expect(today.total).toBe(1)
			expect(overdue.total).toBe(0)
		})

		it('should report the same size the rail counts for that shelf', async () => {
			// GIVEN one task on each shelf, so none of them is trivially empty
			const boundaries = boundariesAround(Date.now())
			const day = Date.parse(boundaries.todayStart)
			for (const [label, data] of [
				['overdue', { dueAt: new Date(day - DAY_MS) }],
				['today', { dueAt: new Date(day + 3600_000) }],
				[
					'thisWeek',
					{ dueAt: new Date(Date.parse(boundaries.todayEnd) + 2 * DAY_MS) },
				],
				['later', { dueAt: new Date(Date.parse(boundaries.weekEnd) + DAY_MS) }],
				['noDue', {}],
				[
					'snoozed',
					{
						dueAt: new Date(day + 3600_000),
						snoozedUntil: new Date(Date.now() + 3 * DAY_MS),
					},
				],
			] as const) {
				await createWith(tallerOrgId, tallerOrgId, {
					type: 'follow_up',
					title: `${FIXTURE_TITLE} ${label}`,
					status: 'open',
					...data,
				})
			}
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} doneRecent`,
				status: 'done',
				completedAt: new Date(),
			})

			// WHEN each shelf is counted and then listed
			const counts = await countsWith(tallerOrgId, boundaries)
			const shelves = [
				'overdue',
				'today',
				'thisWeek',
				'later',
				'noDue',
				'snoozed',
				'doneRecent',
			] as const

			// THEN the number on the rail matches the rows behind it, every time
			for (const shelf of shelves) {
				const page = await listWith(
					tallerOrgId,
					{ shelf, boundaries },
					{ limit: 1 },
				)
				expect(counts[shelf]).toBeGreaterThan(0)
				expect(page.total).toBe(counts[shelf])
			}
		})
	})

	describe('when ordering the page', () => {
		it('should put the soonest deadline first for sort=due', async () => {
			// GIVEN three tasks dated out of order
			const assignee = `sort-fixture-${randomUUID()}`
			const now = Date.now()
			for (const [label, offset] of [
				['middle', 2 * DAY_MS],
				['last', 5 * DAY_MS],
				['first', 1 * DAY_MS],
			] as const) {
				await createWith(tallerOrgId, tallerOrgId, {
					type: 'follow_up',
					title: `${FIXTURE_TITLE} ${label}`,
					status: 'open',
					assigneeId: assignee,
					dueAt: new Date(now + offset),
				})
			}

			// WHEN listing them soonest-first
			const rows = (
				await listWith(tallerOrgId, { assigneeId: assignee }, { sort: 'due' })
			).items as ReadonlyArray<{ title: string }>

			// THEN the nearest deadline leads and the furthest trails
			expect(rows.map(r => r.title.split(' ').pop())).toEqual([
				'first',
				'middle',
				'last',
			])
		})

		it('should put the furthest deadline first for sort=recent', async () => {
			// GIVEN three tasks dated out of order
			const assignee = `sort-fixture-${randomUUID()}`
			const now = Date.now()
			for (const [label, offset] of [
				['middle', 2 * DAY_MS],
				['last', 5 * DAY_MS],
				['first', 1 * DAY_MS],
			] as const) {
				await createWith(tallerOrgId, tallerOrgId, {
					type: 'follow_up',
					title: `${FIXTURE_TITLE} ${label}`,
					status: 'open',
					assigneeId: assignee,
					dueAt: new Date(now + offset),
				})
			}

			// WHEN listing them newest-first
			const rows = (
				await listWith(
					tallerOrgId,
					{ assigneeId: assignee },
					{ sort: 'recent' },
				)
			).items as ReadonlyArray<{ title: string }>

			// THEN the order is the exact reverse of the soonest-first one
			expect(rows.map(r => r.title.split(' ').pop())).toEqual([
				'last',
				'middle',
				'first',
			])
		})
	})
})

const countsWith = (org: string, boundaries: TaskDayBoundaries) => {
	const deps = Layer.mergeAll(
		TaskService.layer,
		Layer.succeed(CurrentOrg, { id: org, name: 'fixture', slug: 'fixture' }),
	).pipe(
		Layer.provideMerge(TimelineActivityService.layer),
		Layer.provideMerge(PgLive),
	)

	return Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const tasks = yield* TaskService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${org}, true)`
				return yield* tasks.counts(boundaries)
			}),
		)
	}).pipe(Effect.provide(deps), Effect.runPromise)
}

const DAY_MS = 86_400_000

// The day and week edges a browser would send, taken from the machine running
// the test.
const boundariesAround = (reference: number): TaskDayBoundaries => {
	const start = new Date(reference)
	start.setHours(0, 0, 0, 0)
	const end = new Date(reference)
	end.setHours(23, 59, 59, 999)
	return {
		todayStart: start.toISOString(),
		todayEnd: end.toISOString(),
		weekEnd: new Date(end.getTime() + 7 * DAY_MS).toISOString(),
	}
}

// Counts cover the whole organization and the seeded org already holds tasks,
// so each test compares before/after instead of pinning an absolute number.
describe('TaskService.counts', () => {
	describe('when a task sits in each stretch of time', () => {
		it('should add it to the shelf its due date falls in', async () => {
			// GIVEN the counts before anything is added
			const boundaries = boundariesAround(Date.now())
			const before = await countsWith(tallerOrgId, boundaries)

			// WHEN one task lands in each dated shelf, plus one with no date
			const dueDates: ReadonlyArray<[string, Date]> = [
				['overdue', new Date(Date.parse(boundaries.todayStart) - DAY_MS)],
				['today', new Date(Date.parse(boundaries.todayStart) + 3600_000)],
				['thisWeek', new Date(Date.parse(boundaries.todayEnd) + 2 * DAY_MS)],
				['later', new Date(Date.parse(boundaries.weekEnd) + DAY_MS)],
			]
			for (const [shelf, dueAt] of dueDates) {
				await createWith(tallerOrgId, tallerOrgId, {
					type: 'follow_up',
					title: `${FIXTURE_TITLE} ${shelf}`,
					status: 'open',
					dueAt,
				})
			}
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} noDue`,
				status: 'open',
			})

			// THEN each shelf grew by exactly one
			const after = await countsWith(tallerOrgId, boundaries)
			expect(after.overdue).toBe(before.overdue + 1)
			expect(after.today).toBe(before.today + 1)
			expect(after.thisWeek).toBe(before.thisWeek + 1)
			expect(after.later).toBe(before.later + 1)
			expect(after.noDue).toBe(before.noDue + 1)
		})
	})

	describe('when a task is due at the very start of today', () => {
		it('should count it as today rather than overdue', async () => {
			// GIVEN the counts before anything is added
			const boundaries = boundariesAround(Date.now())
			const before = await countsWith(tallerOrgId, boundaries)

			// WHEN a task falls exactly on the boundary between the two shelves
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} boundary`,
				status: 'open',
				dueAt: new Date(boundaries.todayStart),
			})

			// THEN the day it is due wins, so nothing reads as already late
			const after = await countsWith(tallerOrgId, boundaries)
			expect(after.today).toBe(before.today + 1)
			expect(after.overdue).toBe(before.overdue)
		})
	})

	describe('when a task is not waiting to be worked', () => {
		it('should keep a sleeping task off its date shelf', async () => {
			// GIVEN the counts before anything is added
			const boundaries = boundariesAround(Date.now())
			const before = await countsWith(tallerOrgId, boundaries)

			// WHEN a task due today is snoozed into next week
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} snoozed`,
				status: 'open',
				dueAt: new Date(Date.parse(boundaries.todayStart) + 3600_000),
				snoozedUntil: new Date(Date.now() + 3 * DAY_MS),
			})

			// THEN it shows up as sleeping instead of as today's work
			const after = await countsWith(tallerOrgId, boundaries)
			expect(after.snoozed).toBe(before.snoozed + 1)
			expect(after.today).toBe(before.today)
		})

		it('should keep a finished task off its date shelf', async () => {
			// GIVEN the counts before anything is added
			const boundaries = boundariesAround(Date.now())
			const before = await countsWith(tallerOrgId, boundaries)

			// WHEN a task due today is already done
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} finished`,
				status: 'done',
				completedAt: new Date(),
				dueAt: new Date(Date.parse(boundaries.todayStart) + 3600_000),
			})

			// THEN it counts as recently finished, not as today's work
			const after = await countsWith(tallerOrgId, boundaries)
			expect(after.doneRecent).toBe(before.doneRecent + 1)
			expect(after.today).toBe(before.today)
		})

		it('should leave a cancelled task off every shelf', async () => {
			// GIVEN the counts before anything is added
			const boundaries = boundariesAround(Date.now())
			const before = await countsWith(tallerOrgId, boundaries)

			// WHEN a task due today is cancelled instead of worked
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} cancelled`,
				status: 'cancelled',
				dueAt: new Date(Date.parse(boundaries.todayStart) + 3600_000),
			})

			// THEN nothing about the inbox changes
			const after = await countsWith(tallerOrgId, boundaries)
			expect(after).toEqual(before)
		})
	})

	describe('when a sleeping task is not simply untouched', () => {
		it('should still count it as snoozed once work has started on it', async () => {
			// GIVEN the counts before anything is added
			const boundaries = boundariesAround(Date.now())
			const before = await countsWith(tallerOrgId, boundaries)

			// WHEN a task someone already started is put to sleep
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} started then snoozed`,
				status: 'in_progress',
				dueAt: new Date(Date.parse(boundaries.todayStart) + 3600_000),
				snoozedUntil: new Date(Date.now() + 3 * DAY_MS),
			})

			// THEN it sits on the sleeping shelf rather than falling off all of them
			const after = await countsWith(tallerOrgId, boundaries)
			expect(after.snoozed).toBe(before.snoozed + 1)
			const shelves = [
				'overdue',
				'today',
				'thisWeek',
				'later',
				'noDue',
				'doneRecent',
			] as const
			for (const shelf of shelves) {
				expect(after[shelf]).toBe(before[shelf])
			}
		})
	})

	describe('when another organization holds the tasks', () => {
		it('should count only the ones the active org can see', async () => {
			// GIVEN a task due today in the taller org
			const boundaries = boundariesAround(Date.now())
			const before = await countsWith(restaurantOrgId, boundaries)
			await createWith(tallerOrgId, tallerOrgId, {
				type: 'follow_up',
				title: `${FIXTURE_TITLE} isolation`,
				status: 'open',
				dueAt: new Date(Date.parse(boundaries.todayStart) + 3600_000),
			})

			// WHEN the other org counts its own shelves
			const after = await countsWith(restaurantOrgId, boundaries)

			// THEN it sees none of the neighbour's work
			expect(after).toEqual(before)
		})
	})
})

// Runs a TaskService method as app_user and reports the failure tag (or null
// on success) — lets the transition guards assert their tagged errors without
// unwrapping Effect causes.
const attempt = (
	org: string,
	body: Effect.Effect<unknown, unknown, CurrentOrg | TaskService>,
): Promise<{ failedWith: string | null }> => {
	const deps = Layer.mergeAll(
		TaskService.layer,
		Layer.succeed(CurrentOrg, { id: org, name: 'fixture', slug: 'fixture' }),
	).pipe(
		// TaskService now records onto the timeline, so it needs
		// TimelineActivityService; both resolve their SqlClient from PgLive.
		Layer.provideMerge(TimelineActivityService.layer),
		Layer.provideMerge(PgLive),
	)

	return Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${org}, true)`
				return yield* body.pipe(
					Effect.match({
						onFailure: e => ({
							failedWith: (e as { _tag?: string })._tag ?? 'error',
						}),
						onSuccess: () => ({ failedWith: null as string | null }),
					}),
				)
			}),
		)
	}).pipe(Effect.provide(deps), Effect.runPromise)
}

const seedTask = async (data: Record<string, unknown>): Promise<string> => {
	const rows = (await createWith(tallerOrgId, tallerOrgId, {
		type: 'follow_up',
		title: FIXTURE_TITLE,
		...data,
	})) as ReadonlyArray<{ id: string }>
	const row = rows[0]
	if (!row) throw new Error('fixture task was not created')
	return row.id
}

// Runs a method under role app_user + the org GUC and returns its value
// (failures die). Use `attempt` instead when asserting a tagged failure.
const runScoped = <A>(
	org: string,
	body: Effect.Effect<A, unknown, CurrentOrg | TaskService>,
): Promise<A> => {
	const deps = Layer.mergeAll(
		TaskService.layer,
		Layer.succeed(CurrentOrg, { id: org, name: 'fixture', slug: 'fixture' }),
	).pipe(
		Layer.provideMerge(TimelineActivityService.layer),
		Layer.provideMerge(PgLive),
	)

	return Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${org}, true)`
				return yield* body
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)
}

describe('TaskService transitions', () => {
	describe('cancel', () => {
		it('should reject cancelling a task that is already done', async () => {
			// GIVEN a done task
			const id = await seedTask({ status: 'done', completedAt: new Date() })

			// WHEN cancelling it
			const result = await attempt(
				tallerOrgId,
				Effect.gen(function* () {
					const tasks = yield* TaskService
					return yield* tasks.cancel(id, { id: null, kind: 'user' })
				}),
			)

			// THEN it is rejected with Conflict (reopen it first to cancel)
			expect(result.failedWith).toBe('Conflict')
			// [apps/server/src/services/tasks.ts — cancel done-guard]
		})
	})

	describe('snooze', () => {
		it('should reject a snooze timer in the past', async () => {
			// GIVEN an open task
			const id = await seedTask({ status: 'open' })

			// WHEN snoozing it to a past timestamp
			const result = await attempt(
				tallerOrgId,
				Effect.gen(function* () {
					const tasks = yield* TaskService
					return yield* tasks.snooze(id, new Date(Date.now() - 60_000), {
						id: null,
						kind: 'user',
					})
				}),
			)

			// THEN it is rejected with BadRequest
			expect(result.failedWith).toBe('BadRequest')
			// [apps/server/src/services/tasks.ts — snooze future guard]
		})
	})

	describe('complete', () => {
		it('should report NotFound for a missing task id', async () => {
			// GIVEN an id that does not exist
			// WHEN completing it
			const result = await attempt(
				tallerOrgId,
				Effect.gen(function* () {
					const tasks = yield* TaskService
					return yield* tasks.complete(randomUUID(), { id: null, kind: 'user' })
				}),
			)

			// THEN it fails with NotFound
			expect(result.failedWith).toBe('NotFound')
			// [apps/server/src/services/tasks.ts — complete NotFound]
		})
	})
})

describe('TaskService task_events', () => {
	it('should record a created event and a status-change event for a task', async () => {
		// GIVEN a freshly created task (createWith records it as a 'user' actor)
		const created = (await createWith(tallerOrgId, tallerOrgId, {
			type: 'follow_up',
			title: FIXTURE_TITLE,
			status: 'open',
		})) as ReadonlyArray<{ id: string }>
		const taskId = created[0]?.id
		if (!taskId) throw new Error('fixture task was not created')

		// WHEN it is completed through the service as an agent
		await attempt(
			tallerOrgId,
			Effect.gen(function* () {
				const tasks = yield* TaskService
				return yield* tasks.complete(taskId, { id: null, kind: 'agent' })
			}),
		)

		// THEN both events are on the audit trail GET /tasks/:id/events reads
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			await client.query('SET LOCAL ROLE app_user')
			await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
				tallerOrgId,
			])
			const events = await client.query<{
				change: unknown
				actor_kind: string
			}>(
				`SELECT change, actor_kind FROM task_events WHERE task_id = $1 ORDER BY at ASC`,
				[taskId],
			)
			await client.query('ROLLBACK')

			expect(events.rows).toHaveLength(2)
			expect(events.rows[0]?.change).toEqual({ kind: 'created' })
			expect(events.rows[0]?.actor_kind).toBe('user')
			expect(events.rows[1]?.change).toEqual({ status: ['open', 'done'] })
			expect(events.rows[1]?.actor_kind).toBe('agent')
			// [apps/server/src/services/tasks.ts — recordEvent]
		} finally {
			client.release()
		}
	})
})

describe('TaskService timeline activity', () => {
	it('should record task_created then task_completed on the company timeline', async () => {
		// GIVEN a freshly created company-less task (create records TaskCreated)
		const created = (await createWith(tallerOrgId, tallerOrgId, {
			type: 'follow_up',
			title: FIXTURE_TITLE,
			status: 'open',
		})) as ReadonlyArray<{ id: string }>
		const taskId = created[0]?.id
		if (!taskId) throw new Error('fixture task was not created')

		// WHEN it is completed through the service
		await attempt(
			tallerOrgId,
			Effect.gen(function* () {
				const tasks = yield* TaskService
				return yield* tasks.complete(taskId, { id: null, kind: 'agent' })
			}),
		)

		// THEN both activities land on the timeline for the task, with a null
		// company_id — company-less tasks still appear
		// [apps/server/src/services/tasks.ts — timeline.record on create + complete]
		const activities = await pool.query<{
			kind: string
			company_id: string | null
		}>(
			`SELECT kind, company_id FROM timeline_activity
			 WHERE entity_type = 'task' AND entity_id = $1::uuid
			 ORDER BY occurred_at ASC`,
			[taskId],
		)
		expect(activities.rows.map(r => r.kind)).toEqual([
			'task_created',
			'task_completed',
		])
		expect(activities.rows[0]?.company_id).toBeNull()
	})
})

describe('TaskService snooze/reschedule events', () => {
	it('should append a field-diff event for snooze and for reschedule', async () => {
		// GIVEN an open task
		const id = await seedTask({ status: 'open' })

		// WHEN it is snoozed to the future then rescheduled, as an agent
		await attempt(
			tallerOrgId,
			Effect.gen(function* () {
				const tasks = yield* TaskService
				return yield* tasks.snooze(id, new Date(Date.now() + 3_600_000), {
					id: null,
					kind: 'agent',
				})
			}),
		)
		await attempt(
			tallerOrgId,
			Effect.gen(function* () {
				const tasks = yield* TaskService
				return yield* tasks.reschedule(id, new Date(Date.now() + 7_200_000), {
					id: null,
					kind: 'agent',
				})
			}),
		)

		// THEN both transitions appended events — previously snooze and
		// reschedule wrote nothing to the undo trail
		// [apps/server/src/services/tasks.ts — recordTaskUpdate on snooze/reschedule]
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			await client.query('SET LOCAL ROLE app_user')
			await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
				tallerOrgId,
			])
			const events = await client.query<{ change: Record<string, unknown> }>(
				`SELECT change FROM task_events WHERE task_id = $1 ORDER BY at ASC`,
				[id],
			)
			await client.query('ROLLBACK')

			const keys = events.rows.flatMap(r => Object.keys(r.change))
			expect(keys).toContain('snoozedUntil')
			expect(keys).toContain('dueAt')
		} finally {
			client.release()
		}
	})
})

describe('TaskService.get', () => {
	it('should return the task for its own org', async () => {
		// GIVEN a seeded task
		const id = await seedTask({ status: 'open' })

		// WHEN fetched through the service under that org
		const row = (await runScoped(
			tallerOrgId,
			Effect.gen(function* () {
				const tasks = yield* TaskService
				return yield* tasks.get(id)
			}),
		)) as { id: string }

		// THEN it returns the row
		expect(row.id).toBe(id)
		// [apps/server/src/services/tasks.ts — get]
	})

	it('should report NotFound for a missing id', async () => {
		// GIVEN an id that does not exist
		// WHEN fetched
		const result = await attempt(
			tallerOrgId,
			Effect.gen(function* () {
				const tasks = yield* TaskService
				return yield* tasks.get(randomUUID())
			}),
		)

		// THEN it fails with NotFound
		expect(result.failedWith).toBe('NotFound')
		// [apps/server/src/services/tasks.ts — get NotFound]
	})
})

describe('TaskService.update', () => {
	it('should apply a field change without an If-Match', async () => {
		// GIVEN an open task
		const id = await seedTask({ status: 'open' })

		// WHEN its priority is changed through the service (the title stays the
		// fixture so afterAll still cleans it up)
		await runScoped(
			tallerOrgId,
			Effect.gen(function* () {
				const tasks = yield* TaskService
				return yield* tasks.update(
					id,
					{ priority: 'high' },
					{ id: null, kind: 'user' },
				)
			}),
		)

		// THEN the committed row reflects the change
		const after = await pool.query<{ priority: string | null }>(
			`SELECT priority FROM tasks WHERE id = $1`,
			[id],
		)
		expect(after.rows[0]?.priority).toBe('high')
		// [apps/server/src/services/tasks.ts — update]
	})

	it('should reject a stale If-Match with Conflict', async () => {
		// GIVEN an open task
		const id = await seedTask({ status: 'open' })

		// WHEN updated with an If-Match that can't match the row's updated_at
		const result = await attempt(
			tallerOrgId,
			Effect.gen(function* () {
				const tasks = yield* TaskService
				return yield* tasks.update(
					id,
					{ title: FIXTURE_TITLE },
					{ id: null, kind: 'user' },
					'1970-01-01T00:00:00.000Z',
				)
			}),
		)

		// THEN it fails Conflict — and the freshness check read `updatedAt`
		// (camelCase) without throwing on a missing `updated_at` column
		expect(result.failedWith).toBe('Conflict')
		// [apps/server/src/services/tasks.ts — update If-Match gate]
	})
})

describe('TaskService.bulkComplete', () => {
	it('should complete the given tasks and report the count', async () => {
		// GIVEN two open tasks
		const a = await seedTask({ status: 'open' })
		const b = await seedTask({ status: 'open' })

		// WHEN bulk-completed through the service
		const result = (await runScoped(
			tallerOrgId,
			Effect.gen(function* () {
				const tasks = yield* TaskService
				return yield* tasks.bulkComplete([a, b])
			}),
		)) as { completed: number; ids: ReadonlyArray<string> }

		// THEN both are reported and persisted as done
		expect(result.completed).toBe(2)
		const statuses = await pool.query<{ status: string }>(
			`SELECT status FROM tasks WHERE id = ANY($1)`,
			[[a, b]],
		)
		expect(statuses.rows.map(r => r.status)).toEqual(['done', 'done'])
		// [apps/server/src/services/tasks.ts — bulkComplete]
	})
})

describe('tasks organization_id contract', () => {
	const asAppUser = async <T>(
		org: string,
		fn: (client: pg.PoolClient) => Promise<T>,
	): Promise<T> => {
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			await client.query('SET LOCAL ROLE app_user')
			await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
				org,
			])
			const result = await fn(client)
			await client.query('ROLLBACK')
			return result
		} finally {
			client.release()
		}
	}

	describe('when a task is inserted without organization_id', () => {
		it('should be rejected under role app_user', () =>
			asAppUser(tallerOrgId, async client => {
				// GIVEN role=app_user pinned to the taller org
				// WHEN inserting a task that omits organization_id (the pre-fix shape)
				const insert = client.query(
					`INSERT INTO tasks (type, title, status) VALUES ('follow_up', $1, 'open')`,
					[FIXTURE_TITLE],
				)

				// THEN Postgres rejects it — not-null + org_isolation WITH CHECK
				await expect(insert).rejects.toThrow()
				// [apps/server/src/db/migrations/0001_initial.ts:387 — organization_id NOT NULL + WITH CHECK]
			}))
	})
})
