import { Cause, Context, DateTime, Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

import { enterOrgScope } from '../middleware/org'
import { CompanyService } from './companies'
import { Geocoder } from './geocoder'

/**
 * Drop the ambient transaction connection so a following `withTransaction`
 * opens a fresh top-level transaction instead of a savepoint on the caller's
 * (about-to-commit) connection. Each client owns its transaction connection
 * under `sql.transactionService`, and `withTransaction` only makes a savepoint
 * when that key is present, so removing it forces a fresh transaction. The key
 * is read via `serviceOption` and is never part of `R`, so removing it leaves
 * the requirements unchanged — the assertion only tells the compiler that.
 */
const detachFromTransaction =
	(sql: SqlClient.SqlClient) =>
	<A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Effect.updateContext(
			self,
			(services: Context.Context<R>) =>
				Context.omit(sql.transactionService)(services) as Context.Context<R>,
		)

/**
 * Resolve a company's coordinates from the deterministic geocoder and store
 * them. Builds the lookup from the company's name and location, and on a match
 * writes latitude/longitude/geocoded_at/geocode_source, returning the updated
 * row. Returns null when there is nothing to store — the company has no
 * name/location to search on, or the geocoder found no match.
 *
 * This is the one place the coordinate columns and the "name, location" lookup
 * are defined. The geocode_company tool, the HTTP geocode endpoint, and the
 * post-enrichment research sink all go through here, so coordinates always come
 * from the geocoder and never from a language model.
 */
export const geocodeCompany = (id: string) =>
	Effect.gen(function* () {
		const service = yield* CompanyService
		const geocoder = yield* Geocoder
		const company = yield* service.findById(id)

		const name = company['name'] as string | null
		const location = company['location'] as string | null
		const query = [name, location].filter(Boolean).join(', ')
		if (!query) return null

		const hit = yield* geocoder.lookup(query)
		if (!hit) return null

		const rows = yield* service.update(id, {
			latitude: hit.latitude,
			longitude: hit.longitude,
			geocodedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
			geocodeSource: hit.source,
		})
		return rows[0] ?? null
	})

/**
 * Whether an update replaced a company's location with a new, non-empty place —
 * the only case that makes the stored coordinates stale. Clearing the location
 * (empty string or null) does not qualify: geocoding by the company name alone
 * could plant a wrong pin, so the old coordinates are left in place instead.
 */
export const locationWasReplaced = (
	before: { readonly location?: unknown } | null,
	fields: Record<string, unknown>,
): boolean => {
	if (!Object.hasOwn(fields, 'location')) return false
	const next = fields['location']
	if (typeof next !== 'string' || next.trim() === '') return false
	return before?.['location'] !== next
}

/**
 * Re-geocode a company in the background, on its own connection.
 *
 * The geocoder call runs ~1.5s (Nominatim's rate limit) and must not block the
 * caller's response, so it forks. But it must NOT reuse the request's
 * transaction: that connection commits and returns to the pool the moment the
 * response is sent. Dropping the inherited `TransactionConnection` makes
 * `enterOrgScope` open its own top-level transaction on a fresh pooled
 * connection and re-apply the app_user role + org GUC, so the coordinate write
 * passes RLS. Best-effort: a miss or failure just leaves the previous
 * coordinates in place. Callers: a location edit and an applied research update.
 */
export const forkCompanyRegeocode = (id: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const org = yield* CurrentOrg
		yield* enterOrgScope(sql, { org })(geocodeCompany(id)).pipe(
			// Strip the request's transaction connection so this fork's
			// `enterOrgScope` opens its own top-level transaction on a fresh pooled
			// connection, instead of a savepoint on the request's committed one.
			detachFromTransaction(sql),
			Effect.catchCause(cause =>
				Cause.hasInterruptsOnly(cause)
					? Effect.interrupt
					: Effect.logWarning('background geocode failed').pipe(
							Effect.annotateLogs({
								event: 'company.geocode.failed',
								companyId: id,
								cause: Cause.pretty(cause),
							}),
						),
			),
			Effect.forkDetach,
		)
	})

/**
 * Update a company, then keep its coordinates in step with a changed location.
 *
 * Runs the normal update inside the request's transaction, and when the write
 * actually replaces `location` with a new place, kicks off a detached
 * re-geocode (see `regeocodeOutOfBand`) so the fresh location gets fresh
 * coordinates without the slow geocoder call blocking the response. The current
 * row is read only when the payload carries `location`, so an update that cannot
 * move the pin pays no extra query.
 */
export const updateCompanyRegeocoding = (
	id: string,
	fields: Record<string, unknown>,
) =>
	Effect.gen(function* () {
		const service = yield* CompanyService

		const before = Object.hasOwn(fields, 'location')
			? yield* service
					.findById(id)
					.pipe(Effect.catchTag('NotFound', () => Effect.succeed(null)))
			: null

		const rows = yield* service.update(id, fields)
		const updated = rows[0] ?? null

		if (updated && locationWasReplaced(before, fields)) {
			yield* forkCompanyRegeocode(id)
		}

		return updated
	})
