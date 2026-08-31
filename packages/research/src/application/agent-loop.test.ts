import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { BudgetSnapshot } from '../domain/types'
import {
	canAffordAnotherRound,
	type LoopRound,
	runAgentResearchLoop,
} from './agent-loop'

// A tool-calling round (the model wants to keep going) carries the page it
// fetched; a final round has no tool calls and produces the answer text.
const toolRound = (n: number): LoopRound => ({
	text: '',
	hasToolCalls: true,
	scrapeUrlHashes: [`hash-${n}`],
	renderedResults: [`[scrape_page] page ${n}`],
	promptChars: 100,
	inputTokens: 10,
})
const finalRound = (text: string): LoopRound => ({
	text,
	hasToolCalls: false,
	scrapeUrlHashes: [],
	renderedResults: [],
	promptChars: 50,
	inputTokens: 8,
})

const snapshot = (
	cheapRemaining: number,
	paidRemaining: number,
): BudgetSnapshot =>
	new BudgetSnapshot({
		cheapBudget: 100,
		cheapSpent: 100 - cheapRemaining,
		cheapRemaining,
		paidBudget: 100,
		paidSpent: 100 - paidRemaining,
		paidRemaining,
	})

// Feed the loop a fixed sequence of rounds, repeating the last one if the loop
// asks for more than were scripted.
const scriptedRounds = (rounds: ReadonlyArray<LoopRound>) => (_round: number) =>
	Effect.sync(() => rounds[Math.min(_round - 1, rounds.length - 1)]!)

describe('runAgentResearchLoop', () => {
	describe('when the first search is weak', () => {
		it('should make several rounds and carry every round into the transcript', async () => {
			// GIVEN two tool-calling rounds then a final answer
			// WHEN the loop runs with a high step cap and ample budget
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					runRound: scriptedRounds([
						toolRound(1),
						toolRound(2),
						finalRound('done'),
					]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)

			// THEN it ran three rounds and stopped because the model finished
			expect(result.rounds).toBe(3)
			expect(result.stopReason).toBe('finished_looking')
			// AND the transcript carries both tool results and the final text
			expect(result.researchText).toContain('page 1')
			expect(result.researchText).toContain('page 2')
			expect(result.researchText).toContain('done')
			// AND every scraped source is attributed, de-duplicated
			expect(result.scrapedUrlHashes).toEqual(['hash-1', 'hash-2'])
		})
	})

	describe('when the model never stops calling tools', () => {
		it('should halt at the step cap with a non-empty transcript', async () => {
			// GIVEN a model that always asks for another tool
			// WHEN the loop runs with a cap of two
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 2,
					runRound: scriptedRounds([toolRound(1), toolRound(2), toolRound(3)]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)

			// THEN it stopped at the cap after exactly two rounds
			expect(result.rounds).toBe(2)
			expect(result.stopReason).toBe('round_cap_reached')
			// AND the transcript is non-empty even though no round produced final text
			expect(result.researchText).toContain('page 1')
		})
	})

	describe('when the run budget is exhausted mid-loop', () => {
		it('should halt on budget independently of the step cap', async () => {
			// GIVEN a very high step cap but a budget already empty after round one
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 100,
					runRound: scriptedRounds([toolRound(1), toolRound(2), toolRound(3)]),
					budgetSnapshot: Effect.succeed(snapshot(0, 0)),
				}),
			)

			// THEN the budget stopped it after the first round, far from the cap
			expect(result.stopReason).toBe('budget_exhausted')
			expect(result.rounds).toBe(1)
		})
	})

	describe('when the accumulated prompt would overflow the context window', () => {
		it('should halt on the prompt-size budget before the step or budget caps', async () => {
			// GIVEN a huge step cap and budget, but each round adds 100 prompt chars
			// and the budget is only 150
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 100,
					maxPromptChars: 150,
					runRound: scriptedRounds([toolRound(1), toolRound(2), toolRound(3)]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)

			// THEN it stopped on context after the second round (2 × 100 ≥ 150)
			expect(result.stopReason).toBe('context_full')
			expect(result.rounds).toBe(2)
		})
	})

	describe('when the model finishes but the target is not yet grounded', () => {
		it('should run another round when the continue hook asks to keep going', async () => {
			// GIVEN the model finishes each round, and the grounding hook asks to
			// continue once (the corrective nudge) then accepts the second result
			let asked = 0
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					runRound: scriptedRounds([
						finalRound('thin'),
						finalRound('grounded'),
					]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
					shouldContinueAfterFinal: () =>
						Effect.sync(() => {
							asked++
							return asked === 1
						}),
				}),
			)

			// THEN the first final answer triggered exactly one extra round
			expect(result.rounds).toBe(2)
			expect(result.stopReason).toBe('finished_looking')
			expect(result.researchText).toContain('grounded')
		})

		it('should end on the first final answer when no continue hook is given', async () => {
			// GIVEN a model that finishes on round one and no grounding-retry hook
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					runRound: scriptedRounds([finalRound('done')]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)

			// THEN it stops after the single final round
			expect(result.rounds).toBe(1)
			expect(result.stopReason).toBe('finished_looking')
		})

		it('should still stop at the step cap when the hook always asks to continue', async () => {
			// GIVEN a grounding hook that never accepts the result
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 3,
					runRound: scriptedRounds([finalRound('thin')]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
					shouldContinueAfterFinal: () => Effect.succeed(true),
				}),
			)

			// THEN the step cap bounds the retries rather than looping forever
			expect(result.rounds).toBe(3)
			// AND the looking is reported as finished, not as stopped at a ceiling:
			// the model ended every one of those rounds with nothing it wanted to
			// do, and what the cap cut short was the hook's errand of grounding the
			// company, which is a different question from whether the search had
			// more companies to find
			expect(result.stopReason).toBe('finished_looking')
		})
	})
})

describe('canAffordAnotherRound', () => {
	describe('when only cheap budget remains', () => {
		it('should allow another round while any cheap tool is fundable', () => {
			// GIVEN paid budget gone but a cent of cheap budget left
			// THEN a cheap tool can still be called
			expect(canAffordAnotherRound(snapshot(1, 0))).toBe(true)
		})
	})

	describe('when only enough paid budget for a registry lookup remains', () => {
		it('should allow another round', () => {
			// GIVEN cheap budget gone but exactly the registry lookup cost left
			expect(canAffordAnotherRound(snapshot(0, 29))).toBe(true)
		})
	})

	describe('when neither a cheap tool nor a registry lookup is fundable', () => {
		it('should stop the loop', () => {
			// GIVEN no cheap budget and less than a registry lookup costs
			expect(canAffordAnotherRound(snapshot(0, 28))).toBe(false)
		})
	})
})

describe('runAgentResearchLoop — token budget', () => {
	// A round with an explicit prompt-token occupancy; a tool round so the loop
	// keeps going and reaches the cap check.
	const tokenRound = (inputTokens: number): LoopRound => ({
		...toolRound(1),
		inputTokens,
	})

	describe("when the latest round's prompt occupancy exceeds the budget", () => {
		it('should halt on context using the latest round, not the running sum', async () => {
			// GIVEN rounds whose occupancy grows 1000 -> 2000 -> 3000 and a 2500 budget
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					maxPromptTokens: 2500,
					runRound: scriptedRounds([
						tokenRound(1000),
						tokenRound(2000),
						tokenRound(3000),
					]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)
			// THEN it stops at round 3 (3000 >= 2500), not round 2 — an accumulated
			// sum would have tripped at round 2 (1000 + 2000)
			expect(result.stopReason).toBe('context_full')
			expect(result.rounds).toBe(3)
		})
	})

	describe('when the provider omits token usage', () => {
		it('should ignore the token budget so the run falls through to the step cap', async () => {
			// GIVEN rounds reporting 0 input tokens (usage absent) and no char cap
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 2,
					maxPromptTokens: 100,
					runRound: scriptedRounds([tokenRound(0)]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)
			// THEN the token cap never fires (0 < 100) and the step cap ends it
			expect(result.stopReason).toBe('round_cap_reached')
			expect(result.rounds).toBe(2)
		})
	})

	describe('when usage is absent but a char budget is set', () => {
		it('should still halt on the char backstop', async () => {
			// GIVEN 0-token rounds that each add 100 prompt chars, a 100-token budget
			// and a 150-char backstop
			const charRound: LoopRound = {
				...toolRound(1),
				inputTokens: 0,
				promptChars: 100,
			}
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					maxPromptTokens: 100,
					maxPromptChars: 150,
					runRound: scriptedRounds([charRound]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)
			// THEN the token cap stays inert and the char cap trips at round 2 (200 >= 150)
			expect(result.stopReason).toBe('context_full')
			expect(result.rounds).toBe(2)
		})
	})

	describe("when the budget is below even the first round's prompt", () => {
		it('should stop immediately on context', async () => {
			// GIVEN a single round already occupying 5000 tokens and a 1000 budget
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					maxPromptTokens: 1000,
					runRound: scriptedRounds([tokenRound(5000)]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)
			// THEN it stops on the very first round
			expect(result.stopReason).toBe('context_full')
			expect(result.rounds).toBe(1)
		})
	})

	describe('when the run stays well under the token budget', () => {
		it("should finish on the model's final answer", async () => {
			// GIVEN a small round then a final answer, under a generous budget
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					maxPromptTokens: 24000,
					runRound: scriptedRounds([tokenRound(100), finalRound('done')]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)
			// THEN the token cap is a no-op and the model finishing ends it
			expect(result.stopReason).toBe('finished_looking')
		})
	})
})
