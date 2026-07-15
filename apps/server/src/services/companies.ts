import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, NotFound } from '@batuda/controllers'
import { Company, Contact, Interaction } from '@batuda/domain'

export interface CompanyFilters {
	readonly status?: string | undefined
	readonly country?: string | undefined
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

export class CompanyService extends Context.Service<CompanyService>()(
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
						if (filters.country)
							conditions.push(sql`country = ${filters.country}`)
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

						const rows = yield* sql`
							SELECT * FROM companies
							WHERE ${sql.and(conditions)}
							ORDER BY ${orderBy}
							LIMIT ${filters.limit ?? 20} OFFSET ${filters.offset ?? 0}
						`
						// Decode to the domain shape so the API encodes dates as ISO strings.
						return yield* Schema.decodeUnknownEffect(Schema.Array(Company))(
							rows,
						)
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
						return yield* Schema.decodeUnknownEffect(Company)(company)
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
						return yield* Schema.decodeUnknownEffect(Company)(company)
					}),

				create: (data: Record<string, unknown>) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows =
							yield* sql`INSERT INTO companies ${sql.insert({ ...data, organizationId: currentOrg.id })} RETURNING *`
						return yield* Schema.decodeUnknownEffect(Schema.Array(Company))(
							rows,
						)
					}),

				update: (id: string, data: Record<string, unknown>) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql`
							UPDATE companies SET ${sql.update({ ...data, updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()) })}
							WHERE id = ${id} AND organization_id = ${currentOrg.id}
							RETURNING *
						`
						return yield* Schema.decodeUnknownEffect(Schema.Array(Company))(
							rows,
						)
					}),

				getWithRelations: (slug: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const companyRows = yield* sql`
							SELECT * FROM companies
							WHERE slug = ${slug} AND organization_id = ${currentOrg.id}
							LIMIT 1
						`
						const companyRow = companyRows[0]
						if (!companyRow)
							return yield* new NotFound({
								entity: 'company',
								id: slug,
							})
						const companyId = companyRow['id']

						const contactRows = yield* sql`
							SELECT c.*, COALESCE(
								(SELECT json_agg(ch ORDER BY ch.is_primary DESC, ch.kind)
								 FROM contact_channels ch WHERE ch.contact_id = c.id),
								'[]'::json
							) AS channels
							FROM contacts c
							WHERE c.company_id = ${companyId}
							  AND c.organization_id = ${currentOrg.id}
						`

						const interactionRows = yield* sql`
							SELECT * FROM interactions
							WHERE company_id = ${companyId}
							  AND organization_id = ${currentOrg.id}
							ORDER BY date DESC
							LIMIT 5
						`

						const company =
							yield* Schema.decodeUnknownEffect(Company)(companyRow)
						// Decode each contact's own columns; `channels` is already JSON
						// from json_agg, so keep it as-is.
						const contacts = yield* Effect.forEach(contactRows, row =>
							Schema.decodeUnknownEffect(Contact)(row).pipe(
								Effect.map(c => ({
									...c,
									channels: (
										row as { readonly channels: ReadonlyArray<unknown> }
									).channels,
								})),
							),
						)
						const recentInteractions = yield* Schema.decodeUnknownEffect(
							Schema.Array(Interaction),
						)(interactionRows)

						return { ...company, contacts, recentInteractions }
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
