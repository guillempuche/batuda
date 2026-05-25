// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from './org.js'

// enterOrgScope is the single combinator the HTTP org middleware, the MCP
// auth middleware, and the cal.com webhook all route their tx-tail through.
// These pin the contract that must not drift between them: role app_user +
// the org GUC always, the user GUC only when a user is present (never an
// empty string), and that the user GUC actually drives user-scoped RLS.

interface Org {
	id: string
	name: string
	slug: string
}

interface ScopeReading {
	currentOrgId: string
	currentOrgSlug: string
	role: string | null
	orgGuc: string | null
	userGuc: string | null
}

// Read the active role + both GUCs + CurrentOrg from inside the scope. Runs
// on enterOrgScope's pinned tx connection, so it observes what the combinator
// set there.
const readScope: Effect.Effect<
	ScopeReading,
	never,
	CurrentOrg | SqlClient.SqlClient
> = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	const org = yield* CurrentOrg
	const rows = yield* sql<{
		role: string
		orgGuc: string | null
		userGuc: string | null
	}>`
			SELECT current_user AS role,
			       current_setting('app.current_org_id', true) AS "orgGuc",
			       current_setting('app.current_user_id', true) AS "userGuc"
		`.pipe(Effect.orDie)
	return {
		currentOrgId: org.id,
		currentOrgSlug: org.slug,
		role: rows[0]?.role ?? null,
		orgGuc: rows[0]?.orgGuc ?? null,
		userGuc: rows[0]?.userGuc ?? null,
	}
})

// Count user_research_policy rows visible under the active scope. The 0003
// user-isolation policy filters these to current_setting('app.current_user_id').
const countVisiblePolicies: Effect.Effect<number, never, SqlClient.SqlClient> =
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<{ n: number }>`
			SELECT count(*)::int AS n FROM user_research_policy
		`.pipe(Effect.orDie)
		return rows[0]?.n ?? 0
	})

const ctx = {} as { org: Org }
const seededUsers: string[] = []

beforeAll(async () => {
	ctx.org = await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<Org>`
				SELECT id, name, slug FROM "organization" WHERE slug = 'taller' LIMIT 1
			`
			const found = rows[0]
			if (!found) {
				throw new Error(
					"taller org missing — run 'pnpm cli db reset && pnpm cli seed' first",
				)
			}
			return found
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<Org, never, never>,
	)
}, 60_000)

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`SET LOCAL ROLE app_service`
					for (const userId of seededUsers)
						yield* sql`DELETE FROM user_research_policy WHERE user_id = ${userId}`
				}),
			)
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('enterOrgScope', () => {
	describe('when a user is present', () => {
		it('should run as app_user with both the org and user GUCs set', async () => {
			// GIVEN an org and a user id
			// WHEN enterOrgScope(sql, { org, userId }) wraps an effect that reads
			//      current_user + both GUCs
			// THEN the role is app_user, both GUCs hold their ids, and CurrentOrg
			//      is the org
			// [middleware/org.ts — enterOrgScope: SET LOCAL ROLE + set_config x2]
			const userId = `usr-${randomUUID()}`
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, { org: ctx.org, userId })(readScope)
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<
					ScopeReading,
					never,
					never
				>,
			)
			expect(result.role).toBe('app_user')
			expect(result.orgGuc).toBe(ctx.org.id)
			expect(result.userGuc).toBe(userId)
			expect(result.currentOrgId).toBe(ctx.org.id)
			expect(result.currentOrgSlug).toBe(ctx.org.slug)
		})
	})

	describe('when no user is present (webhook path)', () => {
		it('should set the org GUC only and leave the user GUC unset', async () => {
			// GIVEN an org and no user id
			// WHEN enterOrgScope(sql, { org }) wraps the reader
			// THEN the org GUC is set, but the user GUC reads NULL — not an empty
			//      string a future user-scoped policy could match
			// [middleware/org.ts — userId omitted ⇒ user GUC skipped]
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, { org: ctx.org })(readScope)
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<
					ScopeReading,
					never,
					never
				>,
			)
			expect(result.role).toBe('app_user')
			expect(result.orgGuc).toBe(ctx.org.id)
			expect(result.userGuc).toBeNull()
		})
	})

	describe('when the user GUC backs a user-scoped RLS table', () => {
		it('should expose only the scoped user rows', async () => {
			// GIVEN a user_research_policy row seeded for userA only
			// WHEN the table is read under enterOrgScope for userA then userB
			// THEN userA sees its row and userB sees none — the user GUC drives
			//      the 0003 user-isolation policy
			// [migrations/0003_user_scoped_rls.ts — user_isolation_user_research_policy]
			const userA = `urp-${randomUUID()}`
			const userB = `urp-${randomUUID()}`
			seededUsers.push(userA, userB)

			await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					// app_service (BYPASSRLS) seeds across the FORCE policy.
					yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`SET LOCAL ROLE app_service`
							yield* sql`INSERT INTO user_research_policy (user_id) VALUES (${userA})`
						}),
					)
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
			)

			const [asA, asB] = await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const a = yield* enterOrgScope(sql, {
						org: ctx.org,
						userId: userA,
					})(countVisiblePolicies)
					const b = yield* enterOrgScope(sql, {
						org: ctx.org,
						userId: userB,
					})(countVisiblePolicies)
					return [a, b] as const
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<
					readonly [number, number],
					never,
					never
				>,
			)

			expect(asA).toBe(1)
			expect(asB).toBe(0)
		})
	})
})
