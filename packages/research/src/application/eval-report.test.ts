import { describe, expect, it } from 'vitest'

import {
	buildEvalReport,
	evalSpanAttributes,
	evalSummaryAttributes,
	scorePayloadsForRun,
} from './eval-report'
import type { RunScore } from './eval-scoring'

const score = (over: Partial<RunScore>): RunScore => ({
	id: 'r',
	grounded: true,
	wrongCompany: false,
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
