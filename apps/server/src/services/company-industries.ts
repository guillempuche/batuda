/**
 * An organisation's own list of the trades it sells to.
 *
 * A trade is written once, however many ways people spell it. `foldLabel` decides
 * when two spellings are one trade, and the uniqueness rule on the folded form is
 * what makes that stick — the rule is a guard against two writers racing, not the
 * place the decision lives.
 *
 * Free functions taking `sql` rather than a service: nothing here holds a
 * resource, and a service would have to be registered in two composition roots
 * for no gain.
 *
 * `companies.industry` keeps the trade's slug alongside `industry_id`. That is a
 * copy, and copies drift, so it is written *only* here — by resolving, renaming
 * and merging. A caller sends a label; what ends up in the two columns is this
 * module's business. In exchange every existing read of the column keeps working
 * with no join, and a bookmarked `?industry=…` still resolves.
 */

import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import { Conflict, NotFound } from '@batuda/controllers'
import { foldLabel, slugFromLabel } from '@batuda/domain'

type Sql = SqlClient.SqlClient

export interface Industry {
	readonly id: string
	readonly label: string
	readonly slug: string
	readonly foldedKey: string
	readonly needsReview: boolean
}

export interface IndustryWithUsage extends Industry {
	/** How many companies are on it, including ones in the bin. */
	readonly companyCount: number
}

const COLUMNS = (sql: Sql) => sql`id, label, slug, folded_key, needs_review`

/**
 * The trade this label means, creating it the first time anybody uses it.
 *
 * `needsReview` marks one research turned up: a person accepting a proposal has
 * agreed to the fact, but the wording is still the model's. Somebody typing a
 * trade themselves has reviewed it by typing it.
 */
export const resolveIndustry = (
	sql: Sql,
	orgId: string,
	label: string,
	options?: { readonly needsReview?: boolean },
) =>
	Effect.gen(function* () {
		const folded = foldLabel(label)
		// A name with no letters or digits in it folds to nothing, and nothing
		// matches every other nothing — the one value that must never be stored.
		if (folded === '') {
			return yield* Effect.fail(
				new Conflict({ message: `"${label}" is not a usable trade name.` }),
			)
		}
		const existing = yield* sql<Industry>`
			SELECT ${COLUMNS(sql)} FROM company_industries
			WHERE organization_id = ${orgId} AND folded_key = ${folded}
			LIMIT 1
		`
		if (existing[0] !== undefined) return existing[0]

		// No index is named: the table is unique on both the folded name and the
		// slug, and naming only one of them leaves the other free to raise. With
		// several writers in flight one can clear the named index and then meet
		// another's committed row in the second, which is a plain unique violation
		// rather than the quiet do-nothing this needs. Both indexes say the same
		// thing here — the slug is the folded name with its spaces hyphenated — so
		// either one firing means the trade already exists, which is what the read
		// below goes to fetch.
		const inserted = yield* sql<Industry>`
			INSERT INTO company_industries (organization_id, label, slug, folded_key, needs_review)
			VALUES (${orgId}, ${label.trim()}, ${slugFromLabel(label)}, ${folded}, ${options?.needsReview ?? false})
			ON CONFLICT DO NOTHING
			RETURNING ${COLUMNS(sql)}
		`
		if (inserted[0] !== undefined) return inserted[0]

		// Another writer got there between the read and the write. That is what the
		// uniqueness rule is for; read back what they wrote rather than failing.
		const raced = yield* sql<Industry>`
			SELECT ${COLUMNS(sql)} FROM company_industries
			WHERE organization_id = ${orgId} AND folded_key = ${folded}
			LIMIT 1
		`
		const won = raced[0]
		if (won === undefined) {
			return yield* Effect.fail(
				new Conflict({
					message: `Could not settle on a trade for "${label}".`,
				}),
			)
		}
		return won
	})

/**
 * The trade a caller named, ready to write onto a company.
 *
 * `undefined` means they did not mention it, so whatever is on the row stays.
 * `null` means the company should carry no trade — either they are clearing the
 * field, or what they sent could never be a trade name.
 */
export const industryForWrite = (
	sql: Sql,
	orgId: string,
	named: unknown,
	options?: { readonly needsReview?: boolean },
): Effect.Effect<Industry | null | undefined> =>
	Effect.gen(function* () {
		if (named === undefined) return undefined
		if (typeof named !== 'string' || foldLabel(named) === '') return null
		// The one refusal resolving can raise is an unusable name, handled just
		// above. Anything left is the row vanishing between writing it and reading
		// it back — a database disagreeing with itself, which no caller can act on.
		return yield* resolveIndustry(sql, orgId, named, options).pipe(Effect.orDie)
	})

/**
 * Put that trade onto the columns a company is written with, so the trade's name
 * and the trade it points at can never disagree: both are set together, or
 * cleared together.
 */
export const withIndustry = (
	columns: Record<string, unknown>,
	trade: Industry | null | undefined,
): Record<string, unknown> =>
	trade === undefined
		? columns
		: trade === null
			? { ...columns, industry: null, industryId: null }
			: { ...columns, industry: trade.slug, industryId: trade.id }

/**
 * The trade a filter names, whether it arrived as a slug or as somebody's
 * spelling of the label. Nothing when the organisation has no such trade — a
 * filter naming a trade nobody uses must match no companies, not all of them.
 */
export const findIndustryByName = (
	sql: Sql,
	orgId: string,
	name: string,
): Effect.Effect<Industry | undefined> =>
	Effect.gen(function* () {
		const folded = foldLabel(name)
		if (folded === '') return undefined
		const rows = yield* sql<Industry>`
			SELECT ${COLUMNS(sql)} FROM company_industries
			WHERE organization_id = ${orgId} AND folded_key = ${folded}
			LIMIT 1
		`.pipe(Effect.orDie)
		return rows[0]
	})

const requireIndustry = (sql: Sql, orgId: string, id: string) =>
	Effect.gen(function* () {
		const rows = yield* sql<Industry>`
			SELECT ${COLUMNS(sql)} FROM company_industries
			WHERE organization_id = ${orgId} AND id = ${id}
			LIMIT 1
		`
		const found = rows[0]
		if (found === undefined) {
			return yield* Effect.fail(new NotFound({ entity: 'CompanyIndustry', id }))
		}
		return found
	})

/**
 * Write a trade's name differently.
 *
 * The folded form is rewritten too. Leaving it as it was would mean the corrected
 * spelling no longer finds this trade, so the next person to type it would create
 * a second one — the exact thing the folding exists to prevent. Editing the name
 * is also a review, so the flag comes off.
 */
export const renameIndustry = (
	sql: Sql,
	orgId: string,
	id: string,
	label: string,
) =>
	Effect.gen(function* () {
		yield* requireIndustry(sql, orgId, id)
		const folded = foldLabel(label)
		if (folded === '') {
			return yield* Effect.fail(
				new Conflict({ message: `"${label}" is not a usable trade name.` }),
			)
		}
		const clash = yield* sql<{ id: string; label: string }>`
			SELECT id, label FROM company_industries
			WHERE organization_id = ${orgId} AND folded_key = ${folded} AND id <> ${id}
			LIMIT 1
		`
		if (clash[0] !== undefined) {
			return yield* Effect.fail(
				new Conflict({
					message: `"${clash[0].label}" is already that trade — merge the two instead.`,
				}),
			)
		}
		const slug = slugFromLabel(label)
		const updated = yield* sql<Industry>`
			UPDATE company_industries
			SET label = ${label.trim()}, slug = ${slug}, folded_key = ${folded},
				needs_review = false, updated_at = now()
			WHERE organization_id = ${orgId} AND id = ${id}
			RETURNING ${COLUMNS(sql)}
		`
		// The copy on every company on this trade follows the name.
		yield* sql`
			UPDATE companies SET industry = ${slug}
			WHERE organization_id = ${orgId} AND industry_id = ${id}
		`
		return updated[0] as Industry
	})

/** Accept a trade's name as it stands, without changing it. */
export const setIndustryReviewed = (sql: Sql, orgId: string, id: string) =>
	Effect.gen(function* () {
		yield* requireIndustry(sql, orgId, id)
		const rows = yield* sql<Industry>`
			UPDATE company_industries SET needs_review = false, updated_at = now()
			WHERE organization_id = ${orgId} AND id = ${id}
			RETURNING ${COLUMNS(sql)}
		`
		return rows[0] as Industry
	})

/**
 * Fold one trade into another: every company on the first moves to the second,
 * and the first is removed.
 *
 * In one transaction, and the companies move before the row goes — the foreign
 * key would otherwise refuse the delete, which is exactly what it is there for.
 * Choosing a survivor is itself a review, so its flag comes off.
 */
export const mergeIndustries = (
	sql: Sql,
	orgId: string,
	fromId: string,
	intoId: string,
) =>
	Effect.gen(function* () {
		if (fromId === intoId) {
			return yield* Effect.fail(
				new Conflict({ message: 'A trade cannot be merged into itself.' }),
			)
		}
		yield* requireIndustry(sql, orgId, fromId)
		const survivor = yield* requireIndustry(sql, orgId, intoId)

		const moved = yield* sql<{ id: string }>`
			UPDATE companies
			SET industry_id = ${intoId}, industry = ${survivor.slug}
			WHERE organization_id = ${orgId} AND industry_id = ${fromId}
			RETURNING id
		`
		yield* sql`
			UPDATE company_industries SET needs_review = false, updated_at = now()
			WHERE organization_id = ${orgId} AND id = ${intoId}
		`
		yield* sql`
			DELETE FROM company_industries
			WHERE organization_id = ${orgId} AND id = ${fromId}
		`
		return { moved: moved.length, survivor }
	}).pipe(sql.withTransaction)

/**
 * Remove a trade nothing is on.
 *
 * Companies in the bin are counted too: they still point at it, so the database
 * would refuse the delete. Counting only the visible ones would offer a Remove
 * that always fails.
 */
export const removeIndustryIfUnused = (sql: Sql, orgId: string, id: string) =>
	Effect.gen(function* () {
		const industry = yield* requireIndustry(sql, orgId, id)
		const rows = yield* sql<{ count: number }>`
			SELECT count(*)::int AS count FROM companies
			WHERE organization_id = ${orgId} AND industry_id = ${id}
		`
		const inUse = rows[0]?.count ?? 0
		if (inUse > 0) {
			return yield* Effect.fail(
				new Conflict({
					message: `${industry.label} is still on ${inUse} ${inUse === 1 ? 'company' : 'companies'} — merge it into another trade instead.`,
				}),
			)
		}
		yield* sql`
			DELETE FROM company_industries
			WHERE organization_id = ${orgId} AND id = ${id}
		`
	})

/** An organisation's trades, with how many companies are on each. */
export const listIndustries = (
	sql: Sql,
	orgId: string,
	filters?: { readonly needsReview?: boolean },
) =>
	Effect.gen(function* () {
		const onlyReview =
			filters?.needsReview === true ? sql`AND i.needs_review` : sql``
		return yield* sql<IndustryWithUsage>`
			SELECT i.id, i.label, i.slug, i.folded_key, i.needs_review,
				count(c.id)::int AS company_count
			FROM company_industries i
			LEFT JOIN companies c
				ON c.industry_id = i.id AND c.organization_id = i.organization_id
			WHERE i.organization_id = ${orgId} ${onlyReview}
			GROUP BY i.id, i.label, i.slug, i.folded_key, i.needs_review
			ORDER BY i.needs_review DESC, i.label
		`
	})
