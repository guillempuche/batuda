// Live-DB integration test for research_sync run durability. The blocking sync
// tool creates its run in its OWN transaction on a fresh pooled connection (via
// enterOrgScope + detachFromTransaction), so the run commits — and stays
// pollable — even when the MCP request transaction that started it is later
// rolled back by a client/transport timeout. The contrast case pins why the
// detach is needed: the same write nested in the request transaction is lost
// when that transaction rolls back.
//
// Prereq: `pnpm cli services up` — this suite's own globalSetup builds and
// migrates the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, ManagedRuntime } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { detachFromTransaction, enterOrgScope } from '../middleware/org'
import { applyTestEnv } from '../test-env'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const runtime = ManagedRuntime.make(PgLive)

const ORG = {
	id: `sync-org-${randomUUID()}`,
	name: 'Sync Durability Org',
	slug: `sync-${randomUUID()}`,
}
const USER = `sync-u-${randomUUID()}`

let pool: pg.Pool

const runExists = async (id: string): Promise<boolean> => {
	const r = await pool.query(`SELECT id FROM research_runs WHERE id = $1`, [id])
	return r.rows.length > 0
}

const insertRun = (researchId: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			INSERT INTO research_runs (id, organization_id, query, status, created_by)
			VALUES (${researchId}, ${ORG.id}, 'sync durability probe', 'queued', ${USER})
		`
	})

// Run `write` inside a request transaction that then rolls back — standing in
// for the fiber interrupt a client/transport cancel causes mid-handler.
const writeThenRollBackRequest = (
	write: Effect.Effect<void, unknown, SqlClient.SqlClient>,
) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql
				.withTransaction(
					write.pipe(
						Effect.andThen(Effect.fail(new Error('client cancelled'))),
					),
				)
				.pipe(Effect.catchCause(() => Effect.void))
		}),
	)

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	await pool.query(`DELETE FROM research_runs WHERE organization_id = $1`, [
		ORG.id,
	])
	await runtime.dispose()
	await pool.end()
})

describe('research_sync run durability', () => {
	describe('when the run is created detached and the request transaction rolls back', () => {
		it('should keep the committed run row instead of losing it', async () => {
			const researchId = randomUUID()
			// GIVEN the run written in its own org scope, detached from the request
			//   transaction — exactly how the sync handler creates it
			const durableCreate = Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* insertRun(researchId).pipe(
					enterOrgScope(sql, { org: ORG, userId: USER }),
					detachFromTransaction(sql),
				)
			})
			// WHEN the surrounding request transaction rolls back (a client cancel)
			await writeThenRollBackRequest(durableCreate)
			// THEN the run survived on its own connection and stays pollable
			expect(await runExists(researchId)).toBe(true)
		})
	})

	describe('when the run is created inside the request transaction that rolls back', () => {
		it('should be lost — the failure the detach prevents', async () => {
			const researchId = randomUUID()
			// GIVEN the same write nested in the request transaction (no detach)
			const fragileCreate = Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* insertRun(researchId).pipe(
					enterOrgScope(sql, { org: ORG, userId: USER }),
				)
			})
			// WHEN the request transaction rolls back
			await writeThenRollBackRequest(fragileCreate)
			// THEN the run vanishes with the rolled-back transaction
			expect(await runExists(researchId)).toBe(false)
		})
	})
})
