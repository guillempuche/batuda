import { describe, expect, it } from 'vitest'

import { goneFrame, liveFrame, toolFromEvent } from './research-live-frame'

// A run partway through gathering, as the database holds it: one phase finished,
// some spend, a few companies written down.
const row = {
	status: 'running',
	phase: 1,
	progressSteps: 7,
	costCents: 42,
	paidCostCents: 8,
	budgetCents: 300,
	paidBudgetCents: 100,
	sourceCount: 12,
	hasFindings: true,
	foundCount: 5,
	pendingProposalCount: 2,
}

describe('liveFrame', () => {
	describe('when a run is working', () => {
		it('should name the phase it is on, not the last one it finished', () => {
			// GIVEN a running run whose column says one phase is behind it
			// THEN the frame names the next one, because the column counts what is
			// done — read straight, it had a run gathering evidence report as not
			// started, and one writing the brief report as still extracting
			expect(liveFrame({ ...row, phase: 0 }, null).phase).toBe(1)
			expect(liveFrame({ ...row, phase: 1 }, null).phase).toBe(2)
			expect(liveFrame({ ...row, phase: 2 }, null).phase).toBe(3)
		})

		it('should not count past the last phase there is', () => {
			// GIVEN a row claiming more finished phases than the run has
			// THEN the frame still names the final one rather than a fourth
			expect(liveFrame({ ...row, phase: 3 }, null).phase).toBe(3)
		})
	})

	describe('when a run has been asked for but not started', () => {
		it('should name no phase at all', () => {
			// GIVEN a queued run: nothing has picked it up, so no phase is finished
			const frame = liveFrame({ ...row, status: 'queued', phase: 0 }, null)

			// THEN it is on no phase — reading the column as "none done, so it must
			// be on the first" had the page announce a run was gathering evidence
			// before the engine had touched it
			expect(frame.phase).toBeNull()
			expect(frame.done).toBe(false)
		})
	})

	describe('when a run is over', () => {
		it('should name no phase and mark itself finished', () => {
			// GIVEN each of the endings a run can reach
			for (const status of [
				'succeeded',
				'succeeded_low_confidence',
				'failed',
				'cancelled',
				'no_reliable_data',
			]) {
				const frame = liveFrame({ ...row, status, phase: 3 }, null)

				// THEN there is no phase underway, and the watcher is told to stop
				expect(frame.phase).toBeNull()
				expect(frame.done).toBe(true)
			}
		})
	})

	describe('when a run has written nothing down yet', () => {
		it('should give no counts rather than zero', () => {
			// GIVEN a run whose findings are still empty, so the counts the database
			// returned mean nothing
			const frame = liveFrame(
				{ ...row, hasFindings: false, foundCount: 0, pendingProposalCount: 0 },
				null,
			)

			// THEN neither count is offered: zero would say it looked and found
			// none, which is a different answer from not having looked yet
			expect(frame.foundCount).toBeNull()
			expect(frame.pendingProposalCount).toBeNull()
		})
	})

	describe('when the run hunts for no list of its own', () => {
		it('should pass the absence through rather than inventing a zero', () => {
			// GIVEN a brief, which has no list of companies for the database to count
			const frame = liveFrame({ ...row, foundCount: null }, null)

			// THEN there is still nothing to report, even though it has findings
			expect(frame.foundCount).toBeNull()
			expect(frame.pendingProposalCount).toBe(2)
		})
	})

	describe('when the run named a tool', () => {
		it('should carry it, since the row does not keep it', () => {
			// GIVEN the tool the last event announced
			// THEN it rides along with the figures read off the row
			expect(liveFrame(row, 'llm.generateText').activeTool).toBe(
				'llm.generateText',
			)
			expect(liveFrame(row, null).activeTool).toBeNull()
		})
	})
})

describe('goneFrame', () => {
	describe('when a run disappears under somebody watching it', () => {
		it('should say it is gone and finished, and claim no phase', () => {
			// GIVEN the last frame a watcher saw before the run was deleted
			const frame = goneFrame(liveFrame(row, 'llm.generateText'))

			// THEN it is marked gone and over, so the page stops waiting and asks the
			// run for itself — and it is on no phase, having no work left
			expect(frame.status).toBe('deleted')
			expect(frame.done).toBe(true)
			expect(frame.phase).toBeNull()
		})
	})
})

describe('toolFromEvent', () => {
	describe('when the run reaches for a tool and finishes with it', () => {
		it('should name it on the call and take the name back on the result', () => {
			// GIVEN the pair of events one tool call produces
			// THEN the call names the tool, and the result says nothing is running —
			// left unhandled, the last tool stood over every phase that followed
			expect(
				toolFromEvent({
					type: 'tool.called',
					data: { tool: 'llm.generateText' },
				}),
			).toEqual({ tool: 'llm.generateText' })
			expect(toolFromEvent({ type: 'tool.result', data: {} })).toEqual({
				tool: null,
			})
		})
	})

	describe('when an event says nothing about a tool', () => {
		it('should leave whatever is held alone', () => {
			// GIVEN events of other kinds, and malformed ones
			// THEN each declines to answer, so the caller keeps what it had
			expect(toolFromEvent({ type: 'run.started', data: {} })).toBeNull()
			expect(toolFromEvent({ type: 'tool.called', data: {} })).toBeNull()
			expect(
				toolFromEvent({ type: 'tool.called', data: { tool: 7 } }),
			).toBeNull()
			expect(toolFromEvent({ type: 'tool.called' })).toBeNull()
			expect(toolFromEvent(null)).toBeNull()
		})
	})
})
