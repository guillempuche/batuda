import { describe, expect, it } from 'vitest'

import { sentRawKey } from './email'

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
