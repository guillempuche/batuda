import { Config, Context, Effect, Layer } from 'effect'

import type { SystemDefaults } from '@batuda/research'

/**
 * What a research run may spend when nobody has set a limit of their own.
 *
 * Its own service rather than a corner of the server's settings, because the
 * five tools that read it also run on the local command-line server a developer
 * points Cursor or Claude Desktop at — which has no port and no address, and so
 * could not build those settings at all.
 *
 * Every value has a fallback, so nothing here can keep a server from booting.
 */
export class ResearchDefaults extends Context.Service<ResearchDefaults>()(
	'ResearchDefaults',
	{
		make: Effect.gen(function* () {
			const budgetCents = yield* Config.int(
				'RESEARCH_DEFAULT_BUDGET_CENTS',
			).pipe(Config.withDefault(100))
			const paidBudgetCents = yield* Config.int(
				'RESEARCH_DEFAULT_PAID_BUDGET_CENTS',
			).pipe(Config.withDefault(500))
			const autoApprovePaidCents = yield* Config.int(
				'RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS',
			).pipe(Config.withDefault(200))
			const paidMonthlyCapCents = yield* Config.int(
				'RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS',
			).pipe(Config.withDefault(2000))
			// The most anyone may raise the monthly cap to. A ceiling on the
			// ceiling: raising a limit is asked about, but nobody should be able to
			// agree to an unbounded one.
			const hardCeiling = yield* Config.int(
				'RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS',
			).pipe(Config.withDefault(10_000))
			return {
				budgetCents,
				paidBudgetCents,
				autoApprovePaidCents,
				paidMonthlyCapCents,
				hardCeiling,
			} satisfies SystemDefaults
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
