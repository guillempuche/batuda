import { describe, expect, it } from 'vitest'

import { newestFirstUndatedLast } from './conversation-order'

const row = (id: string, date: string | null) => ({ id, date })

describe('newestFirstUndatedLast [conversation-order.ts]', () => {
	describe('when every row has a date', () => {
		it('should put the newest first', () => {
			// GIVEN three rows out of order
			const rows = [
				row('march', '2026-03-01T10:00:00.000Z'),
				row('june', '2026-06-15T09:00:00.000Z'),
				row('april', '2026-04-20T08:00:00.000Z'),
			]
			// WHEN ordered
			const ordered = newestFirstUndatedLast(rows)
			// THEN they read newest to oldest
			expect(ordered.map(r => r.id)).toEqual(['june', 'april', 'march'])
		})
	})

	describe('when an open task has no due date', () => {
		it('should come after every dated row, however old', () => {
			// GIVEN an undated row ahead of a row from long ago
			const rows = [
				row('no-due-date', null),
				row('old-call', '2001-01-01T00:00:00.000Z'),
				row('recent-mail', '2026-10-01T00:00:00.000Z'),
			]
			// WHEN ordered
			const ordered = newestFirstUndatedLast(rows)
			// THEN the undated row is last, not ranked as 1970
			expect(ordered.map(r => r.id)).toEqual([
				'recent-mail',
				'old-call',
				'no-due-date',
			])
		})

		it('should keep several undated rows in the order they arrived', () => {
			// GIVEN two undated rows around a dated one
			const rows = [
				row('first-undated', null),
				row('dated', '2026-05-05T00:00:00.000Z'),
				row('second-undated', null),
			]
			// WHEN ordered
			const ordered = newestFirstUndatedLast(rows)
			// THEN the undated pair keeps its order at the end
			expect(ordered.map(r => r.id)).toEqual([
				'dated',
				'first-undated',
				'second-undated',
			])
		})
	})

	describe('when a date cannot be read', () => {
		it('should treat it as undated instead of scrambling the order', () => {
			// GIVEN a garbled date between two good ones
			const rows = [
				row('older', '2026-01-01T00:00:00.000Z'),
				row('garbled', 'not a date'),
				row('newer', '2026-02-01T00:00:00.000Z'),
			]
			// WHEN ordered
			const ordered = newestFirstUndatedLast(rows)
			// THEN the good ones sort and the garbled one sits last
			expect(ordered.map(r => r.id)).toEqual(['newer', 'older', 'garbled'])
		})
	})

	describe('when there are no rows', () => {
		it('should return an empty list', () => {
			// GIVEN nothing
			// WHEN ordered
			const ordered = newestFirstUndatedLast([])
			// THEN nothing comes back
			expect(ordered).toEqual([])
		})
	})
})
