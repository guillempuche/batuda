// Live-DB integration test for the company half of the daily-planning list.
// The three lists exist to be worked top to bottom, so what matters is that a
// company lands on exactly one of them, that the most urgent leads, and that the
// number in the heading is the number of rows behind it — all of which are
// decisions made in SQL and none of which a unit test would catch.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { PipelineService } from './pipeline'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
let orgId: string

// Every fixture carries this run's tag in its slug, so a suite running beside
// another worktree's can still tell its own rows from the seeded ones.
const TAG = `attn-${randomUUID().slice(0, 8)}`

const insertCompany = async (options: {
	readonly name: string
	readonly status: string
	readonly priority?: number | null
	// Days ago; null means never heard from, which is its own kind of quiet.
	readonly lastContactedDaysAgo?: number | null
	// Days from now; negative is a follow-up already missed.
	readonly nextActionInDays?: number | null
}): Promise<string> => {
	const slug = `${TAG}-${options.name}`
	const row = await pool.query<{ id: string }>(
		`INSERT INTO companies (
			organization_id, slug, name, status, priority,
			last_contacted_at, next_action_at
		 ) VALUES (
			$1, $2, $2, $3, $4,
			CASE WHEN $5::int IS NULL THEN NULL ELSE now() - ($5::int * interval '1 day') END,
			CASE WHEN $6::int IS NULL THEN NULL ELSE now() + ($6::int * interval '1 day') END
		 ) RETURNING id`,
		[
			orgId,
			slug,
			options.status,
			options.priority ?? null,
			options.lastContactedDaysAgo ?? null,
			options.nextActionInDays ?? null,
		],
	)
	return row.rows[0]!.id
}

// Read the lists as the request path does: role app_user, scoped to this org, so
// row-level security applies exactly as it would in production.
const readBuckets = (options?: {
	readonly limit?: number
	readonly staleDays?: number
	readonly priorityAtLeast?: number
}) => {
	const deps = PipelineService.layer.pipe(Layer.provideMerge(PgLive))
	return Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const pipeline = yield* PipelineService
		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`SET LOCAL ROLE app_user`
				yield* sql`SELECT set_config('app.current_org_id', ${orgId}, true)`
				return yield* pipeline
					.getNextSteps(options?.limit ?? 200, {
						staleDays: options?.staleDays,
						priorityAtLeast: options?.priorityAtLeast,
					})
					.pipe(
						Effect.provideService(CurrentOrg, {
							id: orgId,
							name: 'fixture',
							slug: 'fixture',
							role: 'member',
						}),
					)
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)
}

const slugsOf = (rows: ReadonlyArray<{ readonly slug: string }>) =>
	rows.map(row => row.slug)

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	await pool.query('GRANT app_user TO CURRENT_USER')
	const org = await pool.query<{ id: string }>(
		`SELECT id FROM organization LIMIT 1`,
	)
	const id = org.rows[0]?.id
	if (!id) throw new Error('no organization seeded — run the integration setup')
	orgId = id
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE slug LIKE $1`, [`${TAG}-%`])
	await pool.end()
})

describe('PipelineService attention buckets', () => {
	describe('when a company has missed its follow-up date', () => {
		it('should lead the overdue list with the one missed longest', async () => {
			// GIVEN two companies past their follow-up, one by a fortnight and one by
			// a day
			await insertCompany({
				name: 'slipped-long',
				status: 'proposal',
				nextActionInDays: -14,
			})
			await insertCompany({
				name: 'slipped-short',
				status: 'proposal',
				nextActionInDays: -1,
			})

			// WHEN the planning lists are read
			const { overdueCompanies } = await readBuckets()
			const ours = slugsOf(overdueCompanies).filter(s => s.startsWith(TAG))

			// THEN the one left waiting longest comes first, because the list is
			// meant to be worked from the top. Both are checked to be on the list
			// before their order is: a missing row also reads as "earlier" once
			// indexOf answers -1, which would pass an ordering check on its own.
			expect(ours).toContain(`${TAG}-slipped-long`)
			expect(ours).toContain(`${TAG}-slipped-short`)
			expect(ours.indexOf(`${TAG}-slipped-long`)).toBeLessThan(
				ours.indexOf(`${TAG}-slipped-short`),
			)
		})

		it('should keep it off the quiet list as well', async () => {
			// GIVEN a company that has both missed its follow-up and not been heard
			// from in months — it qualifies for both lists on the face of it
			await insertCompany({
				name: 'both',
				status: 'meeting',
				lastContactedDaysAgo: 90,
				nextActionInDays: -3,
			})

			// WHEN the lists are read
			const { overdueCompanies, staleCompanies } = await readBuckets()

			// THEN it appears once, under the more urgent heading — a single company
			// asking twice for attention reads as a fault in the screen
			expect(slugsOf(overdueCompanies)).toContain(`${TAG}-both`)
			expect(slugsOf(staleCompanies)).not.toContain(`${TAG}-both`)
		})
	})

	describe('when nobody is selling to the company any more', () => {
		it('should leave it off every list', async () => {
			// GIVEN two finished deals, each of which would otherwise earn a place:
			// one closed with a follow-up date long past, and one dead that is
			// priority 1 with nothing scheduled — the exact shape the high-priority
			// list looks for. Each is built to be caught by a different list, so a
			// missing status check on either one fails this test.
			await insertCompany({
				name: 'closed',
				status: 'closed',
				nextActionInDays: -30,
			})
			await insertCompany({
				name: 'dead',
				status: 'dead',
				priority: 1,
				lastContactedDaysAgo: 2,
			})

			// WHEN the lists are read
			const { overdueCompanies, staleCompanies, highPriority } =
				await readBuckets()
			const everywhere = [
				...slugsOf(overdueCompanies),
				...slugsOf(staleCompanies),
				...slugsOf(highPriority),
			]

			// THEN neither is asked after — chasing a finished deal is the one thing
			// this list must never put in front of somebody
			expect(everywhere).not.toContain(`${TAG}-closed`)
			expect(everywhere).not.toContain(`${TAG}-dead`)
		})
	})

	describe('when a company in play has gone quiet', () => {
		it('should lead with the one never contacted at all', async () => {
			// GIVEN one company last heard from a month ago and one never contacted
			await insertCompany({
				name: 'quiet-month',
				status: 'contacted',
				lastContactedDaysAgo: 30,
			})
			await insertCompany({
				name: 'quiet-never',
				status: 'contacted',
				lastContactedDaysAgo: null,
			})

			// WHEN the quiet list is read
			const { staleCompanies } = await readBuckets()
			const ours = slugsOf(staleCompanies).filter(s => s.startsWith(TAG))

			// THEN never-contacted leads: no contact at all is the longest silence
			// there is, and sorting it last would bury the coldest lead on the list.
			// Presence is asserted first for the same reason as above — a row that
			// is simply absent would otherwise satisfy the ordering.
			expect(ours).toContain(`${TAG}-quiet-never`)
			expect(ours).toContain(`${TAG}-quiet-month`)
			expect(ours.indexOf(`${TAG}-quiet-never`)).toBeLessThan(
				ours.indexOf(`${TAG}-quiet-month`),
			)
		})

		it('should ignore stages where silence means nothing', async () => {
			// GIVEN an untouched prospect and a signed client, neither contacted in
			// months
			await insertCompany({
				name: 'prospect-quiet',
				status: 'prospect',
				lastContactedDaysAgo: 120,
			})
			await insertCompany({
				name: 'client-quiet',
				status: 'client',
				lastContactedDaysAgo: 120,
			})

			// WHEN the quiet list is read
			const { staleCompanies } = await readBuckets()

			// THEN neither is on it: silence is only worth flagging mid-chase, and a
			// list that nagged about every signed client would stop being read
			expect(slugsOf(staleCompanies)).not.toContain(`${TAG}-prospect-quiet`)
			expect(slugsOf(staleCompanies)).not.toContain(`${TAG}-client-quiet`)
		})
	})

	describe('when the caller sets its own idea of quiet', () => {
		it('should narrow the list as the threshold lengthens', async () => {
			// GIVEN a company last heard from three weeks ago
			await insertCompany({
				name: 'three-weeks',
				status: 'responded',
				lastContactedDaysAgo: 21,
			})

			// WHEN the list is read at a fortnight and again at two months
			const fortnight = await readBuckets({ staleDays: 14 })
			const twoMonths = await readBuckets({ staleDays: 60 })

			// THEN three weeks of silence counts under the shorter threshold and not
			// the longer one — the number is the caller's to choose, because a trade
			// quoting in days and one selling on six-month cycles do not mean the
			// same thing by "quiet"
			expect(slugsOf(fortnight.staleCompanies)).toContain(`${TAG}-three-weeks`)
			expect(slugsOf(twoMonths.staleCompanies)).not.toContain(
				`${TAG}-three-weeks`,
			)
		})

		it('should keep a never-contacted company however long the threshold', async () => {
			// GIVEN a company in play that has never been contacted at all
			await insertCompany({
				name: 'never-spoken-to',
				status: 'proposal',
				lastContactedDaysAgo: null,
			})

			// WHEN the list is read at a fortnight and again at ten years
			const fortnight = await readBuckets({ staleDays: 14 })
			const decade = await readBuckets({ staleDays: 3650 })

			// THEN it is on both. Silence with no start date is not shorter than any
			// threshold — it is longer than all of them — so raising the threshold
			// must never quietly drop the coldest leads on the list
			expect(slugsOf(fortnight.staleCompanies)).toContain(
				`${TAG}-never-spoken-to`,
			)
			expect(slugsOf(decade.staleCompanies)).toContain(`${TAG}-never-spoken-to`)
		})
	})

	describe('when a hot company has nothing booked in', () => {
		it('should list it only while it is not already being chased', async () => {
			// GIVEN two priority-1 companies with nothing scheduled: one contacted
			// last week, one silent for two months
			await insertCompany({
				name: 'hot-fresh',
				status: 'responded',
				priority: 1,
				lastContactedDaysAgo: 5,
			})
			await insertCompany({
				name: 'hot-quiet',
				status: 'responded',
				priority: 1,
				lastContactedDaysAgo: 60,
			})

			// WHEN the lists are read
			const { staleCompanies, highPriority } = await readBuckets()

			// THEN only the freshly contacted one is called out as high priority; the
			// silent one is already answered for further up, under gone quiet
			expect(slugsOf(highPriority)).toContain(`${TAG}-hot-fresh`)
			expect(slugsOf(highPriority)).not.toContain(`${TAG}-hot-quiet`)
			expect(slugsOf(staleCompanies)).toContain(`${TAG}-hot-quiet`)
		})

		it('should reach further down the scale when asked to', async () => {
			// GIVEN a second-priority company with nothing scheduled
			await insertCompany({
				name: 'warm',
				status: 'responded',
				priority: 2,
				lastContactedDaysAgo: 2,
			})

			// WHEN the list is read at the default reach and again one step down
			const hottest = await readBuckets()
			const alsoWarm = await readBuckets({ priorityAtLeast: 2 })

			// THEN it only shows once the caller asks for it, so the default list
			// stays as short as the word "priority" promises
			expect(slugsOf(hottest.highPriority)).not.toContain(`${TAG}-warm`)
			expect(slugsOf(alsoWarm.highPriority)).toContain(`${TAG}-warm`)
		})
	})

	describe('when more companies match than the list will hold', () => {
		it('should count them all and say it was cut short', async () => {
			// GIVEN four quiet companies and room on the list for two
			for (const n of [1, 2, 3, 4]) {
				await insertCompany({
					name: `capped-${n}`,
					status: 'contacted',
					lastContactedDaysAgo: 40 + n,
				})
			}

			// WHEN the list is read with a cap of two
			const capped = await readBuckets({ limit: 2 })

			// THEN two rows come back, the flag says there are more, and the count
			// reports every match — the heading has to be able to say "2 of 40",
			// which is the whole reason a screen can show a handful honestly
			expect(capped.staleCompanies).toHaveLength(2)
			expect(capped.staleCompaniesTruncated).toBe(true)
			expect(capped.counts.staleCompanies).toBeGreaterThan(
				capped.staleCompanies.length,
			)
		})

		it('should count exactly what an uncapped read returns', async () => {
			// GIVEN whatever the org holds right now
			// WHEN the lists are read with room to spare
			const full = await readBuckets({ limit: 500 })

			// THEN every count matches the rows beside it, so the number in a heading
			// and the rows under it can never tell different stories. All five lists
			// are checked, including the two that carry no companies: a list that
			// answers "how many?" differently from its neighbours is the asymmetry
			// this count exists to remove.
			expect(full.staleCompaniesTruncated).toBe(false)
			expect(full.counts.staleCompanies).toBe(full.staleCompanies.length)
			expect(full.counts.overdueCompanies).toBe(full.overdueCompanies.length)
			expect(full.counts.highPriority).toBe(full.highPriority.length)
			expect(full.counts.dueTasks).toBe(full.dueTasks.length)
			expect(full.counts.researchAwaitingReview).toBe(
				full.researchAwaitingReview.length,
			)
		})
	})

	describe('when a company card is drawn from the list', () => {
		it('should carry everything the card shows', async () => {
			// GIVEN a quiet company with a trade, a place and a priority on it
			await insertCompany({
				name: 'full-card',
				status: 'meeting',
				priority: 2,
				lastContactedDaysAgo: 45,
			})

			// WHEN the quiet list is read
			const { staleCompanies } = await readBuckets()
			const card = staleCompanies.find(c => c.slug === `${TAG}-full-card`)

			// THEN the row carries the status, priority and last-contact date the
			// card draws, so the dashboard needs no second request to render it
			expect(card?.status).toBe('meeting')
			expect(card?.priority).toBe(2)
			expect(card?.lastContactedAt).not.toBeNull()
		})
	})
})
