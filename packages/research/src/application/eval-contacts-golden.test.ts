import { describe, expect, it } from 'vitest'

import {
	parseContactGoldenRow,
	parseContactGoldenSet,
	type RawContactGoldenRow,
} from './eval-contacts-golden'

const row = (over: Partial<RawContactGoldenRow>): RawContactGoldenRow => ({
	id: 'acme',
	companyName: 'Acme SL',
	domain: 'acme.example',
	expectedContacts: [
		{ name: 'Ada Lovelace', role: 'CEO', email: 'ada@acme.example' },
	],
	...over,
})

describe('parseContactGoldenRow', () => {
	describe('when the row is well-formed', () => {
		it('should keep the company, country, and contacts', () => {
			// GIVEN a complete row with a country
			const result = parseContactGoldenRow(row({ country: 'ES' }))
			// THEN it parses into the typed expectation
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value.companyName).toBe('Acme SL')
				expect(result.value.country).toBe('ES')
				expect(result.value.expectedContacts).toHaveLength(1)
				expect(result.value.expectedContacts[0]?.email).toBe('ada@acme.example')
			}
		})

		it('should omit an all-whitespace country rather than carry a blank one', () => {
			// GIVEN a country that is only whitespace
			const result = parseContactGoldenRow(row({ country: '  ' }))
			// THEN the optional field is dropped
			expect(result.ok).toBe(true)
			if (result.ok) expect(result.value.country).toBeUndefined()
		})

		it('should keep a name-only contact (the email is verified later)', () => {
			// GIVEN a contact the curator knows by name but not address
			const result = parseContactGoldenRow(
				row({ expectedContacts: [{ name: 'Bo Jones' }] }),
			)
			// THEN it is kept with no email
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value.expectedContacts[0]?.name).toBe('Bo Jones')
				expect(result.value.expectedContacts[0]?.email).toBeUndefined()
			}
		})
	})

	describe('when the company fields are missing', () => {
		it('should reject an empty domain with a reason', () => {
			// GIVEN a row with no domain
			const result = parseContactGoldenRow(row({ domain: '' }))
			// THEN it fails loudly rather than scoring against a company it cannot reach
			expect(result).toEqual({ ok: false, error: 'domain is empty' })
		})

		it('should reject an all-whitespace company name', () => {
			// GIVEN a blank company name
			const result = parseContactGoldenRow(row({ companyName: '   ' }))
			// THEN it is rejected
			expect(result).toEqual({ ok: false, error: 'companyName is empty' })
		})
	})

	describe('when the contacts are malformed', () => {
		it('should reject an empty contact list', () => {
			// GIVEN a company with no known contacts to score against
			const result = parseContactGoldenRow(row({ expectedContacts: [] }))
			// THEN it fails — an empty answer key scores nothing
			expect(result).toEqual({
				ok: false,
				error: 'expectedContacts must be a non-empty array',
			})
		})

		it('should reject a contact with no name', () => {
			// GIVEN a contact missing the name recall matches on
			const result = parseContactGoldenRow(
				row({ expectedContacts: [{ role: 'CEO' }] }),
			)
			// THEN it fails
			expect(result).toEqual({ ok: false, error: 'a contact has no name' })
		})

		it('should reject a non-string email', () => {
			// GIVEN a contact whose email is the wrong type
			const result = parseContactGoldenRow(
				row({ expectedContacts: [{ name: 'Ada', email: 42 }] }),
			)
			// THEN it fails rather than mis-scoring precision
			expect(result).toEqual({
				ok: false,
				error: 'a contact email must be a string',
			})
		})
	})
})

describe('parseContactGoldenSet', () => {
	describe('when some rows are bad', () => {
		it('should keep the good rows and collect a reason per bad one', () => {
			// GIVEN one valid row and one with no domain
			const { golden, errors } = parseContactGoldenSet([
				row({ id: 'good' }),
				row({ id: 'bad', domain: '' }),
			])
			// THEN the good row survives and the bad one is reported, not silently dropped
			expect(golden.map(g => g.id)).toEqual(['good'])
			expect(errors).toEqual([{ id: 'bad', error: 'domain is empty' }])
		})
	})
})
