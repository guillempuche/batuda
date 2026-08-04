// Live-DB integration test for refusing a task assignee who does not work here.
// `tasks.assignee_id` is plain text with no foreign key, so nothing in the
// database objects to an id from another organisation or one the model invented
// — the write lands and the task then waits on nobody, appearing on no list.
// Both write paths are exercised: create_task goes through TaskService, while
// update_task writes the row itself, so each has to carry the rule separately.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import { TaskService } from '../../services/tasks'
import { TimelineActivityService } from '../../services/timeline-activity'
import { applyTestEnv } from '../../test-env'
import { TaskHandlersLive, TaskTools } from './tasks'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const MARKER = `assignee-verify-${randomUUID()}`

type Org = { id: string; name: string; slug: string }

const Handlers = TaskHandlersLive.pipe(
	Layer.provide(TaskService.layer),
	Layer.provide(TimelineActivityService.layer),
)
const makeRuntime = () =>
	ManagedRuntime.make(PgLive.pipe(Layer.provide(EnvVars.layer)))

let pool: pg.Pool
let runtime: ReturnType<typeof makeRuntime>
let taller: Org
let restaurant: Org
let colleague: string
let outsider: string

const orgBySlug = async (slug: string): Promise<Org> => {
	const r = await pool.query<Org>(
		'SELECT id, name, slug FROM organization WHERE slug = $1 LIMIT 1',
		[slug],
	)
	const row = r.rows[0]
	if (!row)
		throw new Error(
			`${slug} org missing — run 'pnpm cli db reset && pnpm cli seed'`,
		)
	return row
}

const anyMemberOf = async (orgId: string): Promise<string> => {
	const r = await pool.query<{ userId: string }>(
		'SELECT "userId" FROM member WHERE "organizationId" = $1 LIMIT 1',
		[orgId],
	)
	const id = r.rows[0]?.userId
	if (!id) throw new Error(`org ${orgId} has no members — run 'pnpm cli seed'`)
	return id
}

// Somebody who works in one organisation and not the other. People can belong to
// several, so a plain member of the restaurant may work in the workshop too.
const memberOnlyIn = async (orgId: string, notIn: string): Promise<string> => {
	const r = await pool.query<{ userId: string }>(
		`SELECT "userId" FROM member
		 WHERE "organizationId" = $1
			 AND "userId" NOT IN (SELECT "userId" FROM member WHERE "organizationId" = $2)
		 LIMIT 1`,
		[orgId, notIn],
	)
	const id = r.rows[0]?.userId
	if (!id)
		throw new Error(
			`no user belongs to ${orgId} alone — run 'pnpm cli db reset && pnpm cli seed'`,
		)
	return id
}

type Outcome = { ok: true; id: string | null } | { ok: false; message: string }

// Runs one tool the way the MCP server does, inside the workshop's RLS scope.
// Typed per tool rather than shared, so the toolkit's own parameter types still
// apply to what each case passes.
const runTool = <A, E>(
	body: Effect.Effect<A, E, CurrentOrg | SqlClient.SqlClient>,
): Promise<A> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org: taller, userId: colleague })(body)
		}),
	)

const collect = <E, R>(
	stream: Stream.Stream<{ readonly result: unknown }, E, R>,
): Effect.Effect<Outcome, never, R> =>
	Stream.runCollect(stream).pipe(
		Effect.map(([first]) => {
			const row = first?.result as { id?: string } | null
			return { ok: true as const, id: row?.id ?? null }
		}),
		Effect.catchCause(cause =>
			Effect.succeed({ ok: false as const, message: String(cause) }),
		),
	)

const createTask = (params: {
	title: string
	type: string
	assignee_id?: string | null
}): Promise<Outcome> =>
	runTool(
		Effect.gen(function* () {
			const toolkit = yield* TaskTools
			return yield* collect(yield* toolkit.handle('create_task', params))
		}).pipe(
			Effect.provide(Handlers),
			Effect.catchCause(cause =>
				Effect.succeed({ ok: false as const, message: String(cause) }),
			),
		),
	)

const updateTask = (params: {
	id: string
	assignee_id?: string | null
}): Promise<Outcome> =>
	runTool(
		Effect.gen(function* () {
			const toolkit = yield* TaskTools
			return yield* collect(yield* toolkit.handle('update_task', params))
		}).pipe(
			Effect.provide(Handlers),
			Effect.catchCause(cause =>
				Effect.succeed({ ok: false as const, message: String(cause) }),
			),
		),
	)

const assigneeOf = async (taskId: string): Promise<string | null> => {
	const r = await pool.query<{ assignee_id: string | null }>(
		'SELECT assignee_id FROM tasks WHERE id = $1',
		[taskId],
	)
	return r.rows[0]?.assignee_id ?? null
}

const countTasks = async (): Promise<number> => {
	const r = await pool.query<{ n: string }>(
		'SELECT count(*)::text AS n FROM tasks WHERE title LIKE $1',
		[`${MARKER}%`],
	)
	return Number(r.rows[0]?.n ?? 0)
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	runtime = makeRuntime()
	taller = await orgBySlug('taller')
	restaurant = await orgBySlug('restaurant')
	colleague = await anyMemberOf(taller.id)
	outsider = await memberOnlyIn(restaurant.id, taller.id)
})

afterAll(async () => {
	await pool.query('DELETE FROM tasks WHERE title LIKE $1', [`${MARKER}%`])
	await runtime.dispose()
	await pool.end()
})

describe('create_task assignee', () => {
	describe('when the task is given to a colleague', () => {
		it('should record them as the person it waits on', async () => {
			// GIVEN a task handed to somebody who works here
			const result = await createTask({
				title: `${MARKER}-ok`,
				type: 'todo',
				assignee_id: colleague,
			})

			// THEN it is theirs
			expect(result.ok).toBe(true)
			if (!result.ok || result.id === null) return
			expect(await assigneeOf(result.id)).toBe(colleague)
		})
	})

	describe('when the task names somebody from another organization', () => {
		it('should refuse it and create nothing', async () => {
			// GIVEN a task handed to somebody who works somewhere else
			const before = await countTasks()
			const result = await createTask({
				title: `${MARKER}-outsider`,
				type: 'todo',
				assignee_id: outsider,
			})

			// THEN it is turned away, saying where to look, and no task is left
			// behind waiting on nobody
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.message).toContain('not a member')
			expect(result.message).toContain('list_members')
			expect(await countTasks()).toBe(before)
		})
	})

	describe('when the assignee is an id the model invented', () => {
		it('should refuse it like any other stranger', async () => {
			const result = await createTask({
				title: `${MARKER}-invented`,
				type: 'todo',
				assignee_id: `no-such-user-${randomUUID()}`,
			})
			expect(result.ok).toBe(false)
		})
	})

	describe('when no assignee is given', () => {
		it('should create the task unassigned', async () => {
			// GIVEN work nobody is named on yet
			const result = await createTask({
				title: `${MARKER}-none`,
				type: 'todo',
			})

			// THEN it exists with nobody waiting on it
			expect(result.ok).toBe(true)
			if (!result.ok || result.id === null) return
			expect(await assigneeOf(result.id)).toBeNull()
		})
	})
})

describe('update_task assignee', () => {
	describe('when an existing task is handed to a colleague', () => {
		it('should record the new owner of the work', async () => {
			// GIVEN an unassigned task
			const created = await createTask({
				title: `${MARKER}-reassign`,
				type: 'todo',
			})
			if (!created.ok || created.id === null) throw new Error('setup failed')

			// WHEN it is handed over
			const result = await updateTask({
				id: created.id,
				assignee_id: colleague,
			})

			// THEN they are waiting on it
			expect(result.ok).toBe(true)
			expect(await assigneeOf(created.id)).toBe(colleague)
		})
	})

	describe('when an existing task is handed to an outsider', () => {
		it('should refuse it and leave the assignee as it was', async () => {
			// GIVEN a task already assigned to a colleague — this path writes the
			// row itself rather than going through the service, so it carries the
			// rule separately
			const created = await createTask({
				title: `${MARKER}-keep`,
				type: 'todo',
				assignee_id: colleague,
			})
			if (!created.ok || created.id === null) throw new Error('setup failed')

			// WHEN somebody from another organisation is named
			const result = await updateTask({
				id: created.id,
				assignee_id: outsider,
			})

			// THEN it is refused and the work still waits on the same person
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.message).toContain('not a member')
			expect(await assigneeOf(created.id)).toBe(colleague)
		})
	})

	describe('when the assignee is cleared', () => {
		it('should leave the task waiting on nobody', async () => {
			// GIVEN an assigned task
			const created = await createTask({
				title: `${MARKER}-clear`,
				type: 'todo',
				assignee_id: colleague,
			})
			if (!created.ok || created.id === null) throw new Error('setup failed')

			// WHEN the assignee is removed
			await updateTask({ id: created.id, assignee_id: null })

			// THEN nobody is on the hook for it
			expect(await assigneeOf(created.id)).toBeNull()
		})
	})
})
