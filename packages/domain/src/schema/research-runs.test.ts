import { describe, expect, it } from 'vitest'

import {
	ATTENTION_RESEARCH_STATUSES,
	isActiveResearchStatus,
	isAttentionResearchStatus,
	isSucceededResearchStatus,
	isTerminalResearchEvent,
	isTerminalResearchStatus,
	TERMINAL_RESEARCH_EVENTS,
	TERMINAL_RESEARCH_STATUSES,
} from './research-runs'

// Spelled out because there is no list to import: a status counts as active
// precisely when it is not one that ends a run.
const ACTIVE_STATUSES = ['queued', 'running'] as const

describe('isTerminalResearchStatus', () => {
	describe('when the run has stopped', () => {
		it('should report every status that ends a run', () => {
			// GIVEN each status the domain lists as ending a run
			// WHEN each one is checked
			// THEN all of them read as terminal, so anything waiting on a run
			// stops on every one of them
			for (const status of TERMINAL_RESEARCH_STATUSES) {
				expect(isTerminalResearchStatus(status)).toBe(true)
			}
		})

		it('should count a deleted run as finished', () => {
			// GIVEN a run someone soft-deleted while it was in flight
			// WHEN its status is checked
			// THEN it reads as terminal, so a caller stops instead of waiting on
			// a run that will never move again
			expect(isTerminalResearchStatus('deleted')).toBe(true)
		})
	})

	describe('when the run may still change', () => {
		it('should reject the statuses a run passes through', () => {
			// GIVEN the two statuses a run holds before it stops
			// WHEN each one is checked
			// THEN neither reads as terminal
			for (const status of ACTIVE_STATUSES) {
				expect(isTerminalResearchStatus(status)).toBe(false)
			}
		})
	})

	describe('when the value is not a status at all', () => {
		it('should reject an unknown or empty string rather than guessing', () => {
			// GIVEN values that no run ever carries
			// WHEN each one is checked
			// THEN none of them reads as terminal, so a caller handed a mistyped
			// status keeps waiting instead of stopping early
			for (const value of ['', 'unknown', 'Succeeded', 'done']) {
				expect(isTerminalResearchStatus(value)).toBe(false)
			}
		})
	})
})

describe('isActiveResearchStatus', () => {
	describe('when compared against the terminal check', () => {
		it('should be its exact opposite for every known status', () => {
			// GIVEN every status a run can hold
			// WHEN both checks run over each one
			// THEN they always disagree, so the two can't drift apart
			for (const status of [
				...TERMINAL_RESEARCH_STATUSES,
				...ACTIVE_STATUSES,
			]) {
				expect(isActiveResearchStatus(status)).toBe(
					!isTerminalResearchStatus(status),
				)
			}
		})
	})

	describe('when the run is still working', () => {
		it('should report queued and running as active', () => {
			// GIVEN a run waiting for a slot, and one doing the work
			// WHEN each status is checked
			// THEN both read as active
			for (const status of ACTIVE_STATUSES) {
				expect(isActiveResearchStatus(status)).toBe(true)
			}
		})
	})
})

describe('isAttentionResearchStatus', () => {
	describe('when a finished run needs a person to look', () => {
		it('should report the three outcomes that want review', () => {
			// GIVEN a failed run, one that found nothing usable, and one whose
			// answer the engine flagged as shaky
			// WHEN each status is checked
			// THEN each asks for attention
			for (const status of ATTENTION_RESEARCH_STATUSES) {
				expect(isAttentionResearchStatus(status)).toBe(true)
			}
		})

		it('should only list statuses of runs that already stopped', () => {
			// GIVEN the statuses that ask for attention
			// WHEN each is checked against the ones that end a run
			// THEN every one has already stopped — asking a person to review a
			// run still in flight would be premature
			for (const status of ATTENTION_RESEARCH_STATUSES) {
				expect(isTerminalResearchStatus(status)).toBe(true)
			}
		})
	})

	describe('when the run finished cleanly or is still going', () => {
		it('should leave a plain success alone', () => {
			// GIVEN a run that succeeded with confidence
			// WHEN its status is checked
			// THEN it does not ask for attention, even though it has stopped
			expect(isAttentionResearchStatus('succeeded')).toBe(false)
			expect(isSucceededResearchStatus('succeeded')).toBe(true)
		})

		it('should leave cancelled, deleted and in-flight runs alone', () => {
			// GIVEN runs that stopped on purpose, were removed, or are still
			// working — none of which is an unreviewed result
			// WHEN each status is checked
			// THEN none of them asks for attention
			for (const status of ['cancelled', 'deleted', ...ACTIVE_STATUSES]) {
				expect(isAttentionResearchStatus(status)).toBe(false)
			}
		})
	})
})

describe('isTerminalResearchEvent', () => {
	describe('when a run announces that it stopped', () => {
		it('should report each announced ending', () => {
			// GIVEN each event a run publishes when it stops
			// WHEN each one is checked
			// THEN all of them end a listener's wait
			for (const event of TERMINAL_RESEARCH_EVENTS) {
				expect(isTerminalResearchEvent(event)).toBe(true)
			}
		})
	})

	describe('when an ending is never announced', () => {
		it('should not wait for a deletion or a low-confidence success', () => {
			// GIVEN two endings that exist as statuses but are never published as
			// events — a run is removed from outside itself, and a shaky success
			// still goes out as a plain success
			// WHEN each is checked
			// THEN neither ends a listener's wait, which is why the event list is
			// written out rather than built from the status list
			expect(isTerminalResearchEvent('run.deleted')).toBe(false)
			expect(isTerminalResearchEvent('run.succeeded_low_confidence')).toBe(
				false,
			)
		})
	})

	describe('when the event is part of a run in progress', () => {
		it('should reject start, tool and refining events', () => {
			// GIVEN events published while a run is working
			// WHEN each one is checked
			// THEN none of them ends a listener's wait
			for (const event of [
				'run.started',
				'run.refining',
				'tool.called',
				'tool.result',
				'provider.circuit_open',
				'',
			]) {
				expect(isTerminalResearchEvent(event)).toBe(false)
			}
		})
	})
})
