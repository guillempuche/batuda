// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect, Exit } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client.js'
import {
	listIndustries,
	mergeIndustries,
	removeIndustryIfUnused,
	renameIndustry,
	resolveIndustry,
	setIndustryReviewed,
} from './company-industries'

// An organisation's own list of trades, against a real database.
//
// What needs one is everything that makes the list converge: the uniqueness rule
// that turns two writers into one row, the foreign key that refuses to strand a
// company, and the copy of the slug on `companies` that has to follow a rename
// and a merge. None of that can be shown without Postgres.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const ORG = `ind-org-${randomUUID()}`
const OTHER_ORG = `ind-other-${randomUUID()}`

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(
		effect.pipe(Effect.provide(PgLive), Effect.orDie) as Effect.Effect<A>,
	)

const attempt = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(
		Effect.exit(effect).pipe(Effect.provide(PgLive)) as Effect.Effect<
			Exit.Exit<A, E>
		>,
	)

const withSql = <A, E>(
	f: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* f(sql)
	})

const seedCompany = (orgId: string, industryId: string | null) =>
	withSql(sql =>
		Effect.gen(function* () {
			const rows = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name, industry_id)
				VALUES (${orgId}, ${`co-${randomUUID()}`}, 'Seeded', ${industryId})
				RETURNING id
			`
			return rows[0]?.id as string
		}),
	)

const industryOf = (companyId: string) =>
	withSql(sql =>
		Effect.gen(function* () {
			const rows = yield* sql<{ industry: string | null; industryId: string }>`
				SELECT industry, industry_id FROM companies WHERE id = ${companyId}
			`
			return rows[0]
		}),
	)

beforeEach(async () => {
	await run(
		withSql(sql =>
			Effect.gen(function* () {
				yield* sql`DELETE FROM companies WHERE organization_id IN (${ORG}, ${OTHER_ORG})`
				yield* sql`DELETE FROM company_industries WHERE organization_id IN (${ORG}, ${OTHER_ORG})`
			}),
		),
	)
})

afterAll(async () => {
	await run(
		withSql(sql =>
			Effect.gen(function* () {
				yield* sql`DELETE FROM companies WHERE organization_id IN (${ORG}, ${OTHER_ORG})`
				yield* sql`DELETE FROM company_industries WHERE organization_id IN (${ORG}, ${OTHER_ORG})`
			}),
		),
	)
})

describe('naming a trade', () => {
	describe('when the same trade is written several ways', () => {
		it('should settle on one', async () => {
			const ids = await run(
				withSql(sql =>
					Effect.gen(function* () {
						const a = yield* resolveIndustry(sql, ORG, 'Metal fabrication')
						const b = yield* resolveIndustry(sql, ORG, 'metal Fabrication')
						const c = yield* resolveIndustry(sql, ORG, '  METAL   FABRICATION ')
						const d = yield* resolveIndustry(sql, ORG, 'Metal-fabrication')
						return [a.id, b.id, c.id, d.id]
					}),
				),
			)
			// THEN case, spacing and punctuation are all one trade, not four
			expect(new Set(ids).size).toBe(1)
		})

		it('should treat an accent as the same letter', async () => {
			const ids = await run(
				withSql(sql =>
					Effect.gen(function* () {
						const a = yield* resolveIndustry(sql, ORG, 'Fabricació')
						const b = yield* resolveIndustry(sql, ORG, 'fabricacio')
						return [a.id, b.id]
					}),
				),
			)
			expect(ids[0]).toBe(ids[1])
		})

		it('should keep two genuinely different words apart', async () => {
			// GIVEN Catalan "fabricació" and English "fabrication" differ by more than
			// an accent — folding must not reach across a translation
			const ids = await run(
				withSql(sql =>
					Effect.gen(function* () {
						const ca = yield* resolveIndustry(sql, ORG, 'Metal fabricació')
						const en = yield* resolveIndustry(sql, ORG, 'Metal fabrication')
						return [ca.id, en.id]
					}),
				),
			)
			expect(ids[0]).not.toBe(ids[1])
		})
	})

	describe('when several writers ask for the same new trade at once', () => {
		it('should give them one row without any of them failing', async () => {
			// GIVEN six callers naming a trade the organisation does not have yet
			// WHEN they all resolve it at the same moment
			// THEN none of them fails. This is asserted before the count because a
			//      raised unique violation used to read as a flake: the callers that
			//      did survive still agreed on one id, so counting alone passed while
			//      a caller had been handed a server error.
			const outcomes = await Promise.all(
				Array.from({ length: 6 }, () =>
					attempt(withSql(sql => resolveIndustry(sql, ORG, 'Fusteria'))),
				),
			)
			expect(outcomes.filter(Exit.isFailure)).toEqual([])

			// AND they get one trade between them: whoever loses the race reads back
			// what the winner wrote instead of making a second row
			const ids = outcomes.flatMap(o => (Exit.isSuccess(o) ? [o.value.id] : []))
			expect(new Set(ids).size).toBe(1)
		})
	})

	describe('when the name has no letters or digits in it', () => {
		it('should refuse rather than store a name that matches everything', async () => {
			// GIVEN a name that folds away to nothing
			// WHEN it is resolved
			// THEN it is refused, because an empty folded name matches every other
			//      empty one — the first would swallow every later trade like it
			const exit = await attempt(
				withSql(sql => resolveIndustry(sql, ORG, '...')),
			)
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})

	describe('when research turned the trade up', () => {
		it('should flag it for somebody to look at', async () => {
			const found = await run(
				withSql(sql =>
					resolveIndustry(sql, ORG, 'Artisanal cheese production', {
						needsReview: true,
					}),
				),
			)
			expect(found.needsReview).toBe(true)
		})

		it('should let somebody accept the name as it stands', async () => {
			// GIVEN research found a trade and named it perfectly well. Without this,
			// the only way off the review list would be renaming it to itself.
			const after = await run(
				withSql(sql =>
					Effect.gen(function* () {
						const trade = yield* resolveIndustry(
							sql,
							ORG,
							'Cheese production',
							{
								needsReview: true,
							},
						)
						return yield* setIndustryReviewed(sql, ORG, trade.id)
					}),
				),
			)
			expect(after.needsReview).toBe(false)
			expect(after.label).toBe('Cheese production')
		})
	})
})

describe('renaming a trade', () => {
	describe('when the name is corrected', () => {
		it('should follow through to every company on it', async () => {
			const companyId = await run(
				withSql(sql =>
					Effect.gen(function* () {
						const trade = yield* resolveIndustry(sql, ORG, 'metal fabricaton')
						const id = yield* seedCompany(ORG, trade.id)
						yield* renameIndustry(sql, ORG, trade.id, 'Metal fabrication')
						return id
					}),
				),
			)
			const after = await run(industryOf(companyId))
			// THEN the copy the filter reads follows the name
			expect(after?.industry).toBe('metal-fabrication')
		})

		it('should let the corrected spelling find it again', async () => {
			// GIVEN a fold left unchanged would make the corrected spelling miss and
			// create a second trade — the exact thing folding exists to prevent
			const ids = await run(
				withSql(sql =>
					Effect.gen(function* () {
						const trade = yield* resolveIndustry(sql, ORG, 'metal fabricaton')
						yield* renameIndustry(sql, ORG, trade.id, 'Metal fabrication')
						const again = yield* resolveIndustry(sql, ORG, 'Metal fabrication')
						return [trade.id, again.id]
					}),
				),
			)
			expect(ids[0]).toBe(ids[1])
		})
	})

	describe('when the new name is already another trade', () => {
		it('should say so instead of colliding', async () => {
			const exit = await attempt(
				withSql(sql =>
					Effect.gen(function* () {
						yield* resolveIndustry(sql, ORG, 'Fusteria')
						const other = yield* resolveIndustry(sql, ORG, 'Metal fabrication')
						return yield* renameIndustry(sql, ORG, other.id, 'fusteria')
					}),
				),
			)
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})
})

describe('merging two trades', () => {
	describe('when one is folded into another', () => {
		it('should move its companies and take the survivor off review', async () => {
			const result = await run(
				withSql(sql =>
					Effect.gen(function* () {
						const loser = yield* resolveIndustry(sql, ORG, 'Metal work')
						const survivor = yield* resolveIndustry(
							sql,
							ORG,
							'Metal fabrication',
							{ needsReview: true },
						)
						const companyId = yield* seedCompany(ORG, loser.id)
						const merged = yield* mergeIndustries(
							sql,
							ORG,
							loser.id,
							survivor.id,
						)
						const remaining = yield* listIndustries(sql, ORG)
						const after = yield* industryOf(companyId)
						return { merged, remaining, after, survivor }
					}),
				),
			)
			// THEN the company moved, only the survivor is left, and choosing it as
			//      the survivor counted as reviewing it
			expect(result.merged.moved).toBe(1)
			expect(result.remaining).toHaveLength(1)
			expect(result.remaining[0]?.needsReview).toBe(false)
			// AND the copy of the slug each company keeps followed the merge, so a
			//     filter and a shared link still land on the right trade
			expect(result.after?.industry).toBe(result.survivor.slug)
		})
	})

	describe('when a trade is merged into itself', () => {
		it('should refuse', async () => {
			const exit = await attempt(
				withSql(sql =>
					Effect.gen(function* () {
						const trade = yield* resolveIndustry(sql, ORG, 'Fusteria')
						return yield* mergeIndustries(sql, ORG, trade.id, trade.id)
					}),
				),
			)
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})
})

describe('removing a trade', () => {
	describe('when nothing is on it', () => {
		it('should go', async () => {
			const remaining = await run(
				withSql(sql =>
					Effect.gen(function* () {
						const trade = yield* resolveIndustry(sql, ORG, 'Fusteria')
						yield* removeIndustryIfUnused(sql, ORG, trade.id)
						return yield* listIndustries(sql, ORG)
					}),
				),
			)
			expect(remaining).toHaveLength(0)
		})
	})

	describe('when the only company on it is in the bin', () => {
		it('should still refuse, because the database would', async () => {
			// GIVEN a soft-deleted company still points at the trade, so counting only
			// the visible ones would offer a Remove that always fails
			const exit = await attempt(
				withSql(sql =>
					Effect.gen(function* () {
						const trade = yield* resolveIndustry(sql, ORG, 'Fusteria')
						const companyId = yield* seedCompany(ORG, trade.id)
						yield* sql`UPDATE companies SET deleted_at = now() WHERE id = ${companyId}`
						return yield* removeIndustryIfUnused(sql, ORG, trade.id)
					}),
				),
			)
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})
})

describe('another organisation', () => {
	describe('when it names the same trade', () => {
		it('should get its own, and never see or touch the first', async () => {
			const result = await run(
				withSql(sql =>
					Effect.gen(function* () {
						const mine = yield* resolveIndustry(sql, ORG, 'Fusteria')
						const theirs = yield* resolveIndustry(sql, OTHER_ORG, 'Fusteria')
						const mineList = yield* listIndustries(sql, ORG)
						return { mine, theirs, mineList }
					}),
				),
			)
			expect(result.mine.id).not.toBe(result.theirs.id)
			expect(result.mineList).toHaveLength(1)
		})

		it('should not be able to rename the first organisation’s trade', async () => {
			const exit = await attempt(
				withSql(sql =>
					Effect.gen(function* () {
						const mine = yield* resolveIndustry(sql, ORG, 'Fusteria')
						return yield* renameIndustry(sql, OTHER_ORG, mine.id, 'Stolen')
					}),
				),
			)
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})
})
