import { describe, expect, it } from 'vitest'

import { anyTermAppearsIn, readText, termTokens } from './term-match'

// The reading that decides whether a run answered a part of what it was asked.
// A term that produces no words is refused by every caller here, so a writing
// system this could not read was not measured badly — it was not measured, and
// the run reported the part uncovered however good an answer it had found.

describe('termTokens', () => {
	describe('when a wording is written with word spaces', () => {
		it('should give one word per word, whatever the writing system', () => {
			// GIVEN the same trade written in five writing systems that space words
			// WHEN read
			// THEN each gives its own words rather than nothing
			expect(termTokens('instalacion electrica')).toEqual([
				'instalacion',
				'electrica',
			])
			expect(termTokens('Логистика Плюс')).toEqual(['логистика', 'плюс'])
			expect(termTokens('Μεταφορές Αθηνών')).toEqual(['μεταφορες', 'αθηνων'])
			expect(termTokens('شركة السباكة')).toEqual(['شركة', 'السباكة'])
			expect(termTokens('삼성전자 주식회사')).toEqual(['삼성전자', '주식회사'])
		})
	})

	describe('when a letter stands for plain letters a company spells it with', () => {
		it('should write it out rather than cut the word in half', () => {
			// GIVEN names carrying a letter that is not a-z and is not a marked a-z
			// WHEN read
			// THEN the letter is written as what the company registers its address
			// with, instead of being dropped as punctuation and splitting the word
			expect(termTokens('Straße')).toEqual(['strasse'])
			expect(termTokens('Bjørn Larsen')).toEqual(['bjorn', 'larsen'])
			expect(termTokens('Łukasz')).toEqual(['lukasz'])
		})
	})

	describe('when a wording carries accents', () => {
		it('should read it the same as the same wording without them', () => {
			// GIVEN one trade typed with accents and without
			// WHEN both are read
			// THEN they give the same words
			expect(termTokens('Instalación eléctrica')).toEqual(
				termTokens('instalacion electrica'),
			)
		})
	})

	describe('when a wording has no letters or digits at all', () => {
		it('should give no words, so a caller can refuse it', () => {
			// GIVEN wordings made only of punctuation, and an empty one
			// WHEN read
			// THEN nothing comes back. This is the one case callers refuse, and it has
			// to stay reachable or a blank term would silently measure nothing
			expect(termTokens('·')).toEqual([])
			expect(termTokens('— / —')).toEqual([])
			expect(termTokens('')).toEqual([])
		})
	})
})

describe('anyTermAppearsIn', () => {
	describe('when a term and a page are written with word spaces', () => {
		it('should match a whole word, and a long word as an opening', () => {
			// GIVEN a page naming a trade with a longer ending than the term
			const page = [readText('Empresa de instalaciones eléctricas en Girona')]

			// WHEN asked about a term long enough for its endings to be its own
			// THEN it matches, because Spanish and Catalan put an ending on every word
			expect(anyTermAppearsIn(['instalacion electrica'], page)).toBe(true)
		})

		it('should refuse a short word that is only the opening of another', () => {
			// GIVEN a page about spending, not about gas
			const page = [readText('control de gasto mensual')]

			// WHEN asked about a short term
			// THEN no match: a three-letter word opens far too many unrelated ones
			expect(anyTermAppearsIn(['gas'], page)).toBe(false)
		})
	})

	describe('when a term is written in a system that runs its words together', () => {
		it('should find it inside the page rather than asking for a word', () => {
			// GIVEN pages written in Chinese, Japanese and Thai, which put no space
			// between one word and the next
			const chinese = [readText('北京物流有限公司提供货运服务')]
			const japanese = [readText('東京の配管工事会社です')]
			const thai = [readText('บริษัทรับเหมาก่อสร้างในกรุงเทพ')]

			// WHEN asked about a trade written the same way
			// THEN each is found. Asking these for a whole word asks for something the
			// writing does not have, which is why every one of them missed before
			expect(anyTermAppearsIn(['物流'], chinese)).toBe(true)
			expect(anyTermAppearsIn(['配管工事'], japanese)).toBe(true)
			expect(anyTermAppearsIn(['ก่อสร้าง'], thai)).toBe(true)
		})

		it('should still say no when the trade is not on the page', () => {
			// GIVEN a Chinese page about logistics
			const page = [readText('北京物流有限公司提供货运服务')]

			// WHEN asked about an unrelated trade
			// THEN no match — reading by run of characters still has to be wrong
			// sometimes, or it would report every part answered
			expect(anyTermAppearsIn(['牙科诊所'], page)).toBe(false)
		})

		it('should ignore a run of one character, which names nothing', () => {
			// GIVEN a Chinese page
			const page = [readText('北京物流有限公司提供货运服务')]

			// WHEN asked about a single character that does appear in it
			// THEN no match. One character is a piece of too many unrelated words to
			// say what a page is about, and reporting the part uncovered costs a
			// search rather than claiming an answer nobody gave
			expect(anyTermAppearsIn(['公'], page)).toBe(false)
		})
	})

	describe('when a page mixes writing systems', () => {
		it('should read each term by its own writing rather than the pages', () => {
			// GIVEN one page carrying a Chinese name beside Spanish prose
			const page = [readText('北京物流有限公司 — logistica y transporte')]

			// WHEN asked about a term in each
			// THEN both are found, because which reading applies is decided by the
			// term and not by whatever else the page happens to hold
			expect(anyTermAppearsIn(['物流'], page)).toBe(true)
			expect(anyTermAppearsIn(['logistica'], page)).toBe(true)
		})
	})

	describe('when a term has no words in it', () => {
		it('should match nothing rather than everything', () => {
			// GIVEN a term of punctuation alone
			const page = [readText('北京物流有限公司')]

			// WHEN asked
			// THEN no match. An empty reading matching every page is how a part with a
			// blank term would read answered by rows nobody checked
			expect(anyTermAppearsIn(['·'], page)).toBe(false)
			expect(anyTermAppearsIn([''], page)).toBe(false)
		})
	})

	describe('when there are no texts to look in', () => {
		it('should say no rather than fail', () => {
			// GIVEN no rows came back
			// WHEN asked whether a part was answered
			// THEN no — an empty list of rows answers nothing
			expect(anyTermAppearsIn(['物流'], [])).toBe(false)
		})
	})
})

describe('Korean, which is written from pieces joined into letters', () => {
	describe('when a Korean name is read', () => {
		it('should come back as its letters rather than the pieces they are built from', () => {
			// GIVEN a Korean company name
			// WHEN read
			// THEN the words are the letters somebody typing the name would produce.
			// Taking accents off pulls every letter apart first, and a Korean letter
			// left in pieces matches nothing but another copy of itself
			expect(termTokens('서울')).toEqual(['서울'])
			expect(termTokens('삼성전자 주식회사')).toEqual(['삼성전자', '주식회사'])
		})

		it('should find a Korean trade on a Korean page', () => {
			// GIVEN a Korean page and a Korean trade
			// WHEN asked
			// THEN found, which needs both sides put back together the same way
			expect(anyTermAppearsIn(['물류'], [readText('서울 물류 주식회사')])).toBe(
				true,
			)
		})
	})
})

describe('a term and a page that disagree about where the space goes', () => {
	describe('when either side writes two words joined', () => {
		it('should match whichever way round it is written', () => {
			// GIVEN the same Japanese wording, once with a space and once without, on
			// both the asking side and the page side
			// WHEN each is asked about the other
			// THEN all four match. Either side could be the one carrying the space, so
			// a reading that only stripped the term would answer one way round
			expect(
				anyTermAppearsIn(['物流 倉庫'], [readText('物流倉庫の管理')]),
			).toBe(true)
			expect(
				anyTermAppearsIn(['物流倉庫'], [readText('物流 倉庫 の管理')]),
			).toBe(true)
		})
	})
})
