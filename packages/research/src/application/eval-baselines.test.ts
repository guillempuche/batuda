import { describe, expect, it } from 'vitest'

import {
	baselineReportName,
	goldenStem,
	newestReportName,
	stripReportForBaseline,
} from './eval-baselines'
import type { EvalReport } from './eval-report'
import type { EvalSummary, RunScore } from './eval-scoring-types'

const summary = {
	runs: 1,
	groundingAccuracy: 1,
	fieldPrecision: 1,
	fieldRecall: 1,
	contactRecall: null,
	costPerRun: 3.2,
} as unknown as EvalSummary

const runScore = (overrides: Partial<RunScore> = {}): RunScore =>
	({
		id: 'egein',
		fields: [],
		grounded: true,
		groundable: true,
		wrongCompany: false,
		wrongCompanyAutoApplicable: false,
		lowConfidence: false,
		empty: false,
		fieldsExpected: 1,
		fieldsScored: 1,
		fieldsCorrect: 1,
		contactsExpected: 0,
		contactsFound: 0,
		marketWentUnanswered: false,
		...overrides,
	}) as RunScore

const report = (runs: ReadonlyArray<RunScore>): EvalReport => ({
	summary,
	runs,
	byBucket: { small: summary },
	byCountry: { ES: summary },
	byMarket: {},
})

describe('goldenStem', () => {
	describe('when given a path to a golden set', () => {
		it.each([
			['eval/golden.json', 'golden'],
			['eval/golden-markets.json', 'golden-markets'],
			['/tmp/one-row.json', 'one-row'],
			// No extension to take off, and nothing to take a folder from.
			['golden', 'golden'],
		])('should read %s as %s', (path, expected) => {
			// GIVEN a path a caller passed to --golden
			// WHEN the stem is read
			// THEN it is the file name without its extension
			expect(goldenStem(path)).toBe(expected)
		})
	})
})

describe('baselineReportName', () => {
	describe('when the commit is known', () => {
		it('should name the day, the time and the commit', () => {
			// GIVEN a timestamp and the short sha of HEAD
			// WHEN the file name is built
			const name = baselineReportName('2026-09-13T11:30:00.000Z', 'a1b2c3d')

			// THEN it carries all three
			expect(name).toBe('2026-09-13-1130-a1b2c3d.json')
		})

		it('should not land on an earlier pass of the same commit', () => {
			// GIVEN two passes taken the same day on the same commit
			const morning = baselineReportName('2026-09-13T11:30:00.000Z', 'a1b2c3d')
			const evening = baselineReportName('2026-09-13T19:05:00.000Z', 'a1b2c3d')

			// WHEN both are filed
			// THEN the second does not overwrite the first
			expect(morning).not.toBe(evening)
		})
	})

	describe('when the commit cannot be read', () => {
		it('should still file the pass', () => {
			// GIVEN a checkout that answered with no sha
			// WHEN the file name is built
			// THEN the day is kept and the commit reads nogit
			expect(baselineReportName('2026-09-13T11:30:00.000Z', null)).toBe(
				'2026-09-13-1130-nogit.json',
			)
		})
	})
})

describe('newestReportName', () => {
	describe('when the folder holds nothing', () => {
		it('should answer that there is no report', () => {
			// GIVEN an empty baselines folder
			// WHEN the newest report is asked for
			// THEN there is none
			expect(newestReportName([])).toBeNull()
		})
	})

	describe('when the folder holds one report', () => {
		it('should answer with it', () => {
			// GIVEN a single filed pass
			// WHEN the newest report is asked for
			// THEN it is that one
			expect(newestReportName(['2026-09-01-0930-a1b2c3d.json'])).toBe(
				'2026-09-01-0930-a1b2c3d.json',
			)
		})
	})

	describe('when the names arrive in no order', () => {
		it('should answer with the latest day', () => {
			// GIVEN reports listed in whatever order the filesystem gave them
			const names = [
				'2026-08-30-1200-ffffff1.json',
				'2026-09-12-0900-0000001.json',
				'2026-09-12-1615-0000001.json',
				'2026-09-02-2330-aaaaaa1.json',
			]

			// WHEN the newest report is asked for
			// THEN the day and time at the front of the name decide, not the listing
			// order — two passes on one commit included
			expect(newestReportName(names)).toBe('2026-09-12-1615-0000001.json')
		})
	})

	describe('when the folder holds something that is not a report', () => {
		it('should pass it over', () => {
			// GIVEN a README filed beside the reports
			const names = ['README.md', '2026-09-02-2330-aaaaaa1.json']

			// WHEN the newest report is asked for
			// THEN the report is chosen, however the names would sort
			expect(newestReportName(names)).toBe('2026-09-02-2330-aaaaaa1.json')
		})

		it('should answer that there is no report when that is all there is', () => {
			// GIVEN a folder holding only its own README
			// WHEN the newest report is asked for
			// THEN there is none to price a pass from
			expect(newestReportName(['README.md'])).toBeNull()
		})
	})
})

describe('stripReportForBaseline', () => {
	describe('when a run found something', () => {
		it('should keep no part of what it found', () => {
			// GIVEN a run whose field outcome carries the value it read off a page
			const stripped = stripReportForBaseline(
				report([
					runScore({
						fields: [
							{
								field: 'email',
								expected: 'hola@egein.es',
								got: 'a-value-only-a-page-could-have-given',
								scored: true,
								correct: false,
							},
						],
					}),
				]),
			)

			// WHEN the filed copy is written out
			const written = JSON.stringify(stripped)

			// THEN nothing the run read appears anywhere in it
			expect(written).not.toContain('a-value-only-a-page-could-have-given')
			expect(stripped.runs[0]).not.toHaveProperty('fields')
		})
	})

	describe('when a run reported guard counts', () => {
		it('should keep the counts and the verdicts', () => {
			// GIVEN a run with its facts and its usage
			const stripped = stripReportForBaseline(
				report([
					runScore({
						facts: { 'research.fields.ungrounded.dropped_unsupported': 2 },
						usage: {
							costCents: 3,
							paidCostCents: 0,
							tokensIn: 10,
							tokensOut: 5,
							creditsUsed: 1,
						},
					}),
				]),
			)

			// WHEN the filed copy is read back
			const run = stripped.runs[0]

			// THEN how the run did is all still there
			expect(run?.facts).toStrictEqual({
				'research.fields.ungrounded.dropped_unsupported': 2,
			})
			expect(run?.usage?.costCents).toBe(3)
			expect(run?.grounded).toBe(true)
			expect(run?.fieldsCorrect).toBe(1)
		})
	})

	describe('when a run states no fields at all', () => {
		it('should file it unchanged but for the empty list', () => {
			// GIVEN a run that scored no fields
			const stripped = stripReportForBaseline(
				report([runScore({ fields: [] })]),
			)

			// WHEN the filed copy is read back
			// THEN the run is there and carries no field list
			expect(stripped.runs).toHaveLength(1)
			expect(stripped.runs[0]).not.toHaveProperty('fields')
		})
	})

	describe('when the pass has no runs', () => {
		it('should keep the rates and the tables', () => {
			// GIVEN a report with an empty run list
			const stripped = stripReportForBaseline(report([]))

			// WHEN the filed copy is read back
			// THEN the summary and the breakdowns survive
			expect(stripped.runs).toStrictEqual([])
			expect(stripped.summary).toBe(summary)
			expect(stripped.byBucket).toStrictEqual({ small: summary })
			expect(stripped.byCountry).toStrictEqual({ ES: summary })
		})
	})
})
