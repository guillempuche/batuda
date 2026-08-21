import { describe, expect, it } from 'vitest'

import { namesNobody, runWordsOf, runWroteExactly } from './run-words'

// The trades a Spanish installations request asks for, written the way the
// request itself writes them.
const INSTALLATIONS = runWordsOf([
	'instalación eléctrica',
	'fontanería',
	'ascensor',
	'energía solar',
	'gas',
])

describe('runWordsOf', () => {
	describe('when a request names its trades', () => {
		it('should read a wording as the separate words it is made of', () => {
			// GIVEN a trade written as a phrase
			// WHEN read
			// THEN each word of it stands on its own, since a company writes one of
			// them into its name without the rest
			expect([...runWordsOf(['instalación eléctrica']).words]).toEqual([
				'instalacion',
				'electrica',
			])
		})

		it('should fold accents and case away, as a name is folded', () => {
			// GIVEN the same trade written with accents and in capitals
			// WHEN read
			// THEN one word comes back, so a request and a company's name meet in one
			// spelling rather than missing each other over an accent
			expect([...runWordsOf(['Fontanería', 'FONTANERIA']).words]).toEqual([
				'fontaneria',
			])
		})

		it('should read a Catalan geminate l both ways it is written', () => {
			// GIVEN a trade written with the geminate l Catalan uses
			// WHEN read
			// THEN both spellings come back. A company's name is read both ways too,
			// and a request matched against only one of them leaves the other
			// spelling looking like a word of the company's own
			expect([...runWordsOf(['instal·lacions']).words]).toEqual([
				'installacions',
				'instalacions',
			])
		})

		it('should read a name written with the geminate as dots the same way', () => {
			// GIVEN the spelling a database that could not write the middle dot fell
			// back on
			// WHEN read — THEN it is the same two words
			expect([...runWordsOf(['instal.lacions']).words]).toEqual([
				'installacions',
				'instalacions',
			])
		})
	})

	describe('when there is nothing to read', () => {
		it('should name no trades for a request that asked for none', () => {
			// GIVEN a run about one company on file, which names no trades
			// WHEN read — THEN nothing, so every word of a name reads as its own
			expect([...runWordsOf([]).words]).toEqual([])
		})

		it('should name no trades for a wording holding no letters', () => {
			// GIVEN wordings that are empty or nothing but spaces and punctuation
			// WHEN read
			// THEN nothing comes back — an empty word would otherwise be a word every
			// name is made of
			expect([...runWordsOf(['', '   ', '—', '·']).words]).toEqual([])
		})
	})
})

describe('namesNobody', () => {
	describe('when the request wrote the word', () => {
		it('should read a word the request wrote as the trade', () => {
			// GIVEN a company word that is exactly what the request asked for
			// WHEN asked — THEN it says what the company does, not who it is
			expect(namesNobody('fontaneria', INSTALLATIONS)).toBe(true)
		})

		it('should reach the word with an ending on it', () => {
			// GIVEN a request for "ascensor" and a firm called "Ascensores"
			// WHEN asked
			// THEN the ending is read past, because Spanish, Catalan and French put
			// one on every word of a phrase and no request writes them all out
			expect(namesNobody('ascensores', INSTALLATIONS)).toBe(true)
			expect(namesNobody('solares', INSTALLATIONS)).toBe(true)
		})

		it("should reach two letters past the request's word and no further", () => {
			// GIVEN one word two letters longer than the request's and one three
			// letters longer
			// WHEN each is asked
			// THEN only the first is an ending. Past that a firm has coined a name of
			// its own that happens to open the same way
			expect(namesNobody('solares', INSTALLATIONS)).toBe(true)
			expect(namesNobody('solarock', INSTALLATIONS)).toBe(false)
		})

		it('should leave a coined name that merely opens with a trade word', () => {
			// GIVEN the two firms a market search met whose names open with "solar"
			// WHEN each is asked
			// THEN neither is the trade. Reading them as one would leave those firms
			// with no word of their own at all, and no domain able to spell them
			expect(namesNobody('solarock', INSTALLATIONS)).toBe(false)
			expect(namesNobody('solartec', INSTALLATIONS)).toBe(false)
		})
	})

	describe("when the request's word is short", () => {
		it('should spell a short word whole', () => {
			// GIVEN a three-letter trade the request asked for
			// WHEN the word itself is asked — THEN it is the trade
			expect(namesNobody('gas', INSTALLATIONS)).toBe(true)
		})

		it('should not read a short word as the opening of a longer one', () => {
			// GIVEN a family name that opens with that three-letter trade
			// WHEN asked
			// THEN it is not the trade: three letters open far too many unrelated
			// words to be read as an opening
			expect(namesNobody('gasol', INSTALLATIONS)).toBe(false)
		})
	})

	describe('when there is nothing to compare', () => {
		it('should name no trade when the run asked for none', () => {
			// GIVEN a run that named no trades
			// WHEN any word is asked — THEN nothing is a trade, so every word of a
			// name is left standing as the company's own
			expect(namesNobody('fontaneria', runWordsOf([]))).toBe(false)
		})

		it('should name no trade for a word with nothing in it', () => {
			// GIVEN an empty word
			// WHEN asked — THEN no, so an empty run of letters cannot be read as
			// every trade at once
			expect(namesNobody('', INSTALLATIONS)).toBe(false)
		})

		it('should not read a word shorter than the trade as that trade', () => {
			// GIVEN the opening of a trade word rather than the word
			// WHEN asked — THEN no: the request's word has to be spelled, not started
			expect(namesNobody('fon', INSTALLATIONS)).toBe(false)
		})
	})
})

describe('runWroteExactly', () => {
	describe('when a run of letters might be a word', () => {
		it('should say yes only to the word the request wrote', () => {
			// GIVEN the trade exactly as the request wrote it
			// WHEN asked — THEN yes
			expect(runWroteExactly('fontaneria', INSTALLATIONS)).toBe(true)
		})

		it('should refuse the same word with an ending on it', () => {
			// GIVEN the trade with an ending, which `namesNobody` does read
			// WHEN asked here — THEN no. This is asked of the front of a domain,
			// where nothing says where the first word ends, so an ending offered
			// here is really the first letters of the name behind it
			expect(namesNobody('ascensores', INSTALLATIONS)).toBe(true)
			expect(runWroteExactly('ascensores', INSTALLATIONS)).toBe(false)
		})

		it("should refuse the trade with the next word's first letter stuck to it", () => {
			// GIVEN a domain's opening letters, which are the trade plus the start of
			// the company name after it
			// WHEN asked
			// THEN no — reading it as the trade would cut fontaneriagarcia.es one
			// letter too deep and never find García underneath
			expect(runWroteExactly('fontaneriag', INSTALLATIONS)).toBe(false)
		})
	})
})

describe('the words a run brings and the ones it was asked for', () => {
	describe('when a run brings words for a kind of company beside its trades', () => {
		it('should read both as identifying nobody', () => {
			// GIVEN a run whose request named a trade and whose splitter gave the
			// market's words for a kind of company
			// WHEN each is asked
			// THEN both identify nobody, because the two answer the same question
			const words = runWordsOf(['fontanería'], ['grup', 'serveis'])
			expect(namesNobody('fontaneria', words)).toBe(true)
			expect(namesNobody('grup', words)).toBe(true)
			expect(namesNobody('puig', words)).toBe(false)
		})

		it('should let only the words the request wrote come off a domain', () => {
			// GIVEN the same run
			// WHEN asked which words a domain may be cut at
			// THEN only the ones the request itself wrote. The rest come from a
			// model reading a language rather than from anything a person typed, so
			// they are spent on withholding and never on reaching a name
			const words = runWordsOf(['fontanería'], ['grup', 'serveis'])
			expect(runWroteExactly('fontaneria', words)).toBe(true)
			expect(runWroteExactly('grup', words)).toBe(false)
		})
	})
})
