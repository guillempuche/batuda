import { DateTime, Effect, Layer, ServiceMap } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, NotFound } from '@batuda/controllers'

export interface CompanyFilters {
	readonly status?: string | undefined
	readonly region?: string | undefined
	readonly industry?: string | undefined
	readonly priority?: number | undefined
	readonly productFit?: string | undefined
	// Owner id to match, or the literal 'none' to match only unassigned companies.
	readonly owner?: string | undefined
	// One of the whitelisted sort keys below; anything else falls back to priority.
	readonly sort?: string | undefined
	readonly query?: string | undefined
	// Bounding box on the geocoded coordinates. Each bound is applied
	// independently, so a partial box (e.g. only a southern edge) still narrows.
	readonly minLat?: number | undefined
	readonly maxLat?: number | undefined
	readonly minLng?: number | undefined
	readonly maxLng?: number | undefined
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
						// 'none' narrows to unassigned leads; any other value matches one owner.
						if (filters.owner === 'none') conditions.push(sql`owner_id IS NULL`)
						else if (filters.owner)
							conditions.push(sql`owner_id = ${filters.owner}`)
						if (filters.query)
							conditions.push(sql`name ILIKE ${`%${filters.query}%`}`)
						if (filters.minLat !== undefined)
							conditions.push(sql`latitude >= ${filters.minLat}`)
						if (filters.maxLat !== undefined)
							conditions.push(sql`latitude <= ${filters.maxLat}`)
						if (filters.minLng !== undefined)
							conditions.push(sql`longitude >= ${filters.minLng}`)
						if (filters.maxLng !== undefined)
							conditions.push(sql`longitude <= ${filters.maxLng}`)

						// Whitelisted sort key → a fixed ORDER BY fragment; never
						// interpolate raw sort text into the query.
						const orderBy = ((): Statement.Fragment => {
							switch (filters.sort) {
								case 'name':
									return sql`name ASC`
								case 'recent_contact':
									return sql`last_contacted_at DESC NULLS LAST`
								case 'recent_update':
									return sql`updated_at DESC`
								default:
									return sql`priority, updated_at DESC`
							}
						})()

						return yield* sql`
							SELECT id, slug, name, status, industry, region, priority, owner_id,
								next_action, next_action_at, last_contacted_at, tags,
								-- NUMERIC comes back as a string over the wire; cast so
								-- callers get real numbers for the coordinates.
								latitude::float8 AS latitude, longitude::float8 AS longitude
							FROM companies
							WHERE ${sql.and(conditions)}
							ORDER BY ${orderBy}
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
							UPDATE companies SET ${sql.update({ ...data, updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()) })}
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
							SELECT c.*, COALESCE(
								(SELECT json_agg(ch ORDER BY ch.is_primary DESC, ch.kind)
								 FROM contact_channels ch WHERE ch.contact_id = c.id),
								'[]'::json
							) AS channels
							FROM contacts c
							WHERE c.company_id = ${company['id']}
							  AND c.organization_id = ${currentOrg.id}
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
