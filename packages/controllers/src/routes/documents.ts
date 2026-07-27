import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { Document, DocumentSubject, DocumentSubjectTable } from '@batuda/domain'

import { NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { PaginatedList } from '../pagination'

// A document plus the records it is filed under. The subjects live in their own
// table, so they ride alongside the row rather than in it.
//
// An HTML document's body is not here. It is a stored file, opened through
// `GET /documents/:id/open` — an address anyone holding this id can build, so it
// needs no field of its own.
export const DocumentDetail = Schema.Struct({
	...Document.json.fields,
	subjects: Schema.Array(DocumentSubject),
})

// Listing projection: everything but the full markdown `content`, so a long
// list stays cheap; `snippet` is the opening of it, enough for a row to show
// what the document says. Taken by leaving `content` out rather than by listing
// what to keep, so a field added to a document shows up here on its own.
const { content: _content, ...summaryFields } = Document.json.fields
export const DocumentSummary = Schema.Struct({
	...summaryFields,
	snippet: Schema.String,
	subjects: Schema.Array(DocumentSubject),
})

const CreateDocumentInput = Schema.Struct({
	// Every document starts filed somewhere; attach adds the rest later.
	subjectTable: DocumentSubjectTable,
	subjectId: Schema.String,
	type: Document.json.fields.type,
	// Markdown unless said otherwise. HTML is stored as sent and opens in its
	// own tab; it is replaced whole rather than edited.
	format: Schema.optional(Document.json.fields.format),
	title: Schema.optional(Schema.String),
	content: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
})

const UpdateDocumentInput = Schema.Struct({
	type: Schema.optional(Document.json.fields.type),
	title: Schema.optional(Schema.String),
	// Replaces the body, in whatever format the document already is.
	content: Schema.optional(Schema.String),
})

const LinkInput = Schema.Struct({
	subjectTable: DocumentSubjectTable,
	subjectId: Schema.String,
})

export const DocumentsGroup = HttpApiGroup.make('documents')
	.add(
		HttpApiEndpoint.get('list', '/documents', {
			query: {
				subjectTable: Schema.optional(DocumentSubjectTable),
				subjectId: Schema.optional(Schema.String),
				type: Schema.optional(Document.json.fields.type),
				// Substring match over title and content.
				q: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.NumberFromString),
				offset: Schema.optional(Schema.NumberFromString),
			},
			success: PaginatedList(DocumentSummary),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/documents/:id', {
			params: { id: Schema.String },
			success: DocumentDetail,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		// The address an HTML document opens at. It never changes, so it can be
		// sent to somebody or kept in a tab, and it is checked on every open —
		// unlike the storage link it redirects to, which expires and, while it
		// lasts, works for whoever holds it. Redirecting rather than serving the
		// page keeps markup somebody else wrote off this origin. `Schema.Unknown`
		// because the response is that redirect, not a body — same as the
		// attachment download.
		HttpApiEndpoint.get('open', '/documents/:id/open', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/documents', {
			payload: CreateDocumentInput,
			success: DocumentDetail,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/documents/:id', {
			params: { id: Schema.String },
			payload: UpdateDocumentInput,
			success: Schema.NullOr(DocumentDetail),
		}),
	)
	.add(
		HttpApiEndpoint.delete('remove', '/documents/:id', {
			params: { id: Schema.String },
			success: Schema.Void,
		}),
	)
	.add(
		// File an existing document under one more record. Filing it where it
		// already sits changes nothing rather than failing.
		HttpApiEndpoint.post('attach', '/documents/:id/subjects', {
			params: { id: Schema.String },
			payload: LinkInput,
			success: Schema.Void,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.delete(
			'detach',
			'/documents/:id/subjects/:subjectTable/:subjectId',
			{
				params: {
					id: Schema.String,
					subjectTable: DocumentSubjectTable,
					subjectId: Schema.String,
				},
				success: Schema.Void,
			},
		),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
