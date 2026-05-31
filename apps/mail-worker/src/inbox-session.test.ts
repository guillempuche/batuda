import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { onImapClientError } from './inbox-session.js'

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
