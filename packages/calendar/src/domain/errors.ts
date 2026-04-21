import { Schema } from 'effect'

/** External booking provider rejected a call (network, 4xx/5xx, shape mismatch). */
export class BookingFailed extends Schema.TaggedErrorClass<BookingFailed>()(
	'BookingFailed',
	{
		provider: Schema.String,
		reason: Schema.String,
		recoverable: Schema.Boolean,
	},
) {}

/** No slots available for the requested event type / window. */
export class NoAvailability extends Schema.TaggedErrorClass<NoAvailability>()(
	'NoAvailability',
	{
		eventTypeId: Schema.String,
		// ISO-8601 strings for log-friendliness; internal error, not a schema
		// boundary, so a serialized form beats carrying DateTime.Utc through.
		fromIso: Schema.String,
		toIso: Schema.String,
	},
) {}

/** ICS body could not be parsed into one or more valid VEVENTs. */
export class InvalidIcs extends Schema.TaggedErrorClass<InvalidIcs>()(
	'InvalidIcs',
	{
		reason: Schema.String,
	},
) {}

/** Provider does not support the requested RSVP transition (e.g., tentative on cal.com). */
export class UnsupportedRsvp extends Schema.TaggedErrorClass<UnsupportedRsvp>()(
	'UnsupportedRsvp',
	{
		provider: Schema.String,
		rsvp: Schema.Literals(['accepted', 'declined', 'tentative']),
	},
) {}
