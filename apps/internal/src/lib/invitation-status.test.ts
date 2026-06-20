import { describe, expect, it } from 'vitest'

import {
	type InvitationLike,
	invitationDisplayStatus,
	selectPendingInvitations,
} from '#/lib/invitation-status'

// A fixed "now" so expiry boundaries are deterministic — 2026-06-20T12:00Z.
const NOW = Date.parse('2026-06-20T12:00:00.000Z')

// Minimal invitation builder; only the fields the helpers read matter.
function invitation(overrides: Partial<InvitationLike> = {}): InvitationLike {
	return {
		id: 'inv-1',
		email: 'pat@example.com',
		role: 'member',
		status: 'pending',
		expiresAt: '2026-06-22T12:00:00.000Z',
		createdAt: '2026-06-20T11:00:00.000Z',
		...overrides,
	}
}

describe('invitation display status [invitation-status.ts]', () => {
	describe('when the expiry is still in the future', () => {
		it('should read as pending', () => {
			// GIVEN an invite that expires two days from now
			// WHEN deriving its badge [invitation-status.ts:30 invitationDisplayStatus]
			// THEN it is still pending
			expect(invitationDisplayStatus('2026-06-22T12:00:00.000Z', NOW)).toBe(
				'pending',
			)
		})
	})

	describe('when the expiry has already passed', () => {
		it('should read as expired', () => {
			// GIVEN an invite whose link lapsed an hour ago
			// WHEN deriving its badge
			// THEN it is expired
			expect(invitationDisplayStatus('2026-06-20T11:00:00.000Z', NOW)).toBe(
				'expired',
			)
		})
	})

	describe('when the expiry is exactly the current instant (boundary)', () => {
		it('should read as pending at now and expired one ms before', () => {
			// GIVEN expiries straddling the boundary
			// WHEN deriving the badge
			// THEN `now` itself counts as not-yet-expired (strict <)
			expect(invitationDisplayStatus(new Date(NOW).toISOString(), NOW)).toBe(
				'pending',
			)
			// AND one millisecond earlier is expired
			expect(
				invitationDisplayStatus(new Date(NOW - 1).toISOString(), NOW),
			).toBe('expired')
		})
	})

	describe('when the expiry arrives as a Date (the revived runtime type)', () => {
		it('should read a past Date as expired and a future Date as pending', () => {
			// GIVEN Better Auth revives ISO strings into Date objects
			// WHEN deriving the badge from a Date instance
			// THEN the same boundary logic holds
			expect(invitationDisplayStatus(new Date(NOW - 60_000), NOW)).toBe(
				'expired',
			)
			expect(invitationDisplayStatus(new Date(NOW + 60_000), NOW)).toBe(
				'pending',
			)
		})
	})

	describe('when the expiry timestamp is unparseable', () => {
		it('should fall back to pending rather than hide the invite', () => {
			// GIVEN a garbage timestamp
			// WHEN deriving the badge
			// THEN a bad value never masks an outstanding invite
			expect(invitationDisplayStatus('not-a-date', NOW)).toBe('pending')
		})
	})
})

describe('selecting pending invitations [invitation-status.ts]', () => {
	describe('when the payload mixes every status', () => {
		it('should keep only the pending rows', () => {
			// GIVEN one row of each status
			const rows = [
				invitation({ id: 'a', status: 'pending' }),
				invitation({ id: 'b', status: 'canceled' }),
				invitation({ id: 'c', status: 'accepted' }),
				invitation({ id: 'd', status: 'rejected' }),
			]
			// WHEN selecting [invitation-status.ts:48 selectPendingInvitations]
			const result = selectPendingInvitations(rows)
			// THEN only the pending one survives
			expect(result.map(r => r.id)).toEqual(['a'])
		})
	})

	describe('when several invitations are pending', () => {
		it('should order them newest-created first', () => {
			// GIVEN three pending invites created at different times
			const rows = [
				invitation({ id: 'older', createdAt: '2026-06-18T09:00:00.000Z' }),
				invitation({ id: 'newest', createdAt: '2026-06-20T09:00:00.000Z' }),
				invitation({ id: 'middle', createdAt: '2026-06-19T09:00:00.000Z' }),
			]
			// WHEN selecting
			const result = selectPendingInvitations(rows)
			// THEN the most recent invite sorts to the top
			expect(result.map(r => r.id)).toEqual(['newest', 'middle', 'older'])
		})
	})

	describe('when nothing is pending', () => {
		it('should return an empty list', () => {
			// GIVEN only settled rows
			const rows = [
				invitation({ status: 'accepted' }),
				invitation({ status: 'canceled' }),
			]
			// WHEN selecting
			// THEN the result is empty (drives the "No pending invitations" state)
			expect(selectPendingInvitations(rows)).toEqual([])
		})
	})

	describe('when given an empty payload', () => {
		it('should return an empty list', () => {
			// GIVEN no invitations at all
			// WHEN selecting
			// THEN the result is empty
			expect(selectPendingInvitations([])).toEqual([])
		})
	})

	describe('when selecting from a caller-owned array', () => {
		it('should not mutate or reorder the input', () => {
			// GIVEN an array the caller still holds (active org payload)
			const rows = [
				invitation({ id: 'first', createdAt: '2026-06-18T09:00:00.000Z' }),
				invitation({ id: 'second', createdAt: '2026-06-20T09:00:00.000Z' }),
			]
			const snapshot = rows.map(r => r.id)
			// WHEN selecting (which sorts internally)
			selectPendingInvitations(rows)
			// THEN the original order is untouched — sort runs on a filtered copy
			expect(rows.map(r => r.id)).toEqual(snapshot)
		})
	})
})
