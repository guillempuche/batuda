import { describe, expect, it } from 'vitest'

import { clientIdentityOf } from './client-seen'

describe('clientIdentityOf', () => {
	describe('when the body is an opening handshake', () => {
		it('should return the name and version the assistant announced', () => {
			// GIVEN the handshake an MCP client sends to open a session
			const body = {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-06-18',
					capabilities: {},
					clientInfo: { name: 'claude-code', version: '2.0.1' },
				},
			}

			// WHEN the identity is read from it
			// THEN both parts come through
			expect(clientIdentityOf(body)).toEqual({
				name: 'claude-code',
				version: '2.0.1',
			})
		})

		it('should keep the name when no version was announced', () => {
			// GIVEN a handshake carrying only a name
			const body = {
				method: 'initialize',
				params: { clientInfo: { name: 'Cursor' } },
			}

			// THEN the missing half is null rather than dropping the whole thing
			expect(clientIdentityOf(body)).toEqual({ name: 'Cursor', version: null })
		})

		it('should treat blank strings as absent', () => {
			// GIVEN a client that announces itself with empty strings
			const body = {
				method: 'initialize',
				params: { clientInfo: { name: '', version: '' } },
			}

			// THEN there is nothing worth recording
			expect(clientIdentityOf(body)).toBeNull()
		})

		it('should ignore a handshake with no client details', () => {
			// GIVEN a handshake that omits clientInfo entirely
			const body = { method: 'initialize', params: { capabilities: {} } }

			// THEN nothing is claimed about the caller
			expect(clientIdentityOf(body)).toBeNull()
		})
	})

	describe('when the body is anything else', () => {
		it.each([
			['an ordinary call', { method: 'tools/call', params: { name: 'x' } }],
			['a batch of calls', [{ method: 'initialize', params: {} }]],
			['no body at all', null],
			['a bare string', 'initialize'],
			['a number', 42],
			['an empty object', {}],
		])('should return nothing for %s', (_label, body) => {
			// GIVEN a body that is not a single opening handshake
			// THEN no identity is inferred — only the handshake carries one
			expect(clientIdentityOf(body)).toBeNull()
		})
	})
})
