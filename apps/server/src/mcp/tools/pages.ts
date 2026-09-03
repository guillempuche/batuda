import { Effect, Schema } from 'effect'
import { McpSchema, Tool, Toolkit } from 'effect/unstable/ai'

import { CurrentOrg, PageSummary } from '@batuda/controllers'
import { Page } from '@batuda/domain'
import { BlockNode, TiptapDocument } from '@batuda/ui/blocks'

import { PageService } from '../../services/pages'
import { requireApproval } from './_elicit'
import { PageIdOrSlugParam, PageIdParam } from './_ids'
import { McpPageLimit, McpPageOffset, PageResult, toPage } from './_result'

// `publish_page` returns the published page, or a cancelled marker saying why
// nothing was published — the person declined, or this client has no way to put
// the question to them at all.
const PublishResult = Schema.Union([
	Page.json,
	Schema.Struct({
		status: Schema.Literal('cancelled'),
		reason: Schema.String,
	}),
])

const CreatePage = Tool.make('create_page', {
	description:
		'Create a prospect sales page (draft). One language per prospect is the norm; default lang is "en". slug is optional — omit it for prospect pages (company_id set) and the server generates a safe random URL like "acme-a3f2k1"; pass it explicitly only when cloning an existing prospect page into another language or creating a generic page without a company.',
	parameters: Schema.Struct({
		company_id: Schema.optionalKey(Schema.String),
		slug: Schema.optionalKey(Schema.String),
		lang: Schema.String,
		template: Schema.optionalKey(Schema.String),
		title: Schema.String,
		content: TiptapDocument,
	}),
	success: Schema.NullOr(Page.json),
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'Create Page')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdatePage = Tool.make('update_page', {
	description: 'Update page content, title, or meta.',
	parameters: Schema.Struct({
		id: PageIdParam,
		title: Schema.optionalKey(Schema.String),
		content: Schema.optionalKey(TiptapDocument),
		meta: Schema.optional(Schema.Unknown),
	}),
	success: Schema.NullOr(Page.json),
})
	.annotate(Tool.Title, 'Update Page')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const PublishPage = Tool.make('publish_page', {
	description:
		'Publish a draft page — sets status to published. This makes the page publicly visible.',
	parameters: Schema.Struct({
		id: PageIdParam,
	}),
	success: PublishResult,
	dependencies: [McpSchema.McpServerClient],
})
	.annotate(Tool.Title, 'Publish Page')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const ListPages = Tool.make('list_pages', {
	description:
		'List pages filtered by company, status, or language. `hasMore` says whether more matched than were returned — read it before saying how many there are, and ask again with a larger `offset` if it is true.',
	parameters: Schema.Struct({
		company_id: Schema.optionalKey(Schema.String),
		status: Schema.optionalKey(Schema.String),
		lang: Schema.optionalKey(Schema.String),
		limit: Schema.optionalKey(McpPageLimit),
		offset: Schema.optionalKey(McpPageOffset),
	}),
	success: PageResult(PageSummary),
})
	.annotate(Tool.Title, 'List Pages')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetPage = Tool.make('get_page', {
	description: 'Get full page content by ID or slug+lang.',
	parameters: Schema.Struct({
		id_or_slug: PageIdOrSlugParam,
		lang: Schema.optionalKey(Schema.String),
	}),
	success: Page.json,
})
	.annotate(Tool.Title, 'Get Page')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const EditPageBlock = Tool.make('edit_page_block', {
	description:
		'Edit a page block tree by position. action=insert puts block at position (appends if omitted); update merges attrs into the block at position; move relocates a block from->to; remove deletes the block at position.',
	parameters: Schema.Struct({
		page_id: PageIdParam,
		action: Schema.Literals(['insert', 'update', 'move', 'remove']),
		position: Schema.optionalKey(Schema.Number),
		block: Schema.optionalKey(BlockNode),
		attrs: Schema.optional(Schema.Unknown),
		from: Schema.optionalKey(Schema.Number),
		to: Schema.optionalKey(Schema.Number),
	}),
	success: Schema.NullOr(Page.json),
})
	.annotate(Tool.Title, 'Edit Page Block')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

export const PageTools = Toolkit.make(
	CreatePage,
	UpdatePage,
	PublishPage,
	ListPages,
	GetPage,
	EditPageBlock,
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
					return rows[0] ?? null
				}).pipe(Effect.orDie),
			update_page: ({ id, title, content, meta }) =>
				Effect.gen(function* () {
					const data: Record<string, unknown> = {}
					if (title !== undefined) data['title'] = title
					if (content !== undefined) data['content'] = content
					if (meta !== undefined) data['meta'] = meta
					const rows = yield* service.update(id, data)
					return rows[0] ?? null
				}).pipe(Effect.orDie),
			publish_page: ({ id }) =>
				Effect.gen(function* () {
					const page = yield* service.getById(id)
					// Making a page public is not something to do unasked, so a client
					// that cannot put the question stops here — and says that is why,
					// rather than reporting a refusal nobody gave.
					const answer = yield* requireApproval(
						`Publish page "${page['title']}" (${page['slug']}/${page['lang']})? This makes it publicly visible.`,
					)
					if (answer === 'unaskable')
						return {
							status: 'cancelled' as const,
							reason:
								'this client cannot ask anyone to confirm making the page public; publish it from the app instead',
						}
					if (answer === 'declined')
						return {
							status: 'cancelled' as const,
							reason: 'the page was not published because the answer was no',
						}
					const rows = yield* service.publish(id)
					const published = rows[0]
					if (published === undefined)
						return yield* Effect.die(new Error('publish returned no row'))
					return published
				}).pipe(Effect.orDie),
			list_pages: params =>
				Effect.gen(function* () {
					const pages = yield* service.list({
						companyId: params.company_id,
						status: params.status,
						lang: params.lang,
						limit: params.limit,
						offset: params.offset,
					})
					return toPage(pages)
				}).pipe(Effect.orDie),
			get_page: ({ id_or_slug, lang }) =>
				Effect.gen(function* () {
					if (lang) {
						return yield* service.getBySlugAndLang(id_or_slug, lang)
					}
					return yield* service.getById(id_or_slug)
				}).pipe(Effect.orDie),
			edit_page_block: params =>
				service
					.mutateContent(params.page_id, doc => {
						const content = [...doc.content]
						// Each action treats its missing/out-of-bounds params as a no-op
						// (returns the document unchanged) rather than failing.
						switch (params.action) {
							case 'insert': {
								const idx = params.position ?? content.length
								if (params.block) content.splice(idx, 0, params.block)
								return { ...doc, content }
							}
							case 'update': {
								if (params.position === undefined) return doc
								const existing = content[params.position]
								if (!existing || !('attrs' in existing)) return doc
								content[params.position] = {
									...existing,
									attrs: {
										...existing.attrs,
										...(params.attrs as Record<string, unknown>),
									},
								} as typeof existing
								return { ...doc, content }
							}
							case 'move': {
								if (params.from === undefined || params.to === undefined)
									return doc
								if (params.from < 0 || params.from >= content.length) return doc
								const [block] = content.splice(params.from, 1)
								if (block) content.splice(params.to, 0, block)
								return { ...doc, content }
							}
							case 'remove': {
								if (params.position === undefined) return doc
								if (params.position < 0 || params.position >= content.length)
									return doc
								content.splice(params.position, 1)
								return { ...doc, content }
							}
						}
					})
					.pipe(
						Effect.map(r => r[0] ?? null),
						Effect.orDie,
					),
		}
	}),
)
