import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const DocumentId = Schema.String.pipe(Schema.brand('DocumentId'))

export class Document extends Model.Class<Document>('Document')({
	id: Model.Generated(DocumentId),
	companyId: Schema.String,
	interactionId: Schema.NullOr(Schema.String),
	// links prenote/postnote to a specific meeting

	type: Schema.String,
	// values: research | prenote | postnote | call_notes | visit_notes | general
	title: Schema.NullOr(Schema.String),
	content: Schema.String,
	// full markdown

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
