import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { RejectedToolCall } from '../domain/errors'
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

	describe('when both budgets are set and the chars run out first', () => {
		it('should halt on chars even though the provider reported usage', async () => {
			// GIVEN rounds reporting real usage, well inside a 1000-token budget that
			// therefore cannot fire, each adding 100 chars against a 150-char one
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 100,
					maxPromptChars: 150,
					maxPromptTokens: 1000,
					runRound: scriptedRounds([toolRound(1), toolRound(2), toolRound(3)]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)

			// THEN the char budget ends it at round 2, so it is not something that
			// stands aside once the provider says what the prompt really occupies
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
		it('should still halt on the char budget', async () => {
			// GIVEN 0-token rounds that each add 100 prompt chars, a 100-token budget
			// and a 150-char one
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

describe('runAgentResearchLoop — a tool call the model wrote wrongly', () => {
	// A stub model whose first round writes a tool call the tool would not take,
	// and which writes a good one once it has been told what was wrong. The
	// failure stands in for what reaches the loop in production: every retry on
	// every vendor slot already spent, re-sending the same conversation and
	// getting the same bad call back each time.
	const badCall = new RejectedToolCall(
		{
			provider: 'groq',
			message:
				"Invalid parameters for tool 'web_search': missing properties: 'limit'",
		},
		'web_search',
		"missing properties: 'limit'",
	)

	const rejectedOnce =
		(correctionsMade: { count: number }) => (round: number) =>
			round === 1 && correctionsMade.count === 0
				? Effect.fail(badCall)
				: Effect.succeed(round <= 2 ? toolRound(round) : finalRound('grounded'))

	// What the run fiber does with the failure: notes that the model has now been
	// told, and asks for another round — bounded, as it is in the run fiber.
	const correctionHook =
		(correctionsMade: { count: number }, limit = 2) =>
		(_error: RejectedToolCall) =>
			Effect.sync(() => {
				if (correctionsMade.count >= limit) return false
				correctionsMade.count++
				return true
			})

	describe('when the model is told what it got wrong', () => {
		it('should carry on searching instead of failing the run', async () => {
			// GIVEN a model that writes a bad web_search call on round one and a good
			// one after the correction
			const correctionsMade = { count: 0 }
			const runRound = rejectedOnce(correctionsMade)

			// WHEN the loop runs with a correction hook
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					runRound,
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
					shouldContinueAfterFailure: correctionHook(correctionsMade),
				}),
			)

			// THEN the run reached the model's own answer rather than dying on the
			// bad call
			expect(result.stopReason).toBe('finished_looking')
			expect(result.researchText).toContain('grounded')

			// AND the model was told exactly once
			expect(correctionsMade.count).toBe(1)
		})

		it('should count the lost round but put none of it in the transcript', async () => {
			// GIVEN the same model and correction hook
			const correctionsMade = { count: 0 }
			const runRound = rejectedOnce(correctionsMade)

			// WHEN the loop runs
			const result = await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					runRound,
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
					shouldContinueAfterFailure: correctionHook(correctionsMade),
				}),
			)

			// THEN the round that was lost still counts against the step cap — one
			// lost round, then the search round, then the answer — so a model that
			// keeps fumbling cannot search forever for free
			expect(result.rounds).toBe(3)

			// AND it left nothing behind: a refused call gathered no evidence, and a
			// transcript carrying the correction would offer the extractor a page
			// that was never read
			expect(result.researchText).not.toContain('web_search')
			expect(result.evidenceText).not.toContain('web_search')
		})
	})

	describe('when the correction budget is spent', () => {
		it('should let the failure end the run', async () => {
			// GIVEN a model that writes the same bad call every round, and a hook
			// that has no corrections left to make
			const correctionsMade = { count: 5 }

			// WHEN the loop runs
			const exit = await Effect.runPromiseExit(
				runAgentResearchLoop({
					maxSteps: 10,
					runRound: () => Effect.fail(badCall),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
					shouldContinueAfterFailure: correctionHook(correctionsMade),
				}),
			)

			// THEN the failure reaches the run fiber unchanged, so the run is marked
			// failed rather than shipping a transcript with nothing in it
			expect(Exit.isFailure(exit)).toBe(true)
			expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(
				badCall,
			)
		})
	})

	describe('when a round succeeds', () => {
		it('should not consult the correction hook at all', async () => {
			// GIVEN a model that never fails, and a hook that records being asked
			let asked = 0

			// WHEN the loop runs with the correction hook wired in
			await Effect.runPromise(
				runAgentResearchLoop({
					maxSteps: 10,
					runRound: scriptedRounds([toolRound(1), finalRound('done')]),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
					shouldContinueAfterFailure: () =>
						Effect.sync(() => {
							asked++
							return true
						}),
				}),
			)

			// THEN it was never asked: the hook appends to the prompt, so one
			// consulted on a good round would put a correction in front of a model
			// that had done nothing wrong, on every round of every run
			expect(asked).toBe(0)
		})
	})

	describe('when no correction hook is given', () => {
		it('should fail the run on the first failing round', async () => {
			// GIVEN a failing round and no hook — every failure that is not the
			// model's own bad arguments still has to end the run
			const boom = new Error('provider down')

			// WHEN the loop runs
			const exit = await Effect.runPromiseExit(
				runAgentResearchLoop({
					maxSteps: 10,
					runRound: () => Effect.fail(boom),
					budgetSnapshot: Effect.succeed(snapshot(100, 100)),
				}),
			)

			// THEN it propagates rather than being swallowed into a half-built result
			expect(Exit.isFailure(exit)).toBe(true)
			expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBe(
				boom,
			)
		})
	})
})
