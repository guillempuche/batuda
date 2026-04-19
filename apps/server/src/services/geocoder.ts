import { Effect, Layer, Schema, Semaphore, ServiceMap } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/unstable/http'

const NominatimHit = Schema.Struct({
	lat: Schema.String,
	lon: Schema.String,
})

const NominatimResponse = Schema.Array(NominatimHit)

export interface GeocodeResult {
	readonly latitude: number
	readonly longitude: number
	readonly source: string
}

export class Geocoder extends ServiceMap.Service<Geocoder>()('Geocoder', {
	make: Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		// Nominatim ToS allows 1 req/sec absolute. A single-permit semaphore
		// serialises callers; a trailing 1-second sleep inside the critical
		// section spaces them out so the next request can't fire too soon.
		const semaphore = yield* Semaphore.make(1)

		const lookup = (query: string): Effect.Effect<GeocodeResult | null> =>
			semaphore.withPermits(1)(
				client
					.get('https://nominatim.openstreetmap.org/search', {
						urlParams: {
							q: query,
							format: 'jsonv2',
							limit: '1',
						},
						headers: {
							// Nominatim ToS: every caller must identify itself with
							// a real contact address so abuse can be reported.
							'User-Agent': 'Batuda/1.0 (developer@xiroi.cat)',
							Accept: 'application/json',
						},
					})
					.pipe(
						Effect.flatMap(
							HttpClientResponse.schemaBodyJson(NominatimResponse),
						),
						Effect.map(hits => {
							const hit = hits[0]
							if (!hit) return null
							const latitude = Number(hit.lat)
							const longitude = Number(hit.lon)
							if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
								return null
							}
							return {
								latitude,
								longitude,
								source: 'nominatim',
							}
						}),
						Effect.tap(() => Effect.sleep('1 seconds')),
						Effect.catch((err: unknown) =>
							Effect.logWarning('Geocode lookup failed')
								.pipe(
									Effect.annotateLogs({
										event: 'geocode.failed',
										query,
										cause: String(err),
									}),
								)
								.pipe(Effect.as(null)),
						),
					),
			)

		return { lookup } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
