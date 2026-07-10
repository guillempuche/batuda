import { describe, expect, it } from 'vitest'

import {
	type GoldenExpectation,
	type RunOutcome,
	type RunScore,
	scoreRun,
	summarizeScores,
} from './eval-scoring'

const acme: GoldenExpectation = {
	id: 'acme',
	query: 'Acme Logistics, Barcelona',
	officialDomain: 'acme.es',
	fields: {
		industry: 'transport',
		region: 'cat',
		size_range: '26-50',
		address: 'Carrer del Ferro 12, 08040 Barcelona',
	},
}

const outcome = (over: Partial<RunOutcome>): RunOutcome => ({
	status: 'succeeded',
	reachedDomains: ['acme.es'],
	fields: {},
	...over,
})

describe('scoreRun', () => {
	describe('when the run grounded on the official domain', () => {
		it('should mark it grounded and not wrong-company', () => {
			// GIVEN a run that read the target's own site and filled a field
			const result = scoreRun(
				acme,
				outcome({
					reachedDomains: ['https://www.acme.es/about'],
					fields: { industry: 'transport' },
				}),
			)

			// WHEN scored — THEN it reached the target
			expect(result.grounded).toBe(true)
			expect(result.wrongCompany).toBe(false)
			expect(result.empty).toBe(false)
		})
	})

	describe('when the run grounded only on an alt domain', () => {
		it('should still count as reaching the target', () => {
			// GIVEN a registry profile listed as an accepted grounding anchor
			const withAlt: GoldenExpectation = {
				...acme,
				altDomains: ['librebor.es'],
			}

			// WHEN the run grounded on that alt domain only
			const result = scoreRun(
				withAlt,
				outcome({
					reachedDomains: ['librebor.es'],
					fields: { region: 'cat' },
				}),
			)

			// THEN grounding is satisfied
			expect(result.grounded).toBe(true)
		})
	})

	describe('when the run reached a subdomain of the official site', () => {
		it('should still count as reaching the target', () => {
			// GIVEN a run that fetched a careers subdomain, not the apex domain
			const result = scoreRun(
				acme,
				outcome({
					reachedDomains: ['careers.acme.es'],
					fields: { industry: 'transport' },
				}),
			)

			// THEN a subdomain of the official site still grounds it
			expect(result.grounded).toBe(true)
			expect(result.wrongCompany).toBe(false)
		})
	})

	describe('when a succeeded run returned data but never reached the target', () => {
		it('should flag it as wrong-company', () => {
			// GIVEN a confident run whose sources are a same-named different company
			const result = scoreRun(
				acme,
				outcome({
					reachedDomains: ['ceva-logistics.com'],
					fields: { industry: 'transport' },
				}),
			)

			// WHEN scored — THEN it is the look-alike failure
			expect(result.grounded).toBe(false)
			expect(result.wrongCompany).toBe(true)
			expect(result.empty).toBe(false)
		})
	})

	describe('when the run failed to confirm the company', () => {
		it('should be empty and never wrong-company', () => {
			// GIVEN a run that failed closed with no fields
			const result = scoreRun(
				acme,
				outcome({
					status: 'no_reliable_data',
					reachedDomains: [],
					fields: {},
				}),
			)

			// WHEN scored — THEN empty, and a failed run is not "wrong company"
			expect(result.empty).toBe(true)
			expect(result.wrongCompany).toBe(false)
		})
	})

	describe('when a succeeded run filled no scorable field', () => {
		it('should count as empty', () => {
			// GIVEN a run that succeeded but produced only blanks
			const result = scoreRun(
				acme,
				outcome({ fields: { industry: '  ', region: null } }),
			)

			// WHEN scored — THEN there is no usable data
			expect(result.empty).toBe(true)
		})
	})

	describe('when scoring the open industry field across languages', () => {
		const withIndustry = (expected: string, actual: string): RunScore =>
			scoreRun(
				{ ...acme, fields: { industry: expected } },
				outcome({ fields: { industry: actual } }),
			)

		it('should match a Catalan code against its English cognate via the shared stem', () => {
			// GIVEN the golden holds the CRM code and the run reports English free text
			// WHEN their Latin stems line up — THEN the field counts as correct
			expect(
				withIndustry('manufactura', 'Bike Manufacturing Ltd').fieldsCorrect,
			).toBe(1)
			expect(
				withIndustry('serveis', 'financial services provider').fieldsCorrect,
			).toBe(1)
		})

		it('should match across accents', () => {
			// GIVEN an accented code and its un-accented English cognate
			expect(
				withIndustry('construcció', 'construction company').fieldsCorrect,
			).toBe(1)
		})

		it('should still miss a genuine categorization gap', () => {
			// GIVEN a bank the run labels "banking" while the CRM codes it "serveis"
			// WHEN no stem is shared — THEN it counts as wrong, the signal the eval wants
			expect(withIndustry('serveis', 'banking').fieldsCorrect).toBe(0)
		})
	})

	describe('when scoring the fields it filled', () => {
		it('should count a correct filled field and ignore an unfilled one', () => {
			// GIVEN industry correct, region left blank
			const result = scoreRun(
				acme,
				outcome({ fields: { industry: 'Transport', region: null } }),
			)

			// WHEN scored — THEN only the filled field is judged, and it matched
			expect(result.fieldsScored).toBe(1)
			expect(result.fieldsCorrect).toBe(1)
		})

		it('should count a filled-but-wrong field as scored, not correct', () => {
			// GIVEN a wrong industry
			const result = scoreRun(acme, outcome({ fields: { industry: 'retail' } }))

			// WHEN scored — THEN it counts against precision
			expect(result.fieldsScored).toBe(1)
			expect(result.fieldsCorrect).toBe(0)
		})

		it('should not score a field the golden set has no truth for', () => {
			// GIVEN industry (in the expectation) plus location (NOT in acme's golden fields)
			const result = scoreRun(
				acme,
				outcome({
					fields: { industry: 'transport', location: 'Barcelona' },
				}),
			)

			// WHEN scored — THEN only industry is judged; location has no golden truth
			expect(result.fieldsScored).toBe(1)
			expect(result.fieldsCorrect).toBe(1)
		})

		it('should match an address that differs only in formatting', () => {
			// GIVEN an extracted address that contains the golden postal core
			const result = scoreRun(
				acme,
				outcome({
					fields: {
						address: 'Carrer del Ferro 12, 08040 Barcelona, Catalonia, Spain',
					},
				}),
			)

			// WHEN scored — THEN containment matching accepts it
			expect(result.fieldsScored).toBe(1)
			expect(result.fieldsCorrect).toBe(1)
		})

		it('should count every known field as expected, even the unfilled ones', () => {
			// GIVEN a run that fills 2 of acme's 4 golden fields, both correct
			const result = scoreRun(
				acme,
				outcome({ fields: { industry: 'transport', region: 'cat' } }),
			)

			// WHEN scored — THEN all 4 known fields count toward recall; 2 were filled
			expect(result.fieldsExpected).toBe(4)
			expect(result.fieldsScored).toBe(2)
			expect(result.fieldsCorrect).toBe(2)
		})
	})
})

describe('summarizeScores', () => {
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

	describe('when there are no scores', () => {
		it('should report zeros and an undefined precision and recall', () => {
			// GIVEN an empty run set
			const summary = summarizeScores([])

			// WHEN summarized — THEN nothing is asserted as a rate; precision/recall null
			expect(summary).toEqual({
				runs: 0,
				groundingAccuracy: 0,
				wrongCompanyRate: 0,
				emptyRate: 0,
				fieldPrecision: null,
				fieldRecall: null,
			})
		})
	})

	describe('when runs mix grounded, wrong-company, and empty outcomes', () => {
		it('should average each rate over all runs', () => {
			// GIVEN 4 runs: 2 grounded, 1 wrong-company, 1 empty
			const summary = summarizeScores([
				score({ grounded: true }),
				score({ grounded: true }),
				score({ grounded: false, wrongCompany: true }),
				score({ grounded: false, empty: true }),
			])

			// WHEN summarized — THEN each rate is the fraction over 4
			expect(summary.runs).toBe(4)
			expect(summary.groundingAccuracy).toBe(0.5)
			expect(summary.wrongCompanyRate).toBe(0.25)
			expect(summary.emptyRate).toBe(0.25)
		})
	})

	describe('when scored fields span several runs', () => {
		it('should micro-average precision over filled fields and recall over known fields', () => {
			// GIVEN 3 correct of 4 FILLED fields, but 6 fields were KNOWN across two runs
			const summary = summarizeScores([
				score({ fieldsExpected: 3, fieldsScored: 2, fieldsCorrect: 2 }),
				score({ fieldsExpected: 3, fieldsScored: 2, fieldsCorrect: 1 }),
			])

			// WHEN summarized — THEN precision is correct÷filled, recall is correct÷known
			expect(summary.fieldPrecision).toBe(0.75)
			expect(summary.fieldRecall).toBe(0.5)
		})
	})

	describe('when runs knew fields but filled none of them', () => {
		it('should report precision null but recall zero', () => {
			// GIVEN a run whose golden fields were all left blank
			const summary = summarizeScores([
				score({ fieldsExpected: 3, fieldsScored: 0, fieldsCorrect: 0 }),
			])

			// WHEN summarized — THEN nothing was filled to judge (precision null), but
			// everything known was missed (recall 0) — the two are not the same signal
			expect(summary.fieldPrecision).toBeNull()
			expect(summary.fieldRecall).toBe(0)
		})
	})
})
