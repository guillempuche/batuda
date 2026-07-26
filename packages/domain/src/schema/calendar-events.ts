import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const CalendarEventTypeId = Schema.String.pipe(
	Schema.brand('CalendarEventTypeId'),
)
export const CalendarEventId = Schema.String.pipe(
	Schema.brand('CalendarEventId'),
)

// A bookable meeting kind (duration + location), synced from a scheduling
// provider or defined internally.
export class CalendarEventType extends Model.Class<CalendarEventType>(
	'CalendarEventType',
)({
	id: Model.GeneratedByDb(CalendarEventTypeId),
	slug: Schema.String,
	provider: Schema.String,
	// values: calcom | google | microsoft | internal
	providerEventTypeId: Schema.NullOr(Schema.String),
	title: Schema.String,
	durationMinutes: Schema.Number,
	locationKind: Schema.String,
	// values: video | phone | address | link | none
	defaultLocationValue: Schema.NullOr(Schema.String),
	active: Schema.Boolean,

	syncedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// A concrete calendar event (a booking, an emailed invite, or an internal
// block). `raw_ics` (BYTEA) is deliberately omitted — the wire never carries
// the binary iCal blob; excess columns are dropped on decode.
export class CalendarEvent extends Model.Class<CalendarEvent>('CalendarEvent')({
	id: Model.GeneratedByDb(CalendarEventId),
	source: Schema.String,
	// values: booking | email | internal
	provider: Schema.String,
	// values: calcom | google | microsoft | email | internal
	providerBookingId: Schema.NullOr(Schema.String),
	icalUid: Schema.String,
	icalSequence: Schema.Number,
	eventTypeId: Schema.NullOr(Schema.String),

	startAt: Schema.DateTimeUtcFromDate,
	endAt: Schema.DateTimeUtcFromDate,
	// Covers whole days rather than a slot within one, so it carries no
	// meaningful clock time and ends at midnight.
	allDay: Schema.Boolean,
	status: Schema.String,
	// values: confirmed | tentative | cancelled
	title: Schema.String,
	locationType: Schema.String,
	// values: video | phone | address | link | none
	locationValue: Schema.NullOr(Schema.String),
	videoCallUrl: Schema.NullOr(Schema.String),
	organizerEmail: Schema.String,

	companyId: Schema.NullOr(Schema.String),
	contactId: Schema.NullOr(Schema.String),
	interactionId: Schema.NullOr(Schema.String),
	metadata: Schema.NullOr(Schema.Unknown),

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// Someone invited to an event. `contactId` is null when the address matches
// nobody we know — which is exactly the person worth looking up before the
// meeting, so the wire carries the null rather than dropping the row.
export class CalendarEventAttendee extends Model.Class<CalendarEventAttendee>(
	'CalendarEventAttendee',
)({
	id: Model.GeneratedByDb(Schema.String),
	email: Schema.String,
	name: Schema.NullOr(Schema.String),
	contactId: Schema.NullOr(Schema.String),
	companyId: Schema.NullOr(Schema.String),
	rsvp: Schema.String,
	// values: needs-action | accepted | declined | tentative
	isOrganizer: Schema.Boolean,
	// What was decided when this address was compared against the people on
	// file. Null on a row nothing has judged.
	// values: matched | company_only | ambiguous | no_match
	matchStatus: Schema.NullOr(Schema.String),
	// Who the possibilities were, when more than one person could have been meant.
	matchCandidates: Schema.NullOr(Schema.Unknown),
}) {}
