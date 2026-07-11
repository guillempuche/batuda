import { describe, expect, it } from 'vitest'

import {
	denormColumnFor,
	mapEventToInteraction,
	StageChanged,
} from './timeline-activity'

describe('StageChanged timeline event', () => {
	const event = new StageChanged({
		companyId: '11111111-1111-4111-8111-111111111111',
		from: 'prospect',
		to: 'meeting',
		actorUserId: 'user-1',
		occurredAt: new Date('2026-01-01T00:00:00.000Z'),
	})

	describe('when deciding which denormalized column to bump', () => {
		it('should bump none — a stage change is not a contact touchpoint', () => {
			// GIVEN a stage transition prospect → meeting
			// WHEN the denormalized column is computed
			// THEN there is no last_email/last_call/last_meeting column to bump
			expect(denormColumnFor(event)).toBeNull()
		})
	})

	describe('when projecting the event to an interaction', () => {
		it('should produce no interaction row — it is a system-kind event', () => {
			// GIVEN a stage transition
			// WHEN mapping the event to a CRM interaction
			// THEN nothing is written to interactions
			expect(mapEventToInteraction(event)).toBeNull()
		})
	})

	describe('when the stage did not have a previous value', () => {
		it('should still be a valid, denorm-free system event', () => {
			// GIVEN a first-ever stage (from is null)
			const firstStage = new StageChanged({
				companyId: '22222222-2222-4222-8222-222222222222',
				from: null,
				to: 'contacted',
				actorUserId: null,
				occurredAt: new Date('2026-01-02T00:00:00.000Z'),
			})
			// THEN it neither bumps a column nor creates an interaction
			expect(denormColumnFor(firstStage)).toBeNull()
			expect(mapEventToInteraction(firstStage)).toBeNull()
		})
	})
})
