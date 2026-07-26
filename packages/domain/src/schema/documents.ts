import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

import { DocumentSubjectTable } from './subject-tables'

export const DocumentId = Schema.String.pipe(Schema.brand('DocumentId'))

// What a document is for. The list is closed and kept here so that everything
// offering, filtering or writing a type means the same thing by it.
export const DOCUMENT_TYPES = [
	'general',
	'prenote',
	'postnote',
	'call_notes',
	'visit_notes',
	'research',
] as const
export const DocumentType = Schema.Literals(DOCUMENT_TYPES)
export type DocumentType = typeof DocumentType.Type

// Which record a document is filed under. A document can be filed in several
// places at once — a note from a visit belongs to the meeting and to the
// company both — so these come back as a list.
export const DocumentSubject = Schema.Struct({
	subjectTable: DocumentSubjectTable,
	subjectId: Schema.String,
})
export type DocumentSubject = typeof DocumentSubject.Type

// How a document's body is written. Markdown is typed and edited in place;
// HTML arrives already finished and is replaced whole rather than edited.
export const DOCUMENT_FORMATS = ['markdown', 'html'] as const
export const DocumentFormat = Schema.Literals(DOCUMENT_FORMATS)
export type DocumentFormat = typeof DocumentFormat.Type

export class Document extends Model.Class<Document>('Document')({
	id: Model.GeneratedByDb(DocumentId),
	type: DocumentType,
	format: DocumentFormat,
	title: Schema.NullOr(Schema.String),
	// The markdown body. An HTML document keeps its body in storage instead, so
	// this is empty for one.
	content: Schema.String,

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
