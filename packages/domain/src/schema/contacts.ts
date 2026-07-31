import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const ContactId = Schema.String.pipe(Schema.brand('ContactId'))

// Reachable addresses (email, phone, linkedin, …) live in `channels`,
// the single source of truth — `contacts` carries only identity + activity.
export class Contact extends Model.Class<Contact>('Contact')({
	id: Model.GeneratedByDb(ContactId),
	companyId: Schema.String,
	// The branch this person works at. Beside `companyId` rather than replacing
	// it: someone who covers several branches belongs to the company, and that is
	// most people, so null is an ordinary answer rather than a gap.
	siteId: Schema.NullOr(Schema.String),

	name: Schema.String,
	role: Schema.NullOr(Schema.String),
	// What part this person plays in deciding whether their company buys —
	// economic buyer, champion, gatekeeper, technical evaluator, user. Null means
	// nobody has said, which is a real answer and is not the same as "no".
	// Free text for the same reason industry is: a stored value the vocabulary
	// does not yet know is shown, never decode-rejected.
	buyingRole: Schema.NullOr(Schema.String),

	metadata: Schema.NullOr(Schema.Unknown),

	lastEmailAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	lastCallAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	lastMeetingAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	nextCalendarEventAt: Schema.NullOr(Schema.DateTimeUtcFromDate),

	// Where each fact about this person came from and when it was true — the page
	// it was read on, the run that read it, how sure that run was, and the date
	// the page dated it to. The same record a company keeps, and it matters more
	// here: a job title from eighteen months ago is worse than none, because it
	// gets quoted confidently in an opening line.
	fieldProvenance: Schema.NullOr(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				sourceUrl: Schema.String,
				runId: Schema.String,
				confidence: Schema.optionalKey(Schema.Number),
				asOf: Schema.optionalKey(Schema.String),
			}),
		),
	),

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
