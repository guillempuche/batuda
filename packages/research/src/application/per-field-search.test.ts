import { describe, expect, it } from 'vitest'

import {
	HIGH_VALUE_FIELDS,
	mergePerFieldSearch,
	needsPerFieldSearch,
	perFieldSearchQuery,
} from './per-field-search'

// A per-field-citation value the way the enrichment schema stores one.
const sourced = (value: string) => ({ value, source_id: 'https://x.test' })

describe('needsPerFieldSearch', () => {
	describe('when every high-value field is already filled', () => {
		it('should return no fields to search', () => {
			// GIVEN findings whose country/industry/location/size_range all carry a value
			const findings = {
				enrichment: {
					country: sourced('ES'),
					industry: sourced('manufacturing'),
					location: sourced('Barcelona'),
					size_range: sourced('51-200'),
				},
			}
			// WHEN the still-empty high-value fields are computed
			// THEN there is nothing to search for
			expect(needsPerFieldSearch(findings)).toEqual([])
		})
	})

	describe('when some high-value fields are empty', () => {
		it('should return only the empty ones, in HIGH_VALUE_FIELDS order', () => {
			// GIVEN industry + size_range filled, country + location empty
			const findings = {
				enrichment: {
					industry: sourced('manufacturing'),
					size_range: sourced('51-200'),
					country: { value: null },
				},
			}
			// WHEN computed
			// THEN the two empty high-value fields come back in a stable order
			expect(needsPerFieldSearch(findings)).toEqual(['country', 'location'])
		})

		it('should ignore non-high-value fields that are empty', () => {
			// GIVEN the high-value four filled and the rest of the enrichment empty
			const findings = {
				enrichment: {
					country: sourced('GB'),
					industry: sourced('retail'),
					location: sourced('London'),
					size_range: sourced('1000+'),
				},
			}
			// WHEN computed
			// THEN only high-value fields are ever searched, so nothing is returned
			expect(needsPerFieldSearch(findings)).toEqual([])
		})
	})

	describe('when findings have no enrichment block', () => {
		it('should return all high-value fields', () => {
			// GIVEN a degenerate findings object with nothing filled
			// WHEN computed
			// THEN every high-value field is a search candidate
			expect(needsPerFieldSearch({})).toEqual([...HIGH_VALUE_FIELDS])
			expect(needsPerFieldSearch(null)).toEqual([...HIGH_VALUE_FIELDS])
		})
	})
})

describe('perFieldSearchQuery', () => {
	describe('when a city was queried', () => {
		it('should quote the name and include the city and the field intent', () => {
			// GIVEN a company name, a city, and the size field
			// WHEN the query is built
			// THEN it phrases a focused search
			expect(perFieldSearchQuery('Acme Corp', 'Barcelona', 'size_range')).toBe(
				'"Acme Corp" Barcelona number of employees',
			)
		})
	})

	describe('when no city was queried', () => {
		it('should omit the city and trim the name', () => {
			// GIVEN a padded name, no city, and the country field
			expect(perFieldSearchQuery('  Acme Corp  ', undefined, 'country')).toBe(
				'"Acme Corp" head office country',
			)
		})
	})

	describe('when the field has no known intent', () => {
		it('should fall back to the raw field name', () => {
			// GIVEN a field with no phrasing mapped
			expect(perFieldSearchQuery('Acme', undefined, 'current_tools')).toBe(
				'"Acme" current_tools',
			)
		})
	})
})

describe('mergePerFieldSearch', () => {
	describe('when the re-extraction recovered an empty field', () => {
		it('should fill only the empty high-value fields and count them', () => {
			// GIVEN findings with country empty and industry already grounded
			const findings = {
				enrichment: {
					industry: sourced('manufacturing'),
					country: { value: null },
				},
			}
			// AND a refreshed extraction that now carries a country and a different industry
			const refreshed = {
				enrichment: {
					industry: sourced('logistics'),
					country: sourced('ES'),
				},
			}
			// WHEN merged
			const { findings: next, filled } = mergePerFieldSearch(
				findings,
				refreshed,
			)
			// THEN the empty country is filled but the grounded industry is untouched
			expect(filled).toBe(1)
			const enrichment = (next as { enrichment: Record<string, unknown> })
				.enrichment
			expect(enrichment['country']).toEqual(sourced('ES'))
			expect(enrichment['industry']).toEqual(sourced('manufacturing'))
		})
	})

	describe('when the re-extraction recovered nothing', () => {
		it('should return the findings unchanged with a zero count', () => {
			// GIVEN findings with country already filled
			const findings = { enrichment: { country: sourced('ES') } }
			// AND a refreshed extraction with no enrichment block
			// WHEN merged
			const { findings: next, filled } = mergePerFieldSearch(findings, {})
			// THEN nothing is filled and the same findings come back
			expect(filled).toBe(0)
			expect(next).toBe(findings)
		})
	})

	describe('when the pages this round fetched name people', () => {
		it('should carry the new contacts across and count them', () => {
			// GIVEN findings that named one person
			const findings = {
				enrichment: { country: sourced('ES') },
				contacts: [{ name: 'Anna Puig', role: sourced('CEO') }],
			}
			// AND a re-extraction that names her again plus someone new
			const refreshed = {
				enrichment: { country: sourced('ES') },
				contacts: [
					{ name: 'Anna Puig', role: sourced('CEO') },
					{ name: 'Marc Vila', role: sourced('Operations Manager') },
				],
			}

			// WHEN merged
			const { findings: next, contactsChanged } = mergePerFieldSearch(
				findings,
				refreshed,
			)

			// THEN the second person is kept, the first not duplicated
			expect(contactsChanged).toBe(true)
			const contacts = (next as { contacts: ReadonlyArray<{ name: string }> })
				.contacts
			expect(contacts.map(contact => contact.name)).toEqual([
				'Anna Puig',
				'Marc Vila',
			])
		})

		it('should keep a person the re-extraction no longer names', () => {
			// GIVEN a person found earlier whom the fresh pass missed
			const findings = {
				enrichment: { country: sourced('ES') },
				contacts: [{ name: 'Anna Puig', role: sourced('CEO') }],
			}
			const refreshed = { enrichment: { country: sourced('ES') }, contacts: [] }

			// WHEN merged — THEN a second look never loses somebody
			const { findings: next, contactsChanged } = mergePerFieldSearch(
				findings,
				refreshed,
			)
			expect(contactsChanged).toBe(false)
			expect(next).toBe(findings)
		})

		it('should keep a title the second look put on someone already named', () => {
			// GIVEN a person found earlier whose job title was never established
			const findings = {
				enrichment: { country: sourced('ES') },
				contacts: [{ name: 'Anna Puig' }],
			}
			// AND a re-extraction that reads her title off the team page
			const refreshed = {
				enrichment: { country: sourced('ES') },
				contacts: [{ name: 'Anna Puig', role: sourced('CEO') }],
			}

			// WHEN merged
			const { findings: next, contactsChanged } = mergePerFieldSearch(
				findings,
				refreshed,
			)

			// THEN the title is kept, even though the list is exactly as long as it
			// was — a title is the whole reason for opening a team page, and counting
			// people alone would throw it away
			expect(contactsChanged).toBe(true)
			const contacts = (
				next as { contacts: ReadonlyArray<{ role?: { value: string } }> }
			).contacts
			expect(contacts[0]?.role?.value).toBe('CEO')
		})
	})
})
