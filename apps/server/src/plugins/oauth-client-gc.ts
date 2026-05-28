import type { BetterAuthPlugin } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import type { Pool } from 'pg'

/**
 * Open Dynamic Client Registration lets anyone register an OAuth client
 * unauthenticated, so clients no user ever consents to would pile up. After
 * each registration, delete clients older than `gcDays` that still have no
 * consent — bounding the table opportunistically, without a separate job.
 *
 * Deleting only never-consented clients past a grace window can't touch a
 * client a user is mid-authorizing (its row is recent) or one already in use
 * (it has a consent row). Production keeps `gcDays` short; dev sets it long so
 * a client registered while testing isn't swept away.
 */
export const gcAbandonedClients = async (
	pool: Pool,
	gcDays: number,
): Promise<number> => {
	// Clamp ≥ 0: a negative window lands in the future and would sweep
	// recently-registered, not-yet-consented clients.
	const days = Math.max(0, gcDays)
	const result = await pool.query(
		`DELETE FROM "oauthClient"
		 WHERE "createdAt" < now() - ($1 || ' days')::interval
		   AND NOT EXISTS (
		     SELECT 1 FROM "oauthConsent"
		     WHERE "oauthConsent"."clientId" = "oauthClient"."clientId"
		   )`,
		[String(days)],
	)
	return result.rowCount ?? 0
}

export const oauthClientGc = (
	pool: Pool,
	gcDays: number,
): BetterAuthPlugin => ({
	id: 'oauth-client-gc',
	hooks: {
		after: [
			{
				matcher: ctx => ctx.path === '/oauth2/register',
				// Best-effort: a cleanup failure must never fail the registration
				// the user is in the middle of, so the error is swallowed.
				handler: createAuthMiddleware(async () => {
					await gcAbandonedClients(pool, gcDays).catch(() => {})
				}),
			},
		],
	},
})
