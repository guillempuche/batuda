import { NodeHttpServerRequest } from '@effect/platform-node'
import { fromNodeHeaders } from 'better-auth/node'
import { Data, Effect, Layer } from 'effect'
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
 * Enter the per-request org scope on the SQL connection, then run `effect`
 * inside it. In one transaction: `SET LOCAL ROLE app_user`, set the
 * `app.current_org_id` GUC (and `app.current_user_id` when a user is
 * present), and provide `CurrentOrg`. The role + GUCs release on
 * COMMIT/ROLLBACK with the transaction's scope, so they follow the request
 * exactly. Effect's SqlClient nests handler-side `withTransaction` calls as
 * savepoints, and `SET LOCAL` releases alongside the per-tx Scope, so the
 * GUC scope tracks the request scope. SQL faults die as a defect, keeping
 * callers' error unions free of `SqlError`.
 *
 * The HTTP org middleware, the MCP auth middleware, and the cal.com webhook
 * all route their tx-tail through here so the role + GUC contract can't
 * drift between transports; each keeps its own session prologue and error
 * rendering on top.
 *
 * `userId` is optional: the webhook acts for an org with no signed-in user,
 * so the user GUC is left unset rather than written as an empty string — an
 * empty string reads back as `''` (not NULL) and could match an empty-keyed
 * row under a future user-scoped policy.
 */
export const enterOrgScope =
	(
		// Passed in (not pulled from context) so the wrapped effect's R stays
		// free of SqlClient — the HTTP middleware boundary only admits the
		// services it provides. Every caller already holds a layer-level binding.
		sql: SqlClient.SqlClient,
		scope: { readonly org: OrgRow; readonly userId?: string | undefined },
	) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		sql
			.withTransaction(
				Effect.gen(function* () {
					yield* sql`SET LOCAL ROLE app_user`
					yield* sql`SELECT set_config('app.current_org_id', ${scope.org.id}, true)`
					if (scope.userId !== undefined)
						yield* sql`SELECT set_config('app.current_user_id', ${scope.userId}, true)`
					return yield* Effect.provideService(effect, CurrentOrg, scope.org)
				}),
			)
			.pipe(Effect.orDie) as Effect.Effect<A, never, Exclude<R, CurrentOrg>>

// Raised when a system-actor scope can't resolve its org — e.g. the org was
// deleted between a research run completing and its fan-out firing. A distinct
// tag lets callers skip the work rather than crash.
export class SystemOrgNotFound extends Data.TaggedError('SystemOrgNotFound')<{
	readonly orgId: string
}> {}

/**
 * Fail-closed org scope for system actors that run outside any request — the
 * research event sink fires after the originating request has returned. Loads
 * the real organization row by id (so `CurrentOrg` carries a true name/slug
 * instead of empties), then enters app_user scope via `enterOrgScope`. A
 * missing org fails with `SystemOrgNotFound` *before* the effect runs, so no
 * partial scope (role/GUC) is ever applied.
 *
 * `userId` is the on-behalf-of user (e.g. the run's creator); omit it to set
 * the org GUC alone.
 */
export const resolveSystemOrg =
	(
		sql: SqlClient.SqlClient,
		orgId: string,
		opts?: { readonly userId?: string | undefined },
	) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const rows = yield* sql<OrgRow>`
				SELECT id, name, slug FROM "organization" WHERE id = ${orgId} LIMIT 1
			`.pipe(Effect.orDie)
			const org = rows[0]
			if (!org) return yield* new SystemOrgNotFound({ orgId })
			return yield* enterOrgScope(sql, { org, userId: opts?.userId })(effect)
		})

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
 *   5. Hand off to `enterOrgScope` — role + both GUCs + `CurrentOrg` inside
 *      one transaction; see its doc for the savepoint/scope mechanics.
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

				// Enter the org scope (role + both GUCs + CurrentOrg) for the
				// rest of the request via the shared combinator, keeping the
				// HTTP and MCP transports in lockstep. The user GUC backs
				// future per-user RLS (e.g. scoping membership reads to self).
				return yield* enterOrgScope(sql, {
					org: row,
					userId: result.user.id,
				})(effect)
			})
	}),
).pipe(Layer.provide(Auth.layer))
