import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { CompanyResearchRun, CurrentOrg, NotFound } from '@batuda/controllers'
import { Company, Contact, Interaction } from '@batuda/domain'

import {
	type CountMode,
	pageOf,
	probeLimit,
	resolveTotal,
	takePage,
	totalColumn,
} from '../lib/sql-pagination'
import {
	channelsJsonFor,
	splitCompanyChannelFields,
	writeChannels,
} from './channels'
import { researchProvenance } from './research-provenance'

export interface CompanyFilters {
	readonly status?: string | undefined
	readonly country?: string | undefined
	readonly industry?: string | undefined
	readonly priority?: number | undefined
	readonly productFit?: string | undefined
	// The run's overall judgement of whether this company is worth selling to.
	readonly fitVerdict?: string | undefined
	// Narrows to companies whose fit checks marked a matching rule passed, so a
	// salesperson can ask "who actually meets this criterion?" rather than
	// trusting the one-word verdict alone.
	readonly fitCriterionPassed?: string | undefined
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
	readonly count?: CountMode | undefined
}

/**
 * A registration number stripped down to the part that identifies the company:
 * punctuation and spacing removed, letters raised.
 *
 * The same Spanish company is printed "B12345678", "B-12345678" and "ES B12345678"
 * on three different pages, and comparing those as typed would treat one company as
 * three. Must stay in step with the expression the index is built on, or a
 * comparison stops using it.
 */
export const normalizeTaxId = (taxId: string): string =>
	taxId.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

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
						if (filters.fitVerdict)
							conditions.push(sql`fit_verdict = ${filters.fitVerdict}`)
						// A missing or empty fit_checks simply matches nothing, rather than
						// tripping the element expansion on a null.
						if (filters.fitCriterionPassed)
							conditions.push(
								sql`EXISTS (
									SELECT 1 FROM jsonb_array_elements(COALESCE(fit_checks, '[]'::jsonb)) fc
									WHERE fc->>'result' = 'pass'
										AND fc->>'criterion' ILIKE ${`%${filters.fitCriterionPassed}%`}
								)`,
							)
						if (filters.query)
							conditions.push(sql`name ILIKE ${`%${filters.query}%`}`)
						// A rectangle on the map matches a company when the company's own
						// pin is inside it, or when any of its branches is. Without the
						// second half, a chain registered in one city is invisible to
						// somebody drawing a box around another — even with a shop on that
						// city's main street. Each bound is still applied on its own, so a
						// half-drawn box narrows rather than matching nothing.
						const box: Array<Statement.Fragment> = []
						const siteBox: Array<Statement.Fragment> = []
						if (filters.minLat !== undefined) {
							box.push(sql`latitude >= ${filters.minLat}`)
							siteBox.push(sql`s.latitude >= ${filters.minLat}`)
						}
						if (filters.maxLat !== undefined) {
							box.push(sql`latitude <= ${filters.maxLat}`)
							siteBox.push(sql`s.latitude <= ${filters.maxLat}`)
						}
						if (filters.minLng !== undefined) {
							box.push(sql`longitude >= ${filters.minLng}`)
							siteBox.push(sql`s.longitude >= ${filters.minLng}`)
						}
						if (filters.maxLng !== undefined) {
							box.push(sql`longitude <= ${filters.maxLng}`)
							siteBox.push(sql`s.longitude <= ${filters.maxLng}`)
						}
						if (box.length > 0)
							conditions.push(
								sql`(
									(${sql.and(box)})
									OR EXISTS (
										SELECT 1 FROM sites s
										WHERE s.company_id = companies.id
											AND s.latitude IS NOT NULL
											AND s.longitude IS NOT NULL
											AND ${sql.and(siteBox)}
									)
								)`,
							)

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

						const page = pageOf(filters, 20)
						const probed = yield* sql<{ readonly total?: string | number }>`
							SELECT *${totalColumn(sql, page.count)} FROM companies
							WHERE ${sql.and(conditions)}
							ORDER BY ${orderBy}
							LIMIT ${probeLimit(page.limit)} OFFSET ${page.offset}
						`
						const { rows, hasMore } = takePage(probed, page.limit)

						const total = yield* resolveTotal(
							page,
							rows,
							() => sql<{ readonly count: string | number }>`
								SELECT count(*) AS count FROM companies
								WHERE ${sql.and(conditions)}
							`,
						)

						// Decode to the domain shape so the API encodes dates as ISO strings.
						const items = yield* Schema.decodeUnknownEffect(
							Schema.Array(Company),
						)(rows)
						return {
							items,
							total,
							limit: page.limit,
							offset: page.offset,
							hasMore,
						}
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
						const split = splitCompanyChannelFields(data)
						const rows =
							yield* sql`INSERT INTO companies ${sql.insert({ ...split.columns, organizationId: currentOrg.id })} RETURNING *`
						const row = rows[0]
						if (row !== undefined && split.channels.length > 0) {
							yield* writeChannels(
								sql,
								currentOrg.id,
								{ table: 'companies', id: String(row['id']) },
								split.channels,
							)
						}
						return yield* Schema.decodeUnknownEffect(Schema.Array(Company))(
							rows,
						)
					}),

				// Insert a batch in one transaction, leaving out any company already on
				// file — a duplicate is a conflict, not a failure, so the whole batch
				// must not die on one. Each row inserts its own columns, so companies
				// with different optional fields batch cleanly.
				//
				// A company is already on file if either of two things matches. Its slug,
				// which the table enforces. Or its registration number, which is the
				// surer of the two — the same firm reaches us under "Acme" and "Acme
				// Logistics SL" and gets two different slugs, while its number is the
				// same both times. That one has to be looked up rather than left to the
				// table: a single statement can name only one conflict to watch for.
				//
				// The lookup runs inside the same transaction as the inserts, so a number
				// repeated twice within one batch is caught on the second one too.
				//
				// Both keys are reported back by what matched, so a caller told a company
				// was left out can tell "you already have this slug" from "you already
				// have this company under another name" without guessing.
				createMany: (items: ReadonlyArray<Record<string, unknown>>) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const inserted: Array<unknown> = []
						const skipped: Array<{
							readonly slug: string
							readonly matchedOn: 'slug' | 'taxId'
						}> = []
						for (const data of items) {
							const slug = typeof data['slug'] === 'string' ? data['slug'] : ''
							const taxId =
								typeof data['taxId'] === 'string' ? data['taxId'] : null
							if (taxId !== null && normalizeTaxId(taxId) !== '') {
								const existing = yield* sql`
									SELECT id FROM companies
									WHERE organization_id = ${currentOrg.id}
										AND tax_id IS NOT NULL
										AND upper(regexp_replace(tax_id, '[^A-Za-z0-9]', '', 'g'))
											= ${normalizeTaxId(taxId)}
									LIMIT 1
								`
								if (existing.length > 0) {
									skipped.push({ slug, matchedOn: 'taxId' })
									continue
								}
							}
							const split = splitCompanyChannelFields(data)
							const rows = yield* sql`
								INSERT INTO companies ${sql.insert({ ...split.columns, organizationId: currentOrg.id })}
								ON CONFLICT (organization_id, slug) DO NOTHING
								RETURNING *
							`
							const row = rows[0]
							if (row === undefined) skipped.push({ slug, matchedOn: 'slug' })
							else {
								if (split.channels.length > 0) {
									yield* writeChannels(
										sql,
										currentOrg.id,
										{ table: 'companies', id: String(row['id']) },
										split.channels,
									)
								}
								inserted.push(row)
							}
						}
						const created = yield* Schema.decodeUnknownEffect(
							Schema.Array(Company),
						)(inserted)
						return { created, skipped }
					}).pipe(sql.withTransaction),

				update: (id: string, data: Record<string, unknown>) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						// Bumping the version on every edit is what lets a research apply notice
						// that somebody changed the row while the run was thinking, so its findings
						// can never quietly overwrite a person's edit.
						const split = splitCompanyChannelFields(data)
						if (split.channels.length > 0) {
							yield* writeChannels(
								sql,
								currentOrg.id,
								{ table: 'companies', id },
								split.channels,
							)
						}
						const rows = yield* sql`
							UPDATE companies SET ${sql.update({ ...split.columns, updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()) })},
								version = version + 1
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
							SELECT c.*, ${channelsJsonFor(sql, 'companies')} AS channels
							FROM companies c
							WHERE c.slug = ${slug} AND c.organization_id = ${currentOrg.id}
							LIMIT 1
						`
						const companyRow = companyRows[0]
						if (!companyRow)
							return yield* new NotFound({
								entity: 'company',
								id: slug,
							})
						const companyId = companyRow['id']

						// The places this company trades from. Empty for the great
						// majority — one place, and the company's own coordinates say
						// where it is — so a branch row exists only where there is a
						// second one.
						const siteRows = yield* sql`
							SELECT id, name, address, location, country,
								latitude, longitude, is_primary AS "isPrimary"
							FROM sites
							WHERE company_id = ${companyId} AND organization_id = ${currentOrg.id}
							ORDER BY is_primary DESC, name
						`

						const contactRows = yield* sql`
							SELECT c.*, ${channelsJsonFor(sql, 'contacts')} AS channels
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

						// The runs that have been applied to this row, newest first, so the
						// detail can show where its researched facts came from over time.
						const researchRuns = yield* Schema.decodeUnknownEffect(
							Schema.Array(CompanyResearchRun),
						)(
							yield* researchProvenance(
								sql,
								currentOrg.id,
								'companies',
								String(companyId),
							),
						)
						// The company's channels ride alongside the decoded row rather
						// than through it: they are not columns of `companies`, so the
						// row shape neither knows nor should know about them.
						return {
							...company,
							channels: (companyRow['channels'] ??
								[]) as ReadonlyArray<unknown>,
							sites: siteRows as ReadonlyArray<unknown>,
							contacts,
							recentInteractions,
							researchRuns,
						}
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
