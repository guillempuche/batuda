import { describe, expect, it } from 'vitest'

import { recipientAddresses, replyAddressees } from './recipient-address'

describe('replyAddressees', () => {
	describe('when replying to something that came in', () => {
		it('should answer the sender, not ourselves', () => {
			// GIVEN a message somebody sent us. Its `to` is our own mailbox — that
			// is what being the recipient means — so replying to the `to` would
			// send the message straight back to us.
			expect(
				replyAddressees({
					direction: 'inbound',
					recipients: {
						from: 'nuria@fustespla.example',
						to: ['admin@taller.cat'],
					},
				}),
			).toEqual(['nuria@fustespla.example'])
		})

		it('should fall back to the addressees when no sender was stored', () => {
			// GIVEN a message recorded before the sender was written down. Wrong,
			// but no more wrong than it already was, and a reply with nobody to go
			// to is worse than one that goes to the wrong place.
			expect(
				replyAddressees({
					direction: 'inbound',
					recipients: { to: ['admin@taller.cat'] },
				}),
			).toEqual(['admin@taller.cat'])
		})
	})

	describe('when replying after something we sent', () => {
		it('should answer the people it went to', () => {
			// GIVEN the last thing on the thread is ours — it already went to the
			// right people, and the sender would be our own mailbox
			expect(
				replyAddressees({
					direction: 'outbound',
					recipients: {
						from: 'admin@taller.cat',
						to: ['nuria@fustespla.example'],
					},
				}),
			).toEqual(['nuria@fustespla.example'])
		})
	})

	describe('when the message carries nothing at all', () => {
		it('should answer with nobody rather than inventing a recipient', () => {
			expect(
				replyAddressees({ direction: 'inbound', recipients: null }),
			).toEqual([])
		})
	})
})

describe('recipientAddresses', () => {
	describe('when the caller writes a plain address', () => {
		it('should hand it back as the database stores it', () => {
			// GIVEN the ordinary form
			expect(recipientAddresses('nuria@example.cat')).toEqual([
				'nuria@example.cat',
			])
		})

		it('should fold case and trim, since that is the same mailbox', () => {
			expect(recipientAddresses('  NURIA@Example.CAT ')).toEqual([
				'nuria@example.cat',
			])
		})
	})

	describe('when the caller writes it the way a mail client shows it', () => {
		it('should read the address out of the display-name form', () => {
			// GIVEN a recipient with a name attached — which the mail server accepts
			// and delivers, and which matched no stored address when compared whole
			expect(recipientAddresses('Núria Pla <nuria@example.cat>')).toEqual([
				'nuria@example.cat',
			])
		})

		it('should cope with a quoted name holding a comma', () => {
			// GIVEN the form a client produces for a surname-first name, where a
			// naive split on commas would invent two broken recipients
			expect(recipientAddresses('"Pla, Núria" <nuria@example.cat>')).toEqual([
				'nuria@example.cat',
			])
		})
	})

	describe('when several addresses arrive in one string', () => {
		it('should treat each as its own recipient', () => {
			expect(recipientAddresses('a@example.cat, b@example.cat')).toEqual([
				'a@example.cat',
				'b@example.cat',
			])
		})

		it('should split a mixture of forms', () => {
			expect(
				recipientAddresses('Núria <a@example.cat>, b@example.cat'),
			).toEqual(['a@example.cat', 'b@example.cat'])
		})
	})

	describe('when lists are combined', () => {
		it('should gather every list given and drop repeats', () => {
			// GIVEN a message addressed to somebody who is also copied in
			expect(
				recipientAddresses(
					'a@example.cat',
					['B@example.cat'],
					['a@example.cat'],
				),
			).toEqual(['a@example.cat', 'b@example.cat'])
		})

		it('should ignore lists that were never given', () => {
			expect(recipientAddresses('a@example.cat', undefined, undefined)).toEqual(
				['a@example.cat'],
			)
		})

		it('should answer with nothing when there is nobody to write to', () => {
			// GIVEN only empty entries, which match no stored address and would
			// only widen the query
			expect(recipientAddresses('', ['  ', ''], undefined)).toEqual([])
		})
	})
})
