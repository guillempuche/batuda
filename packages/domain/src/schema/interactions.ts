import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const InteractionId = Schema.String.pipe(Schema.brand('InteractionId'))

export class Interaction extends Model.Class<Interaction>('Interaction')({
	id: Model.GeneratedByDb(InteractionId),
	companyId: Schema.String,
	contactId: Schema.NullOr(Schema.String),

	date: Schema.DateTimeUtcFromDate,
	durationMin: Schema.NullOr(Schema.Number),

	channel: Schema.String,
	// values: email | phone | visit | linkedin | instagram | whatsapp | event
	direction: Schema.String,
	// values: outbound | inbound
	type: Schema.String,
	// values: cold | followup | meeting | demo | check-in

	subject: Schema.NullOr(Schema.String),
	summary: Schema.NullOr(Schema.String),

	outcome: Schema.NullOr(Schema.String),
	// values: no_response | responded | interested | not_interested
	//         | meeting_scheduled | proposal_requested

	nextAction: Schema.NullOr(Schema.String),
	// A DATE column; node-postgres parses it into a JS Date, so read it as a
	// date-time and emit an ISO string on the wire.
	nextActionAt: Schema.NullOr(Schema.DateTimeUtcFromDate),

	metadata: Schema.NullOr(Schema.Unknown),
	createdAt: Model.DateTimeInsertFromDate,
}) {}
