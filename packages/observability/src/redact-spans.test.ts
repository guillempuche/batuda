// The AI toolkit records every tool call's arguments on the current span, and
// those arguments include a mailbox password and whole attached files. With
// tracing switched on that is a credential leaving for a third party in the
// clear. These pin the scrubbing that stops it.

import { Option, type Tracer } from 'effect'
import { describe, expect, it } from 'vitest'

import { redactFacts, redactingTracer } from './redact-spans'

// A tracer that keeps what it was told, so a test can read it back.
const recordingTracer = () => {
	const recorded = new Map<string, unknown>()
	const span: Tracer.Span = {
		_tag: 'Span',
		spanId: 'span',
		traceId: 'trace',
		name: 'test',
		sampled: true,
		parent: Option.none(),
		status: { _tag: 'Started', startTime: 0n },
		attributes: recorded,
		links: [],
		kind: 'internal',
		attribute(key: string, value: unknown) {
			recorded.set(key, value)
		},
		event() {},
		end() {},
		addLinks() {},
	} as unknown as Tracer.Span
	const tracer = { span: () => span } as unknown as Tracer.Tracer
	return { tracer, recorded }
}

const newSpan = (tracer: Tracer.Tracer) =>
	tracer.span({
		name: 'test',
		parent: Option.none(),
		annotations: undefined as never,
		links: [],
		startTime: 0n,
		kind: 'internal',
		root: true,
		sampled: true,
	})

describe('redactingTracer', () => {
	describe('when a span records the arguments a caller sent', () => {
		it('should keep none of them, not even the ones that look harmless', () => {
			// GIVEN a tool call carrying a mailbox password among its arguments
			const { tracer, recorded } = recordingTracer()
			const span = newSpan(redactingTracer(tracer))

			// WHEN the toolkit records them on the span
			span.attribute('parameters', {
				action: 'create',
				email: 'someone@example.com',
				password: 'hunter2',
			})

			// THEN nothing of the value survives — not the password, and not the
			// fields beside it, because the next secret added would sit there too
			const stored = JSON.stringify(recorded.get('parameters'))
			expect(stored).not.toContain('hunter2')
			expect(stored).not.toContain('someone@example.com')
			expect(stored).not.toContain('create')
		})

		it('should keep nothing of an attached file either', () => {
			// GIVEN an attachment upload, whose argument is the file itself
			const { tracer, recorded } = recordingTracer()
			const span = newSpan(redactingTracer(tracer))

			// WHEN the toolkit records it
			span.attribute('parameters', { content_base64: 'QUJDREVGRw==' })

			// THEN the bytes do not leave with the span
			expect(JSON.stringify(recorded.get('parameters'))).not.toContain(
				'QUJDREVGRw==',
			)
		})
	})

	describe('when a span records something it named deliberately', () => {
		it('should leave it alone, so tracing still says anything at all', () => {
			// GIVEN the attributes our own code sets, each named on purpose
			const { tracer, recorded } = recordingTracer()
			const span = newSpan(redactingTracer(tracer))

			// WHEN they are recorded
			span.attribute('tool', 'manage_email_inbox')
			span.attribute('mcp.org_id', 'org_123')
			span.attribute('mcp.auth_method', 'api_key')

			// THEN every one survives — scrubbing everything would leave nothing to
			// debug from, so only the catch-all argument bag is emptied
			expect(recorded.get('tool')).toBe('manage_email_inbox')
			expect(recorded.get('mcp.org_id')).toBe('org_123')
			expect(recorded.get('mcp.auth_method')).toBe('api_key')
		})
	})
})

// Wrapping the tracer protects span attributes only. Facts gathered onto a log
// line leave by a different door, so the same rule has to apply there or the
// wrapper is a door with a hole beside it.
describe('redactFacts', () => {
	describe('when a fact holds whatever a caller sent', () => {
		it('should replace the whole value', () => {
			// GIVEN facts carrying the catch-all argument bag
			const facts = {
				tool: 'manage_email_inbox',
				parameters: { email: 'someone@example.com', password: 'hunter2' },
			}

			// WHEN filtered
			const safe = redactFacts(facts)

			// THEN nothing of the bag survives, and the deliberate attribute does
			expect(JSON.stringify(safe)).not.toContain('hunter2')
			expect(JSON.stringify(safe)).not.toContain('someone@example.com')
			expect(safe['tool']).toBe('manage_email_inbox')
		})

		it('should leave the caller their original object', () => {
			// GIVEN facts the caller may still be using
			const facts = { parameters: { password: 'hunter2' } }

			// WHEN filtered
			redactFacts(facts)

			// THEN the input is untouched — filtering returns a copy rather than
			// reaching back into the caller's object
			expect(JSON.stringify(facts)).toContain('hunter2')
		})
	})

	describe('when no fact needs filtering', () => {
		it('should hand back the same object rather than a copy', () => {
			// GIVEN ordinary facts, which is nearly every call
			const facts = { 'org.id': 'org_1', 'auth.method': 'api_key' }

			// WHEN filtered
			// THEN the common case costs no copy at all
			expect(redactFacts(facts)).toBe(facts)
		})
	})
})
