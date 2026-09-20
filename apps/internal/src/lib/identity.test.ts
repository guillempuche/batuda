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

	describe('when the store asked and came back empty-handed', () => {
		const failed = { data: null, isPending: false, error: { message: 'no' } }

		it('should keep what the server drew rather than blanking it', () => {
			// GIVEN the server listed the organisations a person belongs to
			// AND the store's own request for them failed
			// WHEN hydration is over
			// THEN the server's list still shows, so the switcher keeps its options
			const shown = serverFirst(failed, server, true)
			expect(shown.data).toBe(server)
			expect(shown.isPending).toBe(false)
		})

		it('should treat a failure with no data the same whether it is null or absent', () => {
			// GIVEN a store that reports its emptiness as undefined instead of null
			const undefinedData = {
				data: undefined,
				isPending: false,
				error: { message: 'no' },
			}

			// WHEN hydration is over
			// THEN it is still not an answer, and the server's value stands
			expect(serverFirst(undefinedData, server, true).data).toBe(server)
		})

		it('should still defer to the server when the server said there is none', () => {
			// GIVEN the server asked and found no active organisation
			// AND the store's request failed
			// WHEN hydration is over
			// THEN "there is none" is the answer, told apart from "not known"
			const shown = serverFirst(failed, null, true)
			expect(shown.data).toBeUndefined()
			expect(shown.isPending).toBe(false)
		})

		it('should keep the failure visible when the server never knew', () => {
			// GIVEN no server answer to fall back to
			// WHEN hydration is over and the store has failed
			// THEN the store shows as it is, so the screen can see the failure
			expect(serverFirst(failed, undefined, true)).toBe(failed)
		})

		it('should let data in hand win even when the last refresh failed', () => {
			// GIVEN a store holding an older answer whose refresh then failed
			const staleWithError = {
				data: { id: 'live' },
				isPending: false,
				error: { message: 'no' },
			}

			// WHEN hydration is over
			// THEN what the store holds still beats the server's older copy
			expect(serverFirst(staleWithError, server, true)).toBe(staleWithError)
		})

		it('should not mistake an absent error for a failure', () => {
			// GIVEN a store that genuinely answered "nothing here", error unset
			const emptyNull = { data: null, isPending: false, error: null }
			const emptyUndefined = { data: null, isPending: false }

			// WHEN hydration is over
			// THEN both are real answers and the store wins, not the server
			expect(serverFirst(emptyNull, server, true)).toBe(emptyNull)
			expect(serverFirst(emptyUndefined, server, true)).toBe(emptyUndefined)
		})

		it('should count a falsy answer as an answer', () => {
			// GIVEN stores whose answer is zero, empty string or false
			// WHEN hydration is over
			// THEN each is a real answer — a check on truthiness would lose them
			for (const data of [0, '', false]) {
				const falsy = { data, isPending: false, error: null }
				expect(serverFirst(falsy, server, true)).toBe(falsy)
			}
		})

		it('should hand back the failure alongside the server answer', () => {
			// GIVEN a failed store and a server answer standing in for it
			// WHEN hydration is over
			// THEN the error still rides along, so a screen may warn about it
			expect(serverFirst(failed, server, true).error).toBe(failed.error)
		})

		it('should show the server answer while a retry is in flight', () => {
			// GIVEN a store retrying after a failure, nothing in hand yet
			const retrying = {
				data: null,
				isPending: true,
				error: { message: 'no' },
			}

			// WHEN hydration is over
			// THEN the server's answer stands in until the retry lands
			expect(serverFirst(retrying, server, true).data).toBe(server)
		})

		it('should draw the server answer before hydration whatever went wrong', () => {
			// GIVEN a store that already failed
			// WHEN React is still matching the server's HTML
			// THEN the first frame is the server's, so the two sides agree
			const shown = serverFirst(failed, server, false)
			expect(shown.data).toBe(server)
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
