import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import {
	BadRequest,
	CompanyResearchRun,
	CurrentOrg,
	NotFound,
} from '@batuda/controllers'
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
import { type AttentionFilter, attentionCondition } from './company-attention'
import {
	findIndustryByName,
	industryForWrite,
	withIndustry,
} from './company-industries'
import { requireOrgMembers } from './org-members'
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
	// Narrows to what needs doing: a missed follow-up, a company gone quiet, or
	// one with nothing written down as the next step. Same rules the dashboard
	// counts by, so a heading there opens a list of the same size here.
	readonly attention?: AttentionFilter | undefined
	// How long counts as gone quiet, for `attention: 'stale'`. Carried on the
	// link so the list matches the threshold the dashboard was showing.
	readonly staleDays?: number | undefined
	// Which companies to look at: the live ones by default, 'only' for the ones
	// taken out of view (how somebody finds one to put back), 'include' for both.
	readonly deleted?: 'only' | 'include' | undefined
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
						// Deleted companies are out of view unless they are what was
						// asked for. The count below reads the same list, so this covers
						// the total a page shows as well as its rows.
						if (filters.deleted === 'only')
							conditions.push(sql`deleted_at IS NOT NULL`)
						else if (filters.deleted !== 'include')
							conditions.push(sql`deleted_at IS NULL`)
						if (filters.status) conditions.push(sql`status = ${filters.status}`)
						if (filters.country)
							conditions.push(sql`country = ${filters.country}`)
						if (filters.industry) {
							const trade = yield* findIndustryByName(
								sql,
								currentOrg.id,
								filters.industry,
							)
							conditions.push(
								trade === undefined
									? sql`false`
									: sql`industry_id = ${trade.id}`,
							)
						}
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
						if (filters.attention)
							conditions.push(
								attentionCondition(sql, filters.attention, filters.staleDays),
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
											AND s.organization_id = ${currentOrg.id}
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

				// Every country this organisation actually trades with. The list page
				// used to build its country filter from whichever companies happened
				// to be on screen, so a country further down the list could not be
				// filtered for at all.
				countries: () =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql<{ country: string }>`
							SELECT DISTINCT country FROM companies
							WHERE organization_id = ${currentOrg.id}
								AND country IS NOT NULL
								AND country <> ''
							ORDER BY country
						`
						return rows.map(r => r.country)
					}),

				findBySlug: (slug: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						// A name only points at the company still using it: deleting
						// releases it, so a slug can also belong to an older row nobody
						// can open, and without this the page would sometimes show that
						// one instead.
						const rows = yield* sql`
							SELECT * FROM companies
							WHERE slug = ${slug}
								AND organization_id = ${currentOrg.id}
								AND deleted_at IS NULL
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
						// By id a deleted company is still readable: restoring one, and
						// showing what is about to be restored, both need it.
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
						// The trade a caller named becomes an entry in the organisation's
						// own list, so its name and the entry it points at are written
						// together and can never disagree.
						const columns = withIndustry(
							split.columns,
							yield* industryForWrite(
								sql,
								currentOrg.id,
								split.columns['industry'],
							),
						)
						const rows =
							yield* sql`INSERT INTO companies ${sql.insert({ ...columns, organizationId: currentOrg.id })} RETURNING *`
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

				// Take a company out of view without losing it. Its people go with
				// it, marked at the same instant so a later restore can revive
				// exactly the ones this delete hid and nobody else.
				softDelete: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const at = DateTime.toDateUtc(DateTime.nowUnsafe())
						const rows = yield* sql`
							UPDATE companies
							SET deleted_at = ${at}, updated_at = ${at},
								version = version + 1
							WHERE id = ${id}
								AND organization_id = ${currentOrg.id}
								AND deleted_at IS NULL
							RETURNING id
						`
						if (rows.length === 0) {
							// Nothing changed, but the reason matters to the caller: a
							// company already gone is the outcome they wanted, while one
							// that never existed is a mistake worth telling them about.
							const existing = yield* sql`
								SELECT deleted_at FROM companies
								WHERE id = ${id} AND organization_id = ${currentOrg.id}
								LIMIT 1
							`
							return existing.length > 0
								? { contactsAffected: 0, at, alreadyDeleted: true as const }
								: yield* new NotFound({ entity: 'company', id })
						}
						const contacts = yield* sql`
							UPDATE contacts SET deleted_at = ${at}, updated_at = ${at}
							WHERE company_id = ${id}
								AND organization_id = ${currentOrg.id}
								AND deleted_at IS NULL
							RETURNING id
						`
						return {
							contactsAffected: contacts.length,
							at,
							alreadyDeleted: false as const,
						}
					}),

				// Put it back. The name has to be free first: deleting released it,
				// so somebody may have added a different company under it since, and
				// the database would answer that with a bare duplicate-key fault.
				restore: (id: string) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const found = yield* sql<{
							slug: string
							deletedAt: Date
						}>`
							SELECT slug, deleted_at FROM companies
							WHERE id = ${id}
								AND organization_id = ${currentOrg.id}
								AND deleted_at IS NOT NULL
							LIMIT 1
						`
						const company = found[0]
						if (company === undefined)
							return yield* new NotFound({ entity: 'company', id })
						const taken = yield* sql`
							SELECT id FROM companies
							WHERE organization_id = ${currentOrg.id}
								AND slug = ${company.slug}
								AND deleted_at IS NULL
							LIMIT 1
						`
						if (taken.length > 0)
							return yield* new BadRequest({
								message: `Another company is using the name "${company.slug}" now, so this one cannot come back under it. Rename that company first, then restore this one.`,
							})
						const at = DateTime.toDateUtc(DateTime.nowUnsafe())
						// The name is claimed in the same statement that frees this row,
						// which settles it against anything already committed. A company
						// being inserted right now is invisible to that check, so the
						// index is what catches it, and its complaint is turned into the
						// same sentence rather than left as a fault.
						const revived = yield* sql`
							UPDATE companies
							SET deleted_at = NULL, updated_at = ${at},
								version = version + 1
							WHERE id = ${id}
								AND organization_id = ${currentOrg.id}
								AND NOT EXISTS (
									SELECT 1 FROM companies live
									WHERE live.organization_id = ${currentOrg.id}
										AND live.slug = ${company.slug}
										AND live.deleted_at IS NULL
								)
							RETURNING id
						`.pipe(
							Effect.catchTag('SqlError', () =>
								Effect.succeed([] as ReadonlyArray<{ readonly id: string }>),
							),
						)
						if (revived.length === 0)
							return yield* new BadRequest({
								message: `Another company is using the name "${company.slug}" now, so this one cannot come back under it. Rename that company first, then restore this one.`,
							})
						// Only the people this delete hid: a contact removed on its own
						// account carries a different instant and stays gone.
						const contacts = yield* sql`
							UPDATE contacts SET deleted_at = NULL, updated_at = ${at}
							WHERE company_id = ${id}
								AND organization_id = ${currentOrg.id}
								AND deleted_at = ${company.deletedAt}
							RETURNING id
						`
						return { contactsAffected: contacts.length }
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
						// Checked before anything lands: the batch is one transaction, so
						// a single unusable owner refuses the call rather than creating
						// most of the list and leaving the caller to work out which.
						yield* requireOrgMembers(
							sql,
							items.map(item => item['ownerId']),
						)
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
										-- Live rows only, matching the slug half: a company that
										-- was deleted has given its identity back, so re-adding it
										-- has to land rather than be reported as already here and
										-- point at something nobody can open.
										AND deleted_at IS NULL
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
							// The trade a caller named becomes an entry in the organisation's
							// own list, so its name and the entry it points at are written
							// together and can never disagree.
							const columns = withIndustry(
								split.columns,
								yield* industryForWrite(
									sql,
									currentOrg.id,
									split.columns['industry'],
								),
							)
							const rows = yield* sql`
								INSERT INTO companies ${sql.insert({ ...columns, organizationId: currentOrg.id })}
								-- The predicate is repeated because the unique index only covers
								-- live rows: without it Postgres has no arbiter for this clause
								-- and refuses the statement outright.
								ON CONFLICT (organization_id, slug) WHERE deleted_at IS NULL
								DO NOTHING
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
						yield* requireOrgMembers(sql, [data['ownerId']])
						// Asked before anything is written, not just before the row is
						// updated: the addresses and the trade are written first, so a
						// check further down would let those land on a company nobody
						// can see and then report the edit as having done nothing.
						const live = yield* sql`
							SELECT 1 FROM companies
							WHERE id = ${id}
								AND organization_id = ${currentOrg.id}
								AND deleted_at IS NULL
							LIMIT 1
						`
						if (live.length === 0)
							return yield* new NotFound({ entity: 'company', id })
						// Bumping the version on every edit is what lets a research apply notice
						// that somebody changed the row while the run was thinking, so its findings
						// can never quietly overwrite a person's edit.
						const split = splitCompanyChannelFields(data)
						// The trade a caller named becomes an entry in the organisation's
						// own list, so its name and the entry it points at are written
						// together and can never disagree.
						const columns = withIndustry(
							split.columns,
							yield* industryForWrite(
								sql,
								currentOrg.id,
								split.columns['industry'],
							),
						)
						if (split.channels.length > 0) {
							yield* writeChannels(
								sql,
								currentOrg.id,
								{ table: 'companies', id },
								split.channels,
							)
						}
						// Nothing edits a company that was taken out of view: the change
						// would be invisible, and the next person to restore it would
						// find edits nobody remembers making.
						const rows = yield* sql`
							UPDATE companies SET ${sql.update({ ...columns, updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()) })},
								version = version + 1
							WHERE id = ${id}
								AND organization_id = ${currentOrg.id}
								AND deleted_at IS NULL
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
							WHERE c.slug = ${slug}
								AND c.organization_id = ${currentOrg.id}
								AND c.deleted_at IS NULL
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

						// Companies this one belongs with, read from both ends: a
						// statement is stored once, from the subject's side, so "who owns
						// this" and "what does this own" are the same rows approached
						// either way round. Without both, half of every pairing would be
						// invisible from the company you happened to open.
						const relationRows = yield* sql`
							SELECT r.id, r.kind, r.note,
								'outgoing' AS direction,
								c2.id AS "companyId", c2.name, c2.slug
							FROM company_relations r
							JOIN companies c2
								ON c2.id = r.related_company_id AND c2.deleted_at IS NULL
							WHERE r.company_id = ${companyId}
								AND r.organization_id = ${currentOrg.id}
							UNION ALL
							SELECT r.id, r.kind, r.note,
								'incoming' AS direction,
								c2.id AS "companyId", c2.name, c2.slug
							FROM company_relations r
							JOIN companies c2 ON c2.id = r.company_id
							WHERE r.related_company_id = ${companyId}
								AND r.organization_id = ${currentOrg.id}
						`

						const contactRows = yield* sql`
							SELECT c.*, ${channelsJsonFor(sql, 'contacts')} AS channels
							FROM contacts c
							WHERE c.company_id = ${companyId}
							  AND c.organization_id = ${currentOrg.id}
							  AND c.deleted_at IS NULL
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
							relations: relationRows as ReadonlyArray<unknown>,
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
