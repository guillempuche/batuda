/**
 * Stub site-map provider — returns deterministic same-site URLs for local
 * development, mirroring the pages a real site map would surface.
 *
 * Exported as an instance, which is what the provider factory table in
 * `providers-live.ts` picks from when the config names this vendor.
 */

import { Effect } from 'effect'

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
		return Effect.succeed({
			links: [
				`${origin}/`,
				`${origin}/about`,
				`${origin}/team`,
				`${origin}/contact`,
			].slice(0, input.limit ?? 4),
			units: 0,
		})
	},
})
