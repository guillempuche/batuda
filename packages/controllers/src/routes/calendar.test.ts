import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { CreateInternalEventInput, RsvpEventInput } from './calendar'

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

describe('CreateInternalEventInput', () => {
	it('should accept the minimal required shape', () => {
		// GIVEN a payload with only `title`, `startAt`, `endAt`
		// WHEN decode runs
		// THEN locationType defaults to absent (handler applies 'none'), no error
		const out = decode(CreateInternalEventInput, {
			title: 'Focus block',
			startAt: '2026-05-01T09:00:00.000Z',
			endAt: '2026-05-01T10:00:00.000Z',
		})
		expect(out.title).toBe('Focus block')
	})

	it('should reject an empty title', () => {
		// GIVEN title=''
		// WHEN decode runs
		// THEN it fails — a blank title would render as a stripe in /calendar
		const exit = decodeExit(CreateInternalEventInput, {
			title: '',
			startAt: '2026-05-01T09:00:00.000Z',
			endAt: '2026-05-01T10:00:00.000Z',
		})
		expect(exit._tag).toBe('Failure')
	})

	it('should reject an invalid locationType literal', () => {
		// GIVEN locationType='skype' (not in the CalendarLocationType union)
		const exit = decodeExit(CreateInternalEventInput, {
			title: 'x',
			startAt: '2026-05-01T09:00:00.000Z',
			endAt: '2026-05-01T10:00:00.000Z',
			locationType: 'skype',
		})
		expect(exit._tag).toBe('Failure')
	})

	it('should accept each locationType literal', () => {
		// GIVEN the five allowed values
		// WHEN each is decoded independently
		// THEN all five succeed (pins the enum against future accidental removals)
		for (const kind of ['video', 'phone', 'address', 'link', 'none'] as const) {
			const out = decode(CreateInternalEventInput, {
				title: 'x',
				startAt: '2026-05-01T09:00:00.000Z',
				endAt: '2026-05-01T10:00:00.000Z',
				locationType: kind,
			})
			expect(out.locationType).toBe(kind)
		}
	})

	it('should accept nullable locationValue, companyId, contactId, metadata', () => {
		// GIVEN all nullable optionals set to null
		const out = decode(CreateInternalEventInput, {
			title: 'x',
			startAt: '2026-05-01T09:00:00.000Z',
			endAt: '2026-05-01T10:00:00.000Z',
			locationValue: null,
			companyId: null,
			contactId: null,
			metadata: null,
		})
		expect(out.locationValue).toBeNull()
		expect(out.companyId).toBeNull()
		expect(out.contactId).toBeNull()
	})

	it('should reject startAt/endAt values that are not ISO strings', () => {
		// GIVEN startAt='May 1st' (free text)
		const exit = decodeExit(CreateInternalEventInput, {
			title: 'x',
			startAt: 'May 1st',
			endAt: '2026-05-01T10:00:00.000Z',
		})
		expect(exit._tag).toBe('Failure')
	})

	// The endAt > startAt invariant lives on the handler (it needs to diff two
	// DateTime values and emit a BadRequest). Decode-layer only verifies
	// per-field shape; cross-field coherence is enforced server-side so the
	// client gets a structured domain error instead of a schema-level one.
})

describe('RsvpEventInput', () => {
	it('should require rsvp (no default)', () => {
		// GIVEN an empty object
		// WHEN decode runs
		// THEN it fails — we can't infer a default (accepted would be dangerous)
		const exit = decodeExit(RsvpEventInput, {})
		expect(exit._tag).toBe('Failure')
	})

	it('should accept each of the four rsvp literals', () => {
		// GIVEN the full CalendarAttendeeRsvp union
		// WHEN each is decoded independently
		// THEN all four succeed (protects against accidental enum drift)
		for (const rsvp of [
			'needs-action',
			'accepted',
			'declined',
			'tentative',
		] as const) {
			const out = decode(RsvpEventInput, { rsvp })
			expect(out.rsvp).toBe(rsvp)
		}
	})

	it('should reject unknown rsvp literals', () => {
		// GIVEN rsvp='maybe'
		const exit = decodeExit(RsvpEventInput, { rsvp: 'maybe' })
		expect(exit._tag).toBe('Failure')
	})

	it('should accept an optional free-text comment', () => {
		// GIVEN rsvp='declined' + a comment explaining why
		const out = decode(RsvpEventInput, {
			rsvp: 'declined',
			comment: 'Conflict with board meeting',
		})
		expect(out.comment).toBe('Conflict with board meeting')
	})
})
