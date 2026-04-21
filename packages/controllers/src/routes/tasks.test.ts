import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	BulkCompleteInput,
	CreateTaskInput,
	RescheduleInput,
	SnoozeInput,
	UpdateTaskInput,
} from './tasks'

// Decode through the canonical JSON codec — mirrors the HttpApi wire format so
// ISO strings → DateTime.Utc, etc. `decodeUnknownSync` alone would reject the
// string form and expect a pre-built DateTime.Utc object.
const decode = <S extends Schema.Decoder<unknown>>(
	schema: S,
	input: unknown,
): S['Type'] => Schema.decodeUnknownSync(Schema.toCodecJson(schema))(input)

const decodeExit = <S extends Schema.Decoder<unknown>>(
	schema: S,
	input: unknown,
) => Schema.decodeUnknownExit(Schema.toCodecJson(schema))(input)

describe('CreateTaskInput', () => {
	it('should accept the minimal required shape', () => {
		// GIVEN a payload with only the two required fields (`type`, `title`)
		// WHEN decode runs
		// THEN it succeeds and leaves optional fields absent
		const out = decode(CreateTaskInput, { type: 'call', title: 'Call Acme' })
		expect(out.type).toBe('call')
		expect(out.title).toBe('Call Acme')
	})

	it('should reject an empty title', () => {
		// GIVEN a payload where title is an empty string
		// WHEN decode runs
		// THEN it fails (Schema.isMinLength(1) guards against whitespace-only titles
		// leaking into the inbox)
		const exit = decodeExit(CreateTaskInput, { type: 'call', title: '' })
		expect(exit._tag).toBe('Failure')
	})

	it('should reject an invalid status literal', () => {
		// GIVEN a payload with status='archived' (not in the TaskStatus union)
		// WHEN decode runs
		// THEN it fails — the status literals are the DB CHECK mirror, not free text
		const exit = decodeExit(CreateTaskInput, {
			type: 'call',
			title: 'x',
			status: 'archived',
		})
		expect(exit._tag).toBe('Failure')
	})

	it('should reject an invalid priority literal', () => {
		// GIVEN priority='urgent' (we only allow low|normal|high)
		const exit = decodeExit(CreateTaskInput, {
			type: 'call',
			title: 'x',
			priority: 'urgent',
		})
		expect(exit._tag).toBe('Failure')
	})

	it('should reject an invalid source literal', () => {
		// GIVEN source='cron' (we only allow user|agent|webhook|email|booking)
		const exit = decodeExit(CreateTaskInput, {
			type: 'call',
			title: 'x',
			source: 'cron',
		})
		expect(exit._tag).toBe('Failure')
	})

	it('should accept all linked_* ids simultaneously', () => {
		// GIVEN a payload carrying each linked_* optional
		// WHEN decode runs
		// THEN every id round-trips as a string (no coercion at this layer)
		const out = decode(CreateTaskInput, {
			type: 'followup',
			title: 'Follow up',
			linkedInteractionId: 'in-1',
			linkedCalendarEventId: 'ce-1',
			linkedThreadLinkId: 'tl-1',
			linkedProposalId: 'pr-1',
		})
		expect(out.linkedInteractionId).toBe('in-1')
		expect(out.linkedCalendarEventId).toBe('ce-1')
		expect(out.linkedThreadLinkId).toBe('tl-1')
		expect(out.linkedProposalId).toBe('pr-1')
	})

	it('should decode dueAt from an ISO UTC string into a DateTime', () => {
		// GIVEN dueAt as an ISO-8601 UTC string
		// WHEN decode runs
		// THEN the runtime value is an Effect DateTime (not a raw Date)
		const out = decode(CreateTaskInput, {
			type: 'call',
			title: 'x',
			dueAt: '2026-05-01T10:00:00.000Z',
		})
		expect(out.dueAt).toBeDefined()
	})

	it('should reject dueAt values that are not valid ISO strings', () => {
		// GIVEN dueAt='tomorrow' — natural-language parsing belongs to the Forja
		// quick-add layer, not the HTTP spec
		const exit = decodeExit(CreateTaskInput, {
			type: 'call',
			title: 'x',
			dueAt: 'tomorrow',
		})
		expect(exit._tag).toBe('Failure')
	})
})

describe('UpdateTaskInput', () => {
	it('should accept an entirely empty payload (nothing to change)', () => {
		// GIVEN the empty object
		// WHEN decode runs
		// THEN it succeeds — the server treats PATCH with no diff as a no-op
		const out = decode(UpdateTaskInput, {})
		expect(Object.keys(out)).toHaveLength(0)
	})

	it('should accept null to clear nullable fields', () => {
		// GIVEN explicit null for `notes`, `assigneeId`, `dueAt`, `snoozedUntil`
		// WHEN decode runs
		// THEN each null round-trips (so the server can distinguish "clear" from
		// "leave as-is" using schema-level NullOr)
		const out = decode(UpdateTaskInput, {
			notes: null,
			assigneeId: null,
			dueAt: null,
			snoozedUntil: null,
			companyId: null,
			contactId: null,
			metadata: null,
		})
		expect(out.notes).toBeNull()
		expect(out.assigneeId).toBeNull()
		expect(out.dueAt).toBeNull()
		expect(out.snoozedUntil).toBeNull()
	})

	it('should reject status transitions outside the task lifecycle literals', () => {
		// GIVEN status='archived'
		const exit = decodeExit(UpdateTaskInput, { status: 'archived' })
		expect(exit._tag).toBe('Failure')
	})
})

describe('SnoozeInput', () => {
	it('should require the until field (no default)', () => {
		// GIVEN an empty object
		// WHEN decode runs
		// THEN it fails — snoozing indefinitely isn't a state we model
		const exit = decodeExit(SnoozeInput, {})
		expect(exit._tag).toBe('Failure')
	})

	it('should decode a future ISO timestamp', () => {
		// GIVEN until as an ISO UTC string
		const out = decode(SnoozeInput, { until: '2026-05-01T10:00:00.000Z' })
		expect(out.until).toBeDefined()
	})
})

describe('RescheduleInput', () => {
	it('should accept dueAt=null to clear the due date', () => {
		// GIVEN dueAt=null (reschedule to "no due date")
		const out = decode(RescheduleInput, { dueAt: null })
		expect(out.dueAt).toBeNull()
	})

	it('should decode dueAt from an ISO timestamp', () => {
		const out = decode(RescheduleInput, {
			dueAt: '2026-05-10T12:00:00.000Z',
		})
		expect(out.dueAt).toBeDefined()
	})
})

describe('BulkCompleteInput', () => {
	it('should accept a non-empty array of ids', () => {
		// GIVEN two task ids
		const out = decode(BulkCompleteInput, { ids: ['t-1', 't-2'] })
		expect(out.ids).toEqual(['t-1', 't-2'])
	})

	it('should reject an empty ids array', () => {
		// GIVEN no ids — there is nothing to complete
		// WHEN decode runs
		// THEN it fails (Schema.isMinLength(1)) so the server never issues a
		// no-op UPDATE … WHERE id IN ()
		const exit = decodeExit(BulkCompleteInput, { ids: [] })
		expect(exit._tag).toBe('Failure')
	})
})
