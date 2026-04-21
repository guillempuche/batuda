// Calendar bounded context entry point. Vendor-neutral ports live here; the
// server imports `BookingProvider` / `IcsParser` for handler wiring, and
// `BookingProviderLive` / `IcsParserLive` at boot-time.

// ── Application (ports) ────────────────────────────────────────────────────
export { BookingProvider } from './application/ports/booking-provider'
export {
	type BuildReplyInput,
	type IcsMethod,
	IcsParser,
	type ParsedAttendee,
	type ParsedIcs,
	type ParsedVEvent,
} from './application/ports/ics-parser'
export type {
	AttendeeInput,
	CreateBookingInput,
	FindSlotsInput,
	ProviderBookingRef,
	ProviderEventTypeRef,
	RsvpInput,
	Slot,
	UpsertEventTypeInput,
} from './domain/calendar-event'
// ── Domain ─────────────────────────────────────────────────────────────────
export {
	CalendarAttendeeRsvp,
	CalendarEventProvider,
	CalendarEventSource,
	CalendarEventStatus,
	CalendarLocationType,
	CalendarProvider,
} from './domain/calendar-event'
export {
	BookingFailed,
	InvalidIcs,
	NoAvailability,
	UnsupportedRsvp,
} from './domain/errors'
// ── Infrastructure ─────────────────────────────────────────────────────────
export {
	BookingProviderLive,
	IcsParserLive,
} from './infrastructure/live'
export {
	makeStubBookingProvider,
	makeStubIcsParser,
	StubBookingProviderLayer,
	StubIcsParserLayer,
} from './infrastructure/stub'
