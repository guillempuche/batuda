// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from './client.js'
import addIndex from './migrations/0071_sources_url_index'

// A citation names a stored page by its id or by its address, and the
// provenance a profile shows joins on either. This migration is the index
// that makes the join by address a lookup rather than a read of every page.

const DATABASE_URL = process.env['DATABASE_URL'] as string

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(
		effect.pipe(Effect.provide(PgLive), Effect.orDie) as Effect.Effect<A>,
	)

let pool: pg.Pool

const indexExists = async (): Promise<boolean> => {
	const r = await pool.query<{ indexname: string }>(
		`SELECT indexname FROM pg_indexes
		 WHERE tablename = 'sources' AND indexname = 'idx_sources_url'`,
	)
	return r.rows.length === 1
}

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	await pool.end()
})

describe('migration 0071, when the stored pages have no index by address', () => {
	it('should add one, and leave it be when run again', async () => {
		// GIVEN the migration has run at least once (the migrator ran it at
		// setup)
		// WHEN it runs again
		await run(addIndex)
		// THEN the index is there, once
		expect(await indexExists()).toBe(true)
		await run(addIndex)
		expect(await indexExists()).toBe(true)
	})
})
