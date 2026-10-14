import { describe, expect, it } from 'vitest'

import { parentToQuoteBlock } from './parent-to-quote-block'

// The attribution line is handed in as functions so the caller's translation
// receives the real date and sender. When it was a string with `{date}` in it,
// the translation layer read the braces as its own placeholders and filled
// them with nothing, and every reply opened with "On , wrote:".

const attribution = {
	withDate: ({ date, who }: { date: string; who: string }) =>
		`On ${date}, ${who} wrote:`,
	withoutDate: ({ who }: { who: string }) => `${who} wrote:`,
	fallbackSender: 'someone',
}

const attributionText = (blocks: ReturnType<typeof parentToQuoteBlock>) => {
	const line = blocks[1]
	if (line?.type !== 'paragraph') return null
	const span = line.spans[0]
	return span?.kind === 'text' ? span.value : null
}

describe('parentToQuoteBlock', () => {
	describe('when the message being answered has a date and a sender', () => {
		it('should name both in the attribution line', () => {
			// GIVEN a message from a known address at a known moment
			const receivedAt = new Date('2026-10-13T09:30:00Z')

			// WHEN it is quoted in a reply
			const blocks = parentToQuoteBlock({
				text: 'Can you send the quote?',
				fromEmail: 'client@example.com',
				receivedAt,
				locale: 'en-GB',
				attribution,
			})

			// THEN the line carries the formatted date and the sender
			const expectedDate = new Intl.DateTimeFormat('en-GB', {
				dateStyle: 'long',
				timeStyle: 'short',
			}).format(receivedAt)
			expect(attributionText(blocks)).toBe(
				`On ${expectedDate}, client@example.com wrote:`,
			)
		})

		it('should prefer the sender name over the address', () => {
			// GIVEN a message carrying both a display name and an address
			// WHEN it is quoted without a date
			const blocks = parentToQuoteBlock({
				text: 'Hello',
				fromName: '  Marta Puig ',
				fromEmail: 'marta@example.com',
				attribution,
			})

			// THEN the name, trimmed, is who wrote it
			expect(attributionText(blocks)).toBe('Marta Puig wrote:')
		})
	})

	describe('when nothing says who sent the message', () => {
		it('should fall back to the translated word for an unknown sender', () => {
			// GIVEN a message with neither a name nor an address
			// WHEN it is quoted
			const blocks = parentToQuoteBlock({
				text: 'Hello',
				fromEmail: '   ',
				attribution,
			})

			// THEN the fallback stands in for the sender
			expect(attributionText(blocks)).toBe('someone wrote:')
		})
	})

	describe('when the reply is opened', () => {
		it('should put an empty line first, then the attribution, then the quote', () => {
			// GIVEN a plain-text message
			// WHEN it is quoted
			const blocks = parentToQuoteBlock({
				text: 'First paragraph\n\nSecond paragraph',
				fromEmail: 'client@example.com',
				attribution,
			})

			// THEN the cursor's empty line leads and the message sits in a quote
			expect(blocks[0]).toEqual({ type: 'paragraph', spans: [] })
			expect(blocks[2]).toEqual({
				type: 'quote',
				children: [
					{
						type: 'paragraph',
						spans: [{ kind: 'text', value: 'First paragraph' }],
					},
					{
						type: 'paragraph',
						spans: [{ kind: 'text', value: 'Second paragraph' }],
					},
				],
			})
		})
	})
})
