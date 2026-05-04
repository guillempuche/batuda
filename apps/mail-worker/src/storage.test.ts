import { describe, expect, it } from 'vitest'

import { attachmentKey, rawMessageKey } from './storage'

// Pure key-format checks. The runtime put helpers wrap an S3 client and
// are exercised end-to-end by the IMAP integration test in
// imap-roundtrip.test.ts; here we pin the deterministic-key strings so
// any drift between worker and server (the server reads the same keys
// via StorageProvider.get) trips a unit failure first.

describe('rawMessageKey', () => {
	describe('when given canonical inputs', () => {
		it('should produce messages/<org>/<inbox>/<uidv>/<uid>.eml', () => {
			// GIVEN canonical inputs
			// WHEN rawMessageKey runs
			const key = rawMessageKey({
				organizationId: 'org-1',
				inboxId: 'inbox-1',
				uidValidity: 12345,
				uid: 67,
			})
			// THEN the format is the worker contract
			// [storage.ts:18]
			expect(key).toBe('messages/org-1/inbox-1/12345/67.eml')
		})
	})
})

describe('attachmentKey', () => {
	describe('when given canonical inputs', () => {
		it('should produce a sibling key with attachment-<index>.bin', () => {
			// GIVEN canonical inputs
			// WHEN attachmentKey runs
			const key = attachmentKey({
				organizationId: 'org-1',
				inboxId: 'inbox-1',
				uidValidity: 12345,
				uid: 67,
				index: 0,
			})
			// THEN the key sits under the same message prefix as rawMessageKey
			// [storage.ts:30]
			expect(key).toBe('messages/org-1/inbox-1/12345/67/attachment-0.bin')
		})

		it('should use the supplied index for the suffix', () => {
			// GIVEN index=2
			// WHEN attachmentKey runs
			// THEN the suffix reflects the index (deterministic per UID +
			// position so a re-fetch overwrites in place).
			const key = attachmentKey({
				organizationId: 'org-1',
				inboxId: 'inbox-1',
				uidValidity: 12345,
				uid: 67,
				index: 2,
			})
			expect(key).toContain('attachment-2.bin')
		})
	})
})
