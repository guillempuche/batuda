import { describe, expect, it } from 'vitest'

import {
	genericAtFor,
	hostOf,
	nameOverlap,
	nameTokens,
	tokenWeight,
} from './company-duplicates'

describe('nameTokens', () => {
	describe('when the name carries a company form', () => {
		it('should drop it', () => {
			// GIVEN two different firms that share only "SL"
			// WHEN their names are broken into words
			// THEN the company form is gone, so "Puig SL" and "Ferré SL" cannot read
			//      as a half match on the strength of being companies
			expect(nameTokens('Transports Puig SL')).toEqual(['transports', 'puig'])
			expect(nameTokens('Acme Ltd.')).toEqual(['acme'])
		})
	})

	describe('when the same name is written differently', () => {
		it('should produce the same words once punctuation is set aside', () => {
			expect(nameTokens('Ferré & Fills')).toEqual(['ferre', 'fills'])
		})

		it('should leave a joining word to lose its own weight', () => {
			// GIVEN "Ferré i Fills" and "Ferré & Fills" are one company written two
			// ways. The extra "i" is a real word here, so it is not dropped by hand —
			// a joining word appears in so many names that it wears down to nothing,
			// which is the same answer without a list of words to maintain.
			expect(nameTokens('Ferré i Fills')).toEqual(['ferre', 'i', 'fills'])
			const worthless = (token: string) => (token === 'i' ? 0 : 1)
			expect(
				nameOverlap(
					nameTokens('Ferré i Fills'),
					nameTokens('Ferré & Fills'),
					worthless,
				),
			).toBe(1)
		})
	})

	describe('when the name is not written in Latin letters', () => {
		it('should still produce words to compare', () => {
			// GIVEN a Japanese company name
			// WHEN it is broken into words
			// THEN there is something left to compare, so duplicate detection reaches
			//      companies a Latin-only rule would leave with no words at all
			expect(nameTokens('物流 株式会社').length).toBeGreaterThan(0)
		})
	})
})

describe('tokenWeight', () => {
	describe('when only one company uses the word', () => {
		it('should count for everything', () => {
			// GIVEN a word no other company in the organisation uses
			// WHEN it is weighed
			// THEN it carries the whole signal — it identifies that company alone
			expect(tokenWeight(1, 5)).toBe(1)
		})
	})

	describe('when the whole organisation names things that way', () => {
		it('should count for nothing', () => {
			// GIVEN 40 of 300 companies are "Transports something"
			// WHEN the shared word is weighed
			// THEN it is worth nothing: it says how this organisation names things,
			//      not which of them this is
			expect(tokenWeight(40, genericAtFor(300))).toBe(0)
		})
	})

	describe('when a few companies share the word', () => {
		it('should count for less, but not nothing', () => {
			// GIVEN three companies of three hundred share it
			// WHEN it is weighed
			// THEN it fades rather than switching off, so three copies of one company
			//      degrade the word instead of blinding the check
			const weight = tokenWeight(3, genericAtFor(300))
			expect(weight).toBeGreaterThan(0)
			expect(weight).toBeLessThan(1)
		})
	})

	describe('when the organisation is tiny', () => {
		it('should still leave room for a word to be shared once', () => {
			// GIVEN an organisation of three companies
			// WHEN the point at which a word turns generic is worked out
			// THEN it never drops below five, so two companies sharing a word does
			//      not immediately make that word worthless
			expect(genericAtFor(3)).toBe(5)
			expect(tokenWeight(2, genericAtFor(3))).toBeGreaterThan(0)
		})
	})
})

describe('nameOverlap', () => {
	const distinctive = () => 1

	describe('when the same company is written two ways', () => {
		it('should account for the whole name', () => {
			// GIVEN "Acme" being added while "Acme SL" is already on file
			// WHEN the two are compared
			// THEN the existing one accounts for all of the new name
			expect(
				nameOverlap(nameTokens('Acme'), nameTokens('Acme SL'), distinctive),
			).toBe(1)
		})
	})

	describe('when two companies share only a word the org uses everywhere', () => {
		it('should account for none of it', () => {
			// GIVEN "transports" has been worn down to nothing by a freight CRM
			// WHEN two different hauliers are compared
			// THEN nothing of the name is accounted for, so neither is reported as
			//      the other
			const weightOf = (token: string) => (token === 'transports' ? 0 : 1)
			expect(
				nameOverlap(
					nameTokens('Transports Ferré'),
					nameTokens('Transports Puig'),
					weightOf,
				),
			).toBe(0)
		})
	})

	describe('when the incoming name has no words left', () => {
		it('should not divide by zero', () => {
			// GIVEN a name that was nothing but a company form, leaving no words
			// WHEN it is compared against anything
			// THEN the answer is none of it, rather than a division by zero
			expect(nameOverlap([], nameTokens('Acme'), distinctive)).toBe(0)
		})
	})
})

describe('hostOf', () => {
	describe('when a website is written in the several ways people write one', () => {
		it('should reduce them to the same host', () => {
			// GIVEN the same site written with and without a scheme, www, a path and
			// stray capitals and spaces
			// WHEN each is reduced to its host
			// THEN they are one value, so "the same website" is a usable signal
			for (const written of [
				'https://www.acme.co.uk/about',
				'http://acme.co.uk',
				'acme.co.uk',
				'  WWW.ACME.CO.UK/  ',
			]) {
				expect(hostOf(written), written).toBe('acme.co.uk')
			}
		})
	})

	describe('when the value could not be a website', () => {
		it('should give nothing back', () => {
			// GIVEN prose or an empty value where a website was expected
			// WHEN a host is asked for
			// THEN there is none, rather than a made-up one that could match another
			//      company by accident
			expect(hostOf('not a website')).toBeUndefined()
			expect(hostOf('')).toBeUndefined()
		})
	})
})

describe('nameTokens — names written without spaces between their words', () => {
	describe('when a company writes its legal form joined to its name', () => {
		it('should drop the form wherever it is written', () => {
			// GIVEN one Japanese company written three ways: form at the front, form at
			// the back, and no form at all
			// WHEN each is read for the words worth comparing
			// THEN all three come back as the same word. Japanese writes the form at
			// either end, and left in it is the only thing two unrelated companies
			// would share
			expect(nameTokens('株式会社山田電気')).toEqual(['山田電気'])
			expect(nameTokens('山田電気株式会社')).toEqual(['山田電気'])
			expect(nameTokens('山田電気')).toEqual(['山田電気'])
		})

		it('should let two spellings of one company meet', () => {
			// GIVEN a Chinese company written with and without its legal form
			// WHEN both are read
			// THEN they share a word. Splitting on spaces alone gave one whole-name
			// word for each, so these shared nothing and the pair was never raised for
			// review — the very thing this check exists to do
			expect(nameTokens('北京物流有限公司')).toEqual(nameTokens('北京物流'))
		})
	})

	describe('when the name is nothing but a legal form', () => {
		it('should keep no words at all', () => {
			// GIVEN a name carrying only the form
			// WHEN read
			// THEN nothing is left. A form names no company, so two rows sharing only
			// this must not read as a match
			expect(nameTokens('株式会社')).toEqual([])
			expect(nameTokens('有限公司')).toEqual([])
		})
	})

	describe('when the form is a separate word, as Korean and Russian write it', () => {
		it('should drop it like any other company-form word', () => {
			// GIVEN Korean and Russian names carrying their form as its own word
			// WHEN read
			// THEN the form is gone and the company's own name is what is left
			expect(nameTokens('삼성전자 주식회사')).toEqual(['삼성전자'])
			expect(nameTokens('ООО Логистика Плюс')).toEqual(['логистика', 'плюс'])
		})
	})
})
