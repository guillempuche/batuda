import { Effect, Layer, ServiceMap } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, NotFound } from '@batuda/controllers'

export interface CompanyFilters {
	readonly status?: string | undefined
	readonly region?: string | undefined
	readonly industry?: string | undefined
	readonly priority?: number | undefined
	readonly productFit?: string | undefined
	readonly query?: string | undefined
	readonly limit?: number | undefined
	readonly offset?: number | undefined
}

export class CompanyService extends ServiceMap.Service<CompanyService>()(
	'CompanyService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			return {
				search: (filters: CompanyFilters) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const conditions: Array<Statement.Fragment> = [
							sql`organization_id = ${currentOrg.id}`,
						]
						if (filters.status) conditions.push(sql`status = ${filters.status}`)
						if (filters.region) conditions.push(sql`region = ${filters.region}`)
						if (filters.industry)
							conditions.push(sql`industry = ${filters.industry}`)
						if (filters.priority)
							conditions.push(sql`priority = ${filters.priority}`)
						if (filters.query)
							conditions.push(sql`name ILIKE ${`%${filters.query}%`}`)

						return yield* sql`
							SELECT id, slug, name, status, industry, region, priority,
								next_action, next_action_at, last_contacted_at, tags
							FROM companies
							WHERE ${sql.and(conditions)}
							ORDER BY priority, updated_at DESC
							LIMIT ${filters.limit ?? 20} OFFSET ${filters.offset ?? 0}
						`
					}),

				findBySlug: (slug: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql`
							SELECT * FROM companies
							WHERE slug = ${slug} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`
						const company = rows[0]
						if (!company)
							return yield* new NotFound({
								entity: 'company',
								id: slug,
							})
						return company
					}),

				findById: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql`
							SELECT * FROM companies
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`
						const company = rows[0]
						if (!company)
							return yield* new NotFound({
								entity: 'company',
								id,
							})
						return company
					}),

				create: (data: Record<string, unknown>) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* sql`INSERT INTO companies ${sql.insert({ ...data, organizationId: currentOrg.id })} RETURNING *`
					}),

				update: (id: string, data: Record<string, unknown>) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* sql`
							UPDATE companies SET ${sql.update({ ...data, updatedAt: new Date() })}
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`
					}),

				getWithRelations: (slug: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const companyRows = yield* sql`
							SELECT * FROM companies
							WHERE slug = ${slug} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`
						const company = companyRows[0]
						if (!company)
							return yield* new NotFound({
								entity: 'company',
								id: slug,
							})

						const contacts = yield* sql`
							SELECT * FROM contacts
							WHERE company_id = ${company['id']}
							  AND organization_id = ${currentOrg.id}
						`

						const recentInteractions = yield* sql`
							SELECT * FROM interactions
							WHERE company_id = ${company['id']}
							  AND organization_id = ${currentOrg.id}
							ORDER BY date DESC
							LIMIT 5
						`

						return { ...company, contacts, recentInteractions }
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
