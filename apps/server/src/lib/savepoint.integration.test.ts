// Covers inOwnSavepoint against a real database: a statement Postgres refuses
// inside a transaction aborts that transaction, so a caller that recovers from
// the refusal must still be able to go on and commit.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { Effect, Exit } from 'effect'
import { SqlClient } from 'effect/sql'
import { describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { inOwnSavepoint } from './savepoint'

applyTestEnv()

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromiseExit(effect.pipe(Effect.provide(PgLive)))

// A statement Postgres refuses: the text is not a uuid.
const refused = (sql: SqlClient.SqlClient) =>
	sql`SELECT ${'not-a-uuid'}::uuid AS id`

describe('inOwnSavepoint', () => {
	describe('when a refused statement runs in it inside a transaction', () => {
		it('should let the transaction go on and commit after the refusal is caught', async () => {
			// GIVEN a transaction that runs a refused statement in its own savepoint,
			// recovers from it, and then runs another statement
			const exit = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* refused(sql).pipe(
								inOwnSavepoint(sql),
								Effect.catchTag('SqlError', () => Effect.succeed([])),
							)
							const after = yield* sql<{ one: number }>`SELECT 1 AS one`
							return after[0]?.one
						}),
					)
				}),
			)

			// WHEN the transaction commits
			// THEN it succeeds and the statement after the refusal answered
			expect(Exit.isSuccess(exit) && exit.value).toBe(1)
		})
	})

	describe('when the same refusal is caught without a savepoint', () => {
		it('should fail the transaction, which is the failure the savepoint prevents', async () => {
			// GIVEN the same transaction with no savepoint around the refusal
			const exit = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* refused(sql).pipe(
								Effect.catchTag('SqlError', () => Effect.succeed([])),
							)
							return yield* sql`SELECT 1 AS one`
						}),
					)
				}),
			)

			// WHEN it goes on and tries to commit
			// THEN Postgres has already aborted it, so it fails
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})

	describe('when no transaction is open', () => {
		it('should run the step as it is', async () => {
			// GIVEN a step that reports whether it runs inside a transaction
			const exit = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const inside = Effect.serviceOption(sql.transactionService).pipe(
						Effect.map(open => open._tag === 'Some'),
					)
					return yield* inside.pipe(inOwnSavepoint(sql))
				}),
			)

			// WHEN it runs with nothing open around it
			// THEN it was not wrapped in a transaction of its own
			expect(Exit.isSuccess(exit) && exit.value).toBe(false)
		})
	})
})
