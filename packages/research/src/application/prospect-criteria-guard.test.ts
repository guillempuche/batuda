import { describe, expect, it } from 'vitest'

import {
	countryFromPlaceHint,
	filterProspectsByCriteria,
	prospectCriteriaFromHints,
} from './prospect-criteria-guard'

// A prospect as it reaches the filter: a name, and optionally a stated headcount
// (paired with its source) and country.
const prospect = (name: string, employees?: number, country?: string) => ({
	name,
	...(employees !== undefined
		? { employee_estimate: { value: employees, source_id: 's1' } }
		: {}),
	...(country !== undefined ? { country } : {}),
})

const namesOf = (findings: unknown): string[] =>
	(findings as { prospects: Array<{ name: string }> }).prospects.map(
		p => p.name,
	)

describe('filterProspectsByCriteria', () => {
	describe('when a prospect states a headcount above the ceiling', () => {
		it('should drop it and keep the ones within range', () => {
			// GIVEN a midsize request (max 250) and a mix of sizes
			const findings = {
				prospects: [
					prospect('Right Size', 120),
					prospect('Too Big', 9000),
					prospect('Also Fine', 200),
				],
			}

			// WHEN filtered
			const result = filterProspectsByCriteria(findings, { maxEmployees: 250 })

			// THEN the giant is dropped, the rest stay
			expect(namesOf(result.findings)).toEqual(['Right Size', 'Also Fine'])
			expect(result.dropped).toBe(1)
		})
	})

	describe('when a prospect states a headcount below the floor', () => {
		it('should drop it', () => {
			// GIVEN a floor of 50 and a tiny company
			const findings = { prospects: [prospect('Tiny', 8), prospect('OK', 90)] }

			// WHEN filtered — THEN the too-small one goes
			const result = filterProspectsByCriteria(findings, { minEmployees: 50 })
			expect(namesOf(result.findings)).toEqual(['OK'])
		})
	})

	describe('when a prospect states no headcount', () => {
		it('should keep it — silence is not a conflict', () => {
			// GIVEN a size request and a prospect that never stated its size
			const findings = { prospects: [prospect('Unknown Size')] }

			// WHEN filtered — THEN it survives: the filter drops only what is provably
			// out of range, never what is merely unproven
			const result = filterProspectsByCriteria(findings, { maxEmployees: 250 })
			expect(namesOf(result.findings)).toEqual(['Unknown Size'])
			expect(result.dropped).toBe(0)
		})
	})

	describe('when a prospect states a country outside the request', () => {
		it('should drop it, and keep one that stated the wanted country or none', () => {
			// GIVEN a Spain-only request
			const findings = {
				prospects: [
					prospect('Spanish', undefined, 'ES'),
					prospect('French', undefined, 'FR'),
					prospect('Unstated'),
				],
			}

			// WHEN filtered — THEN only the out-of-country one is dropped; an unstated
			// country is kept (silence is not a conflict)
			const result = filterProspectsByCriteria(findings, { countries: ['ES'] })
			expect(namesOf(result.findings)).toEqual(['Spanish', 'Unstated'])
		})
	})

	describe('when a prospect names the wanted country a different way', () => {
		it('should keep it — "UK" and "GB" are the same place', () => {
			// GIVEN a GB request and a prospect that wrote its country as "UK"
			const findings = {
				prospects: [
					prospect('British', undefined, 'UK'),
					prospect('Also British', undefined, 'GB'),
				],
			}

			// WHEN filtered — THEN neither is dropped: the two codes name one country
			const result = filterProspectsByCriteria(findings, { countries: ['GB'] })
			expect(namesOf(result.findings)).toEqual(['British', 'Also British'])
			expect(result.dropped).toBe(0)
		})

		it('should keep a country written as a name it cannot pin to a code', () => {
			// GIVEN an ES request and a genuinely-Spanish prospect that wrote the full
			// name rather than the code the prompt asked for
			const findings = {
				prospects: [
					prospect('Spanish', undefined, 'Spain'),
					prospect('French', undefined, 'FR'),
				],
			}

			// WHEN filtered — THEN "Spain" reads as "not stated" and is kept (never
			// drop what we could not resolve), while the clear-cut French code goes
			const result = filterProspectsByCriteria(findings, { countries: ['ES'] })
			expect(namesOf(result.findings)).toEqual(['Spanish'])
		})
	})

	describe('when the wanted country is one we cannot resolve to a code', () => {
		it('should filter on nothing rather than drop every prospect', () => {
			// GIVEN a country criterion that is a name, not a code
			const findings = {
				prospects: [
					prospect('One', undefined, 'FR'),
					prospect('Two', undefined, 'ES'),
				],
			}

			// WHEN filtered — THEN with no resolvable wanted country there is nothing
			// to hold a prospect to, so all survive (an empty wanted set must not read
			// as "every stated country conflicts")
			const result = filterProspectsByCriteria(findings, {
				countries: ['Spain'],
			})
			expect(namesOf(result.findings)).toEqual(['One', 'Two'])
			expect(result.dropped).toBe(0)
		})
	})

	describe('when the request set no size or place', () => {
		it('should return the findings untouched', () => {
			// GIVEN an empty criteria
			const findings = { prospects: [prospect('A', 9000, 'FR')] }

			// WHEN filtered — THEN nothing is dropped
			const result = filterProspectsByCriteria(findings, {})
			expect(result.dropped).toBe(0)
			expect(namesOf(result.findings)).toEqual(['A'])
		})
	})

	describe('when a headcount was blanked to null by an earlier guard', () => {
		it('should treat it as not stated and keep the prospect', () => {
			// GIVEN a prospect whose headcount the guard chain nulled
			const findings = {
				prospects: [{ name: 'Nulled', employee_estimate: { value: null } }],
			}

			// WHEN filtered — THEN a nulled value reads as "not stated", so it stays
			const result = filterProspectsByCriteria(findings, { maxEmployees: 250 })
			expect(namesOf(result.findings)).toEqual(['Nulled'])
		})
	})

	describe('when the findings have no prospects', () => {
		it('should pass them through rather than throw', () => {
			// GIVEN non-prospect findings
			expect(
				filterProspectsByCriteria(null, { maxEmployees: 1 }).findings,
			).toBeNull()
			expect(
				filterProspectsByCriteria({ competitors: [] }, { maxEmployees: 1 })
					.dropped,
			).toBe(0)
		})
	})
})

describe('prospectCriteriaFromHints', () => {
	describe('when the hints carry an employee band', () => {
		it('should read min and max under the names the request sent', () => {
			// GIVEN hints as the request wrote them, which is how they are stored
			// WHEN the criteria are derived
			const criteria = prospectCriteriaFromHints(
				{ min_employees: 50, max_employees: 250 },
				['ES'],
			)

			// THEN the band and countries are carried through
			expect(criteria.minEmployees).toBe(50)
			expect(criteria.maxEmployees).toBe(250)
			expect(criteria.countries).toEqual(['ES'])
		})
	})

	describe('when the hints carry no employee band', () => {
		it('should leave the size open', () => {
			// GIVEN hints with only a country
			const criteria = prospectCriteriaFromHints(undefined, ['GB'])

			// THEN size is unset and only the country constrains the scan
			expect(criteria.minEmployees).toBeUndefined()
			expect(criteria.maxEmployees).toBeUndefined()
			expect(criteria.countries).toEqual(['GB'])
		})
	})
})

describe('countryFromPlaceHint', () => {
	describe('when the hint is already a country code', () => {
		it('should read it as that country', () => {
			// GIVEN the shape a caller most often sends
			// THEN it is used as it stands
			expect(countryFromPlaceHint('ES')).toBe('ES')
			expect(countryFromPlaceHint('es-ES')).toBe('ES')
		})
	})

	describe('when the hint names the country in words', () => {
		it('should still reach the country, in either language', () => {
			// GIVEN a request that says the country the way a person writes it
			// THEN the filter runs. Read as a code alone this yields nothing, and a
			// request that plainly said Spain gets no country filter at all — with the
			// check reporting nothing dropped, which reads exactly like a clean run
			expect(countryFromPlaceHint('Spain')).toBe('ES')
			expect(countryFromPlaceHint('España')).toBe('ES')
			expect(countryFromPlaceHint('United Kingdom')).toBe('GB')
		})
	})

	describe('when the hint is not a country', () => {
		it('should yield nothing for a town, so nothing is filtered on', () => {
			// GIVEN a place hint that is somewhere inside a country
			// THEN no country comes back: a town is not a country to hold a prospect
			// to, and inventing one would drop companies the request never ruled out
			expect(countryFromPlaceHint('Barcelona')).toBeUndefined()
			expect(countryFromPlaceHint('the north of the country')).toBeUndefined()
		})

		it('should yield nothing when there is no hint at all', () => {
			expect(countryFromPlaceHint(undefined)).toBeUndefined()
			expect(countryFromPlaceHint('')).toBeUndefined()
		})
	})
})
