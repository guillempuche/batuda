import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { Document } from '@batuda/domain'

import { NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

// Listing projection: everything but the full markdown `content`, so a company
// index stays cheap.
export const DocumentSummary = Schema.Struct({
	id: Document.json.fields.id,
	companyId: Document.json.fields.companyId,
	type: Document.json.fields.type,
	title: Document.json.fields.title,
	createdAt: Document.json.fields.createdAt,
})

const CreateDocumentInput = Schema.Struct({
	companyId: Schema.String,
	interactionId: Schema.optional(Schema.String),
	type: Schema.String,
	title: Schema.optional(Schema.String),
	content: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
})

const UpdateDocumentInput = Schema.Struct({
	title: Schema.optional(Schema.String),
	content: Schema.optional(Schema.String),
})

export const DocumentsGroup = HttpApiGroup.make('documents')
	.add(
		HttpApiEndpoint.get('list', '/documents', {
			query: {
				companyId: Schema.optional(Schema.String),
				type: Schema.optional(Schema.String),
			},
			success: Schema.Array(Document.json),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/documents/:id', {
			params: { id: Schema.String },
			success: Document.json,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/documents', {
			payload: CreateDocumentInput,
			success: Document.json,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/documents/:id', {
			params: { id: Schema.String },
			payload: UpdateDocumentInput,
			success: Schema.NullOr(Document.json),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
