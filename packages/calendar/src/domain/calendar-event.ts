import { Schema } from 'effect'

export const CalendarProvider = Schema.Literals([
	'calcom',
	'google',
	'microsoft',
	'internal',
])
export type CalendarProvider = typeof CalendarProvider.Type

export const CalendarEventSource = Schema.Literals([
	'booking',
	'email',
	'internal',
])
export type CalendarEventSource = typeof CalendarEventSource.Type

export const CalendarEventProvider = Schema.Literals([
	'calcom',
	'google',
	'microsoft',
	'email',
	'internal',
])
export type CalendarEventProvider = typeof CalendarEventProvider.Type

export const CalendarEventStatus = Schema.Literals([
	'confirmed',
	'tentative',
	'cancelled',
])
export type CalendarEventStatus = typeof CalendarEventStatus.Type

export const CalendarLocationType = Schema.Literals([
	'video',
	'phone',
	'address',
	'link',
	'none',
])
export type CalendarLocationType = typeof CalendarLocationType.Type

export const CalendarAttendeeRsvp = Schema.Literals([
	'needs-action',
	'accepted',
	'declined',
	'tentative',
])
export type CalendarAttendeeRsvp = typeof CalendarAttendeeRsvp.Type

// Cross-provider identity for a booking we own. Returned by
// `BookingProvider.createBooking` and consumed by the calendar service to
// upsert into `calendar_events`. `icalUid` + `icalSequence` are the storage
// keys; `providerBookingId` + `provider` round-trip through the adapter so
// later cancel/reschedule calls can find the upstream row.
export interface ProviderBookingRef {
	readonly provider: CalendarProvider
	readonly providerBookingId: string
	readonly icalUid: string
	readonly icalSequence: number
}

export interface Slot {
	readonly start: Date
	readonly end: Date
}

export interface AttendeeInput {
	readonly email: string
	readonly name: string | null
}

// Payload to create a new booking via the provider.
export interface CreateBookingInput {
	readonly providerEventTypeId: string
	readonly startAt: Date
	readonly attendees: ReadonlyArray<AttendeeInput>
	readonly metadata: Record<string, unknown> | null
}

export interface FindSlotsInput {
	readonly providerEventTypeId: string
	readonly from: Date
	readonly to: Date
}

// Provider-side event type descriptor. `providerEventTypeId` is the string
// form of the upstream id (cal.com returns numeric; Google/Microsoft return
// strings — we normalize to text at this boundary).
export interface ProviderEventTypeRef {
	readonly provider: CalendarProvider
	readonly providerEventTypeId: string | null
	readonly slug: string
	readonly title: string
	readonly durationMinutes: number
	readonly locationKind: CalendarLocationType
	readonly defaultLocationValue: string | null
	readonly active: boolean
}

export interface UpsertEventTypeInput {
	readonly slug: string
	readonly title: string
	readonly durationMinutes: number
	readonly locationKind: CalendarLocationType
	readonly defaultLocationValue: string | null
}

export interface RsvpInput {
	readonly providerBookingId: string
	readonly rsvp: 'accepted' | 'declined' | 'tentative'
	readonly comment: string | null
}
