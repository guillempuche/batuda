import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { NotFound } from '../errors'

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
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/documents/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/documents', {
			payload: CreateDocumentInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/documents/:id', {
			params: { id: Schema.String },
			payload: UpdateDocumentInput,
			success: Schema.Unknown,
		}),
	)
	.prefix('/v1')
