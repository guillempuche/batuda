import { DateTime, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { Interaction } from './interactions'

// A raw interaction row exactly as the driver hands it back: a TIMESTAMPTZ
// column is a JS Date, a DATE column is a "YYYY-MM-DD" string, and the keys are
// camelCased by the client's result transform.
const rawRow = {
	id: 'int_1',
	companyId: 'co_1',
	contactId: null,
	date: new Date('2026-07-01T10:00:00Z'),
	durationMin: 30,
	channel: 'email',
	direction: 'outbound',
	type: 'followup',
	subject: null,
	summary: 'Sent the proposal',
	outcome: null,
	nextAction: 'Chase a reply',
	nextActionAt: '2026-08-01',
	metadata: null,
	createdAt: new Date('2026-07-01T10:00:00Z'),
}

describe('Interaction', () => {
	describe('when the next_action_at DATE column is populated', () => {
		it('should read the day the driver returns as midnight UTC that day', () => {
			// GIVEN a raw row whose next_action_at arrives as "YYYY-MM-DD", which
			//   is how the driver hands over a DATE column. Typing it as a Date
			//   would 500 the interactions list/create read-back.
			// WHEN the row is decoded through the domain model
			const decoded = Schema.decodeUnknownSync(Interaction)(rawRow)
			// THEN the DATE column lands as a DateTime.Utc on that day
			expect(DateTime.isDateTime(decoded.nextActionAt)).toBe(true)
			expect(
				decoded.nextActionAt === null
					? null
					: DateTime.formatIso(decoded.nextActionAt),
			).toBe('2026-08-01T00:00:00.000Z')
		})
	})

	describe('when next_action_at is null', () => {
		it('should decode the null without entering the date branch', () => {
			// GIVEN an interaction with no scheduled next action
			// WHEN the row is decoded
			const decoded = Schema.decodeUnknownSync(Interaction)({
				...rawRow,
				nextActionAt: null,
			})
			// THEN the field is null
			expect(decoded.nextActionAt).toBeNull()
		})
	})
})
