import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { PageService } from '../../services/pages'

const CreatePage = Tool.make('create_page', {
	description:
		'Create a prospect sales page (draft). Set lang to "ca" first, then create translations for the same slug.',
	parameters: Schema.Struct({
		company_id: Schema.optional(Schema.String),
		slug: Schema.String,
		lang: Schema.String,
		template: Schema.optional(Schema.String),
		title: Schema.String,
		content: Schema.Unknown,
	}),
	success: Schema.Unknown,
})

const UpdatePage = Tool.make('update_page', {
	description: 'Update page content, title, or meta.',
	parameters: Schema.Struct({
		id: Schema.String,
		title: Schema.optional(Schema.String),
		content: Schema.optional(Schema.Unknown),
		meta: Schema.optional(Schema.Unknown),
	}),
	success: Schema.Unknown,
})

const PublishPage = Tool.make('publish_page', {
	description: 'Publish a draft page — sets status to published.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Unknown,
})

const ListPages = Tool.make('list_pages', {
	description: 'List pages filtered by company, status, or language.',
	parameters: Schema.Struct({
		company_id: Schema.optional(Schema.String),
		status: Schema.optional(Schema.String),
		lang: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
})

const GetPage = Tool.make('get_page', {
	description: 'Get full page content by ID or slug+lang.',
	parameters: Schema.Struct({
		id_or_slug: Schema.String,
		lang: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
})

export const PageTools = Toolkit.make(
	CreatePage,
	UpdatePage,
	PublishPage,
	ListPages,
	GetPage,
)

export const PageHandlersLive = PageTools.toLayer(
	Effect.gen(function* () {
		const service = yield* PageService
		return {
			create_page: params =>
				Effect.gen(function* () {
					const rows = yield* service.create({
						companyId: params.company_id,
						slug: params.slug,
						lang: params.lang,
						template: params.template,
						title: params.title,
						content: params.content,
					})
					return rows[0]
				}).pipe(Effect.orDie),
			update_page: ({ id, title, content, meta }) =>
				Effect.gen(function* () {
					const data: Record<string, unknown> = {}
					if (title !== undefined) data['title'] = title
					if (content !== undefined) data['content'] = content
					if (meta !== undefined) data['meta'] = meta
					const rows = yield* service.update(id, data)
					return rows[0]
				}).pipe(Effect.orDie),
			publish_page: ({ id }) =>
				Effect.gen(function* () {
					const rows = yield* service.publish(id)
					return rows[0]
				}).pipe(Effect.orDie),
			list_pages: params =>
				Effect.gen(function* () {
					return yield* service.list({
						companyId: params.company_id,
						status: params.status,
						lang: params.lang,
					})
				}).pipe(Effect.orDie),
			get_page: ({ id_or_slug, lang }) =>
				Effect.gen(function* () {
					if (lang) {
						return yield* service.getBySlugAndLang(id_or_slug, lang)
					}
					return yield* service.getById(id_or_slug)
				}).pipe(Effect.orDie),
		}
	}),
)
