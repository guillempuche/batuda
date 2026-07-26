// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'
// The service reads these via Config at layer-build time.
process.env['RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL'] ??= '4'
process.env['RESEARCH_MAX_AGENT_STEPS'] ??= '6'
process.env['RESEARCH_MAX_LOOP_PROMPT_TOKENS'] ??= '24000'
process.env['RESEARCH_ORPHAN_SWEEP_INTERVAL_SEC'] ??= '3600'

import { Effect, Layer, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
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
	WriterLanguageModel,
} from '@batuda/research'

import { PgLive } from '../db/client.js'

// Saving the research budget, against the real schema.
//
// What a person may spend on one run lives on their own row; what the whole
// company may spend in a month lives on the company's. A single save writes
// both, and hands back the combined picture. It runs against a database with
// the real tables in place, because what can go wrong here is a disagreement
// between those tables and the shape the service reads them into — something a
// stubbed database cannot show.
//
// No research job runs here, so the language-model and provider ports are never
// called; the stubs exist only so the service layer builds.

const stubLlm: LanguageModel.Service = {
	generateText: (_options: unknown) => Effect.die('llm not exercised') as never,
	generateObject: (_options: unknown) =>
		Effect.die('llm not exercised') as never,
	streamText: (_options: unknown) => Stream.die('llm not exercised') as never,
}

const providerNotExercised =
	'research provider not exercised by the policy-save suite'
const providersLayer = Layer.mergeAll(
	Layer.succeed(SearchProvider)(
		SearchProvider.of({ search: () => Effect.die(providerNotExercised) }),
	),
	Layer.succeed(MapProvider)(
		MapProvider.of({ map: () => Effect.die(providerNotExercised) }),
	),
	Layer.succeed(ScrapeProvider)(
		ScrapeProvider.of({ scrape: () => Effect.die(providerNotExercised) }),
	),
	Layer.succeed(RegistryRouter)(
		RegistryRouter.of({ lookup: () => Effect.die(providerNotExercised) }),
	),
)

const llmLayer = Layer.mergeAll(
	Layer.succeed(AgentLanguageModel)(stubLlm),
	Layer.succeed(ExtractLanguageModel)(stubLlm),
	Layer.succeed(WriterLanguageModel)(stubLlm),
)

const ResearchLive = ResearchService.layer.pipe(
	Layer.provide(llmLayer),
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

type PolicyRow = {
	budgetCents: number
	paidBudgetCents: number
	autoApprovePaidCents: number
	autoApplyMinConfidence: number | null
}

let orgId = ''
let userId = ''
// What the seed left on both rows, so this suite can put its figures back.
let seededPolicy: PolicyRow | undefined
let seededOrgCapCents: number | undefined

beforeAll(async () => {
	const seed = await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const [org] = yield* sql<{ id: string }>`
				SELECT id FROM "organization" WHERE slug = 'taller' LIMIT 1
			`
			const [user] = yield* sql<{ id: string }>`
				SELECT id FROM "user" WHERE email = 'admin@taller.cat' LIMIT 1
			`
			if (!org || !user) {
				throw new Error(
					"taller org / admin@taller.cat missing — run 'pnpm cli db reset && pnpm cli seed' first",
				)
			}
			const [policy] = yield* sql<PolicyRow>`
				SELECT budget_cents, paid_budget_cents, auto_approve_paid_cents, auto_apply_min_confidence
				FROM user_research_policy WHERE user_id = ${user.id}
			`
			const [orgPolicy] = yield* sql<{ paidMonthlyCapCents: number }>`
				SELECT paid_monthly_cap_cents
				FROM organization_research_policy WHERE organization_id = ${org.id}
			`
			return {
				orgId: org.id,
				userId: user.id,
				policy,
				orgCapCents: orgPolicy?.paidMonthlyCapCents,
			}
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<
			{
				orgId: string
				userId: string
				policy: PolicyRow | undefined
				orgCapCents: number | undefined
			},
			never,
			never
		>,
	)
	orgId = seed.orgId
	userId = seed.userId
	seededPolicy = seed.policy
	seededOrgCapCents = seed.orgCapCents
}, 60_000)

// Both rows belong to the shared seed and other suites read them, so the
// figures written here are put back rather than left behind — and a row this
// suite brought into being is removed again.
afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const policy = seededPolicy
			if (policy === undefined) {
				yield* sql`DELETE FROM user_research_policy WHERE user_id = ${userId}`
			} else {
				yield* sql`
					UPDATE user_research_policy SET
						budget_cents = ${policy.budgetCents},
						paid_budget_cents = ${policy.paidBudgetCents},
						auto_approve_paid_cents = ${policy.autoApprovePaidCents},
						auto_apply_min_confidence = ${policy.autoApplyMinConfidence}
					WHERE user_id = ${userId}
				`
			}
			if (seededOrgCapCents === undefined) {
				yield* sql`DELETE FROM organization_research_policy WHERE organization_id = ${orgId}`
			} else {
				yield* sql`
					UPDATE organization_research_policy
					SET paid_monthly_cap_cents = ${seededOrgCapCents}
					WHERE organization_id = ${orgId}
				`
			}
		}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
	)
})

describe('ResearchService policy saving', () => {
	describe('when a per-run budget is saved on its own', () => {
		it('should hand back the new figure and keep it in the table', async () => {
			// GIVEN a save carrying a new per-run figure
			// WHEN it runs against the real table
			// THEN the answer carries the new figure
			// AND reading the policy back afterwards agrees with it
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const saved = yield* svc.updatePolicy(userId, orgId, {
						budgetCents: 725,
					})
					const reread = yield* svc.getPolicy(userId, orgId)
					return { saved, reread }
				}).pipe(Effect.provide(ResearchLive), Effect.orDie),
			)

			expect(outcome.saved.budgetCents).toBe(725)
			expect(outcome.reread?.budgetCents).toBe(725)
		})
	})

	describe('when the same save also sets the company monthly ceiling', () => {
		it('should keep both, rather than losing one to the other', async () => {
			// GIVEN a save that carries the person's own limits and the company's
			//   monthly ceiling together
			// WHEN it runs
			// THEN the answer reports the company ceiling alongside the personal ones
			// AND every figure is still there when the policy is read back, so
			//   neither write was discarded on the way out
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					const saved = yield* svc.updatePolicy(userId, orgId, {
						budgetCents: 450,
						paidBudgetCents: 900,
						autoApprovePaidCents: 300,
						paidMonthlyCapCents: 4200,
					})
					const reread = yield* svc.getPolicy(userId, orgId)
					const sql = yield* SqlClient.SqlClient
					const [orgRow] = yield* sql<{ paidMonthlyCapCents: number }>`
						SELECT paid_monthly_cap_cents
						FROM organization_research_policy
						WHERE organization_id = ${orgId}
					`
					return { saved, reread, orgRow }
				}).pipe(Effect.provide(ResearchLive), Effect.orDie),
			)

			expect(outcome.saved.budgetCents).toBe(450)
			expect(outcome.saved.paidBudgetCents).toBe(900)
			expect(outcome.saved.autoApprovePaidCents).toBe(300)
			expect(outcome.saved.paidMonthlyCapCents).toBe(4200)

			expect(outcome.reread?.budgetCents).toBe(450)
			expect(outcome.reread?.paidMonthlyCapCents).toBe(4200)

			// The company ceiling is the other half of the same save; if the save had
			// come apart, this row would be missing while the personal one stood.
			expect(outcome.orgRow?.paidMonthlyCapCents).toBe(4200)
		})
	})

	describe('when a save leaves the auto-apply confidence out', () => {
		it('should leave the existing setting alone', async () => {
			// GIVEN auto-apply is set to a minimum confidence of 80 percent
			// WHEN a later save changes only the per-run budget
			// THEN the confidence is untouched, because an omitted field means
			//   "leave this as it is" rather than "clear it"
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					yield* svc.updatePolicy(userId, orgId, {
						autoApplyMinConfidence: 80,
					})
					const after = yield* svc.updatePolicy(userId, orgId, {
						budgetCents: 610,
					})
					return after
				}).pipe(Effect.provide(ResearchLive), Effect.orDie),
			)

			expect(outcome.budgetCents).toBe(610)
			expect(outcome.autoApplyMinConfidence).toBe(80)
		})
	})

	describe('when a save passes a null auto-apply confidence', () => {
		it('should turn auto-apply off', async () => {
			// GIVEN auto-apply is on at a minimum confidence of 90 percent
			// WHEN a save passes null for it explicitly
			// THEN it is cleared, because passing null means "turn auto-apply off"
			const outcome = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* ResearchService
					yield* svc.updatePolicy(userId, orgId, {
						autoApplyMinConfidence: 90,
					})
					return yield* svc.updatePolicy(userId, orgId, {
						autoApplyMinConfidence: null,
					})
				}).pipe(Effect.provide(ResearchLive), Effect.orDie),
			)

			expect(outcome.autoApplyMinConfidence).toBeNull()
		})
	})
})
