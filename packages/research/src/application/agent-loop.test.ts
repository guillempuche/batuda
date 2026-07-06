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
	outputTokens: 5,
})
const finalRound = (text: string): LoopRound => ({
	text,
	hasToolCalls: false,
	scrapeUrlHashes: [],
	renderedResults: [],
	promptChars: 50,
	inputTokens: 8,
	outputTokens: 20,
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
			expect(result.stopReason).toBe('model-final')
			// AND the transcript carries both tool results and the final text
			expect(result.researchText).toContain('page 1')
			expect(result.researchText).toContain('page 2')
			expect(result.researchText).toContain('done')
			// AND every scraped source is attributed, de-duplicated
			expect(result.scrapedUrlHashes).toEqual(['hash-1', 'hash-2'])
			expect(result.tokensIn).toBe(28)
			expect(result.tokensOut).toBe(30)
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
			expect(result.stopReason).toBe('step-cap')
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
			expect(result.stopReason).toBe('budget')
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
			expect(result.stopReason).toBe('context')
			expect(result.rounds).toBe(2)
		})
	})

	describe('when a prior run is resumed', () => {
		it('should add this loop onto the carried token totals', async () => {
			// GIVEN token counts carried across a resume
			// WHEN a single final round runs
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					runRound: scriptedRounds([finalRound('ok')]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
					priorTokensIn: 100,
					priorTokensOut: 200,
				}),
			)

			// THEN the loop's own usage adds onto the prior totals
			expect(result.tokensIn).toBe(108)
			expect(result.tokensOut).toBe(220)
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
