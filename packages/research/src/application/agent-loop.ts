/**
 * The bounded reflect-and-retry loop that drives a research run's phase-1 agent.
 *
 * A single model call only ever emits its tool calls once and never sees the
 * results, so it cannot judge "these are thin, search again". This loop feeds
 * each round's tool results back to the model until it produces a final answer,
 * hits a step cap, or exhausts the run budget — whichever comes first.
 *
 * The loop is kept free of the inference API and the database: the caller injects
 * one round as a `runRound` effect and the budget as a `budgetSnapshot` effect.
 * That lets the stop conditions be unit-tested with scripted rounds, while the
 * model call and prompt threading are exercised where they live, in the run fiber.
 */

import { Effect } from 'effect'

import type { BudgetSnapshot } from '../domain/types'
import { CHEAP_MIN_COST_CENTS, REGISTRY_LOOKUP_COST_CENTS } from './tool-costs'

/** One round of the loop, reduced to the plain data the stop conditions need. */
export interface LoopRound {
	/** The model's assistant text this round (often empty on a tool-only turn). */
	readonly text: string
	/** Whether the model asked to call any tool — i.e. it wants to keep going. */
	readonly hasToolCalls: boolean
	/** `scrape_page` url hashes fetched this round, for source attribution. */
	readonly scrapeUrlHashes: ReadonlyArray<string>
	/** Bounded, human-readable tool-result excerpts to fold into the transcript. */
	readonly renderedResults: ReadonlyArray<string>
	/** How much this round adds to the running prompt, to bound context growth. */
	readonly promptChars: number
	readonly inputTokens: number
	readonly outputTokens: number
}

export type LoopStopReason = 'model-final' | 'step-cap' | 'budget' | 'context'

export interface AgentLoopResult {
	/** Rendered transcript of the whole loop — the grounding input for phase 2. */
	readonly researchText: string
	readonly scrapedUrlHashes: ReadonlyArray<string>
	readonly tokensIn: number
	readonly tokensOut: number
	readonly rounds: number
	readonly stopReason: LoopStopReason
}

/**
 * The loop may run another round only while some tool it might call is still
 * fundable: any cheap tool, or the paid registry lookup.
 */
export const canAffordAnotherRound = (snapshot: BudgetSnapshot): boolean =>
	snapshot.cheapRemaining >= CHEAP_MIN_COST_CENTS ||
	snapshot.paidRemaining >= REGISTRY_LOOKUP_COST_CENTS

export interface RunAgentResearchLoopParams<E, R> {
	readonly maxSteps: number
	/** Character budget for the accumulated prompt; stops the loop before the
	 * agent model's context window overflows. Omitted = unbounded. */
	readonly maxPromptChars?: number | undefined
	readonly runRound: (round: number) => Effect.Effect<LoopRound, E, R>
	readonly budgetSnapshot: Effect.Effect<BudgetSnapshot, E, R>
	/** Carried across a resume so token totals and text survive a restart. */
	readonly priorText?: string | undefined
	readonly priorTokensIn?: number | undefined
	readonly priorTokensOut?: number | undefined
}

// A failing round (e.g. the model provider erroring after its retries) is not
// swallowed: it propagates as E so the run fiber marks the run failed rather
// than shipping a half-built transcript.
export const runAgentResearchLoop = <E, R>(
	params: RunAgentResearchLoopParams<E, R>,
): Effect.Effect<AgentLoopResult, E, R> =>
	Effect.gen(function* () {
		const transcript: string[] =
			params.priorText && params.priorText.length > 0 ? [params.priorText] : []
		const urlHashes = new Set<string>()
		let tokensIn = params.priorTokensIn ?? 0
		let tokensOut = params.priorTokensOut ?? 0
		let round = 0
		let totalPromptChars = 0
		let stopReason: LoopStopReason = 'model-final'

		while (true) {
			round++
			const result = yield* params.runRound(round)
			tokensIn += result.inputTokens
			tokensOut += result.outputTokens
			totalPromptChars += result.promptChars
			if (result.text.length > 0) transcript.push(result.text)
			for (const rendered of result.renderedResults) transcript.push(rendered)
			for (const hash of result.scrapeUrlHashes) urlHashes.add(hash)

			// The stop conditions are independent: the model finishing, the step
			// cap, the prompt outgrowing the context window, and the budget each
			// end the loop on their own.
			if (!result.hasToolCalls) {
				stopReason = 'model-final'
				break
			}
			if (round >= params.maxSteps) {
				stopReason = 'step-cap'
				break
			}
			if (
				params.maxPromptChars !== undefined &&
				totalPromptChars >= params.maxPromptChars
			) {
				stopReason = 'context'
				break
			}
			const snapshot = yield* params.budgetSnapshot
			if (!canAffordAnotherRound(snapshot)) {
				stopReason = 'budget'
				break
			}
		}

		return {
			researchText: transcript.join('\n\n'),
			scrapedUrlHashes: Array.from(urlHashes),
			tokensIn,
			tokensOut,
			rounds: round,
			stopReason,
		}
	})
