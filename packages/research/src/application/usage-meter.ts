/**
 * What a research run really spent.
 *
 * The budget is a spending limit: it is charged a flat, predictable amount
 * before each tool call so the run can decide whether it can still afford to
 * keep going. This is the separate record of what the run was actually billed —
 * the credits a provider reports after the fact, and the model tokens the budget
 * never sees at all. Keeping the two apart is deliberate: if real prices fed the
 * limit, two identical runs would stop at different points depending on what a
 * vendor happened to charge that day.
 *
 * Amounts add up in millionths of a cent. A single model call costs a tiny
 * fraction of a cent, so rounding each one to whole cents would record every run
 * as free; the total is rounded once, at the end.
 */

import { Context, Effect, Metric, Ref } from 'effect'

import type { LlmTier } from '../infrastructure/cached-llm'

const MICROCENTS_PER_CENT = 1_000_000

// One model call that actually reached a provider, priced at that slot's rate.
export interface LlmUsage {
	readonly tier: LlmTier
	/** The model that answered — a fallback slot bills at its own vendor's rate. */
	readonly model: string
	readonly tokensIn: number
	readonly tokensOut: number
	readonly microcents: number
}

// One billed provider call: the credits it reported, priced at that provider's
// rate. Firecrawl charges several credits for one search, so this is the real
// figure it returned, not the flat one the budget was charged.
export interface UnitUsage {
	readonly provider: string
	readonly port: 'search' | 'scrape' | 'map'
	readonly units: number
	readonly microcents: number
}

export interface UsageSnapshot {
	/** Everything the run was billed, in whole cents. */
	readonly costCents: number
	readonly tokensIn: number
	readonly tokensOut: number
	/** Cents per kind of work: `llm_agent` for a model tier, `search` for a port. */
	readonly costByBucket: Record<string, number>
	/** Credits consumed, per provider and port: `firecrawl_search`. */
	readonly unitsByProvider: Record<string, number>
	/**
	 * How many calls each model answered, per tier: `agent@Qwen/Qwen3-32B`. A
	 * tier with two entries fell back partway through, and the counts say how
	 * much of it ran on each — which is the difference between reading a run's
	 * quality as the model it was configured with and as the model that
	 * actually produced it.
	 *
	 * Counted apart from the cost buckets on purpose: those are summed to reach
	 * the run's total, so a second entry describing the same spend would charge
	 * the run twice.
	 */
	readonly callsByModel: Record<string, number>
}

export interface UsageMeterService {
	/**
	 * Carry forward what an earlier attempt of the same run already spent, so a
	 * run that resumes adds to that total instead of replacing it.
	 */
	readonly seed: (
		priorCents: number,
		priorTokensIn: number,
		priorTokensOut: number,
	) => Effect.Effect<void>
	readonly recordLlm: (usage: LlmUsage) => Effect.Effect<void>
	readonly recordUnits: (usage: UnitUsage) => Effect.Effect<void>
	readonly snapshot: () => Effect.Effect<UsageSnapshot>
}

export class UsageMeter extends Context.Service<
	UsageMeter,
	UsageMeterService
>()('research/UsageMeter') {}

// Counters carry only tags with a handful of possible values: the metrics store
// keeps a separate running total for every combination of tags, so tagging by
// organization, run or query would create an endless number of them. Those
// belong on a span or in the database instead.
//
// This meter and `WorkRecord` in @batuda/observability are the same shape on
// purpose-adjacent problems: both gather facts about one piece of work through
// `serviceOption`, so work running outside one carries on quietly. They are kept
// apart because this one prices and buckets as it goes, which a plain bag of
// facts does not do. If a research run ever opens a record of its own, these
// totals are what it should carry.
const llmTokens = Metric.counter('batuda_research_llm_tokens_total', {
	description: 'Model tokens billed by the research pipeline',
	incremental: true,
})
const llmCost = Metric.counter('batuda_research_llm_cost_microcents_total', {
	description: 'Model inference cost, in millionths of a cent',
	incremental: true,
})
const providerUnits = Metric.counter('batuda_research_provider_units_total', {
	description: 'Provider credits consumed by the research pipeline',
	incremental: true,
})
const providerCost = Metric.counter(
	'batuda_research_provider_cost_microcents_total',
	{
		description: 'Provider cost, in millionths of a cent',
		incremental: true,
	},
)

interface MeterState {
	readonly seedCents: number
	readonly seedTokensIn: number
	readonly seedTokensOut: number
	readonly tokensIn: number
	readonly tokensOut: number
	readonly microcentsByBucket: Record<string, number>
	readonly unitsByProvider: Record<string, number>
	readonly callsByModel: Record<string, number>
}

const EMPTY: MeterState = {
	seedCents: 0,
	seedTokensIn: 0,
	seedTokensOut: 0,
	tokensIn: 0,
	tokensOut: 0,
	microcentsByBucket: {},
	unitsByProvider: {},
	callsByModel: {},
}

const add = (
	totals: Record<string, number>,
	key: string,
	amount: number,
): Record<string, number> => ({ ...totals, [key]: (totals[key] ?? 0) + amount })

export const makeUsageMeter: Effect.Effect<UsageMeterService> = Effect.gen(
	function* () {
		const state = yield* Ref.make(EMPTY)

		return {
			seed: (priorCents, priorTokensIn, priorTokensOut) =>
				Ref.update(state, s => ({
					...s,
					seedCents: priorCents,
					seedTokensIn: priorTokensIn,
					seedTokensOut: priorTokensOut,
				})),

			recordLlm: usage =>
				Effect.gen(function* () {
					yield* Ref.update(state, s => ({
						...s,
						tokensIn: s.tokensIn + usage.tokensIn,
						tokensOut: s.tokensOut + usage.tokensOut,
						microcentsByBucket: add(
							s.microcentsByBucket,
							`llm_${usage.tier}`,
							usage.microcents,
						),
						callsByModel: add(
							s.callsByModel,
							`${usage.tier}@${usage.model}`,
							1,
						),
					}))
					const tags = { tier: usage.tier, model: usage.model }
					yield* Metric.update(
						llmTokens.pipe(Metric.withAttributes({ ...tags, direction: 'in' })),
						usage.tokensIn,
					)
					yield* Metric.update(
						llmTokens.pipe(
							Metric.withAttributes({ ...tags, direction: 'out' }),
						),
						usage.tokensOut,
					)
					yield* Metric.update(
						llmCost.pipe(Metric.withAttributes(tags)),
						usage.microcents,
					)
				}),

			recordUnits: usage =>
				Effect.gen(function* () {
					const bucket = `${usage.provider}_${usage.port}`
					yield* Ref.update(state, s => ({
						...s,
						microcentsByBucket: add(
							s.microcentsByBucket,
							usage.port,
							usage.microcents,
						),
						unitsByProvider: add(s.unitsByProvider, bucket, usage.units),
					}))
					const tags = { provider: usage.provider, port: usage.port }
					yield* Metric.update(
						providerUnits.pipe(Metric.withAttributes(tags)),
						usage.units,
					)
					yield* Metric.update(
						providerCost.pipe(Metric.withAttributes(tags)),
						usage.microcents,
					)
				}),

			snapshot: () =>
				Ref.get(state).pipe(
					Effect.map(s => {
						const costByBucket: Record<string, number> = {}
						let microcents = 0
						for (const [bucket, amount] of Object.entries(
							s.microcentsByBucket,
						)) {
							microcents += amount
							costByBucket[bucket] = amount / MICROCENTS_PER_CENT
						}
						return {
							costCents: Math.round(
								s.seedCents + microcents / MICROCENTS_PER_CENT,
							),
							tokensIn: s.seedTokensIn + s.tokensIn,
							tokensOut: s.seedTokensOut + s.tokensOut,
							costByBucket,
							unitsByProvider: s.unitsByProvider,
							callsByModel: s.callsByModel,
						} satisfies UsageSnapshot
					}),
				),
		}
	},
)
