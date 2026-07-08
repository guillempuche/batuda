import { describe, expect, it } from 'vitest'

import {
	DEFAULT_TRUST_THRESHOLD,
	isEnteredOutcome,
	normalizeConfidence,
	outcomeTone,
	type ProposalOutcome,
	trustTier,
	verdictRank,
	verdictTone,
} from './proposal-logic'

describe('trustTier', () => {
	describe('when the finding is machine-checkable and deliverable', () => {
		it('should be trustworthy with confidence above the threshold', () => {
			// GIVEN a verified, deliverable email with high confidence
			// THEN it is safe to batch-apply
			expect(
				trustTier({
					verification: 'deliverable',
					confidence: 90,
					machineCheckable: true,
				}),
			).toBe('trustworthy')
		})

		it('should be trustworthy when no confidence score is present', () => {
			// GIVEN a deliverable verdict but a null confidence
			// THEN the verdict alone is enough — still trustworthy
			expect(
				trustTier({
					verification: 'deliverable',
					confidence: null,
					machineCheckable: true,
				}),
			).toBe('trustworthy')
		})

		it('should need review when confidence is below the threshold', () => {
			// GIVEN a deliverable verdict but low confidence
			// THEN a human should look before it applies
			expect(
				trustTier({
					verification: 'deliverable',
					confidence: DEFAULT_TRUST_THRESHOLD - 1,
					machineCheckable: true,
				}),
			).toBe('needs_review')
		})

		it('should honour a custom threshold', () => {
			// GIVEN a confidence of 50 and a caller threshold of 40
			// THEN it clears the lower bar and is trustworthy
			expect(
				trustTier(
					{
						verification: 'deliverable',
						confidence: 50,
						machineCheckable: true,
					},
					40,
				),
			).toBe('trustworthy')
		})
	})

	describe('when the finding is not fully verifiable', () => {
		it('should need review for a non-machine-checkable field', () => {
			// GIVEN a free-text field (not machine-checkable)
			// THEN it always needs human review, whatever the confidence
			expect(
				trustTier({
					verification: 'deliverable',
					confidence: 100,
					machineCheckable: false,
				}),
			).toBe('needs_review')
		})

		it('should need review for a non-deliverable verdict', () => {
			// GIVEN a risky verdict on a machine-checkable channel
			// THEN it needs review
			expect(
				trustTier({
					verification: 'risky',
					confidence: 100,
					machineCheckable: true,
				}),
			).toBe('needs_review')
		})

		it('should need review when the verdict is missing', () => {
			// GIVEN no verdict at all
			// THEN it needs review
			expect(
				trustTier({
					verification: null,
					confidence: 100,
					machineCheckable: true,
				}),
			).toBe('needs_review')
		})
	})
})

describe('verdictRank', () => {
	it('should order verdicts most-deliverable first', () => {
		// GIVEN the five known verdicts
		// THEN deliverable ranks before risky before catch_all before unknown before undeliverable
		expect(verdictRank('deliverable')).toBeLessThan(verdictRank('risky'))
		expect(verdictRank('risky')).toBeLessThan(verdictRank('catch_all'))
		expect(verdictRank('catch_all')).toBeLessThan(verdictRank('unknown'))
		expect(verdictRank('unknown')).toBeLessThan(verdictRank('undeliverable'))
	})

	it('should sort an unrecognised or missing verdict last', () => {
		// GIVEN an unknown string or null
		// THEN it ranks after every known verdict
		expect(verdictRank('nonsense')).toBe(Number.POSITIVE_INFINITY)
		expect(verdictRank(null)).toBe(Number.POSITIVE_INFINITY)
	})
})

describe('verdictTone', () => {
	it('should map each verdict to its tone', () => {
		// GIVEN each verdict
		// THEN it renders in the expected colour tone
		expect(verdictTone('deliverable')).toBe('positive')
		expect(verdictTone('risky')).toBe('caution')
		expect(verdictTone('catch_all')).toBe('caution')
		expect(verdictTone('undeliverable')).toBe('negative')
		expect(verdictTone('unknown')).toBe('neutral')
		expect(verdictTone(null)).toBe('neutral')
	})
})

describe('outcomeTone', () => {
	const cases: ReadonlyArray<readonly [ProposalOutcome, string]> = [
		['applied', 'positive'],
		['created', 'positive'],
		['duplicate', 'info'],
		['rejected', 'neutral'],
		['conflict', 'caution'],
		['invalid', 'negative'],
		['no_applicable_fields', 'negative'],
		['run_not_found', 'negative'],
		['proposal_not_found', 'negative'],
		['error', 'negative'],
	]

	for (const [outcome, tone] of cases) {
		it(`should render ${outcome} with the ${tone} tone`, () => {
			// GIVEN a resolved proposal outcome
			// THEN its badge tone communicates success/failure at a glance
			expect(outcomeTone(outcome)).toBe(tone)
		})
	}
})

describe('normalizeConfidence', () => {
	it('should scale a 0–1 model fraction up to 0–100', () => {
		// GIVEN a 0.9 fraction from the model
		// THEN it becomes a 90 score
		expect(normalizeConfidence(0.9)).toBe(90)
	})

	it('should keep an already-0–100 enrichment score as-is', () => {
		// GIVEN an 82 score from an enrichment provider
		// THEN it stays 82 (rounded)
		expect(normalizeConfidence(82)).toBe(82)
	})

	it('should treat the boundary value 1 as a full fraction', () => {
		// GIVEN exactly 1 (a fraction, not a percent)
		// THEN it becomes 100
		expect(normalizeConfidence(1)).toBe(100)
	})

	it('should clamp out-of-range and reject non-finite or missing values', () => {
		// GIVEN over-100, negative, NaN, null and undefined
		// THEN they clamp or drop to null
		expect(normalizeConfidence(150)).toBe(100)
		expect(normalizeConfidence(-5)).toBe(0)
		expect(normalizeConfidence(Number.NaN)).toBeNull()
		expect(normalizeConfidence(null)).toBeNull()
		expect(normalizeConfidence(undefined)).toBeNull()
	})
})

describe('isEnteredOutcome', () => {
	it('should treat applied, created and duplicate as entered into the CRM', () => {
		// GIVEN the outcomes that write a record
		// THEN they count as entered
		expect(isEnteredOutcome('applied')).toBe(true)
		expect(isEnteredOutcome('created')).toBe(true)
		expect(isEnteredOutcome('duplicate')).toBe(true)
	})

	it('should treat every non-writing outcome as not entered', () => {
		// GIVEN outcomes that changed nothing in the CRM
		// THEN they do not count as entered
		for (const outcome of [
			'rejected',
			'conflict',
			'invalid',
			'no_applicable_fields',
			'run_not_found',
			'proposal_not_found',
			'error',
		] as const) {
			expect(isEnteredOutcome(outcome)).toBe(false)
		}
	})
})
