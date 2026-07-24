import { describe, expect, it } from 'vitest'

import { guardFitEvidence } from './fit-evidence-guard'

// A corpus that mentions the fleet but nothing about a brokerage licence.
const CORPUS =
	'Acme Freight operates a fleet of 40 owned trucks across the Midwest. ' +
	'Our drivers haul refrigerated loads for regional grocers.'

describe('guardFitEvidence', () => {
	describe('when a disqualifier quotes the evidence', () => {
		it('should keep it', () => {
			// GIVEN a disqualifier whose quote is (loosely) in the corpus
			const findings = {
				disqualifiers: [
					{
						rule: 'asset-based carrier, not a broker',
						evidence_quote: 'a fleet of 40 owned trucks',
						source_id: 'https://acme.example/about',
					},
				],
			}

			// WHEN guarded against the corpus — THEN the grounded disqualifier stays
			const out = guardFitEvidence(findings, CORPUS)
			expect(
				(out.findings as { disqualifiers: unknown[] }).disqualifiers,
			).toHaveLength(1)
			expect(out.droppedDisqualifiers).toBe(0)
		})
	})

	describe('when a disqualifier quotes something no page said', () => {
		it('should drop it as a fabricated negative claim', () => {
			// GIVEN a disqualifier whose quote is nowhere in the evidence
			const findings = {
				disqualifiers: [
					{
						rule: 'lapsed operating authority',
						evidence_quote: 'their DOT authority was revoked in 2019',
						source_id: 'https://acme.example/about',
					},
				],
			}

			// WHEN guarded — THEN the unsupported disqualifier is dropped
			const out = guardFitEvidence(findings, CORPUS)
			expect(
				(out.findings as { disqualifiers: unknown[] }).disqualifiers,
			).toHaveLength(0)
			expect(out.droppedDisqualifiers).toBe(1)
		})
	})

	describe('when a fit check asserts pass/fail on a fabricated quote', () => {
		it('should downgrade it to unknown and clear the quote', () => {
			// GIVEN a "fail" check whose quote appears in no page
			const findings = {
				fit_checks: [
					{
						criterion: 'US-based operations',
						result: 'fail',
						evidence_quote: 'headquartered in Hamburg, Germany',
						source_id: 'https://acme.example/contact',
					},
				],
			}

			// WHEN guarded — THEN the criterion stays but its verdict becomes unknown
			// and the invented quote is gone
			const out = guardFitEvidence(findings, CORPUS)
			const check = (
				out.findings as { fit_checks: Array<Record<string, unknown>> }
			).fit_checks[0]
			expect(check?.['result']).toBe('unknown')
			expect(check?.['evidence_quote']).toBeUndefined()
			expect(check?.['criterion']).toBe('US-based operations')
			expect(out.unverifiedChecks).toBe(1)
		})
	})

	describe('when an entry carries no quote', () => {
		it('should leave it untouched — an unquoted claim cannot be refuted', () => {
			// GIVEN a disqualifier and a check with no evidence_quote
			const findings = {
				disqualifiers: [{ rule: 'too small' }],
				fit_checks: [{ criterion: 'sector match', result: 'pass' }],
			}

			// WHEN guarded — THEN nothing is dropped or downgraded
			const out = guardFitEvidence(findings, CORPUS)
			expect(out.droppedDisqualifiers).toBe(0)
			expect(out.unverifiedChecks).toBe(0)
		})
	})

	describe('when there is no evidence corpus', () => {
		it('should skip the check so nothing is dropped on a resume', () => {
			// GIVEN a fabricated-looking quote but an empty corpus (a resumed run)
			const findings = {
				disqualifiers: [
					{ rule: 'x', evidence_quote: 'anything at all', source_id: 's' },
				],
			}

			// WHEN guarded with no corpus — THEN it passes untouched
			const out = guardFitEvidence(findings, '')
			expect(out.droppedDisqualifiers).toBe(0)
		})
	})
})
