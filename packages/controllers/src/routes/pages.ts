import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { NotFound } from '../errors'
import { SessionMiddleware } from '../middleware/session'

const CreatePageInput = Schema.Struct({
	companyId: Schema.optional(Schema.String),
	slug: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9-]+$/))),
	lang: Schema.String,
	title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	template: Schema.optional(Schema.String),
	content: Schema.Unknown,
	meta: Schema.optional(Schema.Unknown),
})

const UpdatePageInput = Schema.Struct({
	title: Schema.optional(Schema.String),
	content: Schema.optional(Schema.Unknown),
	meta: Schema.optional(Schema.Unknown),
	status: Schema.optional(Schema.String),
})

export const PagesGroup = HttpApiGroup.make('pages')
	// Protected endpoints FIRST
	.add(
		HttpApiEndpoint.get('list', '/v1/pages', {
			query: {
				companyId: Schema.optional(Schema.String),
				status: Schema.optional(Schema.String),
				lang: Schema.optional(Schema.String),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/v1/pages', {
			payload: CreatePageInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/v1/pages/:id', {
			params: { id: Schema.String },
			payload: UpdatePageInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('publish', '/v1/pages/:id/publish', {
			params: { id: Schema.String },
			success: Schema.Unknown,
		}),
	)
	.middleware(SessionMiddleware)
	// Public endpoints AFTER (no auth)
	.add(
		HttpApiEndpoint.get('getPublic', '/pages/:slug', {
			params: { slug: Schema.String },
			query: {
				lang: Schema.optional(Schema.String),
			},
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('view', '/pages/:slug/view', {
			params: { slug: Schema.String },
			query: {
				lang: Schema.optional(Schema.String),
			},
			success: Schema.Void,
		}),
	)
