/**
 * Boot-time `BookingProvider` selection via `CALENDAR_PROVIDER`. The variable is
 * named for what it does rather than for whoever supplies it, so bringing in
 * another supplier adds a case here instead of renaming the setting everywhere.
 */

import { Config, Effect, Layer, Schema } from 'effect'

import { CalcomBookingProviderLayer } from './calcom-live'
import { IcsParserLayer, StubBookingProviderLayer } from './stub'

export const BookingProviderLive = Layer.unwrap(
	Effect.gen(function* () {
		const provider = yield* Config.schema(
			Schema.Literals(['stub', 'calcom']),
			'CALENDAR_PROVIDER',
		)
		yield* Effect.logInfo(`calendar provider: ${provider}`)
		switch (provider) {
			case 'stub':
				return StubBookingProviderLayer
			case 'calcom':
				return CalcomBookingProviderLayer
		}
	}),
)

// There is one invitation reader and it is the same everywhere: a zero-dependency
// parser covering the shapes real senders actually produce. The alias exists so
// boot code names it alongside the provider selection above.
export const IcsParserLive = IcsParserLayer
