// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterEach, describe, expect, it } from 'vitest'

import { foldLabel, slugFromLabel } from '@batuda/domain'

import { PgLive } from './client.js'
import refold from './migrations/0066_company_industries_refold'

// Writing an organisation's trades again under a folding rule that changed.
//
// The rule decides when two spellings are one trade, and a uniqueness rule stands
// on what it produces — so rows written under the old rule can turn out to be the
// same trade under the new one. They have to be MERGED rather than left to collide,
// with the companies on the losing row carried across, and none of that can be
// shown without a real database: the uniqueness rule, the foreign key that refuses
// to strand a company, and the copy of the slug on `companies` are the whole point.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(
		effect.pipe(Effect.provide(PgLive), Effect.orDie) as Effect.Effect<A>,
	)

const withSql = <A, E>(
	f: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return yield* f(sql)
	})

const orgs: Array<string> = []

const seedTrade = (
	orgId: string,
	label: string,
	storedKey: string,
	storedSlug: string,
) =>
	withSql(sql =>
		Effect.gen(function* () {
			const rows = yield* sql<{ id: string }>`
				INSERT INTO company_industries (organization_id, label, slug, folded_key, needs_review)
				VALUES (${orgId}, ${label}, ${storedSlug}, ${storedKey}, true)
				RETURNING id
			`
			return rows[0]?.id as string
		}),
	)

const seedCompanies = (orgId: string, industryId: string, howMany: number) =>
	withSql(sql =>
		Effect.gen(function* () {
			for (let at = 0; at < howMany; at++) {
				yield* sql`
					INSERT INTO companies (organization_id, slug, name, industry_id, industry)
					VALUES (${orgId}, ${`co-${randomUUID()}`}, 'Seeded', ${industryId},
						(SELECT slug FROM company_industries WHERE id = ${industryId}))
				`
			}
		}),
	)

const tradesOf = (orgId: string) =>
	withSql(
		sql => sql<{
			id: string
			label: string
			foldedKey: string
			slug: string
			needsReview: boolean
		}>`
			SELECT id, label, folded_key, slug, needs_review
			FROM company_industries WHERE organization_id = ${orgId}
		`,
	)

const companyTradesOf = (orgId: string) =>
	withSql(
		sql => sql<{ industryId: string | null; industry: string | null }>`
			SELECT industry_id, industry FROM companies WHERE organization_id = ${orgId}
		`,
	)

afterEach(async () => {
	for (const orgId of orgs.splice(0)) {
		await run(
			withSql(sql =>
				Effect.gen(function* () {
					yield* sql`DELETE FROM companies WHERE organization_id = ${orgId}`
					yield* sql`DELETE FROM company_industries WHERE organization_id = ${orgId}`
				}),
			),
		)
	}
})

describe('writing the trades again under the new fold', () => {
	describe('when two rows turn out to be one trade', () => {
		it('should keep the one on the most companies and carry the rest across', async () => {
			// GIVEN one Greek trade filed twice, because the database and the
			// application disagreed about how to lower-case a final sigma — the
			// database wrote σ where the application writes ς
			const org = `refold-${randomUUID()}`
			orgs.push(org)
			const onMany = await run(
				seedTrade(org, 'ΜΕΤΑΦΟΡΕΣ', 'μεταφορεσ', 'μεταφορεσ'),
			)
			const onFew = await run(
				seedTrade(org, 'Μεταφορές', 'μεταφορες', 'μεταφορες'),
			)
			await run(seedCompanies(org, onMany, 2))
			await run(seedCompanies(org, onFew, 1))

			// WHEN the trades are written again
			await run(refold)

			// THEN one trade is left, under the key the application writes, and every
			// company is on it — including the one that was on the row that went
			const trades = await run(tradesOf(org))
			expect(trades).toHaveLength(1)
			expect(trades[0]?.id).toBe(onMany)
			expect(trades[0]?.foldedKey).toBe(foldLabel('ΜΕΤΑΦΟΡΕΣ'))
			expect(trades[0]?.slug).toBe(slugFromLabel('ΜΕΤΑΦΟΡΕΣ'))

			const companies = await run(companyTradesOf(org))
			expect(companies).toHaveLength(3)
			expect(companies.every(c => c.industryId === onMany)).toBe(true)
			expect(
				companies.every(c => c.industry === slugFromLabel('ΜΕΤΑΦΟΡΕΣ')),
			).toBe(true)
		})

		it('should count choosing a survivor as having looked at it', async () => {
			// GIVEN the same two rows, both waiting to be reviewed
			const org = `refold-${randomUUID()}`
			orgs.push(org)
			const kept = await run(
				seedTrade(org, 'ΜΕΤΑΦΟΡΕΣ', 'μεταφορεσ', 'μεταφορεσ'),
			)
			await run(seedTrade(org, 'Μεταφορές', 'μεταφορες', 'μεταφορες'))

			// WHEN the trades are written again
			await run(refold)

			// THEN the survivor is no longer waiting, the same as when somebody
			// merges two trades by hand
			const trades = await run(tradesOf(org))
			expect(trades[0]?.id).toBe(kept)
			expect(trades[0]?.needsReview).toBe(false)
		})
	})

	it('should carry a company in the bin across with the rest', async () => {
		// GIVEN the losing trade held by a company somebody has thrown away, which
		// still points at it
		const org = `refold-${randomUUID()}`
		orgs.push(org)
		const kept = await run(
			seedTrade(org, 'ΜΕΤΑΦΟΡΕΣ', 'μεταφορεσ', 'μεταφορεσ'),
		)
		const going = await run(
			seedTrade(org, 'Μεταφορές', 'μεταφορες', 'μεταφορες'),
		)
		await run(seedCompanies(org, kept, 1))
		await run(seedCompanies(org, going, 1))
		await run(
			withSql(
				sql => sql`
						UPDATE companies SET deleted_at = now()
						WHERE organization_id = ${org} AND industry_id = ${going}
					`,
			),
		)

		// WHEN the trades are written again
		await run(refold)

		// THEN the row still goes, and the company in the bin came with it. Leaving
		// it behind would have the foreign key refuse the delete, which is exactly
		// what that key is there for
		const trades = await run(tradesOf(org))
		expect(trades).toHaveLength(1)
		const companies = await run(companyTradesOf(org))
		expect(companies.every(c => c.industryId === kept)).toBe(true)
	})

	it('should not let a trade nobody is left on take the name', async () => {
		// GIVEN the two rows again, where the one with MORE companies has had every
		// one of them thrown away
		const org = `refold-${randomUUID()}`
		orgs.push(org)
		const binned = await run(
			seedTrade(org, 'ΜΕΤΑΦΟΡΕΣ', 'μεταφορεσ', 'μεταφορεσ'),
		)
		const live = await run(
			seedTrade(org, 'Μεταφορές', 'μεταφορες', 'μεταφορες'),
		)
		await run(seedCompanies(org, binned, 3))
		await run(seedCompanies(org, live, 1))
		await run(
			withSql(
				sql => sql`
						UPDATE companies SET deleted_at = now()
						WHERE organization_id = ${org} AND industry_id = ${binned}
					`,
			),
		)

		// WHEN the trades are written again
		await run(refold)

		// THEN the trade people are still on keeps the name. Counting the bin would
		// hand it to the row nobody is on, and the label is what people see
		const trades = await run(tradesOf(org))
		expect(trades).toHaveLength(1)
		expect(trades[0]?.id).toBe(live)
	})

	it('should settle a tie on the older row rather than on luck', async () => {
		// GIVEN two rows that are one trade and are on the same number of companies
		// — the ordinary shape of a trade research found that nobody is on yet —
		// with one plainly written down before the other
		const org = `refold-${randomUUID()}`
		orgs.push(org)
		const older = await run(
			seedTrade(org, 'ΜΕΤΑΦΟΡΕΣ', 'μεταφορεσ', 'μεταφορεσ'),
		)
		const newer = await run(
			seedTrade(org, 'Μεταφορές', 'μεταφορες', 'μεταφορες'),
		)
		await run(
			withSql(sql =>
				Effect.gen(function* () {
					yield* sql`UPDATE company_industries SET created_at = '2020-01-01T00:00:00Z' WHERE id = ${older}`
					yield* sql`UPDATE company_industries SET created_at = '2021-01-01T00:00:00Z' WHERE id = ${newer}`
				}),
			),
		)

		// WHEN the trades are written again
		await run(refold)

		// THEN the one written down first keeps the name. With nothing said about
		// the order, the survivor was whichever the database happened to hand over
		// first, which can differ between two copies of one database
		const trades = await run(tradesOf(org))
		expect(trades).toHaveLength(1)
		expect(trades[0]?.id).toBe(older)
	})

	describe('when a trade was filed under a key its letters had been broken up into', () => {
		it('should write it again whole, and follow it on the companies', async () => {
			// GIVEN trades in writing systems where a mark is part of a word rather
			// than decoration over a letter, filed under the broken-up form the old
			// rule produced
			const org = `refold-${randomUUID()}`
			orgs.push(org)
			const hindi = await run(seedTrade(org, 'निर्माण', 'न रम ण', 'न-रम-ण'))
			const arabic = await run(seedTrade(org, 'أثاث', 'ا ثاث', 'ا-ثاث'))
			await run(seedCompanies(org, hindi, 1))

			// WHEN the trades are written again
			await run(refold)

			// THEN each is one word again, and the slug a company carries beside the
			// trade follows it rather than pointing at the old one
			const trades = await run(tradesOf(org))
			const byId = new Map(trades.map(t => [t.id, t]))
			expect(byId.get(hindi)?.foldedKey).toBe(foldLabel('निर्माण'))
			expect(byId.get(hindi)?.foldedKey.split(' ')).toHaveLength(1)
			expect(byId.get(arabic)?.foldedKey).toBe(foldLabel('أثاث'))

			const companies = await run(companyTradesOf(org))
			expect(companies[0]?.industry).toBe(slugFromLabel('निर्माण'))
		})
	})

	describe('when a trade is written in Latin letters', () => {
		it('should leave it exactly as it was', async () => {
			// GIVEN the trades almost every organisation actually has
			const org = `refold-${randomUUID()}`
			orgs.push(org)
			const before = [
				['Metal·lúrgia', 'metallurgia', 'metallurgia'],
				['Fontanería', 'fontaneria', 'fontaneria'],
				['Instal·lacions elèctriques', 'installacions electriques', 'x-1'],
			] as const
			for (const [label, key, slug] of before)
				await run(seedTrade(org, label, key, slug))

			// WHEN the trades are written again
			await run(refold)

			// THEN every one of them is still there, and the two that already held
			// the key the rule produces were not touched at all
			const trades = await run(tradesOf(org))
			expect(trades).toHaveLength(3)
			for (const [label] of before) {
				const trade = trades.find(t => t.label === label)
				expect(trade?.foldedKey).toBe(foldLabel(label))
			}
		})
	})

	describe('when it has already been run', () => {
		it('should change nothing the second time', async () => {
			// GIVEN trades that have already been written again
			const org = `refold-${randomUUID()}`
			orgs.push(org)
			await run(seedTrade(org, 'ΜΕΤΑΦΟΡΕΣ', 'μεταφορεσ', 'μεταφορεσ'))
			await run(seedTrade(org, 'निर्माण', 'न रम ण', 'न-रम-ण'))
			await run(refold)
			const once = await run(tradesOf(org))

			// WHEN it runs again — as it would on a database migrated twice
			await run(refold)

			// THEN nothing moves
			const twice = await run(tradesOf(org))
			expect(twice).toEqual(once)
		})
	})
})
