import { describe, expect, it } from 'vitest'

import { sentAttachmentKey, sentRawKey, storedAttachmentFor } from './email'

// The name a sent message's wire bytes are stored under. Those bytes are the only
// copy on our side and storing is a plain overwrite, so two messages that end up
// sharing a name cost the older one's bytes outright — and every later read of
// that older message serves the newer one's mail instead.

const ORGANIZATION = 'org_1'
const INBOX = 'inbox_1'

describe('sentRawKey', () => {
	describe('when several messages are sent from one inbox', () => {
		it('should give each of them a name of its own', () => {
			// GIVEN two sends from the same inbox
			// WHEN each is given a name
			// THEN neither can write over the other
			expect(sentRawKey(ORGANIZATION, INBOX)).not.toBe(
				sentRawKey(ORGANIZATION, INBOX),
			)
		})

		it('should not repeat a name across a thousand of them', () => {
			// GIVEN a thousand sends
			// WHEN each is given a name
			// THEN every one is its own. A name folded down from the message's own id
			// could not promise that: ids differing only in a character a path cannot
			// carry — "foo+1" against "foo_1" — folded onto one name
			const keys = Array.from({ length: 1000 }, () =>
				sentRawKey(ORGANIZATION, INBOX),
			)
			expect(new Set(keys).size).toBe(keys.length)
		})
	})

	describe('when the name is used as a path in object storage', () => {
		it('should sit under the inbox and carry nothing exotic', () => {
			// GIVEN a name
			// WHEN read as a path
			// THEN it is filed under the organisation and inbox it belongs to, and
			// holds only what every S3-compatible store accepts
			expect(sentRawKey(ORGANIZATION, INBOX)).toMatch(
				/^messages\/org_1\/inbox_1\/sent\/[0-9a-f-]{36}\.eml$/,
			)
		})
	})
})

// A file sent with a message is kept beside that message's wire bytes and
// listed on its row in the shape arriving mail uses, so one reader serves both.

describe('sentAttachmentKey', () => {
	describe('when a sent message carries files', () => {
		it('should file each one under the message it went with', () => {
			// GIVEN the name a sent message's wire bytes were kept under
			const rawRef =
				'messages/org_1/inbox_1/sent/0b5c6e2a-1111-4222-8333-444455556666.eml'

			// WHEN its files are given names
			// THEN each sits in a folder named after the message, numbered
			expect(sentAttachmentKey(rawRef, 0)).toBe(
				'messages/org_1/inbox_1/sent/0b5c6e2a-1111-4222-8333-444455556666/attachment-0.bin',
			)
			expect(sentAttachmentKey(rawRef, 1)).not.toBe(
				sentAttachmentKey(rawRef, 0),
			)
		})
	})
})

describe('storedAttachmentFor', () => {
	describe('when a file was sent as an attachment', () => {
		it('should record its real size and mark it as a file, not an inline image', () => {
			// GIVEN a five-byte file sent as an attachment
			const attachment = {
				filename: 'quote.pdf',
				contentType: 'application/pdf',
				contentBase64: Buffer.from('hello').toString('base64'),
				disposition: 'attachment' as const,
			}

			// WHEN it is recorded
			const entry = storedAttachmentFor(attachment, 0, 'key')

			// THEN the size is of the bytes, not of their base64 text
			expect(entry).toEqual({
				index: 0,
				filename: 'quote.pdf',
				contentType: 'application/pdf',
				sizeBytes: 5,
				cid: null,
				isInline: false,
				storageKey: 'key',
			})
		})
	})

	describe('when an image was sent inside the body', () => {
		it('should mark it inline and keep the id the body points at', () => {
			// GIVEN an image sent inline with a content id
			const attachment = {
				filename: 'logo.png',
				contentType: 'image/png',
				contentBase64: '',
				contentId: 'logo@batuda',
				disposition: 'inline' as const,
			}

			// WHEN it is recorded
			const entry = storedAttachmentFor(attachment, 2, 'key')

			// THEN it does not count as an attachment, and its id survives
			expect(entry.isInline).toBe(true)
			expect(entry.cid).toBe('logo@batuda')
			expect(entry.index).toBe(2)
		})
	})

	describe('when no disposition was given', () => {
		it('should treat it as an ordinary attachment, as the mail builder does', () => {
			// GIVEN a file with no disposition
			// WHEN it is recorded
			const entry = storedAttachmentFor(
				{ filename: 'a.txt', contentType: 'text/plain', contentBase64: '' },
				0,
				'key',
			)

			// THEN it counts as an attachment
			expect(entry.isInline).toBe(false)
		})
	})
})
