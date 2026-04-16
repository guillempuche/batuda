import { Effect, Layer, Schema, ServiceMap } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient, type SqlError } from 'effect/unstable/sql'

import { NotFound } from '@engranatge/controllers'
import { TiptapDocument } from '@engranatge/ui/blocks'

import { CompanyService } from './companies'
import { buildPageSlug } from './page-slug'

export interface PageFilters {
	readonly companyId?: string | undefined
	readonly status?: string | undefined
	readonly lang?: string | undefined
}

export interface CreatePageData {
	readonly slug?: string | undefined
	readonly companyId?: string | undefined
	readonly lang: string
	readonly title: string
	readonly template?: string | undefined
	readonly content: unknown
	readonly meta?: unknown
}

export class SlugRequired extends Schema.TaggedErrorClass<SlugRequired>()(
	'SlugRequired',
	{ reason: Schema.String },
) {}

export class SlugCollision extends Schema.TaggedErrorClass<SlugCollision>()(
	'SlugCollision',
	{ attempts: Schema.Number },
) {}

const decodeDocument = Schema.decodeUnknownEffect(TiptapDocument)
const encodeDocument = Schema.encodeEffect(TiptapDocument)

export class PageService extends ServiceMap.Service<PageService>()(
	'PageService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const companies = yield* CompanyService

			const insertPage = (data: Record<string, unknown>) =>
				sql`INSERT INTO pages ${sql.insert(data)} RETURNING *`

			const create = (data: CreatePageData) =>
				Effect.gen(function* () {
					const { slug, companyId, ...rest } = data
					if (slug) {
						return yield* insertPage({ ...rest, companyId, slug })
					}
					if (!companyId) {
						return yield* new SlugRequired({
							reason:
								'slug is required when companyId is not provided (generic pages must declare their slug explicitly)',
						})
					}
					const company = yield* companies.findById(companyId)
					const companySlug = String(company['slug'])
					const maxAttempts = 3
					for (let attempt = 1; attempt <= maxAttempts; attempt++) {
						const candidate = buildPageSlug(companySlug)
						const result = yield* insertPage({
							...rest,
							companyId,
							slug: candidate,
						}).pipe(
							Effect.catch((err: SqlError.SqlError) =>
								err.reason._tag === 'ConstraintError' && attempt < maxAttempts
									? Effect.succeed(null)
									: Effect.fail(err),
							),
						)
						if (result !== null) return result
					}
					return yield* new SlugCollision({ attempts: maxAttempts })
				})

			const mutateContent = (
				id: string,
				mutator: (doc: TiptapDocument) => TiptapDocument,
			) =>
				Effect.gen(function* () {
					const rows =
						yield* sql`SELECT content FROM pages WHERE id = ${id} LIMIT 1`
					const row = rows[0]
					if (!row) return yield* new NotFound({ entity: 'page', id })
					const doc = yield* decodeDocument(row['content'])
					const next = mutator(doc)
					const encoded = yield* encodeDocument(next)
					return yield* sql`UPDATE pages SET content = ${JSON.stringify(encoded)}, updated_at = now() WHERE id = ${id} RETURNING *`
				})

			return {
				list: (filters: PageFilters) => {
					const conditions: Array<Statement.Fragment> = []
					if (filters.companyId)
						conditions.push(sql`company_id = ${filters.companyId}`)
					if (filters.status) conditions.push(sql`status = ${filters.status}`)
					if (filters.lang) conditions.push(sql`lang = ${filters.lang}`)

					return sql`
						SELECT id, slug, lang, title, status, template,
							view_count, published_at, company_id
						FROM pages
						WHERE ${sql.and(conditions)}
					`
				},

				getBySlugAndLang: (slug: string, lang: string) =>
					Effect.gen(function* () {
						const rows = yield* sql`
							SELECT * FROM pages
							WHERE slug = ${slug} AND lang = ${lang} AND status = 'published'
							LIMIT 1
						`
						const page = rows[0]
						if (!page)
							return yield* new NotFound({
								entity: 'page',
								id: `${slug}/${lang}`,
							})
						return page
					}),

				getById: (id: string) =>
					Effect.gen(function* () {
						const rows =
							yield* sql`SELECT * FROM pages WHERE id = ${id} LIMIT 1`
						const page = rows[0]
						if (!page)
							return yield* new NotFound({
								entity: 'page',
								id,
							})
						return page
					}),

				create,

				update: (id: string, data: Record<string, unknown>) =>
					sql`UPDATE pages SET ${sql.update({ ...data, updatedAt: new Date() })} WHERE id = ${id} RETURNING *`,

				publish: (id: string) =>
					sql`UPDATE pages SET status = 'published', published_at = now(), updated_at = now() WHERE id = ${id} RETURNING *`,

				incrementView: (slug: string, lang: string) =>
					sql`UPDATE pages SET view_count = view_count + 1 WHERE slug = ${slug} AND lang = ${lang}`,

				mutateContent,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(CompanyService.layer),
	)
}
