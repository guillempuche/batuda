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

	describe('when the name is written in letters this eval does not have', () => {
		it('should say it could not be read rather than that it is a company', () => {
			// GIVEN trade bodies named in scripts the word reading has no letters for
			// WHEN each is held against a list naming that very body
			// THEN unreadable — not "not one of them". Answering the latter counted
			// each of these as a company and reported a precision nobody could trust
			for (const body of [
				'中国光伏行业协会',
				'Ассоциация Электромонтажников',
				'نقابة المقاولين',
				'일본전기공사협회',
			] as const) {
				expect(goldenKindOf(body, [body])).toBe('unreadable')
			}
		})

		it('should not read a body into the one word it happens to see', () => {
			// GIVEN a real Chinese company whose only word this reading can see is
			// the place written after it, and a list naming that place
			// WHEN held against the list
			// THEN unreadable rather than listed. Judging a name on the fragment that
			// survives the reading marked a real company as the wrong kind, which
			// overstates the very problem being measured
			expect(goldenKindOf('上海某某太阳能公司 (Shanghai)', ['Shanghai'])).toBe(
				'unreadable',
			)
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
