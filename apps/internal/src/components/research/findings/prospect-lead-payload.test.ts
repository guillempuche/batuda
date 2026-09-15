import { describe, expect, it } from 'vitest'

import type { AttributeDeclaration } from '#/components/instructions/attribute-shapes'
import {
	buildLeadPayload,
	type ProspectLeadSource,
} from './prospect-lead-payload'

// One declaration as the settings page narrows it, for the keys a lead may carry.
const declaration = (
	over: Partial<AttributeDeclaration>,
): AttributeDeclaration => ({
	id: 'a1',
	stackId: 's1',
	stackName: 'Girona',
	key: 'site_count',
	label: 'Sites',
	kind: 'number',
	enumValues: [],
	unit: null,
	description: null,
	isActive: true,
	createdAt: null,
	...over,
})

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

describe("the people a search read off the company's own pages", () => {
	describe('when the run named some', () => {
		it('should carry them across with their job titles', () => {
			// GIVEN a prospect whose own team page named two people
			const { payload } = buildLeadPayload(
				{
					name: 'Egein',
					contacts: [
						{ name: 'David Garrido', role: 'CEO - Enginyer Industrial' },
						{ name: 'Mariona Garrido' },
					],
				},
				'egein',
			)

			// THEN both travel with the company, the untitled one without a title
			// invented for her
			expect(payload.contacts).toEqual([
				{ name: 'David Garrido', role: 'CEO - Enginyer Industrial' },
				{ name: 'Mariona Garrido' },
			])
		})
	})

	describe('when a title is blank or only spaces', () => {
		it('should leave the title off rather than carry a blank one', () => {
			// GIVEN two people the run named, one with an empty title and one whose
			// title is nothing but spacing
			const { payload } = buildLeadPayload(
				{
					name: 'Egein',
					contacts: [
						{ name: 'David Garrido', role: '' },
						{ name: 'Mariona Garrido', role: '   ' },
					],
				},
				'egein',
			)

			// THEN both travel with no title at all. A blank title passes every
			// check for having one, and would be read back as a finding
			expect(payload.contacts).toEqual([
				{ name: 'David Garrido' },
				{ name: 'Mariona Garrido' },
			])
		})
	})

	describe('when an entry has a title but nobody to hang it on', () => {
		it('should leave it out', () => {
			// GIVEN a blank name beside a real one
			const { payload } = buildLeadPayload(
				{
					name: 'Egein',
					contacts: [{ name: '  ', role: 'Gerent' }, { name: 'David Garrido' }],
				},
				'egein',
			)

			// THEN only the person who can be asked for is carried: a contact with
			// no name is one nobody can be asked for
			expect(payload.contacts).toEqual([{ name: 'David Garrido' }])
		})
	})

	describe('when the run named nobody', () => {
		it('should leave the field off entirely', () => {
			// GIVEN a company with no people on its pages
			const { payload } = buildLeadPayload({ name: 'Egein' }, 'egein')

			// THEN nothing is sent rather than an empty list
			expect(payload.contacts).toBeUndefined()
		})
	})
})

describe('the attribute values a scan read off the company', () => {
	describe('when the run tied a value to a page', () => {
		it('should carry the page and the words on it, so the run is what found it', () => {
			// GIVEN a row with two values, one read off a page the run fetched and one
			// the run could not tie to any page
			const { payload } = buildLeadPayload(
				{
					name: 'Egein',
					attributes: {
						site_count: 3,
						takes_bookings: true,
						evidence: {
							site_count: {
								source_id: 'https://egein.com/instalacions',
								quote: 'Tres naus a Celrà',
								confidence: null,
							},
						},
					},
				},
				'egein',
				'run-1',
			)

			// THEN the grounded value travels with its page, the other travels bare —
			// and the run is named, which is what lets the CRM tell the two apart
			expect(payload.attributes).toEqual({
				site_count: {
					value: 3,
					source_id: 'https://egein.com/instalacions',
					quote: 'Tres naus a Celrà',
				},
				takes_bookings: true,
			})
			expect(payload.researchId).toBe('run-1')
		})
	})

	describe('when a value names a page but no words on it', () => {
		it('should carry the page without inventing a quote', () => {
			// GIVEN evidence holding only the page
			const { payload } = buildLeadPayload(
				{
					name: 'Egein',
					attributes: {
						site_count: 3,
						evidence: { site_count: { source_id: 'https://egein.com' } },
					},
				},
				'egein',
				'run-1',
			)

			// THEN nothing is quoted
			expect(payload.attributes).toEqual({
				site_count: { value: 3, source_id: 'https://egein.com' },
			})
		})
	})

	describe('when the evidence names no page', () => {
		it('should pass the value on its own', () => {
			// GIVEN an entry with words but no page to go and read them on
			const { payload } = buildLeadPayload(
				{
					name: 'Egein',
					attributes: {
						site_count: 3,
						evidence: { site_count: { quote: 'Tres naus' } },
					},
				},
				'egein',
				'run-1',
			)

			// THEN the value lands as the person's own: a page nothing fetched would
			// be refused, and there is none to name
			expect(payload.attributes).toEqual({ site_count: 3 })
		})
	})

	describe('when the run filled none', () => {
		it('should name neither the values nor the run', () => {
			// GIVEN a row with no attributes at all
			const { payload } = buildLeadPayload({ name: 'Egein' }, 'egein', 'run-1')

			// THEN nothing is sent rather than an empty map, and the run's id has
			// nothing to tie and so is left off
			expect(payload.attributes).toBeUndefined()
			expect(payload.researchId).toBeUndefined()
		})
	})

	describe('when there is no run to name', () => {
		it('should still carry the values, as the person adding them', () => {
			// GIVEN a lead added from outside a run page
			const { payload } = buildLeadPayload(
				{ name: 'Egein', attributes: { site_count: 3 } },
				'egein',
			)

			// THEN the values travel and nothing claims a run found them
			expect(payload.attributes).toEqual({ site_count: 3 })
			expect(payload.researchId).toBeUndefined()
		})
	})

	describe('when a key nobody declares any more turns up', () => {
		it('should leave it behind rather than lose the whole lead', () => {
			// GIVEN a run that filled a key since retired, beside one still declared
			const { payload } = buildLeadPayload(
				{
					name: 'Egein',
					attributes: { site_count: 3, takes_bookings: true },
				},
				'egein',
				'run-1',
				[
					declaration({}),
					declaration({
						id: 'a2',
						key: 'takes_bookings',
						kind: 'boolean',
						isActive: false,
					}),
				],
			)

			// THEN only the declared key travels: the server refuses the whole create
			// on the first key it does not recognise
			expect(payload.attributes).toEqual({ site_count: 3 })
		})
	})

	describe('when a value does not read as the kind it was declared with', () => {
		it('should leave it behind, since the server would refuse it', () => {
			// GIVEN a number key the run filled with words that are not a number
			const { payload } = buildLeadPayload(
				{ name: 'Egein', attributes: { site_count: 'a few' } },
				'egein',
				'run-1',
				[declaration({})],
			)

			// THEN nothing is sent rather than a value the write would be refused for
			expect(payload.attributes).toBeUndefined()
			expect(payload.researchId).toBeUndefined()
		})
	})

	describe('when a declared key carries what it was declared to carry', () => {
		it('should travel with the page it was read on', () => {
			// GIVEN a grounded value under a key declared active
			const { payload } = buildLeadPayload(
				{
					name: 'Egein',
					attributes: {
						site_count: '3',
						evidence: {
							site_count: {
								source_id: 'https://egein.com/instalacions',
								quote: 'Tres naus a Celrà',
							},
						},
					},
				},
				'egein',
				'run-1',
				[declaration({})],
			)

			// THEN it lands as the declared kind, with its page and words intact
			expect(payload.attributes).toEqual({
				site_count: {
					value: 3,
					source_id: 'https://egein.com/instalacions',
					quote: 'Tres naus a Celrà',
				},
			})
			expect(payload.researchId).toBe('run-1')
		})
	})

	describe('when the page does not know what is declared yet', () => {
		it('should send everything and let the server decide', () => {
			// GIVEN declarations that have not arrived
			const { payload } = buildLeadPayload(
				{ name: 'Egein', attributes: { site_count: 'a few', anything: 2 } },
				'egein',
				'run-1',
				null,
			)

			// THEN nothing is held back: guessing here would drop a value that is
			// perfectly declared, on a page that simply has not been told
			expect(payload.attributes).toEqual({ site_count: 'a few', anything: 2 })
		})
	})
})

describe('the number a company is registered under', () => {
	describe('when the run read one', () => {
		it('should carry it, since it is what recognises the firm again', () => {
			// GIVEN a prospect whose registration number the run found
			const { payload } = buildLeadPayload(
				{ name: 'Egein', tax_id: 'B17234567' },
				'egein',
			)

			// THEN it travels: the name and the web address both change, the
			// registration does not
			expect(payload.taxId).toBe('B17234567')
		})
	})

	describe('when the run read none', () => {
		it('should leave it off', () => {
			expect(
				buildLeadPayload({ name: 'Egein', tax_id: '  ' }, 'egein').payload
					.taxId,
			).toBeUndefined()
		})
	})
})
