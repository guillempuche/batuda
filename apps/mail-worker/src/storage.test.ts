import { describe, expect, it } from 'vitest'

import { attachmentKey, rawMessageKey } from './storage'

// Pure key-format checks. The runtime put helpers wrap an S3 client and
// are exercised end-to-end by the IMAP integration test in
// imap-roundtrip.test.ts; here we pin the deterministic-key strings so
// any drift between worker and server (the server reads the same keys
// via StorageProvider.get) trips a unit failure first.

describe('rawMessageKey', () => {
	describe('when given canonical inputs', () => {
		it('should produce messages/<org>/<inbox>/<folder>/<uidv>/<uid>.eml', () => {
			// GIVEN canonical inputs
			// WHEN rawMessageKey runs
			const key = rawMessageKey({
				organizationId: 'org-1',
				inboxId: 'inbox-1',
				folder: 'INBOX',
				uidValidity: 12345,
				uid: 67,
			})
			// THEN the format is the worker contract
			expect(key).toBe('messages/org-1/inbox-1/INBOX/12345/67.eml')
		})
	})

	describe('when two folders hand out the same numbering', () => {
		it('should keep their messages apart', () => {
			// GIVEN the same message number in two folders of one mailbox — which
			// a server is free to do, since a number only means anything within
			// its own folder
			const shared = {
				organizationId: 'org-1',
				inboxId: 'inbox-1',
				uidValidity: 12345,
				uid: 67,
			}

			// WHEN each is named for storage
			const inbox = rawMessageKey({ ...shared, folder: 'INBOX' })
			const sent = rawMessageKey({ ...shared, folder: 'Sent' })

			// THEN they are stored apart, so neither is written over the other
			expect(inbox).not.toBe(sent)
		})
	})

	describe('when the folder name is not safe to put in a key', () => {
		it('should reduce it to something that is', () => {
			// GIVEN a provider whose folder name carries separators and spaces
			// WHEN it is named for storage
			const key = rawMessageKey({
				organizationId: 'org-1',
				inboxId: 'inbox-1',
				folder: '[Gmail]/Sent Mail',
				uidValidity: 1,
				uid: 2,
			})

			// THEN the name cannot open a path of its own inside the key
			expect(key).toBe('messages/org-1/inbox-1/_Gmail__Sent_Mail/1/2.eml')
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
				folder: 'INBOX',
				uidValidity: 12345,
				uid: 67,
				index: 0,
			})
			// THEN the key sits under the same message prefix as rawMessageKey
			expect(key).toBe('messages/org-1/inbox-1/INBOX/12345/67/attachment-0.bin')
		})

		it('should use the supplied index for the suffix', () => {
			// GIVEN index=2
			// WHEN attachmentKey runs
			// THEN the suffix reflects the index (deterministic per UID +
			// position so a re-fetch overwrites in place).
			const key = attachmentKey({
				organizationId: 'org-1',
				inboxId: 'inbox-1',
				folder: 'INBOX',
				uidValidity: 12345,
				uid: 67,
				index: 2,
			})
			expect(key).toContain('attachment-2.bin')
		})
	})

	describe('when two folders hand out the same numbering', () => {
		it('should keep their attachments apart', () => {
			// GIVEN the same message number and position in two folders
			const shared = {
				organizationId: 'org-1',
				inboxId: 'inbox-1',
				uidValidity: 12345,
				uid: 67,
				index: 0,
			}

			// WHEN each is named for storage
			// THEN neither attachment is written over the other
			expect(attachmentKey({ ...shared, folder: 'INBOX' })).not.toBe(
				attachmentKey({ ...shared, folder: 'Sent' }),
			)
		})
	})
})
