import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { Page } from '@batuda/domain'
import { TiptapDocument } from '@batuda/ui/blocks'

import { NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

// Listing projection: page metadata without the Tiptap `content`/`meta` blobs,
// so a company's page index stays light.
export const PageSummary = Schema.Struct({
	id: Page.json.fields.id,
	companyId: Page.json.fields.companyId,
	slug: Page.json.fields.slug,
	lang: Page.json.fields.lang,
	title: Page.json.fields.title,
	status: Page.json.fields.status,
	template: Page.json.fields.template,
	viewCount: Page.json.fields.viewCount,
	publishedAt: Page.json.fields.publishedAt,
})

const CreatePageInput = Schema.Struct({
	companyId: Schema.optional(Schema.String),
	slug: Schema.optional(
		Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9-]+$/))),
	),
	lang: Schema.String,
	title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	template: Schema.optional(Schema.String),
	content: TiptapDocument,
	meta: Schema.optional(Schema.Unknown),
})

const UpdatePageInput = Schema.Struct({
	title: Schema.optional(Schema.String),
	content: Schema.optional(TiptapDocument),
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
			success: Schema.Array(PageSummary),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/v1/pages/:id', {
			params: { id: Schema.String },
			success: Page.json,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/v1/pages', {
			payload: CreatePageInput,
			success: Schema.NullOr(Page.json),
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/v1/pages/:id', {
			params: { id: Schema.String },
			payload: UpdatePageInput,
			success: Schema.NullOr(Page.json),
		}),
	)
	.add(
		HttpApiEndpoint.patch('publish', '/v1/pages/:id/publish', {
			params: { id: Schema.String },
			success: Schema.NullOr(Page.json),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	// Public endpoints AFTER (no auth)
	.add(
		HttpApiEndpoint.get('getPublic', '/pages/:slug', {
			params: { slug: Schema.String },
			query: {
				lang: Schema.optional(Schema.String),
			},
			success: Page.json,
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
