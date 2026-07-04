import { DateTime, Effect } from 'effect'

import { CompanyService } from './companies'
import { Geocoder } from './geocoder'

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
