// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Deferred, Effect, Exit, Fiber } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client.js'

// A research run is created inside the request transaction (the org middleware
// wraps every handler in sql.withTransaction) and then dispatched to do its
// cache writes. A job forked from that request fiber inherits the request's
// transaction connection; once the request commits, the job's first
// sql.withTransaction issues SAVEPOINT on a pooled connection with no live BEGIN
// and dies on "ROLLBACK TO SAVEPOINT can only be used in transaction blocks".
// The dispatch consumer runs each job from the service's own scope, so its first
// transaction opens a clean connection. These tests pin that contract with the
// exact cache write web_search performs: an advisory-locked search_cache upsert
// inside a transaction.

// The shape of cached-search's web_search cache write.
const cacheWrite = (key: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* Effect.gen(function* () {
			yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`search:${key}`}))`
			yield* sql`
				INSERT INTO search_cache (
					key_hash, provider, query, items, units_cost, cached_at, expires_at
				) VALUES (
					${key}, 'it-stub', 'q', '[]'::jsonb, 0, now(), now() + interval '1 hour'
				)
				ON CONFLICT (key_hash) DO UPDATE SET cached_at = now()
			`
		}).pipe(sql.withTransaction)
	})

const cacheRowExists = (key: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<{
			keyHash: string
		}>`SELECT key_hash FROM search_cache WHERE key_hash = ${key}`
		return rows.length > 0
	})

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM search_cache WHERE key_hash LIKE 'it-171-%'`
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('research dispatch transaction context', () => {
	describe('when a cache-writing job is forked from inside a committed request transaction', () => {
		it('should die on ROLLBACK TO SAVEPOINT — the failure the consumer removes', async () => {
			// GIVEN the cache write forked from within a request transaction, so it
			//   holds that transaction's connection [forkDetach]
			// WHEN the request transaction commits and the forked job then runs its
			//   own sql.withTransaction on the now-released connection
			// THEN it issues SAVEPOINT with no live BEGIN and the fiber fails
			const key = `it-171-${randomUUID()}`
			const exit = await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					// Release the job only after the request transaction has committed,
					// so the crash is deterministic rather than a scheduling race.
					const afterCommit = yield* Deferred.make<void>()
					const fiber = yield* sql.withTransaction(
						Effect.gen(function* () {
							return yield* Deferred.await(afterCommit).pipe(
								Effect.andThen(cacheWrite(key)),
								Effect.forkDetach,
							)
						}),
					)
					yield* Deferred.succeed(afterCommit, undefined)
					return yield* Fiber.await(fiber)
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<
					Exit.Exit<void, unknown>,
					never,
					never
				>,
			)

			expect(Exit.isFailure(exit)).toBe(true)
		})
	})

	describe('when the same job runs from the service’s own clean scope', () => {
		it('should open its own transaction, commit, and write the cache row', async () => {
			// GIVEN a request transaction that has already committed
			// WHEN the identical cache write runs on a fiber forked into a clean
			//   scope — as the layer-scoped dispatch consumer runs it — rather than
			//   the request fiber [forkIn]
			// THEN its transaction opens a real BEGIN, commits, and the row lands
			const key = `it-171-${randomUUID()}`
			const committed = await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const sql = yield* SqlClient.SqlClient
						const scope = yield* Effect.scope
						// A prior request transaction, now committed.
						yield* sql.withTransaction(sql`SELECT 1`)
						const fiber = yield* cacheWrite(key).pipe(Effect.forkIn(scope))
						yield* Fiber.await(fiber)
						return yield* cacheRowExists(key)
					}),
				).pipe(Effect.provide(PgLive)) as Effect.Effect<boolean, never, never>,
			)

			expect(committed).toBe(true)
		})
	})
})
