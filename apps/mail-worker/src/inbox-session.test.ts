import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { onImapClientError, resolveTrackedFolders } from './inbox-session.js'

// Spy on console.warn so the handler's single JSON line is captured, not printed.
const captureWarn = () =>
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)

const loggedPayload = (
	warn: ReturnType<typeof captureWarn>,
): Record<string, unknown> => JSON.parse(String(warn.mock.calls[0]?.[0]))

describe('onImapClientError', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('when the client emits an Error with the listener attached', () => {
		it('should swallow the error without throwing', () => {
			// GIVEN an emitter wired exactly like the ImapFlow client
			// [inbox-session.ts — client.on('error', onImapClientError(claimed.id))]
			captureWarn()
			const client = new EventEmitter()
			client.on('error', onImapClientError('inbox_123'))

			// WHEN a socket-style error fires mid-session
			const emit = () => client.emit('error', new Error('socket hang up'))

			// THEN it does not throw (without a listener Node would crash here)
			expect(emit).not.toThrow()
		})

		it('should log one WARN entry naming the inbox and the error message', () => {
			// GIVEN the wired emitter
			const warn = captureWarn()
			const client = new EventEmitter()
			client.on('error', onImapClientError('inbox_123'))

			// WHEN it emits an Error
			client.emit('error', new Error('socket hang up'))

			// THEN exactly one structured WARN line is written
			// AND it carries the inbox id and the error's message
			expect(warn).toHaveBeenCalledOnce()
			expect(loggedPayload(warn)).toMatchObject({
				level: 'WARN',
				inboxId: 'inbox_123',
				error: 'socket hang up',
			})
		})
	})

	describe('when the emitted value is not an Error instance', () => {
		it('should still swallow it and stringify the value', () => {
			// GIVEN a non-Error payload — some providers surface a bare code/string
			// [inbox-session.ts — `error instanceof Error ? … : String(error)`]
			const warn = captureWarn()
			const client = new EventEmitter()
			client.on('error', onImapClientError('inbox_456'))

			// WHEN a non-Error value is emitted
			const emit = () => client.emit('error', 'ECONNRESET')

			// THEN it does not throw, and the stringified value is logged
			expect(emit).not.toThrow()
			expect(loggedPayload(warn)).toMatchObject({
				inboxId: 'inbox_456',
				error: 'ECONNRESET',
			})
		})

		it('should not throw on a null payload', () => {
			// GIVEN a null payload (the degenerate non-Error case)
			const warn = captureWarn()
			const client = new EventEmitter()
			client.on('error', onImapClientError('inbox_789'))

			// WHEN null is emitted
			const emit = () => client.emit('error', null)

			// THEN it still swallows and records 'null', never throwing
			expect(emit).not.toThrow()
			expect(loggedPayload(warn)).toMatchObject({ error: 'null' })
		})
	})

	describe('when no error listener is attached', () => {
		it('should throw on emit, proving the listener is load-bearing', () => {
			// GIVEN a bare emitter with no 'error' listener (the pre-fix state)
			const client = new EventEmitter()

			// WHEN it emits 'error'
			const emit = () => client.emit('error', new Error('socket hang up'))

			// THEN Node rethrows — which, without our listener, crashes the worker
			expect(emit).toThrow('socket hang up')
		})
	})
})

describe('resolveTrackedFolders', () => {
	describe('when the server only offers an inbox', () => {
		it('should track it alone, as arriving mail', () => {
			// GIVEN the dev catcher, which has no sent folder
			const boxes = [{ path: 'INBOX', specialUse: '\\Inbox' }]

			// WHEN the folders to sync are worked out
			// THEN only the inbox is synced, and what lands there arrived
			expect(resolveTrackedFolders(boxes)).toEqual([
				{ path: 'INBOX', direction: 'inbound' },
			])
		})
	})

	describe('when the server names its folders conventionally', () => {
		it('should track both by name even with no special-use flags', () => {
			// GIVEN a server that advertises no purposes at all
			const boxes = [{ path: 'INBOX' }, { path: 'Sent' }, { path: 'Drafts' }]

			// WHEN the folders are worked out
			// THEN the two we care about are found by name, and drafts are left alone
			expect(resolveTrackedFolders(boxes)).toEqual([
				{ path: 'INBOX', direction: 'inbound' },
				{ path: 'Sent', direction: 'outbound' },
			])
		})
	})

	describe('when the provider names its sent folder something else', () => {
		it('should find the Gmail sent folder and skip the copy of everything', () => {
			// GIVEN Gmail, whose sent folder is not called "Sent" and whose
			// "All Mail" repeats every message already counted elsewhere
			const boxes = [
				{ path: 'INBOX', specialUse: '\\Inbox' },
				{ path: '[Gmail]/Sent Mail', specialUse: '\\Sent' },
				{ path: '[Gmail]/All Mail', specialUse: '\\All' },
				{ path: '[Gmail]/Bin', specialUse: '\\Trash' },
			]

			// WHEN the folders are worked out
			// THEN sent mail is found by its purpose, and nothing is counted twice
			expect(resolveTrackedFolders(boxes)).toEqual([
				{ path: 'INBOX', direction: 'inbound' },
				{ path: '[Gmail]/Sent Mail', direction: 'outbound' },
			])
		})

		it('should find the Outlook sent folder', () => {
			// GIVEN Outlook, which calls it "Sent Items"
			const boxes = [
				{ path: 'INBOX', specialUse: '\\Inbox' },
				{ path: 'Sent Items', specialUse: '\\Sent' },
			]

			// WHEN the folders are worked out
			// THEN it is still recognised as where sent mail lives
			expect(resolveTrackedFolders(boxes)).toEqual([
				{ path: 'INBOX', direction: 'inbound' },
				{ path: 'Sent Items', direction: 'outbound' },
			])
		})
	})

	describe('when a folder is merely named like one we track', () => {
		it('should prefer the one the server says is for sent mail', () => {
			// GIVEN a personal folder someone named "Sent" alongside the real one
			const boxes = [
				{ path: 'INBOX', specialUse: '\\Inbox' },
				{ path: 'Sent' },
				{ path: 'Sent Items', specialUse: '\\Sent' },
			]

			// WHEN the folders are worked out
			// THEN the server's own answer wins over the coincidence of a name
			expect(resolveTrackedFolders(boxes)).toEqual([
				{ path: 'INBOX', direction: 'inbound' },
				{ path: 'Sent Items', direction: 'outbound' },
			])
		})
	})

	describe('when the server offers nothing we recognise', () => {
		it('should track nothing rather than guess', () => {
			// GIVEN a mailbox list with no inbox and no sent folder
			// [runInboxSession fails on an empty result, letting the backoff retry]
			expect(resolveTrackedFolders([{ path: 'Archive' }])).toEqual([])
		})
	})

	describe('when the server offers no folders at all', () => {
		it('should track nothing', () => {
			// GIVEN the degenerate empty list
			expect(resolveTrackedFolders([])).toEqual([])
		})
	})

	describe('when one folder answers to two of our roles', () => {
		it('should sync it once', () => {
			// GIVEN a server that flags a single folder as both
			// (malformed, but syncing it twice would double every message)
			const boxes: ReadonlyArray<{ path: string; specialUse?: string }> = [
				{ path: 'INBOX', specialUse: '\\Inbox' },
				{ path: 'INBOX', specialUse: '\\Sent' },
			]

			// WHEN the folders are worked out
			// THEN the folder appears once
			expect(resolveTrackedFolders(boxes)).toEqual([
				{ path: 'INBOX', direction: 'inbound' },
			])
		})
	})
})
