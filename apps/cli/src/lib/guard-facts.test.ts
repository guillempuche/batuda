import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	factsFromLogLine,
	makeGuardFacts,
	meanFactsPerRun,
} from './guard-facts'

describe('factsFromLogLine', () => {
	describe('when a guard reports under a research message', () => {
		it('should keep every number it carries', () => {
			// GIVEN the line the scalar guard writes, as the logger receives it
			const facts = factsFromLogLine(['research.fields.ungrounded'], {
				event: 'research.fields.ungrounded',
				research_id: 'run_1',
				dropped_placeholder: 1,
				dropped_unsupported: 2,
			})

			// WHEN its facts are read
			// THEN each number is keyed by the line that reported it
			expect(facts).toStrictEqual({
				'research.fields.ungrounded.dropped_placeholder': 1,
				'research.fields.ungrounded.dropped_unsupported': 2,
			})
		})

		it('should keep a count a guard added later, with no change here', () => {
			// GIVEN a line no code on this side knows about
			const facts = factsFromLogLine(['research.fields.dropped_unquoted'], {
				research_id: 'run_1',
				dropped: 3,
			})

			// WHEN its facts are read
			// THEN it flows through like any other
			expect(facts).toStrictEqual({
				'research.fields.dropped_unquoted.dropped': 3,
			})
		})

		it('should take the name from the event when the message is not one', () => {
			// GIVEN a line whose message says nothing but which names its own event
			const facts = factsFromLogLine('some other wording', {
				event: 'research.websites.blanked',
				research_id: 'run_1',
				blanked_social_page: 4,
			})

			// WHEN its facts are read
			// THEN the event names the key
			expect(facts).toStrictEqual({
				'research.websites.blanked.blanked_social_page': 4,
			})
		})

		it('should keep nothing that is not a number', () => {
			// GIVEN a line carrying the field and the value it dropped
			const facts = factsFromLogLine(['research.field.dropped'], {
				research_id: 'run_1',
				field: 'website',
				value: 'example.com',
				guard: 'scalar',
			})

			// WHEN its facts are read
			// THEN nothing a run read off a page is kept
			expect(facts).toStrictEqual({})
		})
	})

	describe("when the line is the run's own summary", () => {
		it('should keep nothing, because usage already carries it', () => {
			// GIVEN the line a run writes about itself when it finishes
			const facts = factsFromLogLine(['research.run'], {
				event: 'research.run',
				research_id: 'run_1',
				outcome: 'succeeded',
				cost_cents: 4,
				tokens_in: 125324,
			})

			// WHEN its facts are read
			// THEN none are kept: those figures are the run's cost, not a guard drop
			expect(facts).toStrictEqual({})
		})

		it('should still keep a line that starts with the same words', () => {
			// GIVEN a line under the run's own heading but about something else
			const facts = factsFromLogLine(['research.run.heartbeat_failed'], {
				research_id: 'run_1',
				missed: 2,
			})

			// WHEN its facts are read
			// THEN only the summary line itself is passed over
			expect(facts).toStrictEqual({
				'research.run.heartbeat_failed.missed': 2,
			})
		})
	})

	describe('when the line is not a guard reporting', () => {
		it.each<[string, unknown, Record<string, unknown>]>([
			['an unrelated message', ['sql.query'], { research_id: 'run_1', n: 1 }],
			['no message at all', undefined, { research_id: 'run_1', n: 1 }],
			['a message that is not text', [42], { research_id: 'run_1', n: 1 }],
		])('should keep nothing for %s', (_case, message, annotations) => {
			// GIVEN a line from somewhere else in the pipeline
			// WHEN its facts are read
			// THEN there are none
			expect(factsFromLogLine(message, annotations)).toStrictEqual({})
		})
	})
})

describe('meanFactsPerRun', () => {
	describe('when only some runs reported a count', () => {
		it('should divide by every run of the pass', () => {
			// GIVEN four runs, one of which dropped two fields
			const runs = [
				{ facts: { 'research.fields.ungrounded.dropped_unsupported': 2 } },
				{},
				{},
				{},
			]

			// WHEN the mean per run is taken
			// THEN it reads as the fraction of the pass it is
			expect(meanFactsPerRun(runs)).toStrictEqual([
				{ key: 'research.fields.ungrounded.dropped_unsupported', mean: 0.5 },
			])
		})
	})

	describe('when several keys were reported', () => {
		it('should sort them by name', () => {
			// GIVEN two runs reporting two guards between them
			const runs = [
				{ facts: { 'research.websites.blanked.blanked_social_page': 2 } },
				{ facts: { 'research.citations.kept': 6 } },
			]

			// WHEN the mean per run is taken
			// THEN the keys read in a fixed order, so two passes can be compared
			expect(meanFactsPerRun(runs).map(row => row.key)).toStrictEqual([
				'research.citations.kept',
				'research.websites.blanked.blanked_social_page',
			])
		})
	})

	describe('when the pass has no runs', () => {
		it('should report nothing rather than divide by nought', () => {
			// GIVEN a pass that scored nothing
			// WHEN the mean per run is taken
			// THEN there is nothing to print
			expect(meanFactsPerRun([])).toStrictEqual([])
		})
	})
})

describe('makeGuardFacts', () => {
	describe('when a run writes a guard line', () => {
		it('should keep its counts under the run it named', async () => {
			// GIVEN a capture installed alongside the loggers already in place
			const guardFacts = makeGuardFacts()

			// WHEN a guard reports twice for one run and once for another
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* Effect.logWarning('research.fields.ungrounded').pipe(
						Effect.annotateLogs({
							research_id: 'run_1',
							dropped_unsupported: 2,
						}),
					)
					yield* Effect.logWarning('research.fields.ungrounded').pipe(
						Effect.annotateLogs({
							research_id: 'run_1',
							dropped_unsupported: 1,
						}),
					)
					yield* Effect.logWarning('research.websites.blanked').pipe(
						Effect.annotateLogs({
							research_id: 'run_2',
							blanked_social_page: 4,
						}),
					)
					// A line belonging to no run has nothing to be filed under.
					yield* Effect.logWarning('research.fields.ungrounded').pipe(
						Effect.annotateLogs({ dropped_unsupported: 9 }),
					)
				}).pipe(Effect.provide(guardFacts.layer)),
			)

			// THEN each run carries its own counts, summed over its passes
			expect(guardFacts.forRun('run_1')).toStrictEqual({
				'research.fields.ungrounded.dropped_unsupported': 3,
			})
			expect(guardFacts.forRun('run_2')).toStrictEqual({
				'research.websites.blanked.blanked_social_page': 4,
			})
			expect(guardFacts.forRun('run_3')).toBeUndefined()
		})
	})
})
