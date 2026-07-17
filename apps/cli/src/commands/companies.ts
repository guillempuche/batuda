import { Console, Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// One-time backfill: geocode every company that has a written location but no
// coordinates — rows enriched before geocoding was stored, located by hand, or
// from a run not linked to the company. It mirrors the server Geocoder's
// Nominatim call (the CLI can't import server code) and honours the same
// ~1 request/second limit. The CLI's DB role bypasses RLS, so this sweeps every
// org in one pass.

interface CompanyRow {
	readonly id: string
	readonly name: string | null
	readonly location: string | null
}

interface GeoHit {
	readonly latitude: number
	readonly longitude: number
}

const lookup = (query: string): Effect.Effect<GeoHit | null> =>
	Effect.promise(async () => {
		try {
			const url = new URL('https://nominatim.openstreetmap.org/search')
			url.searchParams.set('q', query)
			url.searchParams.set('format', 'jsonv2')
			url.searchParams.set('limit', '1')
			const res = await fetch(url, {
				headers: {
					// Nominatim ToS: identify the caller with a real contact address.
					'User-Agent': 'Batuda/1.0 (developer@xiroi.cat)',
					Accept: 'application/json',
				},
			})
			if (!res.ok) return null
			const hits = (await res.json()) as ReadonlyArray<{
				lat?: string
				lon?: string
			}>
			const hit = hits[0]
			if (!hit) return null
			const latitude = Number(hit.lat)
			const longitude = Number(hit.lon)
			return Number.isFinite(latitude) && Number.isFinite(longitude)
				? { latitude, longitude }
				: null
		} catch {
			return null
		}
	})

export const companiesBackfillGeocode = (dryRun: boolean) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		const rows = yield* sql<CompanyRow>`
			SELECT id, name, location
			FROM companies
			WHERE location IS NOT NULL
				AND latitude IS NULL
				AND deleted_at IS NULL
			ORDER BY created_at
		`

		yield* Console.log(
			`${rows.length} compan${rows.length === 1 ? 'y' : 'ies'} to geocode${
				dryRun ? ' (dry run)' : ''
			}`,
		)

		let geocoded = 0
		let missed = 0
		for (const company of rows) {
			const query = [company.name, company.location].filter(Boolean).join(', ')
			if (!query) {
				missed++
				continue
			}

			let hit = yield* lookup(query)
			// Pause between calls to respect Nominatim's ~1 request/second limit.
			yield* Effect.sleep('1 seconds')
			let matchedQuery = query

			// The name-prefixed query resolves to no place for many companies, so
			// fall back to the bare location before giving up — only when it differs
			// from the query already tried (i.e. a name was part of it).
			if (!hit && company.location && company.location !== query) {
				hit = yield* lookup(company.location)
				yield* Effect.sleep('1 seconds')
				matchedQuery = company.location
			}

			if (!hit) {
				missed++
				yield* Console.log(`  ✗ ${query} — no match`)
				continue
			}

			if (!dryRun) {
				yield* sql`
					UPDATE companies
					SET latitude = ${hit.latitude},
						longitude = ${hit.longitude},
						geocoded_at = now(),
						geocode_source = 'nominatim',
						updated_at = now()
					WHERE id = ${company.id}
				`
			}
			geocoded++
			yield* Console.log(
				`  ✓ ${matchedQuery} → ${hit.latitude}, ${hit.longitude}`,
			)
		}

		yield* Console.log(
			`Done: ${geocoded} geocoded, ${missed} without a match${
				dryRun ? ' (dry run — nothing written)' : ''
			}`,
		)
	})
