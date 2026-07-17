import { Cause, DateTime, Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'
import type { Company } from '@batuda/domain'

import { detachFromTransaction, enterOrgScope } from '../middleware/org'
import { CompanyService } from './companies'
import { type GeocodeResult, Geocoder } from './geocoder'

/**
 * What geocoding a company came to. `geocoded` carries the row with fresh
 * coordinates; the rest say why none were written, kept apart so a caller can
 * tell success from each kind of silence: the company had nothing to search on,
 * the geocoder had no place for it, or the geocoder could not be reached.
 */
export type GeocodeCompanyResult =
	| { readonly _tag: 'geocoded'; readonly company: Company }
	| { readonly _tag: 'no_match' }
	| { readonly _tag: 'nothing_to_search' }
	| { readonly _tag: 'lookup_failed' }

/**
 * Resolve a company's coordinates from the deterministic geocoder and store
 * them. It first asks for the company's "name, location" together — the name is
 * kept in the query on purpose, since a bare place name can plant a pin on the
 * wrong same-named town. When that finds nothing it retries with the location
 * on its own, because prepending a company name (not a geographic word) often
 * defeats an otherwise easy match. On a hit it writes
 * latitude/longitude/geocoded_at/geocode_source and returns the updated row.
 *
 * The result says which of four things happened, so callers can tell a real
 * geocode from each kind of silence: nothing to search on, no place found, or
 * the geocoder unreachable (see {@link GeocodeCompanyResult}).
 *
 * This is the one place the coordinate columns and that lookup are defined. The
 * geocode_company tool, the HTTP geocode endpoint, and the post-enrichment
 * research sink all go through here, so coordinates always come from the
 * geocoder and never from a language model.
 */
export const geocodeCompany = (id: string) =>
	Effect.gen(function* () {
		const service = yield* CompanyService
		const geocoder = yield* Geocoder
		const company = yield* service.findById(id)

		const name = company['name'] as string | null
		const location = company['location'] as string | null
		const primaryQuery = [name, location].filter(Boolean).join(', ')
		if (!primaryQuery) return { _tag: 'nothing_to_search' } as const

		// Write the coordinates and hand back the fresh row; a race that removed
		// the company between lookup and write leaves nothing to return.
		const persist = (hit: GeocodeResult) =>
			Effect.gen(function* () {
				const rows = yield* service.update(id, {
					latitude: hit.latitude,
					longitude: hit.longitude,
					geocodedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
					geocodeSource: hit.source,
				})
				const updated = rows[0]
				return updated
					? ({ _tag: 'geocoded', company: updated } as const)
					: ({ _tag: 'no_match' } as const)
			})

		const primaryHit = yield* geocoder.lookup(primaryQuery)
		if (primaryHit) return yield* persist(primaryHit)

		// The name-prefixed query resolves to no place for many companies, so fall
		// back to the bare location before giving up — only when it differs from
		// the query already tried (i.e. a name was part of it).
		if (location && location !== primaryQuery) {
			const locationHit = yield* geocoder.lookup(location)
			if (locationHit) return yield* persist(locationHit)
		}

		return { _tag: 'no_match' } as const
	}).pipe(
		// A geocoder that could not be reached is not a no-match: report it as its
		// own outcome instead of folding it into "no place found".
		Effect.catchTag('GeocodeLookupError', () =>
			Effect.succeed({ _tag: 'lookup_failed' } as const),
		),
	)

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
