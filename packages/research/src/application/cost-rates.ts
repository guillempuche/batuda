/**
 * What the pipeline is charged, per unit of work.
 *
 * Rates are required settings with no fallback: a made-up default would quietly
 * report a wrong figure, and a wrong figure is worse than a missing one. Each is
 * read where the thing it prices is set up, so adding a model or a provider
 * without saying what it costs stops startup rather than producing runs that
 * look free.
 *
 * Amounts are carried in millionths of a cent: one call can be worth a few
 * thousandths of a cent, which whole cents would record as nothing at all.
 *
 * A rate is only ever as good as the figure someone put in. The Groq, Brave and
 * Firecrawl rates in production were read off those vendors' own published
 * prices; the two Nebius Token Factory rates and the Fireworks one are informed
 * estimates, because neither vendor states a per-model price where it could be
 * read directly. Treat a cost that looks surprising as a question about the rate
 * before it is treated as a question about the run — and correct the rate at its
 * source, since nothing here can tell a good figure from a bad one.
 */

const MICROCENTS_PER_CENT = 1_000_000

// What one model slot charges for the text it reads and the text it writes,
// per thousand tokens.
export interface LlmRate {
	readonly inCentsPer1k: number
	readonly outCentsPer1k: number
}

/**
 * What one model call costs, from the tokens it reported.
 *
 * Providers price the two directions differently — reading a long page of
 * evidence is usually far cheaper than writing an answer — so each is charged at
 * its own rate.
 */
export const priceLlmMicrocents = (
	tokensIn: number,
	tokensOut: number,
	rate: LlmRate,
): number =>
	Math.round(
		((tokensIn * rate.inCentsPer1k + tokensOut * rate.outCentsPer1k) / 1000) *
			MICROCENTS_PER_CENT,
	)

/** What a provider's reported credits cost, at that provider's rate. */
export const priceUnitsMicrocents = (
	units: number,
	centsPerUnit: number,
): number => Math.round(units * centsPerUnit * MICROCENTS_PER_CENT)
