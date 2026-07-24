/**
 * Stub site-map provider — returns deterministic same-site URLs for local
 * development, mirroring the pages a real site map would surface.
 *
 * Exports both the instance (for the provider factory table in
 * `providers-live.ts`) and the standalone Layer (single-slot callers, tests).
 */

import { Effect, Layer } from 'effect'

import { MapProvider } from '../../application/ports'

export const StubMapProviderInstance = MapProvider.of({
	map: input => {
		const origin = (() => {
			try {
				return new URL(input.url).origin
			} catch {
				return `https://${input.url}`
			}
		})()
		return Effect.succeed(
			[
				`${origin}/`,
				`${origin}/about`,
				`${origin}/team`,
				`${origin}/contact`,
			].slice(0, input.limit ?? 4),
		)
	},
})

export const StubMapProviderLayer = Layer.succeed(
	MapProvider,
	StubMapProviderInstance,
)
