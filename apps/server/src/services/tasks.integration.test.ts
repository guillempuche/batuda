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
import { type TaskFilters, type TaskPage, TaskService } from './tasks'
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

describe('TaskService.create', () => {
	describe('when invoked as app_user with a matching active org', () => {
		it('should stamp organization_id from CurrentOrg', async () => {
			// GIVEN role=app_user pinned to the taller org
			// WHEN a company-less task is created through the service
			const rows = (await createWith(
				tallerOrgId,
				tallerOrgId,
			)) as ReadonlyArray<{
				id: string
				organizationId: string
				companyId: string | null
				title: string
			}>

			// THEN the persisted row carries the active org id
			expect(rows[0]?.organizationId).toBe(tallerOrgId)
			// AND the company-less task persisted with a null company_id
			expect(rows[0]?.companyId).toBeNull()
			expect(rows[0]?.title).toBe(FIXTURE_TITLE)
			// [apps/server/src/services/tasks.ts — sql.insert organizationId]
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

const listWith = (org: string, filters: TaskFilters) => {
	const deps = Layer.mergeAll(
		TaskService.layer,
		Layer.succeed(CurrentOrg, { id: org, name: 'fixture', slug: 'fixture' }),
	).pipe(
		// TaskService now records onto the timeline, so it needs
		// TimelineActivityService; both resolve their SqlClient from PgLive.
		Layer.provideMerge(TimelineActivityService.layer),
		Layer.provideMerge(PgLive),
	)
	const page: TaskPage = { sort: 'due', limit: 100, offset: 0 }

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
			const rows = (await listWith(tallerOrgId, {
				assigneeId: assignee,
				completed: false,
			})) as ReadonlyArray<{ status: string }>

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
			const rows = (await listWith(tallerOrgId, {
				assigneeId: assignee,
				completed: true,
			})) as ReadonlyArray<{ status: string }>

			// THEN only the done task returns
			expect(rows.map(r => r.status)).toEqual(['done'])
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
