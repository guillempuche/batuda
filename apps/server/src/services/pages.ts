import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient, type SqlError } from 'effect/unstable/sql'

import { CurrentOrg, NotFound, PageSummary } from '@batuda/controllers'
import { Page } from '@batuda/domain'
import { TiptapDocument } from '@batuda/ui/blocks'

import {
	type CountMode,
	pageOf,
	probeLimit,
	resolveTotal,
	takePage,
	totalColumn,
} from '../lib/sql-pagination'
import { CompanyService } from './companies'
import { buildPageSlug } from './page-slug'

export interface PageFilters {
	readonly companyId?: string | undefined
	readonly status?: string | undefined
	readonly lang?: string | undefined
	readonly limit?: number | undefined
	readonly offset?: number | undefined
	readonly count?: CountMode | undefined
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

const decodePage = Schema.decodeUnknownEffect(Page)
const decodePages = Schema.decodeUnknownEffect(Schema.Array(Page))
// The listing query reads the summary columns with the raw Date, so override
// just the timestamp before decoding into the wire summary shape.
const PageSummaryRow = Schema.Struct({
	...PageSummary.fields,
	publishedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
})
const decodeSummaries = Schema.decodeUnknownEffect(Schema.Array(PageSummaryRow))

export class PageService extends Context.Service<PageService>()('PageService', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const companies = yield* CompanyService

		const insertPage = (data: Record<string, unknown>, orgId: string) =>
			sql`INSERT INTO pages ${sql.insert({ ...data, organizationId: orgId })} RETURNING *`

		const create = (data: CreatePageData) =>
			Effect.gen(function* () {
				const currentOrg = yield* CurrentOrg
				const { slug, companyId, ...rest } = data
				if (slug) {
					const rows = yield* insertPage(
						{ ...rest, companyId, slug },
						currentOrg.id,
					)
					return yield* decodePages(rows)
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
					const result = yield* insertPage(
						{ ...rest, companyId, slug: candidate },
						currentOrg.id,
					).pipe(
						Effect.catch((err: SqlError.SqlError) =>
							err.reason._tag === 'UniqueViolation' && attempt < maxAttempts
								? Effect.succeed(null)
								: Effect.fail(err),
						),
					)
					if (result !== null) return yield* decodePages(result)
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
				const updated =
					yield* sql`UPDATE pages SET content = ${JSON.stringify(encoded)}, updated_at = now() WHERE id = ${id} RETURNING *`
				return yield* decodePages(updated)
			})

		return {
			list: (filters: PageFilters) =>
				Effect.gen(function* () {
					const page = pageOf(filters, 100)
					const conditions: Array<Statement.Fragment> = []
					if (filters.companyId)
						conditions.push(sql`company_id = ${filters.companyId}`)
					if (filters.status) conditions.push(sql`status = ${filters.status}`)
					if (filters.lang) conditions.push(sql`lang = ${filters.lang}`)

					const probed = yield* sql<{ readonly total?: string | number }>`
						SELECT id, slug, lang, title, status, template,
							view_count, published_at, company_id
							${totalColumn(sql, page.count)}
						FROM pages
						WHERE ${sql.and(conditions)}
						LIMIT ${probeLimit(page.limit)} OFFSET ${page.offset}
					`
					const { rows, hasMore } = takePage(probed, page.limit)
					const total = yield* resolveTotal(
						page,
						rows,
						() => sql<{ readonly count: string | number }>`
							SELECT count(*) AS count FROM pages
							WHERE ${sql.and(conditions)}
						`,
					)
					const items = yield* decodeSummaries(rows)
					return {
						items,
						total,
						limit: page.limit,
						offset: page.offset,
						hasMore,
					}
				}),

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
					return yield* decodePage(page)
				}),

			getById: (id: string) =>
				Effect.gen(function* () {
					const rows = yield* sql`SELECT * FROM pages WHERE id = ${id} LIMIT 1`
					const page = rows[0]
					if (!page)
						return yield* new NotFound({
							entity: 'page',
							id,
						})
					return yield* decodePage(page)
				}),

			create,

			update: (id: string, data: Record<string, unknown>) =>
				sql`UPDATE pages SET ${sql.update({ ...data, updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()) })} WHERE id = ${id} RETURNING *`.pipe(
					Effect.flatMap(decodePages),
				),

			publish: (id: string) =>
				sql`UPDATE pages SET status = 'published', published_at = now(), updated_at = now() WHERE id = ${id} RETURNING *`.pipe(
					Effect.flatMap(decodePages),
				),

			incrementView: (slug: string, lang: string) =>
				sql`UPDATE pages SET view_count = view_count + 1 WHERE slug = ${slug} AND lang = ${lang}`,

			mutateContent,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(CompanyService.layer),
	)
}
