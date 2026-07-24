import { describe, expect, it } from 'vitest'

import { withBriefOwnership } from './company-brief'

const person = { userId: 'user_123', isAgent: false }
const agent = { userId: 'agent_007', isAgent: true }

describe('withBriefOwnership', () => {
	describe('when a person edits the notes', () => {
		it('should mark the notes as theirs, so research adds to them instead of replacing them', () => {
			// GIVEN a person rewriting the account notes
			const result = withBriefOwnership({ accountBrief: 'My notes.' }, person)

			// THEN the edit carries who owns the notes now, and when
			expect(result).toMatchObject({
				accountBrief: 'My notes.',
				briefUpdatedBy: 'user_123',
			})
			expect(
				(result as { briefUpdatedAt: Date }).briefUpdatedAt,
			).toBeInstanceOf(Date)
		})
	})

	describe('when an agent edits the notes', () => {
		it('should write them without claiming ownership', () => {
			// GIVEN an agent writing the same notes
			const result = withBriefOwnership({ accountBrief: 'Agent notes.' }, agent)

			// THEN the text lands but the ownership marker is untouched, so the
			// agent cannot pass its own writing off as a person's
			expect(result).toEqual({ accountBrief: 'Agent notes.' })
		})
	})

	describe('when the edit does not touch the notes at all', () => {
		it('should leave ownership alone even for a person', () => {
			// GIVEN a person editing some other field
			const result = withBriefOwnership({ industry: 'transport' }, person)

			// THEN nothing about the notes is claimed
			expect(result).toEqual({ industry: 'transport' })
		})
	})

	describe('when a person clears the notes to an empty string', () => {
		it('should still count as their edit', () => {
			// GIVEN a person deliberately emptying the notes — a present value, not
			// an absent one, so it is an edit like any other
			const result = withBriefOwnership({ accountBrief: '' }, person)

			// THEN they own the now-empty notes
			expect(result).toMatchObject({
				accountBrief: '',
				briefUpdatedBy: 'user_123',
			})
		})
	})

	describe('when other fields ride along with the notes', () => {
		it('should keep them all and add only the ownership marker', () => {
			// GIVEN one edit changing the notes and the industry together
			const result = withBriefOwnership(
				{ accountBrief: 'Notes.', industry: 'retail' },
				person,
			)

			// THEN the rest of the edit is untouched
			expect(result).toMatchObject({
				accountBrief: 'Notes.',
				industry: 'retail',
				briefUpdatedBy: 'user_123',
			})
		})
	})
})
