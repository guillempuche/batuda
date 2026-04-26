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
 *   5. Provide `CurrentOrg` to downstream handlers.
 *
 * The per-request `SET LOCAL app.current_org_id` GUC wrapper is *not*
 * wired here — it lands with the slice that introduces the first RLS
 * policy, so we don't pay for nested transactions before they're useful.
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

				return yield* Effect.provideService(effect, CurrentOrg, {
					id: row.id,
					name: row.name,
					slug: row.slug,
				})
			})
	}),
).pipe(Layer.provide(Auth.layer))
