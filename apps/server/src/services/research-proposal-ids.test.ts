import { describe, expect, it } from 'vitest'

import { withProposalIds } from '@batuda/research'

describe('withProposalIds', () => {
	describe('when findings carry proposed updates and paid actions', () => {
		it('should stamp each with an id and a pending status', () => {
			// GIVEN findings with both review lists, none carrying ids yet
			const stamped = withProposalIds({
				summary: 's',
				proposed_updates: [{ subject_table: 'contacts', fields: {} }],
				pending_paid_actions: [{ tool: 'registry_lookup', args: {} }],
			}) as {
				proposed_updates: Array<{ id: string; status: string }>
				pending_paid_actions: Array<{ id: string; status: string }>
			}

			// THEN both a proposed update and a paid action become addressable
			expect(stamped.proposed_updates[0]?.id).toBeTruthy()
			expect(stamped.proposed_updates[0]?.status).toBe('pending')
			expect(stamped.pending_paid_actions[0]?.id).toBeTruthy()
			expect(stamped.pending_paid_actions[0]?.status).toBe('pending')
		})
	})

	describe('when a list is absent', () => {
		it('should leave the findings otherwise unchanged', () => {
			// GIVEN findings with no review lists
			// THEN nothing is added
			expect(withProposalIds({ summary: 's' })).toEqual({ summary: 's' })
		})
	})

	describe('when findings is not an object', () => {
		it('should return it as-is', () => {
			// GIVEN a non-object (the tolerant decoder kept prose, or null)
			expect(withProposalIds('nope')).toBe('nope')
			expect(withProposalIds(null)).toBe(null)
		})
	})
})
