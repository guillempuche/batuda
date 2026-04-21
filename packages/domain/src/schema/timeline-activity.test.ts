import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	TimelineDirection,
	TimelineEntityType,
	TimelineKind,
} from './timeline-activity'

const decodeExit = <S extends Schema.Decoder<unknown>>(
	schema: S,
	input: unknown,
) => Schema.decodeUnknownExit(schema)(input)

describe('TimelineKind', () => {
	it('should accept every legacy kind', () => {
		// GIVEN kinds that existed before the calendar plan
		// WHEN each is decoded independently
		// THEN every one round-trips — guards against an additive PR
		// accidentally removing an existing kind the timeline already emits
		for (const value of [
			'email_sent',
			'email_received',
			'call_logged',
			'document_created',
			'proposal_sent',
			'proposal_viewed',
			'proposal_responded',
			'research_run',
			'system_event',
		] as const) {
			expect(Schema.decodeUnknownSync(TimelineKind)(value)).toBe(value)
		}
	})

	it('should accept the four new meeting kinds', () => {
		// GIVEN the meeting lifecycle kinds added in the calendar plan (§12)
		// WHEN each is decoded
		// THEN all round-trip — CalendarService writes these during ingest
		// and webhook handling and the feed UI matches against this exact set
		for (const value of [
			'meeting_scheduled',
			'meeting_rescheduled',
			'meeting_cancelled',
			'meeting_rsvp',
		] as const) {
			expect(Schema.decodeUnknownSync(TimelineKind)(value)).toBe(value)
		}
	})

	it('should accept the three new task kinds', () => {
		// GIVEN the task audit kinds added in the calendar plan (§12)
		// WHEN each is decoded
		// THEN all round-trip — MCP tasks tools + UI undo drawer both read
		// these kinds to render the agent badge
		for (const value of [
			'task_created',
			'task_updated',
			'task_completed',
		] as const) {
			expect(Schema.decodeUnknownSync(TimelineKind)(value)).toBe(value)
		}
	})

	it('should reject unknown kinds like "meeting_ended"', () => {
		// GIVEN 'meeting_ended' (close to a real kind but not modelled — the
		// existing 'meeting_cancelled' covers the end-of-life case)
		// THEN decode fails
		const exit = decodeExit(TimelineKind, 'meeting_ended')
		expect(exit._tag).toBe('Failure')
	})
})

describe('TimelineEntityType', () => {
	it('should accept every legacy entity type', () => {
		// GIVEN entity types that existed before the calendar plan
		// WHEN each is decoded
		// THEN every one round-trips
		for (const value of [
			'email_message',
			'interaction',
			'call_recording',
			'document',
			'proposal',
			'research_run',
			'system',
		] as const) {
			expect(Schema.decodeUnknownSync(TimelineEntityType)(value)).toBe(value)
		}
	})

	it('should accept the two new entity types', () => {
		// GIVEN 'calendar_event' and 'task' (added in the calendar plan §12)
		// WHEN each is decoded
		// THEN both round-trip — timeline rows for meetings point at
		// entity_type='calendar_event' and for tasks at entity_type='task',
		// so the feed query can filter precisely
		for (const value of ['calendar_event', 'task'] as const) {
			expect(Schema.decodeUnknownSync(TimelineEntityType)(value)).toBe(value)
		}
	})

	it('should reject unknown entity types like "meeting"', () => {
		// GIVEN 'meeting' (it would be tempting to use this but the plan
		// deliberately uses 'calendar_event' to match the table name)
		// THEN decode fails
		const exit = decodeExit(TimelineEntityType, 'meeting')
		expect(exit._tag).toBe('Failure')
	})
})

describe('TimelineDirection', () => {
	it('should accept inbound | outbound', () => {
		// GIVEN the two modelled directions
		// WHEN each is decoded
		// THEN both round-trip
		for (const value of ['inbound', 'outbound'] as const) {
			expect(Schema.decodeUnknownSync(TimelineDirection)(value)).toBe(value)
		}
	})

	it('should reject unknown directions like "internal"', () => {
		// GIVEN 'internal' — meeting_rsvp / task_* rows use direction=NULL for
		// this case (modelled via NullOr on the row), not a third literal
		// THEN decode fails
		const exit = decodeExit(TimelineDirection, 'internal')
		expect(exit._tag).toBe('Failure')
	})
})
