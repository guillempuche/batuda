import { DateTime, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { Interaction } from './interactions'

// A raw interaction row exactly as node-postgres hands it back: TIMESTAMPTZ and
// DATE columns are JS Date objects (the pg driver parses DATE into a Date, not
// a "YYYY-MM-DD" string), and camelCased by the client's result transform.
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
	nextActionAt: new Date('2026-08-01T00:00:00Z'),
	metadata: null,
	createdAt: new Date('2026-07-01T10:00:00Z'),
}

describe('Interaction', () => {
	describe('when the next_action_at DATE column is populated', () => {
		it('should decode the JS Date the driver returns, not reject it as a non-string', () => {
			// GIVEN a raw row whose next_action_at arrives as a JS Date
			//   (interactions.next_action_at is a DATE column; node-postgres
			//    parses DATE values into Date objects). Typing it as a plain
			//    string would 500 the interactions list/create read-back.
			// WHEN the row is decoded through the domain model
			const decoded = Schema.decodeUnknownSync(Interaction)(rawRow)
			// THEN the DATE column lands as a DateTime.Utc instead of failing
			expect(DateTime.isDateTime(decoded.nextActionAt)).toBe(true)
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
