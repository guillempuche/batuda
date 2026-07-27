import { describe, expect, it } from 'vitest'

import { decidePoll, deriveProgress, narrowEvents } from './event-shapes'

describe('narrowEvents', () => {
	it('should keep well-formed events and default missing pieces', () => {
		// GIVEN a mix of a full event and one missing timestamp/data
		// THEN each kept event has a type, a string timestamp, and an object data
		const out = narrowEvents([
			{ type: 'tool.called', timestamp: 't1', data: { phase: 1 } },
			{ type: 'run.started' },
		])
		expect(out).toHaveLength(2)
		expect(out[1]).toEqual({ type: 'run.started', timestamp: '', data: {} })
	})

	it('should drop entries that are not objects or lack a type', () => {
		// GIVEN junk in the array
		// THEN only the typed object survives
		const out = narrowEvents([null, 'nope', 42, { data: {} }, { type: 'ok' }])
		expect(out).toHaveLength(1)
		expect(out[0]?.type).toBe('ok')
	})
})

describe('deriveProgress', () => {
	it('should take the newest phase and active tool', () => {
		// GIVEN a sequence of phase-1 then phase-2 tool calls
		// WHEN the events are folded together
		// THEN progress reflects only the latest phase and tool
		const progress = deriveProgress([
			{ type: 'run.started', timestamp: '', data: {} },
			{
				type: 'tool.called',
				timestamp: '',
				data: { phase: 1, tool: 'llm.generateText' },
			},
			{
				type: 'tool.called',
				timestamp: '',
				data: { phase: 2, tool: 'llm.generateObject' },
			},
		])
		expect(progress.phase).toBe(2)
		expect(progress.activeTool).toBe('llm.generateObject')
	})

	it('should surface a reported source count and default the rest to null', () => {
		// GIVEN an events stream that only reports a source count
		// WHEN the events are folded together
		// THEN sourceCount is set while phase/tool stay null
		const progress = deriveProgress([
			{ type: 'run.no_reliable_data', timestamp: '', data: { sourceCount: 3 } },
		])
		expect(progress.sourceCount).toBe(3)
		expect(progress.phase).toBeNull()
		expect(progress.activeTool).toBeNull()
	})
})

describe('decidePoll', () => {
	const base = {
		enabled: true,
		done: false,
		failed: false,
		newEventCount: 0,
		emptyPolls: 0,
		maxEmptyPolls: 5,
	}

	it('should stop when disabled, done, or failed', () => {
		// GIVEN any terminal condition
		// THEN the loop stops
		expect(decidePoll({ ...base, enabled: false })).toBe('stop')
		expect(decidePoll({ ...base, done: true })).toBe('stop')
		expect(decidePoll({ ...base, failed: true })).toBe('stop')
	})

	it('should stop once the empty-poll cap is reached', () => {
		// GIVEN too many empty polls in a row
		// THEN the loop gives up rather than spinning forever
		expect(decidePoll({ ...base, emptyPolls: 5 })).toBe('stop')
	})

	it('should re-arm immediately when new events arrived', () => {
		// GIVEN the long-poll returned events
		// THEN poll again straight away (the server already blocked up to 30s)
		expect(decidePoll({ ...base, newEventCount: 2 })).toBe('poll-now')
	})

	it('should back off when a poll returned nothing', () => {
		// GIVEN an empty poll under the cap
		// THEN wait before retrying to avoid a request storm
		expect(decidePoll({ ...base, newEventCount: 0, emptyPolls: 1 })).toBe(
			'poll-later',
		)
	})
})
