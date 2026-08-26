import { describe, expect, it } from 'vitest'

import { replacesAccountBrief } from './research-lifecycle'

// A run as the approval step sees it: the brief it wrote, the companies it was
// pinned to, and the changes it is proposing.
const run = (over: Record<string, unknown> = {}) => ({
	briefMd: '## Acme\n\nA carrier.',
	context: { subjects: [{ table: 'companies', id: 'acme' }] },
	findings: {
		proposed_updates: [
			{ id: 'p1', subject_table: 'companies', subject_id: 'acme' },
		],
	},
	...over,
})

describe('replacesAccountBrief', () => {
	describe('when the change is about the company the run was pinned to', () => {
		it('should say the notes go with it', () => {
			// GIVEN a run that wrote a brief about the company it was asked about
			// WHEN the change on that company is the one being applied
			// THEN applying it replaces the notes
			expect(replacesAccountBrief(run(), 'p1')).toBe(true)
		})
	})

	describe('when the change is about a person rather than a company', () => {
		it('should say the notes are not at stake', () => {
			// GIVEN a change that adds a phone number to somebody
			const r = run({
				findings: {
					proposed_updates: [
						{ id: 'p1', subject_table: 'contacts', subject_id: 'mar' },
					],
				},
			})

			// THEN nothing about the company's notes changes
			expect(replacesAccountBrief(r, 'p1')).toBe(false)
		})
	})

	describe('when the company was only mentioned, not researched', () => {
		it('should say the notes are not at stake', () => {
			// GIVEN a rival the run named while researching somebody else
			const r = run({
				context: { subjects: [{ table: 'companies', id: 'somebody-else' }] },
			})

			// THEN its notes are left alone, so there is nothing to warn about
			expect(replacesAccountBrief(r, 'p1')).toBe(false)
		})
	})

	describe('when the run wrote no brief', () => {
		it('should say the notes are not at stake', () => {
			// GIVEN a run that found values but had nothing to write up
			// THEN there is no text to replace the notes with
			expect(replacesAccountBrief(run({ briefMd: null }), 'p1')).toBe(false)
			expect(replacesAccountBrief(run({ briefMd: '   ' }), 'p1')).toBe(false)
		})
	})

	describe('when the id names no change on this run', () => {
		it('should say the notes are not at stake', () => {
			// GIVEN an id that matches nothing the run proposed
			// THEN nothing can be concluded about notes, so nothing is claimed
			expect(replacesAccountBrief(run(), 'not-a-proposal')).toBe(false)
		})
	})

	describe('when the run is missing the parts this reads', () => {
		it('should say the notes are not at stake rather than throwing', () => {
			// GIVEN runs shaped in ways a stored row could still be
			// THEN each is answered, because a crash here blocks the apply itself
			expect(replacesAccountBrief(null, 'p1')).toBe(false)
			expect(replacesAccountBrief({}, 'p1')).toBe(false)
			expect(replacesAccountBrief(run({ context: null }), 'p1')).toBe(false)
			expect(replacesAccountBrief(run({ findings: null }), 'p1')).toBe(false)
			expect(
				replacesAccountBrief(
					run({ findings: { proposed_updates: 'no' } }),
					'p1',
				),
			).toBe(false)
			expect(
				replacesAccountBrief(run({ context: { subjects: 'no' } }), 'p1'),
			).toBe(false)
		})
	})
})
