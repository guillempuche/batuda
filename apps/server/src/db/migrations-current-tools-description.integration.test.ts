// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from './client.js'
import addDescription from './migrations/0070_current_tools_description'

// Migration 0069 declared `current_tools` on every organisation it copied a
// value for, but left `description` blank, so a research run had nothing to
// tell it what the key is for. This migration fills that in — only on the
// row 0069 made, and only while nobody has written their own words onto it.

const DATABASE_URL = process.env['DATABASE_URL'] as string

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(
		effect.pipe(Effect.provide(PgLive), Effect.orDie) as Effect.Effect<A>,
	)

let pool: pg.Pool
const orgs: Array<string> = []

const newOrg = () => {
	const id = `desc-mig-${randomUUID()}`
	orgs.push(id)
	return id
}

const seedStack = async (orgId: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO instruction_stacks (organization_id, owner_user_id, agent, name, is_default)
		 VALUES ($1, NULL, 'research', $2, true) RETURNING id`,
		[orgId, `st-${randomUUID()}`],
	)
	return r.rows[0]?.id as string
}

const declare = async (
	orgId: string,
	stackId: string,
	key: string,
	createdBy: string,
	description: string | null,
): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO research_attributes
			(organization_id, stack_id, key, label, kind, is_active, created_by, description)
		 VALUES ($1, $2, $3, $3, 'text', true, $4, $5)
		 RETURNING id`,
		[orgId, stackId, key, createdBy, description],
	)
	return r.rows[0]?.id as string
}

const readDescription = async (id: string): Promise<string | null> => {
	const r = await pool.query<{ description: string | null }>(
		`SELECT description FROM research_attributes WHERE id = $1`,
		[id],
	)
	return r.rows[0]?.description ?? null
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	await pool.query('GRANT app_user TO CURRENT_USER')
})

afterAll(async () => {
	for (const org of orgs) {
		await pool.query(
			`DELETE FROM research_attributes WHERE organization_id = $1`,
			[org],
		)
		await pool.query(
			`DELETE FROM instruction_stacks WHERE organization_id = $1`,
			[org],
		)
	}
	await pool.end()
})

describe('migration 0070: describing the copied current_tools declaration', () => {
	describe('when a declaration was made by migration 0069 with no description', () => {
		it('should fill it in', async () => {
			// GIVEN a declaration migration 0069 would have left blank
			const org = newOrg()
			const stack = await seedStack(org)
			const id = await declare(
				org,
				stack,
				'current_tools',
				'migration-0069',
				null,
			)

			// WHEN the migration runs
			await run(addDescription)

			// THEN the declaration reads what a research run should look for
			expect(await readDescription(id)).toBe(
				'Software and systems the company says it uses in its own work, named on its pages — never the products it makes or sells.',
			)
		})
	})

	describe('when a declaration already carries its own description', () => {
		it('should leave it untouched', async () => {
			// GIVEN a row made by the same migration, but already described by hand
			const org = newOrg()
			const stack = await seedStack(org)
			const id = await declare(
				org,
				stack,
				'current_tools',
				'migration-0069',
				'What the company already runs day to day.',
			)

			// WHEN the migration runs
			await run(addDescription)

			// THEN the hand-written words survive
			expect(await readDescription(id)).toBe(
				'What the company already runs day to day.',
			)
		})
	})

	describe('when a declaration was not made by this migration', () => {
		it('should leave a blank description alone', async () => {
			// GIVEN a declaration an admin made with no description of their own
			const org = newOrg()
			const stack = await seedStack(org)
			const id = await declare(org, stack, 'crm', 'u1', null)

			// WHEN the migration runs
			await run(addDescription)

			// THEN it is not this migration's to fill in
			expect(await readDescription(id)).toBeNull()
		})
	})

	describe('when it runs a second time', () => {
		it('should change nothing it changed the first time', async () => {
			// GIVEN one row this migration fills and one it leaves alone
			const org = newOrg()
			const stack = await seedStack(org)
			const filled = await declare(
				org,
				stack,
				'current_tools',
				'migration-0069',
				null,
			)
			const kept = await declare(
				org,
				stack,
				'own_words',
				'migration-0069',
				'Already said.',
			)
			await run(addDescription)
			const once = [await readDescription(filled), await readDescription(kept)]

			// WHEN it runs again
			await run(addDescription)

			// THEN both are exactly as after the first run
			const twice = [await readDescription(filled), await readDescription(kept)]
			expect(twice).toEqual(once)
		})
	})
})
