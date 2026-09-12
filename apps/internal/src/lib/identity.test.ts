import { describe, expect, it } from 'vitest'

import { isOrgAdmin, serverFirst } from './identity'

const pending = { data: null, isPending: true, error: null }
const answered = { data: { id: 'live' }, isPending: false, error: null }
const server = { id: 'server' }

describe('serverFirst', () => {
	describe('when the server did not know', () => {
		it('should show the store as it is, withholding data until hydration is over', () => {
			// GIVEN no server answer and a store that already holds data
			// WHEN React is still matching the server's HTML
			// THEN nothing is shown, so both sides draw the same frame
			expect(serverFirst(answered, undefined, false).data).toBeUndefined()
			expect(serverFirst(answered, undefined, false).isPending).toBe(false)

			// AND once hydration is over the store shows through, pending included
			expect(serverFirst(answered, undefined, true)).toBe(answered)
			expect(serverFirst(pending, undefined, true)).toBe(pending)
		})
	})

	describe('when the server answered', () => {
		it('should show the server answer before hydration, whatever the store holds', () => {
			// GIVEN a server answer and a store that already answered differently
			// WHEN React is still matching the server's HTML
			// THEN the server's answer is what both sides draw
			const shown = serverFirst(answered, server, false)
			expect(shown.data).toBe(server)
			expect(shown.isPending).toBe(false)
		})

		it('should stand in for the store only until it answers for itself', () => {
			// GIVEN a server answer and hydration over
			// WHEN the store has not answered yet
			// THEN the server's answer stands in, and nothing reads as loading
			const standingIn = serverFirst(pending, server, true)
			expect(standingIn.data).toBe(server)
			expect(standingIn.isPending).toBe(false)

			// AND once the store has answered, the store wins
			expect(serverFirst(answered, server, true)).toBe(answered)
		})

		it('should keep the store while it refreshes with data in hand', () => {
			// GIVEN a store that is asking again but still holds its last answer
			const refreshing = { data: { id: 'live' }, isPending: true, error: null }

			// WHEN hydration is over
			// THEN the store's own data shows, not the server's older one
			expect(serverFirst(refreshing, server, true)).toBe(refreshing)
		})

		it('should treat "there is none" as an answer, not as waiting', () => {
			// GIVEN the server said there is nothing (no active organisation)
			// WHEN the store is still pending after hydration
			// THEN the screen sees an answered, empty result
			const shown = serverFirst(pending, null, true)
			expect(shown.data).toBeUndefined()
			expect(shown.isPending).toBe(false)
		})
	})
})

describe('isOrgAdmin', () => {
	it('should count owners and admins and nobody else', () => {
		// GIVEN the roles an organisation hands out
		// THEN only the two managing roles may manage it
		expect(isOrgAdmin('owner')).toBe(true)
		expect(isOrgAdmin('admin')).toBe(true)
		expect(isOrgAdmin('member')).toBe(false)
		expect(isOrgAdmin(null)).toBe(false)
		expect(isOrgAdmin(undefined)).toBe(false)
	})
})
