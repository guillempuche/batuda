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

	describe('when a varying-cost action names a price cents cannot count', () => {
		// The estimate on contact discovery is the run's own figure rather than one
		// read off a table, so it is the only price that reaches storage as the
		// model wrote it. A page listing these actions reads the figure as a whole
		// number of cents, and a run that wrote 0.05 once took that page down for
		// a whole organisation until somebody looked.
		const settle = (estimated_cents: unknown): number | null => {
			const stamped = withProposalIds({
				pending_paid_actions: [
					{ tool: 'discover_contacts', args: {}, estimated_cents },
				],
			}) as {
				pending_paid_actions: Array<{ estimated_cents: number | null }>
			}
			return stamped.pending_paid_actions[0]?.estimated_cents ?? null
		}

		it('should round a part of a cent up, never down to free', () => {
			// GIVEN a lookup priced below a single cent
			// THEN it is recorded as costing something, because it does
			expect(settle(0.05)).toBe(1)
			expect(settle(0.9)).toBe(1)
		})

		it('should read a whole number written as a decimal as that number', () => {
			// GIVEN a figure that is whole but written with a fractional part
			// THEN it settles to the whole number, not to something larger
			expect(settle(5.0)).toBe(5)
		})

		it('should round any other fraction up to the next whole cent', () => {
			// GIVEN figures either side of a half cent
			// THEN both round up, so an estimate is never quoted under its cost
			expect(settle(5.4)).toBe(6)
			expect(settle(5.6)).toBe(6)
		})

		it('should leave a whole number of cents exactly as written', () => {
			// GIVEN a figure that is already countable
			// THEN nothing is done to it
			expect(settle(12)).toBe(12)
			expect(settle(0)).toBe(0)
		})

		it('should record no estimate at all for a price below zero', () => {
			// GIVEN a lookup offered at a negative price
			// THEN there is no estimate, since a lookup cannot pay anybody —
			// and zero is not used, which would claim the lookup is free
			expect(settle(-3)).toBe(null)
			expect(settle(-0.4)).toBe(null)
		})

		it('should record no estimate for a figure too large to be one', () => {
			// GIVEN a price beyond what the estimate can hold
			// THEN it is dropped rather than folded down to the largest that fits,
			// which would put an enormous sum in front of somebody to approve
			expect(settle(99999999999)).toBe(null)
			expect(settle(2147483648)).toBe(null)

			// AND the largest figure that does fit is still kept
			expect(settle(2147483647)).toBe(2147483647)
		})

		it('should keep "no estimate" as no estimate', () => {
			// GIVEN a run that offered the lookup without pricing it
			// THEN that stays a missing estimate rather than becoming a number
			expect(settle(null)).toBe(null)
			expect(settle(undefined)).toBe(null)
		})

		it('should refuse a price that is not a number at all', () => {
			// GIVEN findings that reached here without passing the decoder, so the
			// figure is still a string, a flag or an object
			// THEN none of them is treated as a price
			expect(settle('12')).toBe(null)
			expect(settle(true)).toBe(null)
			expect(settle({ amount: 5 })).toBe(null)
			expect(settle(Number.NaN)).toBe(null)
			expect(settle(Number.POSITIVE_INFINITY)).toBe(null)
		})
	})

	describe('when a fixed-cost action names a price cents cannot count', () => {
		it('should charge what the tool costs, whatever was written', () => {
			// GIVEN a register lookup offered at a fraction of a cent
			const stamped = withProposalIds({
				pending_paid_actions: [
					{ tool: 'registry_lookup', args: {}, estimated_cents: 0.05 },
				],
			}) as {
				pending_paid_actions: Array<{ estimated_cents: number }>
			}

			// THEN the real cost replaces it, as it does for any other figure
			expect(stamped.pending_paid_actions[0]?.estimated_cents).toBe(29)
		})
	})

	describe('when a tool name is written loosely', () => {
		const settledTool = (tool: unknown): string =>
			(
				withProposalIds({
					pending_paid_actions: [{ tool, args: {} }],
				}) as { pending_paid_actions: Array<{ tool: unknown }> }
			).pending_paid_actions[0]?.tool as string

		it('should read past the spacing and the capitals', () => {
			// GIVEN the same tool written with stray spacing and mixed case
			// THEN each resolves to the real tool behind it
			expect(settledTool('  Registry_Lookup  ')).toBe('registry_lookup')
			expect(settledTool('EMAIL_FINDER')).toBe('discover_contacts')
			expect(settledTool('\tHunter\n')).toBe('discover_contacts')
		})

		it('should not mistake a name every object carries for a tool', () => {
			// GIVEN names that exist on any object rather than in the tool list
			const stamped = withProposalIds({
				pending_paid_actions: [
					{ tool: 'toString', args: {} },
					{ tool: 'constructor', args: {} },
				],
			}) as { pending_paid_actions: Array<{ status: string }> }

			// THEN neither is taken for a real tool
			expect(stamped.pending_paid_actions[0]?.status).toBe('unsupported')
			expect(stamped.pending_paid_actions[1]?.status).toBe('unsupported')
		})

		it('should treat a nameless or non-text tool as naming nothing', () => {
			// GIVEN a tool that is blank, or is not written as text at all
			const stamped = withProposalIds({
				pending_paid_actions: [
					{ tool: '', args: {}, estimated_cents: 5 },
					{ tool: '   ', args: {}, estimated_cents: 5 },
					{ tool: 42, args: {}, estimated_cents: 5 },
					{ args: {}, estimated_cents: 5 },
				],
			}) as {
				pending_paid_actions: Array<{
					status: string
					estimated_cents: number | null
				}>
			}

			// THEN each is kept to read but waits on nobody, and shows no price
			for (const action of stamped.pending_paid_actions) {
				expect(action.status).toBe('unsupported')
				expect(action.estimated_cents).toBe(null)
			}
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
