// Live-DB integration test for the progress counter a research run writes while
// it works. It repeats the same guarded write a run makes, against the real
// column, and covers what that counter has to get right: it lands on a working
// run, it is refused on a run that already stopped, and it never breaks the read
// that returns the run — no row was backfilled, so plenty carry no count at all.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds
// and migrates the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Effect, ManagedRuntime, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ResearchRun } from '@batuda/domain'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const runtime = ManagedRuntime.make(PgLive)

const ORG = `progress-org-${randomUUID()}`
const USER = `progress-u-${randomUUID()}`

let pool: pg.Pool

const insertRun = async (status: string, progressSteps: number | null) => {
	const id = randomUUID()
	await pool.query(
		`INSERT INTO research_runs (id, organization_id, query, status, created_by, progress_steps)
		 VALUES ($1, $2, 'progress probe', $3, $4, $5)`,
		[id, ORG, status, USER, progressSteps],
	)
	return id
}

// The write a run makes each round, repeated here: set the count, but only while
// the run is still going, so a run cancelled underneath is left as it was.
const recordProgress = (id: string, steps: number) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				UPDATE research_runs
				SET progress_steps = ${steps}, updated_at = now()
				WHERE id = ${id} AND status = 'running'
			`
		}),
	)

const readSteps = async (id: string): Promise<number | null> => {
	const result = await pool.query(
		`SELECT progress_steps FROM research_runs WHERE id = $1`,
		[id],
	)
	return (result.rows[0] as { progress_steps: number | null }).progress_steps
}

// Decode the row the way the read that returns a run does — same schema, and the
// same camelCased keys the SQL client hands back — so a shape the decoder rejects
// fails here rather than on a caller fetching their findings.
const decodeRow = async (id: string) => {
	const result = await pool.query(`SELECT * FROM research_runs WHERE id = $1`, [
		id,
	])
	const row = result.rows[0] as Record<string, unknown>
	const camelCased = Object.fromEntries(
		Object.entries(row).map(([k, v]) => [
			k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
			v,
		]),
	)
	return Effect.runSync(Schema.decodeUnknownEffect(ResearchRun)(camelCased))
}

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG,
	])
	await pool.end()
	await runtime.dispose()
})

describe('research run progress counter', () => {
	describe('when the run is still working', () => {
		it('should record a finished round on the run', async () => {
			// GIVEN a run that has started and reported nothing yet
			const id = await insertRun('running', null)

			// WHEN it reports finishing a round
			await recordProgress(id, 1)

			// THEN the count is on the row, where anyone watching reads it
			expect(await readSteps(id)).toBe(1)
		})

		it('should carry on from an earlier attempt rather than restart', async () => {
			// GIVEN a run picked up again after an earlier attempt got through five
			//   rounds
			const id = await insertRun('running', 5)

			// WHEN the run reads that count back and reports one more
			const seeded = (await readSteps(id)) ?? 0
			await recordProgress(id, seeded + 1)

			// THEN the count goes up rather than starting over, so a watcher never
			//   sees the run lose ground
			expect(await readSteps(id)).toBe(6)
		})
	})

	describe('when the run already stopped', () => {
		it('should leave a cancelled run untouched', async () => {
			// GIVEN a run cancelled while a round was still in flight, with the count
			//   the run had reached
			const id = await insertRun('cancelled', 3)

			// WHEN that in-flight round tries to report
			await recordProgress(id, 4)

			// THEN the count is left where the cancellation found it
			expect(await readSteps(id)).toBe(3)
		})

		it('should leave a finished run untouched', async () => {
			// GIVEN a run that succeeded
			const id = await insertRun('succeeded', 9)

			// WHEN a late report arrives
			await recordProgress(id, 10)

			// THEN its recorded count stands
			expect(await readSteps(id)).toBe(9)
		})
	})

	describe('when the run is read back', () => {
		it('should decode a run that has reported a count', async () => {
			// GIVEN a working run with a count
			const id = await insertRun('running', 4)

			// WHEN the row is decoded the way a read returns it
			const decoded = await decodeRow(id)

			// THEN the count comes through
			expect(decoded.progressSteps).toBe(4)
		})

		it('should decode a run that has reported nothing', async () => {
			// GIVEN a queued run, which carries no count
			const id = await insertRun('queued', null)

			// WHEN the row is decoded
			const decoded = await decodeRow(id)

			// THEN it reads as nothing reported rather than failing, so every row
			//   that carries no count stays readable
			expect(decoded.progressSteps).toBeNull()
		})
	})
})
