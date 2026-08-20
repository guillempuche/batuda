import { describe, expect, it } from 'vitest'

import {
	buildEvalReport,
	evalSpanAttributes,
	evalSummaryAttributes,
	scorePayloadsForRun,
} from './eval-report'
import type { EvalSummary, RunScore } from './eval-scoring'

const score = (over: Partial<RunScore>): RunScore => ({
	id: 'r',
	fields: [],
	grounded: true,
	groundable: true,
	wrongCompany: false,
	wrongCompanyAutoApplicable: false,
	lowConfidence: false,
	empty: false,
	fieldsExpected: 0,
	fieldsScored: 0,
	fieldsCorrect: 0,
	contactsExpected: 0,
	contactsFound: 0,
	...over,
})

const byName = <T extends { name: string }>(payloads: ReadonlyArray<T>) =>
	new Map(payloads.map(p => [p.name, p] as const))

describe('scorePayloadsForRun', () => {
	describe('when a run reached the target and filled every field correctly', () => {
		it('should mark every metric passed with value 1', () => {
			// GIVEN a clean, fully-correct run
			const payloads = byName(
				scorePayloadsForRun(
					score({ fieldsExpected: 2, fieldsScored: 2, fieldsCorrect: 2 }),
				),
			)

			// WHEN mapped — THEN each metric is 1 / passed
			expect(payloads.get('grounding')).toMatchObject({
				value: 1,
				passed: true,
			})
			expect(payloads.get('not_wrong_company')?.passed).toBe(true)
			expect(payloads.get('not_empty')?.passed).toBe(true)
			expect(payloads.get('field_precision')).toMatchObject({
				value: 1,
				passed: true,
			})
			expect(payloads.get('field_recall')).toMatchObject({
				value: 1,
				passed: true,
			})
		})
	})

	describe('when a run returned another company as a success', () => {
		it('should score not_wrong_company as 0 / failed', () => {
			// GIVEN a look-alike run
			const payloads = byName(
				scorePayloadsForRun(score({ grounded: false, wrongCompany: true })),
			)

			// WHEN mapped — THEN the good-direction score is 0
			expect(payloads.get('not_wrong_company')).toMatchObject({
				value: 0,
				passed: false,
			})
			expect(payloads.get('grounding')?.value).toBe(0)
		})
	})

	describe('when a run filled only some fields correctly', () => {
		it('should report precision below 1 and mark it not passed', () => {
			// GIVEN 1 correct of 2 filled, 1 of 3 known
			const payloads = byName(
				scorePayloadsForRun(
					score({ fieldsExpected: 3, fieldsScored: 2, fieldsCorrect: 1 }),
				),
			)

			// WHEN mapped — THEN precision is 0.5 (failed), recall is 1/3 (failed)
			expect(payloads.get('field_precision')).toMatchObject({
				value: 0.5,
				passed: false,
			})
			expect(payloads.get('field_recall')?.passed).toBe(false)
		})
	})

	describe('when a run filled no fields', () => {
		it('should omit the precision score entirely', () => {
			// GIVEN nothing filled, but fields were known
			const payloads = byName(
				scorePayloadsForRun(score({ fieldsExpected: 2, fieldsScored: 0 })),
			)

			// WHEN mapped — THEN there is no precision to report, but recall (0) is
			expect(payloads.has('field_precision')).toBe(false)
			expect(payloads.get('field_recall')).toMatchObject({ value: 0 })
		})
	})

	describe('when the golden set specified no fields for the company', () => {
		it('should omit the recall score', () => {
			// GIVEN a company with no known fields to recover
			const payloads = byName(scorePayloadsForRun(score({ fieldsExpected: 0 })))

			// WHEN mapped — THEN recall is not reported
			expect(payloads.has('field_recall')).toBe(false)
		})
	})
})

describe('evalSpanAttributes', () => {
	describe('when a run filled and scored some fields', () => {
		it('should carry the booleans and both rates', () => {
			// GIVEN a grounded run, 1 correct of 2 filled, 1 of 4 known
			const attrs = evalSpanAttributes(
				score({
					id: 'acme',
					grounded: true,
					fieldsExpected: 4,
					fieldsScored: 2,
					fieldsCorrect: 1,
				}),
			)

			// WHEN flattened — THEN the id, booleans, and both rates ride along
			expect(attrs['eval.company_id']).toBe('acme')
			expect(attrs['eval.grounded']).toBe(true)
			expect(attrs['eval.field_precision']).toBe(0.5)
			expect(attrs['eval.field_recall']).toBe(0.25)
		})
	})

	describe('when a run filled no fields', () => {
		it('should omit precision but keep recall', () => {
			// GIVEN a run that filled nothing but had known fields
			const attrs = evalSpanAttributes(
				score({ fieldsExpected: 3, fieldsScored: 0, fieldsCorrect: 0 }),
			)

			// WHEN flattened — THEN there is no precision to chart, but recall (0) rides
			expect('eval.field_precision' in attrs).toBe(false)
			expect(attrs['eval.field_recall']).toBe(0)
		})
	})
})

describe('evalSummaryAttributes', () => {
	describe('when precision and recall are present', () => {
		it('should carry every rate', () => {
			// GIVEN a full summary
			const attrs = evalSummaryAttributes({
				runs: 4,
				groundingAccuracy: 0.5,
				wrongCompanyRate: 0.25,
				emptyRate: 0.25,
				fieldPrecision: 0.75,
				fieldRecall: 0.5,
				contactRecall: 0.6,
				costPerRun: 84,
				costPerGroundedRun: 168,
				paidCostPerRun: 29,
				tokensPerRun: 42_000,
				creditsPerRun: 12,
				fieldsFilledPerRun: null,
				profileFieldsTotal: null,
				contactsNamedPerRun: null,
				contactsTitledPerRun: null,
				lowConfidenceRate: 0,
				wrongCompanyAutoApplicableRate: 0,
				organisationKindPrecision: null,
				rowsJudgedShare: null,
				rowsGoldenListedShare: null,
				requestCoverage: null,
				neverSearchedShare: null,
				scansReportingCoverage: null,
				partsThoughtAnswered: null,
				duplicateRate: null,
				possibleDuplicateRate: null,
				locationFill: null,
				confirmationRate: null,
				rowsPerScan: null,
				callsByModel: {},
				cascadedRunRate: 0,
			})

			// WHEN flattened — THEN each top-line rate is present
			expect(attrs['eval.runs']).toBe(4)
			expect(attrs['eval.grounding_accuracy']).toBe(0.5)
			expect(attrs['eval.field_precision']).toBe(0.75)
			expect(attrs['eval.field_recall']).toBe(0.5)
			expect(attrs['eval.contact_recall']).toBe(0.6)
			expect(attrs['eval.cost_cents_per_run']).toBe(84)
			expect(attrs['eval.credits_per_run']).toBe(12)
		})
	})

	describe('when nothing was filled to judge', () => {
		it('should omit the null precision', () => {
			// GIVEN a summary whose precision and contact recall are null (nothing to judge)
			const attrs = evalSummaryAttributes({
				runs: 1,
				groundingAccuracy: 1,
				wrongCompanyRate: 0,
				emptyRate: 1,
				fieldPrecision: null,
				fieldRecall: 0,
				contactRecall: null,
				costPerRun: null,
				costPerGroundedRun: null,
				paidCostPerRun: null,
				tokensPerRun: null,
				creditsPerRun: null,
				fieldsFilledPerRun: null,
				profileFieldsTotal: null,
				contactsNamedPerRun: null,
				contactsTitledPerRun: null,
				lowConfidenceRate: 0,
				wrongCompanyAutoApplicableRate: 0,
				organisationKindPrecision: null,
				rowsJudgedShare: null,
				rowsGoldenListedShare: null,
				requestCoverage: null,
				neverSearchedShare: null,
				scansReportingCoverage: null,
				partsThoughtAnswered: null,
				duplicateRate: null,
				possibleDuplicateRate: null,
				locationFill: null,
				confirmationRate: null,
				rowsPerScan: null,
				callsByModel: {},
				cascadedRunRate: null,
			})

			// WHEN flattened — THEN each null rate is left off, not charted as zero
			expect('eval.field_precision' in attrs).toBe(false)
			expect('eval.contact_recall' in attrs).toBe(false)
			expect('eval.cost_cents_per_run' in attrs).toBe(false)
			expect(attrs['eval.field_recall']).toBe(0)
		})
	})
})

describe('buildEvalReport', () => {
	describe('when given a set of run scores', () => {
		it('should pair the aggregate summary with the raw per-run scores', () => {
			// GIVEN two runs, one grounded and one not
			const runs = [
				score({ grounded: true }),
				score({ grounded: false, empty: true }),
			]

			// WHEN a report is built
			const report = buildEvalReport(runs)

			// THEN it carries both the rolled-up summary and every run for drill-down
			expect(report.summary.runs).toBe(2)
			expect(report.summary.groundingAccuracy).toBe(0.5)
			expect(report.runs).toHaveLength(2)
		})
	})

	describe('when the scores carry buckets and countries', () => {
		it('should break the summary out by bucket and by country', () => {
			// GIVEN a grounded big/GB run and an empty niche/FR run
			const runs = [
				score({ bucket: 'big', country: 'GB', grounded: true }),
				score({ bucket: 'niche', country: 'FR', grounded: false, empty: true }),
			]
			// WHEN a report is built
			const report = buildEvalReport(runs)
			// THEN each segment is summarized on its own
			expect(Object.keys(report.byBucket).sort()).toEqual(['big', 'niche'])
			expect(Object.keys(report.byCountry).sort()).toEqual(['FR', 'GB'])
			expect(report.byBucket['big']?.groundingAccuracy).toBe(1)
			expect(report.byBucket['niche']?.emptyRate).toBe(1)
		})

		it('should bucket untagged and country-less scores under fallback keys', () => {
			// GIVEN a score with neither a bucket nor a country
			const report = buildEvalReport([score({})])
			// WHEN a report is built
			// THEN it falls into the explicit fallback groups, never dropped
			expect(Object.keys(report.byBucket)).toEqual(['untagged'])
			expect(Object.keys(report.byCountry)).toEqual(['unknown'])
		})
	})
})

describe('reporting a pass that held market requests', () => {
	const marketScore = (over: Partial<RunScore['market']> = {}): RunScore =>
		score({
			groundable: false,
			grounded: false,
			market: {
				name: 'ES',
				rowsGoldenListed: 0,
				rowsJudged: 0,
				rowsUnjudged: 0,
				rowsReturned: 62,
				rowsRightKind: 39,
				rowsConfirmed: 0,
				rowsLocated: 25,
				rowsDuplicated: 10,
				rowsPossiblyDuplicated: 10,
				partsExpected: 5,
				partsAnswered: 1,
				reportedCoverage: null,
				...over,
			},
		})

	describe('when a market run carried a reckoning of its own', () => {
		it('should chart its counts per run, so a moved rate names the run', () => {
			// GIVEN a market run that reported four missing trades, two of them never
			// looked for and one of those only because it thought it had it
			const attrs = evalSpanAttributes(
				marketScore({
					reportedCoverage: {
						missing: 4,
						neverSearched: 2,
						thoughtAnswered: 1,
					},
				}),
			)
			// THEN each rides on the run's own span — a pass-level rate says a change
			// happened, and only these say which run it happened in
			expect(attrs['eval.reported_missing']).toBe(4)
			expect(attrs['eval.reported_never_searched']).toBe(2)
			expect(attrs['eval.reported_thought_answered']).toBe(1)
		})

		it('should chart nothing for a run that stored no reckoning', () => {
			// GIVEN a run that ended before a reckoning was written
			const attrs = evalSpanAttributes(marketScore())
			// THEN the keys are absent rather than nought, which would chart a run
			// that said nothing as a run that found nothing wrong
			expect(attrs).not.toHaveProperty('eval.reported_missing')
			expect(attrs).not.toHaveProperty('eval.reported_thought_answered')
		})
	})

	describe('when a market run is turned into per-run scores', () => {
		it('should score the list and leave out the questions it was never asked', () => {
			// GIVEN a market request, which names no company to have reached
			const payloads = byName(scorePayloadsForRun(marketScore()))

			// WHEN mapped
			// THEN the list is graded on what was wrong with it, and grounding is
			// absent rather than scored nought — a market run cannot fail to reach a
			// company nobody named
			expect(payloads.get('organisation_kind_precision')).toMatchObject({
				value: 39 / 62,
				passed: false,
			})
			expect(payloads.get('request_coverage')).toMatchObject({
				value: 0.2,
				passed: false,
			})
			expect(payloads.get('not_duplicated')).toMatchObject({
				value: 1 - 10 / 62,
				passed: false,
			})
			expect(payloads.get('location_fill')).toMatchObject({ value: 25 / 62 })
			expect(payloads.has('grounding')).toBe(false)
			expect(payloads.has('not_wrong_company')).toBe(false)
		})

		it('should still score a clean list as passed', () => {
			// GIVEN a market whose every row is a company, located, and unique
			const payloads = byName(
				scorePayloadsForRun(
					marketScore({
						rowsReturned: 10,
						rowsRightKind: 10,
						rowsLocated: 10,
						rowsDuplicated: 0,
						partsAnswered: 5,
						reportedCoverage: null,
					}),
				),
			)

			// WHEN mapped — THEN every market metric is 1 and passed, the same
			// direction as every other metric here
			for (const name of [
				'organisation_kind_precision',
				'request_coverage',
				'not_duplicated',
				'location_fill',
			]) {
				expect(payloads.get(name)).toMatchObject({ value: 1, passed: true })
			}
		})
	})

	describe('when a market came back with no rows', () => {
		it('should still report the coverage and leave out the per-row scores', () => {
			// GIVEN a market request that returned nothing
			const payloads = byName(
				scorePayloadsForRun(
					marketScore({
						rowsReturned: 0,
						rowsRightKind: 0,
						rowsLocated: 0,
						rowsDuplicated: 0,
						partsAnswered: 0,
						reportedCoverage: null,
					}),
				),
			)

			// WHEN mapped
			// THEN "none of the five parts was answered" is a reading worth sending;
			// the other three have nothing to divide by, so they are absent rather
			// than a zero that reads as a quality collapse
			expect(payloads.get('request_coverage')).toMatchObject({ value: 0 })
			expect(payloads.has('organisation_kind_precision')).toBe(false)
			expect(payloads.has('not_duplicated')).toBe(false)
			expect(payloads.has('location_fill')).toBe(false)
		})
	})

	describe('when a market run becomes span attributes', () => {
		it('should carry the market and its counts for grouping', () => {
			// GIVEN a market run's score
			const attrs = evalSpanAttributes(marketScore())

			// WHEN flattened — THEN a chart can group by market and read both the
			// counts and the rates off one span
			expect(attrs['eval.market']).toBe('ES')
			expect(attrs['eval.rows_returned']).toBe(62)
			expect(attrs['eval.rows_right_kind']).toBe(39)
			expect(attrs['eval.rows_duplicated']).toBe(10)
			expect(attrs['eval.rows_located']).toBe(25)
			expect(attrs['eval.parts_answered']).toBe(1)
			expect(attrs['eval.request_coverage']).toBe(0.2)
		})

		it('should carry no market attributes for a company run', () => {
			// GIVEN an ordinary company run
			const attrs = evalSpanAttributes(score({}))

			// WHEN flattened — THEN nothing about a market rides along
			expect('eval.market' in attrs).toBe(false)
			expect('eval.rows_returned' in attrs).toBe(false)
		})
	})

	describe('when the whole-pass summary becomes span attributes', () => {
		const summary = (over: Partial<EvalSummary>): EvalSummary => ({
			runs: 2,
			groundingAccuracy: null,
			wrongCompanyRate: 0,
			wrongCompanyAutoApplicableRate: 0,
			lowConfidenceRate: 0,
			emptyRate: 0,
			fieldPrecision: null,
			fieldRecall: null,
			contactRecall: null,
			organisationKindPrecision: null,
			rowsJudgedShare: null,
			rowsGoldenListedShare: null,
			requestCoverage: null,
			neverSearchedShare: null,
			scansReportingCoverage: null,
			partsThoughtAnswered: null,
			duplicateRate: null,
			possibleDuplicateRate: null,
			locationFill: null,
			confirmationRate: null,
			rowsPerScan: null,
			fieldsFilledPerRun: null,
			profileFieldsTotal: null,
			contactsNamedPerRun: null,
			contactsTitledPerRun: null,
			costPerRun: null,
			costPerGroundedRun: null,
			paidCostPerRun: null,
			tokensPerRun: null,
			creditsPerRun: null,
			callsByModel: {},
			cascadedRunRate: null,
			...over,
		})

		it('should omit grounding accuracy when no run was asked to reach a company', () => {
			// GIVEN a pass made only of market requests
			const attrs = evalSummaryAttributes(summary({ groundingAccuracy: null }))

			// WHEN flattened — THEN grounding is left off rather than charted as a nought
			expect('eval.grounding_accuracy' in attrs).toBe(false)
		})

		it('should carry each market rate that has a reading', () => {
			// GIVEN a market pass with figures
			const attrs = evalSummaryAttributes(
				summary({
					organisationKindPrecision: 0.63,
					rowsJudgedShare: 0,
					rowsGoldenListedShare: 0,
					requestCoverage: 0.2,
					neverSearchedShare: null,
					scansReportingCoverage: null,
					partsThoughtAnswered: null,
					duplicateRate: 0.16,
					locationFill: 0.4,
					confirmationRate: 0.3,
					rowsPerScan: 62,
				}),
			)

			// WHEN flattened — THEN the drift chart has every market figure
			expect(attrs['eval.organisation_kind_precision']).toBe(0.63)
			expect(attrs['eval.request_coverage']).toBe(0.2)
			expect(attrs['eval.duplicate_rate']).toBe(0.16)
			expect(attrs['eval.location_fill']).toBe(0.4)
			expect(attrs['eval.rows_per_scan']).toBe(62)
		})

		it('should omit every market rate on a pass that held no market', () => {
			// GIVEN an ordinary pass of company profiles
			const attrs = evalSummaryAttributes(summary({ groundingAccuracy: 1 }))

			// WHEN flattened — THEN no market figure is charted as a zero
			expect('eval.organisation_kind_precision' in attrs).toBe(false)
			expect('eval.request_coverage' in attrs).toBe(false)
			expect('eval.duplicate_rate' in attrs).toBe(false)
			expect('eval.location_fill' in attrs).toBe(false)
			expect('eval.rows_per_scan' in attrs).toBe(false)
		})
	})

	describe('when the report is built', () => {
		it('should break the figures out per market', () => {
			// GIVEN two markets in one pass, one of which the shipped kind check reads
			// and one of which it does not
			const report = buildEvalReport([
				marketScore({ name: 'ES', rowsReturned: 10, rowsRightKind: 10 }),
				marketScore({ name: 'FR', rowsReturned: 10, rowsRightKind: 4 }),
			])

			// WHEN built
			// THEN each market keeps its own reading. Averaged together they read 70%
			// and the gap that matters — a check that reads three languages — disappears
			expect(report.byMarket['ES']?.organisationKindPrecision).toBe(1)
			expect(report.byMarket['FR']?.organisationKindPrecision).toBe(0.4)
		})

		it('should hold no markets for a pass of company profiles', () => {
			// GIVEN an ordinary pass
			const report = buildEvalReport([score({}), score({})])

			// WHEN built — THEN there is no market breakdown at all, rather than one
			// bucket of company rows pretending to be a market
			expect(report.byMarket).toEqual({})
		})
	})
})
