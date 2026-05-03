import { NodeHttpServerRequest } from '@effect/platform-node'
import { fromNodeHeaders } from 'better-auth/node'
import { Effect, Layer } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { SqlClient } from 'effect/unstable/sql'

import {
	CurrentOrg,
	Forbidden,
	OrgMiddleware,
	Unauthorized,
} from '@batuda/controllers'

import { Auth } from '../lib/auth'

interface OrgRow {
	readonly id: string
	readonly name: string
	readonly slug: string
}

/**
 * Run an effect with `CurrentOrg` provided AND the matching
 * `app.current_org_id` GUC set on the connection. Both values must match —
 * RLS would catch drift but the cost of debugging "row level security
 * denied" is high, so they're stitched together here.
 *
 * For HTTP routes the same dance lives inline inside `OrgMiddlewareLive`
 * (closed over its own `sql` binding); this exported helper exists so
 * non-HTTP entry points (webhook handlers, MCP tools, future cron jobs)
 * can reuse the contract without re-deriving it.
 */
export const provideOrg =
	(org: {
		readonly id: string
		readonly name: string
		readonly slug: string
	}) =>
	<A, E, R>(effect: Effect.Effect<A, E, R | CurrentOrg>) =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`SET LOCAL ROLE app_user`
					yield* sql`SELECT set_config('app.current_org_id', ${org.id}, true)`
					return yield* Effect.provideService(effect, CurrentOrg, org)
				}),
			)
		}) as Effect.Effect<
			A,
			E | import('effect/unstable/sql').SqlError.SqlError,
			Exclude<R, CurrentOrg> | SqlClient.SqlClient
		>

/**
 * Implementing Layer for the `OrgMiddleware` Tag declared in
 * `@batuda/controllers`. Lives here (not in the shared package) because it
 * depends on Better-Auth, Node HTTP, and the Postgres client — pulling
 * those into `packages/controllers` would make the spec package
 * browser-hostile.
 *
 * Sequence per request:
 *   1. Re-read the session via Better-Auth (cheap; getSession caches).
 *   2. Reject with `Unauthorized` if no session — defense in depth, since
 *      `SessionMiddleware` should already have stopped that path.
 *   3. Reject with `Forbidden` if the session has no `activeOrganizationId`.
 *   4. Look up the organization row by id — slug + name are read alongside
 *      so route handlers can build org-scoped URLs without a second query.
 *   5. Open a transaction and `SET LOCAL ROLE app_user` + `SELECT
 *      set_config('app.current_org_id', <id>, true)` so RLS policies engage
 *      for the rest of the handler. Effect's SqlClient cleanly nests handler-
 *      side `withTransaction` calls as savepoints (per
 *      `docs/repos/effect/packages/effect/src/unstable/sql/SqlClient.ts:205-209`),
 *      and `SET LOCAL` releases on COMMIT/ROLLBACK alongside the per-tx
 *      Scope close (line 244), so the GUC scope follows the request scope
 *      exactly. Pattern mirrors the mail-worker's per-batch wrapper at
 *      `apps/mail-worker/src/ingest.ts:49-74`.
 *   6. Provide `CurrentOrg` to downstream handlers.
 */
export const OrgMiddlewareLive = Layer.effect(
	OrgMiddleware,
	Effect.gen(function* () {
		const { instance } = yield* Auth
		const sql = yield* SqlClient.SqlClient

		return effect =>
			Effect.gen(function* () {
				const req = yield* HttpServerRequest.HttpServerRequest
				const incomingMessage = NodeHttpServerRequest.toIncomingMessage(req)
				const headers = fromNodeHeaders(incomingMessage.headers)

				const result = yield* Effect.promise(() =>
					instance.api.getSession({ headers }),
				)

				if (!result) {
					return yield* new Unauthorized({
						message: 'Invalid or missing session',
					})
				}

				// `activeOrganizationId` is contributed by the Better-Auth
				// `organization` plugin via `additionalFields`; it is not part of
				// the base `Session` type, so we widen the read site instead of
				// asking every caller to re-augment Better-Auth's exported types.
				const activeOrgId = (
					result.session as { activeOrganizationId?: string | null }
				).activeOrganizationId
				if (!activeOrgId) {
					return yield* new Forbidden({
						message:
							'No active organization on session — call /auth/organization/set-active first',
					})
				}

				// SQL failures here are infrastructure errors, not authz errors:
				// die rather than leaking `SqlError` into the middleware's
				// declared { Unauthorized | Forbidden } error union, which would
				// otherwise force every protected route to handle SqlError.
				const orgRows = yield* sql<OrgRow>`
					SELECT id, name, slug
					FROM "organization"
					WHERE id = ${activeOrgId}
					LIMIT 1
				`.pipe(Effect.orDie)
				const row = orgRows[0]
				if (!row) {
					// Stale `activeOrganizationId` after the org was deleted, or the
					// session was forged. Either way the user can't act in it.
					return yield* new Forbidden({
						message: `Active organization ${activeOrgId} not found`,
					})
				}

				// Run the rest of the request inside a transaction so SET LOCAL
				// ROLE + the two GUCs (org id + user id) live for exactly the
				// request's scope and release on COMMIT/ROLLBACK. SqlError
				// surfaces as a die so the middleware's declared error union
				// stays { Unauthorized | Forbidden }. `app.current_user_id`
				// is set alongside `app.current_org_id` so future per-user
				// RLS policies (e.g. on `member` to scope membership reads
				// by self) don't need a second middleware change.
				return yield* sql
					.withTransaction(
						Effect.gen(function* () {
							yield* sql`SET LOCAL ROLE app_user`
							yield* sql`SELECT set_config('app.current_org_id', ${row.id}, true)`
							yield* sql`SELECT set_config('app.current_user_id', ${result.user.id}, true)`
							return yield* Effect.provideService(effect, CurrentOrg, {
								id: row.id,
								name: row.name,
								slug: row.slug,
							})
						}),
					)
					.pipe(Effect.orDie)
			})
	}),
).pipe(Layer.provide(Auth.layer))
