// Exercises create_contact and update_contact through the real toolkit handlers,
// inside the same org RLS scope (`enterOrgScope`) the /mcp middleware applies.
//
// What it pins is the one way a job title is absent. A form clears the box and
// sends blank, a caller with nothing to put there leaves the field out, and a
// caller taking a wrong title back off sends null — three ways of saying the
// same thing, which the column must not keep three ways. Only a real database
// can show what was written down. Requires $DATABASE_URL.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import type { Tool } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import { applyTestEnv } from '../../test-env'
import { ContactHandlersLive, ContactTools } from './contacts'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
// Namespaces every row this suite creates so cleanup never touches seed data.
const MARKER = `title-verify-${randomUUID()}-`

type Org = { id: string; name: string; slug: string }
type Tools = typeof ContactTools.tools

const makeRuntime = () =>
	ManagedRuntime.make(PgLive.pipe(Layer.provide(EnvVars.layer)))

let pool: pg.Pool
let runtime: ReturnType<typeof makeRuntime>
let org: Org
let ownerId: string
let companyId: string

const callInOrg = <A, E>(
	body: Effect.Effect<A, E, CurrentOrg | SqlClient.SqlClient>,
): Promise<A> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org, userId: ownerId })(body)
		}),
	)

const runTool = <K extends 'create_contact' | 'update_contact'>(
	name: K,
	params: Tool.Parameters<Tools[K]>,
): Promise<{ readonly id: string }> =>
	callInOrg(
		Effect.gen(function* () {
			const toolkit = yield* ContactTools
			const stream = yield* toolkit.handle(name, params)
			const [first] = yield* Stream.runCollect(stream)
			if (first === undefined) return yield* Effect.die(new Error('no result'))
			return first.result as { readonly id: string }
		}).pipe(Effect.provide(ContactHandlersLive)),
	)

// Read from the table rather than from what the tool answered: the question is
// what a later reader of this column will find.
const titleOf = async (id: string): Promise<string | null> => {
	const found = await pool.query<{ role: string | null }>(
		'SELECT role FROM contacts WHERE id = $1::uuid',
		[id],
	)
	return found.rows[0]?.role ?? null
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	await pool.query('GRANT app_user TO CURRENT_USER')
	runtime = makeRuntime()

	const found = await pool.query<Org>(
		'SELECT id, name, slug FROM organization WHERE slug = $1 LIMIT 1',
		['taller'],
	)
	if (!found.rows[0])
		throw new Error(
			"taller org missing — run 'pnpm cli db reset && pnpm cli seed'",
		)
	org = found.rows[0]

	const member = await pool.query<{ userId: string }>(
		'SELECT "userId" FROM member WHERE "organizationId" = $1 LIMIT 1',
		[org.id],
	)
	if (!member.rows[0])
		throw new Error("taller has no members — run 'pnpm cli seed'")
	ownerId = member.rows[0].userId

	const c = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, $3) RETURNING id`,
		[org.id, `${MARKER}co`, `${MARKER}Fusteria`],
	)
	companyId = c.rows[0]!.id
}, 30_000)

afterAll(async () => {
	await pool.query('DELETE FROM contacts WHERE name LIKE $1', [`${MARKER}%`])
	await pool.query('DELETE FROM companies WHERE slug = $1', [`${MARKER}co`])
	await runtime.dispose()
	await pool.end()
})

describe('the job title on a person', () => {
	describe('when somebody is created with no title at all', () => {
		it('should store nothing rather than a blank', async () => {
			// GIVEN a caller that has a name and no title
			// WHEN the person is created
			const created = await runTool('create_contact', {
				company_id: companyId,
				name: `${MARKER}No Title`,
			})

			// THEN the column holds nothing. Blank would pass every check for having
			// a title, so the absence would stop reading as an absence
			expect(await titleOf(created.id)).toBeNull()
		})
	})

	describe('when somebody is created with a title that is only spaces', () => {
		it('should store nothing rather than the spaces', async () => {
			// GIVEN a title that looks filled in and says nothing
			// WHEN the person is created
			const created = await runTool('create_contact', {
				company_id: companyId,
				name: `${MARKER}Spaces`,
				role: '   ',
			})

			// THEN it reads the same as never having been given one
			expect(await titleOf(created.id)).toBeNull()
		})
	})

	describe('when a title is taken back off', () => {
		it('should store nothing, and leave the name alone', async () => {
			// GIVEN somebody on file with a title
			const created = await runTool('create_contact', {
				company_id: companyId,
				name: `${MARKER}Wrong Title`,
				role: 'Cap de compres',
			})
			expect(await titleOf(created.id)).toBe('Cap de compres')

			// WHEN the title turns out to be wrong and is cleared
			await runTool('update_contact', { id: created.id, role: null })

			// THEN it is gone — a title can be withdrawn, not only replaced
			expect(await titleOf(created.id)).toBeNull()
			const still = await pool.query<{ name: string }>(
				'SELECT name FROM contacts WHERE id = $1::uuid',
				[created.id],
			)
			expect(still.rows[0]?.name).toBe(`${MARKER}Wrong Title`)
		})
	})

	describe('when a title is sent blank on an update', () => {
		it('should store nothing rather than a blank', async () => {
			// GIVEN somebody on file with a title
			const created = await runTool('create_contact', {
				company_id: companyId,
				name: `${MARKER}Cleared`,
				role: 'Gerent',
			})

			// WHEN a caller sends the emptied box straight through
			await runTool('update_contact', { id: created.id, role: '' })

			// THEN it lands as nothing, the same as null: a form that clears a box and
			// a caller that says null mean one thing
			expect(await titleOf(created.id)).toBeNull()
		})
	})

	describe('when an update names everything but the title', () => {
		it('should leave the title alone', async () => {
			// GIVEN somebody on file with a title
			const created = await runTool('create_contact', {
				company_id: companyId,
				name: `${MARKER}Untouched`,
				role: 'Enginyera',
			})

			// WHEN something else about them changes
			await runTool('update_contact', {
				id: created.id,
				name: `${MARKER}Untouched Renamed`,
			})

			// THEN the title is still there. Leaving a field out means "don't touch",
			// and treating it as a clear would wipe a title on every unrelated edit
			expect(await titleOf(created.id)).toBe('Enginyera')
		})
	})
})
