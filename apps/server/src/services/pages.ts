import { Effect, Layer, ServiceMap } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { NotFound } from '@engranatge/controllers'

export interface PageFilters {
	readonly companyId?: string | undefined
	readonly status?: string | undefined
	readonly lang?: string | undefined
}

export class PageService extends ServiceMap.Service<PageService>()(
	'PageService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

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

				create: (data: Record<string, unknown>) =>
					sql`INSERT INTO pages ${sql.insert(data)} RETURNING *`,

				update: (id: string, data: Record<string, unknown>) =>
					sql`UPDATE pages SET ${sql.update({ ...data, updatedAt: new Date() })} WHERE id = ${id} RETURNING *`,

				publish: (id: string) =>
					sql`UPDATE pages SET status = 'published', published_at = now(), updated_at = now() WHERE id = ${id} RETURNING *`,

				incrementView: (slug: string, lang: string) =>
					sql`UPDATE pages SET view_count = view_count + 1 WHERE slug = ${slug} AND lang = ${lang}`,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
