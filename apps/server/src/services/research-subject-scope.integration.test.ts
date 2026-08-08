// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '4'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, Result, Stream } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AgentLanguageModel,
	ContactDiscovery,
	ExtractLanguageModel,
	MapProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchService,
	ScrapeProvider,
	SearchProvider,
	type SystemDefaults,
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'
import { enterOrgScope } from '../middleware/org.js'

// A research run can be pinned to a company by id, and ids are not secret —
// they turn up in exports, old links and earlier answers. This suite holds the
// line that a run only ever reads its own organization's records, and that a
// run which cannot read the record it was pinned to stops instead of quietly
// researching whatever its free text suggests.
//
// Prereq: `pnpm cli services up` — globalSetup builds and migrates the
// disposable batuda_it database this runs against.

interface Org {
	id: string
	name: string
	slug: string
}

// Every phase-1 prompt the agent tier is handed. The frozen subject snapshot is
// injected into that prompt, so this is where we can see what the run was told
// about the company — including whether it was told anything at all.
const prompts: Array<string> = []

const finalRound = {
	content: [],
	finishReason: 'stop' as const,
	usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
}

const capturingAgentLlm = {
	generateText: (options: unknown) => {
		prompts.push(JSON.stringify(options))
		return Effect.succeed({
			...finalRound,
			text: 'Nothing gathered.',
		}) as never
	},
	generateObject: (_options: unknown) =>
		Effect.succeed({ ...finalRound, value: {} }) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

const quietLlm = {
	generateText: (_options: unknown) =>
		Effect.succeed({ ...finalRound, text: '' }) as never,
	generateObject: (_options: unknown) =>
		Effect.succeed({ ...finalRound, value: {} }) as never,
	streamText: (_options: unknown) =>
		Stream.succeed({ type: 'text-delta' as const, delta: '' }) as never,
}

// Nothing external is exercised: the run under test never gets past the
// snapshot, and the one that does gathers nothing on purpose.
const unused = 'research provider not exercised by this test'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(unused) }),
	),
	Layer.succeed(MapProvider)(MapProvider.of({ map: () => Effect.die(unused) })),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(unused) }),
	),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(unused) }),
	),
)

const ResearchLive = ResearchService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(AgentLanguageModel)(capturingAgentLlm),
			Layer.succeed(ExtractLanguageModel)(quietLlm),
			Layer.succeed(WriterLanguageModel)(quietLlm),
		),
	),
	Layer.provide(providersLayer),
	Layer.provide(
		Layer.succeed(ContactDiscovery)({
			discover: () =>
				Effect.succeed({
					status: 'no_reliable_contact' as const,
					researchId: 'test',
				}),
		}),
	),
	Layer.provide(
		Layer.succeed(ResearchEventSink)(
			ResearchEventSink.of({ fire: () => Effect.void }),
		),
	),
	Layer.provideMerge(PgLive),
)

const systemDefaults: SystemDefaults = {
	budgetCents: 100,
	paidBudgetCents: 500,
	autoApprovePaidCents: 200,
	paidMonthlyCapCents: 2000,
	hardCeiling: 5000,
}

const OTHER_ORG = `scope-other-${randomUUID()}`
const OWN_WEBSITE = `https://own-${randomUUID()}.example`
// Seeded alongside the website because the snapshot reads all three from
// `channels`, so all three are scoped — but only the website is consumed by the
// run today, so only that one can be asserted on behaviour rather than on SQL.
const OWN_EMAIL = `hello@own-${randomUUID()}.example`
const OWN_PHONE = '+34 900 000 111'

const TERMINAL = new Set([
	'succeeded',
	'succeeded_low_confidence',
	'failed',
	'cancelled',
	'no_reliable_data',
])

const ctx = {} as { org: Org }
let userId = ''
let ownCompanyId = ''
let foreignCompanyId = ''
const createdRunIds: Array<string> = []

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	Effect.runPromise(
		effect.pipe(Effect.provide(PgLive), Effect.orDie) as Effect.Effect<
			A,
			never,
			never
		>,
	)

beforeAll(async () => {
	const seed = await run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const [org] = yield* sql<Org>`
				SELECT id, name, slug FROM "organization" WHERE slug = 'taller' LIMIT 1
			`
			const [user] = yield* sql<{ id: string }>`
				SELECT id FROM "user" WHERE email = 'admin@taller.cat' LIMIT 1
			`
			if (!org || !user) {
				throw new Error(
					"taller org / admin@taller.cat missing — run 'pnpm cli db reset && pnpm cli seed' first",
				)
			}

			// The caller's own company, reachable three ways — the snapshot reads
			// each from `channels`, so all three prove the scoping did not cost the
			// run the picture it needs.
			const [own] = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name)
				VALUES (${org.id}, ${`own-${randomUUID()}`}, 'Own Scope Co')
				RETURNING id
			`
			for (const [channel, address] of [
				['website', OWN_WEBSITE],
				['email', OWN_EMAIL],
				['phone', OWN_PHONE],
			] as const) {
				yield* sql`
					INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, is_primary)
					VALUES (${org.id}, 'companies', ${own!.id}, ${channel}, ${address}, true)
				`
			}

			// A company belonging to somebody else entirely.
			const [foreign] = yield* sql<{ id: string }>`
				INSERT INTO companies (organization_id, slug, name)
				VALUES (${OTHER_ORG}, ${`foreign-${randomUUID()}`}, 'Foreign Scope Co')
				RETURNING id
			`
			return { org, userId: user.id, ownId: own!.id, foreignId: foreign!.id }
		}),
	)
	ctx.org = seed.org
	userId = seed.userId
	ownCompanyId = seed.ownId
	foreignCompanyId = seed.foreignId
}, 60_000)

afterAll(async () => {
	await run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			for (const id of createdRunIds) {
				yield* sql`DELETE FROM research_cache WHERE research_id = ${id}::uuid`
				yield* sql`DELETE FROM research_runs WHERE id = ${id}::uuid`
			}
			yield* sql`DELETE FROM channels WHERE subject_id = ${ownCompanyId}::uuid`
			yield* sql`DELETE FROM companies WHERE id = ${ownCompanyId}::uuid`
			yield* sql`DELETE FROM companies WHERE id = ${foreignCompanyId}::uuid`
		}),
	)
})

const startRun = (subjectId: string) =>
	Effect.gen(function* () {
		const svc = yield* ResearchService
		const sql = yield* SqlClient.SqlClient
		const created = yield* enterOrgScope(sql, { org: ctx.org, userId })(
			svc.create(
				userId,
				ctx.org.id,
				{
					query: `Scope check ${randomUUID()}`,
					schemaName: 'company_enrichment_v1',
					forceFresh: true,
					context: { subjects: [{ table: 'companies', id: subjectId }] },
				},
				systemDefaults,
			),
		)
		if (created.status === 'confirm_required')
			return yield* Effect.die(new Error('scope test input should not fan out'))
		createdRunIds.push(created.id)
		return created.id
	})

const pollToTerminal = (id: string) =>
	Effect.gen(function* () {
		const svc = yield* ResearchService
		for (let attempt = 0; attempt < 60; attempt++) {
			const row = (yield* svc.get(id).pipe(Effect.orDie)) as {
				status?: string
				reasonCode?: string | null
			} | null
			if (row?.status && TERMINAL.has(row.status)) return row
			yield* Effect.sleep('1 second')
		}
		return null
	})

describe('research subject scoping', () => {
	describe('when a run names a company belonging to another organization', () => {
		it('should refuse to start it and link nothing', async () => {
			// GIVEN a company id that belongs to a different organization
			// WHEN a member of this organization starts a run pinned to that id
			// THEN the run is refused, naming the record it could not find, and no
			//   link row is written that would let a later read reach it
			const outcome = await Effect.runPromise(
				Effect.result(startRun(foreignCompanyId)).pipe(
					Effect.provide(ResearchLive),
					Effect.orDie,
				),
			)

			expect(Result.isFailure(outcome)).toBe(true)
			if (Result.isFailure(outcome))
				expect(outcome.failure._tag).toBe('SubjectUnavailable')

			const links = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* sql<{ n: number }>`
						SELECT COUNT(*)::int AS n FROM research_links
						WHERE subject_id = ${foreignCompanyId}::uuid
					`
				}),
			)
			expect(links[0]?.n).toBe(0)
		}, 30_000)
	})

	describe('when a run names a company of its own organization', () => {
		it('should still read it, and still know its own website', async () => {
			// GIVEN a company of the caller's own organization holding a website
			// WHEN a run is pinned to it and the fiber reaches the first prompt
			// THEN the run is still told which company it is and which site is that
			//   company's own — the domain being what tells this company from a
			//   same-named one elsewhere, and the one thing scoping could have cost
			//   it. The version it read the row at survives too, since a proposal
			//   without it can never be applied.
			prompts.length = 0
			const id = await Effect.runPromise(
				startRun(ownCompanyId).pipe(
					Effect.flatMap(runId => pollToTerminal(runId).pipe(Effect.as(runId))),
					Effect.provide(ResearchLive),
					Effect.orDie,
				),
			)
			expect(id).toBeTruthy()

			const seen = prompts.join('\n')
			expect(seen).toContain('Own Scope Co')
			expect(seen).toContain(OWN_WEBSITE)
			expect(seen).toContain('expected_version')
		}, 90_000)
	})

	describe('when the company is deleted between asking and the run starting', () => {
		it('should fail the run rather than research an unnamed company', async () => {
			// GIVEN a run accepted while its company still existed
			// WHEN the company is soft-deleted before the fiber reads it
			// THEN the run ends failed with subject_unavailable, rather than
			//   carrying on with nothing to ground itself against
			const [doomed] = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* sql<{ id: string }>`
						INSERT INTO companies (organization_id, slug, name)
						VALUES (${ctx.org.id}, ${`doomed-${randomUUID()}`}, 'Doomed Co')
						RETURNING id
					`
				}),
			)

			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const runId = yield* startRun(doomed!.id)
					// Soft-delete it out from under the queued run, the way a person
					// deleting a company while research is queued would.
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						UPDATE companies SET deleted_at = now() WHERE id = ${doomed!.id}::uuid
					`
					return yield* pollToTerminal(runId)
				}).pipe(Effect.provide(ResearchLive), Effect.orDie),
			)

			expect(outcome?.status).toBe('failed')
			expect(outcome?.reasonCode).toBe('subject_unavailable')

			await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`DELETE FROM companies WHERE id = ${doomed!.id}::uuid`
				}),
			)
		}, 90_000)
	})

	describe('when re-running a run that was pinned to a foreign company', () => {
		it('should refuse it, so an old row cannot become runnable', async () => {
			// GIVEN a run row already carrying another organization's company id —
			//   the shape every run written before this check existed can have
			// WHEN somebody re-runs it against a corrected domain
			// THEN it is refused, rather than reading that company on the way through
			const [stale] = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* sql<{ id: string }>`
						INSERT INTO research_runs (organization_id, query, status, context, created_by)
						VALUES (
							${ctx.org.id}, 'stale pinned run', 'failed',
							${JSON.stringify({ subjects: [{ table: 'companies', id: foreignCompanyId }] })}::jsonb,
							${userId}
						)
						RETURNING id
					`
				}),
			)
			createdRunIds.push(stale!.id)

			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const sql = yield* SqlClient.SqlClient
					return yield* enterOrgScope(sql, { org: ctx.org, userId })(
						Effect.result(
							svc.rerun(userId, ctx.org.id, stale!.id, 'example.com'),
						),
					)
				}).pipe(Effect.provide(ResearchLive), Effect.orDie),
			)

			expect(Result.isFailure(outcome)).toBe(true)
			if (Result.isFailure(outcome))
				expect(outcome.failure._tag).toBe('SubjectUnavailable')
		}, 30_000)
	})
})
