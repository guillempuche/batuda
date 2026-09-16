import { describe, expect, it } from 'vitest'

import { personName, readsAsPersonName } from './contact-name'

describe('readsAsPersonName', () => {
	describe('when given a plain two-word Latin name', () => {
		it('should read as a person', () => {
			// GIVEN a first and last name
			// WHEN checked
			// THEN it passes
			expect(readsAsPersonName('Ana Puig')).toBe(true)
		})
	})

	describe('when the name has a non-breaking hyphen', () => {
		it('should still read as a person', () => {
			// GIVEN a hyphenated first name using U+2011 (non-breaking hyphen)
			// WHEN checked
			// THEN the hyphen splits it into letter runs the same as a plain one
			expect(readsAsPersonName('Jean‑Claude Viers')).toBe(true)
		})
	})

	describe('when the name carries a diacritic', () => {
		it('should still read as a person', () => {
			expect(readsAsPersonName('Anaïs Solà')).toBe(true)
		})
	})

	describe('when the name carries an honorific', () => {
		it('should still read as a person', () => {
			// GIVEN a title in front of a real two-word name
			expect(readsAsPersonName('Dr. Ana Puig')).toBe(true)
		})
	})

	describe('when the name is a single word', () => {
		it('should fail', () => {
			// GIVEN a testimonial's bare first name
			expect(readsAsPersonName('Ana')).toBe(false)
		})
	})

	describe('when the name carries a bracketed aside', () => {
		it('should fail once the aside is stripped down to one word', () => {
			// GIVEN a first name with a role/place aside, as scraped from a
			// testimonial page
			expect(readsAsPersonName('Stéphane (Cutting‑folding, Bordeaux)')).toBe(
				false,
			)
		})
	})

	describe('when the value is an email address', () => {
		it('should fail', () => {
			expect(readsAsPersonName('info@acme.es')).toBe(false)
			expect(readsAsPersonName('pgimenez@tous.com')).toBe(false)
		})
	})

	describe('when the value is a phone number', () => {
		it('should fail, with or without punctuation', () => {
			expect(readsAsPersonName('+34 935 603 166')).toBe(false)
			expect(readsAsPersonName('935603166')).toBe(false)
		})
	})

	describe('when the value is a bare domain', () => {
		it('should fail', () => {
			expect(readsAsPersonName('acme.es')).toBe(false)
		})
	})

	describe('when the value is empty', () => {
		it('should fail', () => {
			expect(readsAsPersonName('')).toBe(false)
		})
	})

	describe('when the name is written in a script with no word spaces', () => {
		it('should pass on its own terms', () => {
			// GIVEN a Chinese name, which has no spaces to count tokens by
			expect(readsAsPersonName('王小明')).toBe(true)
		})
	})

	describe('when the name is written in a non-Latin script with word spaces', () => {
		it('should pass without the two-token count', () => {
			// GIVEN Cyrillic and Arabic names
			expect(readsAsPersonName('Иван Петров')).toBe(true)
			expect(readsAsPersonName('محمد العلي')).toBe(true)
		})
	})

	describe('when the name is Korean', () => {
		it('should pass on its own terms', () => {
			expect(readsAsPersonName('김민준')).toBe(true)
		})
	})
})

describe('personName', () => {
	describe('when the name carries a bracketed aside', () => {
		it('should remove the aside and collapse the leftover whitespace', () => {
			expect(personName('Stéphane (Cutting‑folding, Bordeaux)')).toBe(
				'Stéphane',
			)
		})
	})

	describe('when the name has no aside', () => {
		it('should return it unchanged', () => {
			expect(personName('Ana Puig')).toBe('Ana Puig')
		})
	})
})

describe('readsAsPersonName, when the name is a company’s', () => {
	it('should refuse a name that ends in a legal form', () => {
		// GIVEN company names a run listed as people, and a person whose surname
		// is not a legal form
		expect(readsAsPersonName('Pronimetal S.L.')).toBe(false)
		expect(readsAsPersonName('Acme Industries GmbH')).toBe(false)
		expect(readsAsPersonName('Acme SA')).toBe(false)
		expect(readsAsPersonName('Ana Salas')).toBe(true)
		// A surname that is also a legal form's letters stays a surname when it
		// is written as a word
		expect(readsAsPersonName('Paulo Sa')).toBe(true)
		expect(readsAsPersonName('Ana Co')).toBe(true)
	})
})
