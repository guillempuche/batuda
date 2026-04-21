/**
 * Boot-time `BookingProvider` selection via `CALENDAR_PROVIDER`. The var
 * names the capability, never the vendor (memory `feedback_env_var_naming`);
 * adding a provider is a new case, not a rename.
 */

import { Config, Effect, Layer, Schema } from 'effect'

import { CalcomBookingProviderLayer } from './calcom-live'
import { StubBookingProviderLayer, StubIcsParserLayer } from './stub'

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

// IcsParser only has a stub implementation for PR #1 (the live ical.js
// adapter lands in PR #6 alongside inbound-email ICS ingestion).
export const IcsParserLive = StubIcsParserLayer
