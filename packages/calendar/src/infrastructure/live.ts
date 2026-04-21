/**
 * Boot-time `BookingProvider` selection via `CALENDAR_PROVIDER`. The var
 * names the capability, never the vendor (memory `feedback_env_var_naming`);
 * adding a provider is a new case, not a rename.
 *
 * PR #1 ships with `stub` only; `calcom` is a placeholder that fails fast
 * until the live adapter lands in PR #3.
 */

import { Config, Effect, Layer, Schema } from 'effect'

import { BookingProvider } from '../application/ports/booking-provider'
import { BookingFailed } from '../domain/errors'
import { StubBookingProviderLayer, StubIcsParserLayer } from './stub'

const notWired = () =>
	Effect.fail(
		new BookingFailed({
			provider: 'calcom',
			reason: 'calcom_adapter_not_yet_wired',
			recoverable: false,
		}),
	)

const CalcomNotWiredLayer = Layer.succeed(
	BookingProvider,
	BookingProvider.of({
		findSlots: notWired,
		createBooking: notWired,
		rescheduleBooking: notWired,
		cancelBooking: notWired,
		respondToRsvp: notWired,
		listEventTypes: notWired,
		upsertEventType: notWired,
	}),
)

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
				return CalcomNotWiredLayer
		}
	}),
)

// IcsParser only has a stub implementation for PR #1 (the live ical.js
// adapter lands in PR #6 alongside inbound-email ICS ingestion).
export const IcsParserLive = StubIcsParserLayer
