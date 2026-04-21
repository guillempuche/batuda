import { type Effect, ServiceMap } from 'effect'

import type {
	CreateBookingInput,
	FindSlotsInput,
	ProviderBookingRef,
	ProviderEventTypeRef,
	RsvpInput,
	Slot,
	UpsertEventTypeInput,
} from '../../domain/calendar-event'
import type {
	BookingFailed,
	NoAvailability,
	UnsupportedRsvp,
} from '../../domain/errors'

/**
 * Vendor-neutral port over an external booking backend (cal.com today;
 * Google / Microsoft / self-hosted tomorrow). The calendar service only ever
 * sees this surface; no SDK types leak past this boundary.
 */
export class BookingProvider extends ServiceMap.Service<
	BookingProvider,
	{
		readonly findSlots: (
			input: FindSlotsInput,
		) => Effect.Effect<ReadonlyArray<Slot>, BookingFailed | NoAvailability>

		readonly createBooking: (
			input: CreateBookingInput,
		) => Effect.Effect<ProviderBookingRef, BookingFailed>

		readonly rescheduleBooking: (
			providerBookingId: string,
			newStartAt: Date,
		) => Effect.Effect<ProviderBookingRef, BookingFailed>

		readonly cancelBooking: (
			providerBookingId: string,
			reason: string | null,
		) => Effect.Effect<void, BookingFailed>

		readonly respondToRsvp: (
			input: RsvpInput,
		) => Effect.Effect<void, BookingFailed | UnsupportedRsvp>

		readonly listEventTypes: () => Effect.Effect<
			ReadonlyArray<ProviderEventTypeRef>,
			BookingFailed
		>

		readonly upsertEventType: (
			input: UpsertEventTypeInput,
		) => Effect.Effect<ProviderEventTypeRef, BookingFailed>
	}
>()('calendar/BookingProvider') {}
