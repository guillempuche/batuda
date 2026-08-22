import { describe, expect, it } from 'vitest'

import { isReplySubject, withReplyPrefix } from './subject'

// One rule, read by the server when it sends and by the web app when it fills
// the compose window. They each had their own copy before and the copies
// disagreed: a subject written "Re : quote" was left alone by one and stacked
// into "Re: Re : quote" by the other.

describe('isReplySubject', () => {
	describe('when the subject already answers something', () => {
		it('should recognise every spelling mail clients write', () => {
			// GIVEN the prefix as it actually arrives
			// WHEN each is judged
			// THEN all of them count as a reply
			// AND "Re :" is the French-typography one the copies disagreed on
			for (const subject of [
				'Re: quote',
				're: quote',
				'RE: quote',
				'rE: quote',
				'Re : quote',
				'Re\t: quote',
				'  Re: quote',
				'Re:',
			]) {
				expect(isReplySubject(subject)).toBe(true)
			}
		})

		it('should recognise the prefix in the languages clients write it in', () => {
			// GIVEN the same marker as a German, Dutch, Scandinavian or Polish
			// client writes it
			// WHEN each is judged
			// THEN all count as replies
			// AND otherwise each gets an English prefix stacked on top of it,
			// and each slips past the check that refuses a reply answering
			// nothing — the shape a spam filter reads as forged
			for (const subject of [
				'AW: Angebot',
				'aw: Angebot',
				'Antw: offerte',
				'SV: offert',
				'Odp: oferta',
			]) {
				expect(isReplySubject(subject)).toBe(true)
			}
		})
	})

	describe('when the marker doubles as an ordinary word', () => {
		it('should leave it alone rather than refuse a real message', () => {
			// GIVEN markers some clients do write, which also read as plain text
			// WHEN each is judged
			// THEN none counts as a reply
			// AND that is the deliberate trade: counting these would refuse
			// somebody's real message, which costs more than missing a prefix
			// that is rare in the languages this writes to anyway
			for (const subject of ['R: Barcelona', 'VS: Barcelona']) {
				expect(isReplySubject(subject)).toBe(false)
			}
		})
	})

	describe('when the subject only looks like one', () => {
		it('should not mistake an ordinary word for the prefix', () => {
			// GIVEN words that begin "re" with no colon straight after
			// WHEN each is judged
			// THEN none counts as a reply
			// AND a false positive here would stack a prefix onto ordinary mail
			for (const subject of [
				'Reminder: pay the invoice',
				'Renewal quote',
				'Ref: 2026-0114',
				're',
				're the pallet pools',
				'Score: Re: last match',
			]) {
				expect(isReplySubject(subject)).toBe(false)
			}
		})
	})
})

describe('withReplyPrefix', () => {
	describe('when the subject does not answer anything yet', () => {
		it('should add the prefix once', () => {
			// GIVEN a plain subject
			// THEN it comes back prefixed
			expect(withReplyPrefix('your pallet pools')).toBe('Re: your pallet pools')
		})
	})

	describe('when the subject already answers something', () => {
		it('should leave it exactly as it is', () => {
			// GIVEN subjects already marked as replies, however spelled
			// THEN none is stacked on
			// AND the spacing the sender chose is preserved rather than rewritten
			expect(withReplyPrefix('Re: quote')).toBe('Re: quote')
			expect(withReplyPrefix('re: quote')).toBe('re: quote')
			expect(withReplyPrefix('Re : quote')).toBe('Re : quote')
		})
	})
})
