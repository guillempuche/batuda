import { describe, expect, it } from 'vitest'

import {
	buildLeadPayload,
	type ProspectLeadSource,
} from './prospect-lead-payload'

// Rows as a real scan wrote them — a Girona industrial-engineering search whose
// countries came back as words rather than codes, which is what made half of
// every prospect ever scanned impossible to add.
const prospect = (over: Partial<ProspectLeadSource>): ProspectLeadSource => ({
	name: 'Cobra Instalaciones y Servicios, S.A.',
	...over,
})

describe('buildLeadPayload', () => {
	describe('when the run named its country in words', () => {
		it('should carry it across as the code the CRM stores', () => {
			// GIVEN the spellings real scans produced
			const spanish = buildLeadPayload(prospect({ countries: ['España'] }), 's')
			const english = buildLeadPayload(prospect({ countries: ['Spain'] }), 's')

			// WHEN built — THEN both reach the CRM as the same code, so a person can
			// filter on it afterwards
			expect(spanish.payload.country).toBe('ES')
			expect(english.payload.country).toBe('ES')
			expect(spanish.dropped).toEqual([])
		})

		it('should take the first of several, which is where it is registered', () => {
			// GIVEN a company with a place in more than one country
			const built = buildLeadPayload(
				prospect({ countries: ['Portugal', 'Spain'] }),
				's',
			)

			// WHEN built — THEN the row holds the one country it can, and it is the
			// first
			expect(built.payload.country).toBe('PT')
		})
	})

	describe('when the country cannot be turned into a code', () => {
		it('should add the lead without it and say so', () => {
			// GIVEN a country the run itself was unsure of
			const built = buildLeadPayload(
				prospect({
					countries: ['Portugal? (uncertain – site uses .br domain)'],
				}),
				's',
			)

			// WHEN built — THEN the lead survives, the country does not, and the
			// caller is told which field went rather than left to notice
			expect(built.payload.country).toBeUndefined()
			expect(built.payload.name).toBe('Cobra Instalaciones y Servicios, S.A.')
			expect(built.dropped).toEqual(['country'])
		})

		it('should say nothing when the run named no country at all', () => {
			// GIVEN a row with no country to begin with
			const built = buildLeadPayload(prospect({}), 's')

			// WHEN built — THEN nothing was dropped, because nothing was offered:
			// naming a field the run never filled would read as a fault
			expect(built.dropped).toEqual([])
		})
	})

	describe('when the country is already a code', () => {
		it('should keep it, whatever case it came in', () => {
			// GIVEN a code the model wrote in lower case. It passes the CRM's read
			// but fails its write, and the browser is what writes.
			expect(
				buildLeadPayload(prospect({ countries: ['es'] }), 's').payload.country,
			).toBe('ES')
			expect(
				buildLeadPayload(prospect({ countries: ['ES'] }), 's').payload.country,
			).toBe('ES')
		})
	})

	describe('when the web address is not one', () => {
		it('should add the lead without it and say so', () => {
			// GIVEN a website field holding something that is not an address
			const built = buildLeadPayload(
				prospect({ countries: ['ES'], website: 'not a url' }),
				's',
			)

			// WHEN built — THEN the lead lands and only the address is left behind
			expect(built.payload.website).toBeUndefined()
			expect(built.dropped).toEqual(['website'])
		})

		it('should keep a real one', () => {
			// GIVEN the address this company actually publishes
			const built = buildLeadPayload(
				prospect({ website: 'https://www.grupocobra.com' }),
				's',
			)

			// WHEN built — THEN it is carried across untouched
			expect(built.payload.website).toBe('https://www.grupocobra.com')
			expect(built.dropped).toEqual([])
		})
	})

	describe('when a social profile is missing half of itself', () => {
		it('should leave that one out and keep the rest', () => {
			// GIVEN a list where one entry says the platform but not the page
			const built = buildLeadPayload(
				prospect({
					social_profiles: [
						{ kind: 'linkedin', value: 'https://linkedin.com/company/cobra' },
						{ kind: 'x', value: '  ' },
					],
				}),
				's',
			)

			// WHEN built — THEN the usable page survives on its own. A footnote is
			// not worth the lead.
			expect(built.payload.socialProfiles).toEqual([
				{ kind: 'linkedin', value: 'https://linkedin.com/company/cobra' },
			])
		})
	})

	describe('when every field the run filled can be stored', () => {
		it('should carry the whole row and report nothing dropped', () => {
			// GIVEN a complete row
			const built = buildLeadPayload(
				prospect({
					name: 'EGEIN',
					industry: 'Ingeniería y construcción industrial',
					countries: ['ES'],
					location: 'Celrà, Girona',
					website: 'https://egein.com',
				}),
				'egein-x7f2q',
			)

			// WHEN built — THEN it arrives whole, at the prospect stage
			expect(built.payload).toEqual({
				name: 'EGEIN',
				slug: 'egein-x7f2q',
				status: 'prospect',
				industry: 'Ingeniería y construcción industrial',
				country: 'ES',
				location: 'Celrà, Girona',
				website: 'https://egein.com',
			})
			expect(built.dropped).toEqual([])
		})
	})
})
