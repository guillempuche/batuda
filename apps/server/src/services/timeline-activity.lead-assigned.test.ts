import { describe, expect, it } from 'vitest'

import {
	denormColumnFor,
	LeadAssigned,
	mapEventToInteraction,
} from './timeline-activity'

describe('LeadAssigned timeline event', () => {
	const event = new LeadAssigned({
		companyId: '11111111-1111-4111-8111-111111111111',
		ownerUserId: 'user-1',
		actorUserId: 'user-1',
		occurredAt: new Date('2026-01-01T00:00:00.000Z'),
	})

	describe('when deciding which denormalized column to bump', () => {
		it('should bump none — taking a lead is not a contact touchpoint', () => {
			// GIVEN a lead being claimed
			// WHEN the denormalized column is computed
			// THEN there is no last_email/last_call/last_meeting column to bump
			expect(denormColumnFor(event)).toBeNull()
		})
	})

	describe('when projecting the event to an interaction', () => {
		it('should produce no interaction row — it is a system-kind event', () => {
			// GIVEN a lead being claimed
			// WHEN mapping the event to a CRM interaction
			// THEN nothing is written to interactions
			expect(mapEventToInteraction(event)).toBeNull()
		})
	})

	describe('when the lead goes to somebody other than whoever acted', () => {
		it('should still be a denorm-free system event', () => {
			// GIVEN a lead handed to one person by another
			const handedOver = new LeadAssigned({
				companyId: '22222222-2222-4222-8222-222222222222',
				ownerUserId: 'user-2',
				actorUserId: 'user-1',
				occurredAt: new Date('2026-01-02T00:00:00.000Z'),
			})
			// THEN it neither bumps a column nor creates an interaction
			expect(denormColumnFor(handedOver)).toBeNull()
			expect(mapEventToInteraction(handedOver)).toBeNull()
		})
	})

	describe('when nobody is recorded as having done it', () => {
		it('should still be a denorm-free system event', () => {
			// GIVEN an assignment with no actor
			const unattributed = new LeadAssigned({
				companyId: '33333333-3333-4333-8333-333333333333',
				ownerUserId: 'user-3',
				actorUserId: null,
				occurredAt: new Date('2026-01-03T00:00:00.000Z'),
			})
			// THEN it neither bumps a column nor creates an interaction
			expect(denormColumnFor(unattributed)).toBeNull()
			expect(mapEventToInteraction(unattributed)).toBeNull()
		})
	})
})
