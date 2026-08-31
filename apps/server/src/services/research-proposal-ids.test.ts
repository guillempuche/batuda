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

	describe('when a paid action names a tool that does not exist', () => {
		it('should keep it but stop it waiting on a person, with no price', () => {
			// GIVEN a run that offered to buy something no follow-up can do, at a
			// price nothing charges — the shape a real run produced
			const stamped = withProposalIds({
				pending_paid_actions: [
					{
						tool: 'employee_count_estimation',
						args: {},
						estimated_cents: 200,
						reason: 'The request requires an employee-range filter.',
					},
				],
			}) as {
				pending_paid_actions: Array<{
					tool: string
					status: string
					estimated_cents: number | null
					reason: string
				}>
			}
			const action = stamped.pending_paid_actions[0]

			// THEN it is still there to read, so what the run wanted is not hidden
			// AND it no longer waits on a decision, since none can be given
			// AND the invented price is gone rather than shown as a real one
			expect(action?.tool).toBe('employee_count_estimation')
			expect(action?.reason).toContain('employee-range')
			expect(action?.status).toBe('unsupported')
			expect(action?.estimated_cents).toBe(null)
		})
	})

	describe('when a paid action names a real tool at the wrong price', () => {
		it('should keep the action and correct the price to what it costs', () => {
			// GIVEN a register lookup offered at ten times its real cost
			const stamped = withProposalIds({
				pending_paid_actions: [
					{ tool: 'registry', args: {}, estimated_cents: 290 },
				],
			}) as {
				pending_paid_actions: Array<{
					tool: string
					status: string
					estimated_cents: number
				}>
			}
			const action = stamped.pending_paid_actions[0]

			// THEN the name it wrote is resolved to the real tool
			// AND the price is the one that will actually be charged
			// AND it still waits on a person, because it can be honoured
			expect(action?.tool).toBe('registry_lookup')
			expect(action?.estimated_cents).toBe(29)
			expect(action?.status).toBe('pending')
		})
	})

	describe('when a paid action is one whose cost varies', () => {
		it("should leave the run's own estimate alone", () => {
			// GIVEN contact discovery, which pays per candidate it checks, so there
			// is no single figure to correct it to
			const stamped = withProposalIds({
				pending_paid_actions: [
					{ tool: 'email_finder', args: {}, estimated_cents: 12 },
				],
			}) as {
				pending_paid_actions: Array<{ tool: string; estimated_cents: number }>
			}
			const action = stamped.pending_paid_actions[0]

			// THEN the tool is resolved but the estimate stands
			expect(action?.tool).toBe('discover_contacts')
			expect(action?.estimated_cents).toBe(12)
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
