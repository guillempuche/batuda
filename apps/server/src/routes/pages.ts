import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { NotFound } from '../errors'

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
	.add(
		// Public: get published page by slug+lang
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
		// Public: track page view
		HttpApiEndpoint.post('view', '/pages/:slug/view', {
			params: { slug: Schema.String },
			query: {
				lang: Schema.optional(Schema.String),
			},
			success: Schema.Void,
		}),
	)
	.add(
		// Internal: list pages
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
		// Internal: create page
		HttpApiEndpoint.post('create', '/v1/pages', {
			payload: CreatePageInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		// Internal: update page
		HttpApiEndpoint.patch('update', '/v1/pages/:id', {
			params: { id: Schema.String },
			payload: UpdatePageInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		// Internal: publish page
		HttpApiEndpoint.patch('publish', '/v1/pages/:id/publish', {
			params: { id: Schema.String },
			success: Schema.Unknown,
		}),
	)
