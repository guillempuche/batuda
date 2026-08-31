import { describe, expect, it } from 'vitest'

import { goldenKindOf } from './eval-scoring-market'

// What the golden file's list of "these are not companies" says about a row.
//
// The eval reads a row's name in words, and it has letters only for a-z — so a name
// written in another script leaves nothing to hold the list against. Answering "not
// one of them" there is answering a question that was never asked, and it moves the
// figure in both directions: a trade body counts as a company and the pass reports
// the precision of a list it could not read, while a real company whose only
// readable word is the place in its brackets is marked a body off that one word.

const BODIES = ['FENIE', 'Federación Nacional de Empresarios de Instalaciones']

describe('goldenKindOf', () => {
	describe('when the list names the organisation', () => {
		it('should say so, however much longer the run wrote the name', () => {
			// GIVEN a run writing a federation's name out in full
			// WHEN held against the list
			// THEN listed, since the listed name sits inside the row's own
			expect(
				goldenKindOf(
					'FENIE — Federación Nacional de Empresarios de Instalaciones',
					BODIES,
				),
			).toBe('listed')
		})
	})

	describe('when the list does not name the organisation', () => {
		it('should say so rather than reach for a word it shares', () => {
			// GIVEN an ordinary installer whose name shares a word with the list
			// WHEN held against it — THEN not listed
			expect(goldenKindOf('Instalaciones García', BODIES)).toBe('not-listed')
		})
	})

	describe('when the name is written in another alphabet', () => {
		it('should recognise the body the list names', () => {
			// GIVEN trade bodies named in four writing systems
			// WHEN each is held against a list naming that very body
			// THEN each is found. These could not be held against the list at all
			// before, so a market in any of these alphabets could be written into the
			// golden set but never actually scored by it
			for (const body of [
				'中国光伏行业协会',
				'Ассоциация Электромонтажников',
				'نقابة المقاولين',
				'일본전기공사협회',
			] as const) {
				expect(goldenKindOf(body, [body])).toBe('listed')
			}
		})

		it('should find a body written longer than the list writes it', () => {
			// GIVEN a body the run names with its legal form attached, and a list
			// carrying the plain name with a space in it
			// WHEN held against the list
			// THEN listed. Where the writing puts no space between words, the listed
			// name is looked for inside the row's rather than lined up word by word
			expect(
				goldenKindOf('一般社団法人日本電設工業協会', [
					'一般社団法人 日本電設工業協会',
				]),
			).toBe('listed')
		})

		it('should not read a body into the one word it happens to see', () => {
			// GIVEN a real Chinese company whose only Latin word is the place written
			// after it, and a list naming that place
			// WHEN held against the list
			// THEN not listed. The whole name is read now, so this is answered
			// outright rather than set aside as something that could not be read
			expect(goldenKindOf('上海某某太阳能公司 (Shanghai)', ['Shanghai'])).toBe(
				'not-listed',
			)
		})

		it('should not read a body into the legal form thousands of them share', () => {
			// GIVEN a list carrying only the legal form Japanese bodies open with
			// WHEN a real body is held against it
			// THEN not listed. Written as one run with no space, an entry is only
			// conclusive when it is the whole of what the row is called — otherwise
			// one shared prefix would mark every body and company carrying it
			expect(
				goldenKindOf('一般社団法人日本電設工業協会', ['一般社団法人']),
			).toBe('not-listed')
		})
	})

	describe('when a name is nothing but punctuation', () => {
		it('should treat it as unlisted rather than as unread', () => {
			// GIVEN a row whose name carries no letters anywhere
			// WHEN held against the list
			// THEN not listed. Nothing went unread — there was nothing written to read
			// — so it stays a company and is not counted among the rows this eval is
			// blind to, which would overstate how much it could not see
			expect(goldenKindOf('...', BODIES)).toBe('not-listed')
			expect(goldenKindOf('—', BODIES)).toBe('not-listed')
		})
	})

	describe('when there is no name at all', () => {
		it('should treat it as unlisted rather than unreadable', () => {
			// GIVEN a row with a blank name
			// WHEN held against the list
			// THEN not listed. Nothing was written, so nothing went unread — the
			// difference matters, because one is a gap in the eval and the other is
			// a gap in the row
			expect(goldenKindOf('   ', BODIES)).toBe('not-listed')
		})
	})
})
