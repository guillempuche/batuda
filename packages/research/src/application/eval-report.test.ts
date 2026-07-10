import { describe, expect, it } from 'vitest'

import { buildEvalReport, scorePayloadsForRun } from './eval-report'
import type { RunScore } from './eval-scoring'

const score = (over: Partial<RunScore>): RunScore => ({
	id: 'r',
	grounded: true,
	wrongCompany: false,
	empty: false,
	fieldsExpected: 0,
	fieldsScored: 0,
	fieldsCorrect: 0,
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
})
