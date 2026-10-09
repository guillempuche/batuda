import { describe, expect, it } from 'vitest'

import { looksLikeRegistrationNumber } from './registration-number'

describe('looksLikeRegistrationNumber', () => {
	describe('when the value is a number a register writes', () => {
		it.each([
			['a Spanish CIF', 'B12345678'],
			['a Spanish CIF with the country prefix', 'ESB12345678'],
			['a Spanish NIF', '12345678Z'],
			['a UK company number', '01234567'],
			['a French SIREN written in groups', '552 100 554'],
			['a French SIREN with its court', 'RCS Paris B 552 100 554'],
			['a German commercial-register entry', 'HRB 12345 B'],
			[
				'a German entry with its court written out',
				'Amtsgericht München HRB 123456',
			],
			[
				'a German entry under a court with a long name',
				'Amtsgericht Charlottenburg HRB 12345 B',
			],
			[
				'a German entry under a court of three words',
				'AG Frankfurt am Main HRB 12345',
			],
			[
				'a French entry under a hyphenated town',
				'RCS Aix-en-Provence B 552 100 554',
			],
			['a UK number with its register named', 'Companies House 01234567'],
			['a Dutch number', 'KvK-nummer 12345678'],
			['an Italian VAT number with its words', 'Partita IVA 01234567890'],
			[
				'an accented town written in decomposed form',
				'Amtsgericht Mu\u0308nchen HRB 123456',
			],
			['an Italian fiscal number', 'IT01234567890'],
			['a Portuguese fiscal number', '501 234 567'],
			['a number with blank space around it', '  B12345678  '],
		])('should accept %s', (_label, value) => {
			// GIVEN a value with digits at its heart and at most a short prefix
			// THEN it may be written into the field
			expect(looksLikeRegistrationNumber(value)).toBe(true)
		})
	})

	describe('when the value is a name or a sentence', () => {
		it.each([
			[
				'a legal name with no digits',
				'INGENIERÍA Y GESTIÓN De ESPACIOS INDUSTRIALES, SL',
			],
			['a legal name carrying a year', 'Construcciones 2000 SL'],
			['a legal name beside its number', 'Espacios Industriales SL B17000000'],
			['a sentence that names the number', 'the CIF is B12345678 as printed'],
			[
				'a register line with the town and the volume',
				'Registro Mercantil de Barcelona, tomo 45678',
			],
			['an empty value', ''],
			['blank space only', '   '],
			['a street number', 'C/ Anoia 12'],
		])('should refuse %s', (_label, value) => {
			// GIVEN a value with too few digits, or too many letters beside them
			// THEN it is not a registration number, whatever the page said
			expect(looksLikeRegistrationNumber(value)).toBe(false)
		})

		it.each([
			['a telephone number with a plus', '+34 93 123 45 67'],
			['a telephone number with its word', 'Tel. 931234567'],
			['an ISO date', '2023-01-15'],
			['a date with slashes', '15/01/2023'],
			['a bank account', 'ES91 2100 0418 4502 0005 1332'],
			['a bank account with its word', 'IBAN ES9121000418450200051332'],
			['an email address', 'info12345@acme.example'],
			['a street address', 'Calle Mayor 12, 08001 Barcelona'],
			['a postcode line', 'CP 08001 Barcelona'],
			['a street written short', 'C/ Anoia 12, 08700'],
		])(
			"should refuse %s, whose digits are not a register's",
			(_label, value) => {
				// GIVEN a line a page writes with digits in it that is not a register entry
				// THEN its own shape refuses it before the counts are taken
				expect(looksLikeRegistrationNumber(value)).toBe(false)
			},
		)

		it('should accept exactly five digits and refuse four', () => {
			// GIVEN the fewest digits a register writes, and one fewer
			expect(looksLikeRegistrationNumber('12345')).toBe(true)
			expect(looksLikeRegistrationNumber('1234')).toBe(false)
		})

		it('should accept three words of letters around the number and refuse four', () => {
			// GIVEN a court of three words, and one of four
			expect(looksLikeRegistrationNumber('Frankfurt am Main 12345')).toBe(true)
			expect(looksLikeRegistrationNumber('Frankfurt am Main Oder 12345')).toBe(
				false,
			)
		})

		it('should refuse a value longer than any register writes', () => {
			// GIVEN a real number followed by the whole legal notice line
			const value = 'B12345678 inscrita en el Registro Mercantil de Barcelona'
			// THEN its length alone refuses it
			expect(looksLikeRegistrationNumber(value)).toBe(false)
		})
	})
})
