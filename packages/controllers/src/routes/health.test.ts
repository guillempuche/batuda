// The health check is the one way to ask a running instance whether it is
// still reaching its telemetry backend, so what it will and will not carry over
// the wire is worth pinning. It is served without authentication.

import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { HealthResponse } from './health'

const encode = (input: unknown) =>
	Schema.encodeUnknownExit(Schema.toCodecJson(HealthResponse))(input)

const healthy = {
	status: 'ok',
	version: '2026.8.30',
	commit: 'a3cf4f0',
	region: 'fra',
	telemetry: {
		exporting: true,
		signals: {
			traces: { failing: false, lastSuccessAt: 1_788_199_862_000 },
			logs: { failing: false, lastSuccessAt: 1_788_199_862_000 },
			metrics: { failing: false, lastSuccessAt: 1_788_199_862_000 },
		},
	},
}

describe('the health response', () => {
	describe('when telemetry is flowing', () => {
		it('should carry the state of each kind of telemetry', () => {
			// GIVEN an instance exporting all three signals
			// WHEN the response is encoded for the wire
			const exit = encode(healthy)

			// THEN it is accepted
			expect(exit._tag).toBe('Success')
		})
	})

	describe('when a signal has never succeeded', () => {
		it('should accept the report with no last success to name', () => {
			// GIVEN traces that have been refused since boot, so there is no
			//       success to date — the state the 2026-08-31 outage left behind
			// WHEN the response is encoded
			const exit = encode({
				...healthy,
				telemetry: {
					exporting: true,
					signals: {
						traces: { failing: true, failure: 'unauthorized' },
						logs: { failing: true, failure: 'unauthorized' },
						metrics: { failing: true, failure: 'unauthorized' },
					},
				},
			})

			// THEN it is accepted without a `lastSuccessAt`
			expect(exit._tag).toBe('Success')
		})
	})

	describe('when the process exports nothing at all', () => {
		it('should say so rather than look like a healthy one', () => {
			// GIVEN local development, with no endpoint configured
			// WHEN the response is encoded
			const exit = encode({
				...healthy,
				telemetry: {
					exporting: false,
					signals: {
						traces: { failing: false },
						logs: { failing: false },
						metrics: { failing: false },
					},
				},
			})

			// THEN it is accepted, and `exporting` is what tells the two apart
			expect(exit._tag).toBe('Success')
		})
	})

	describe('when the clocks have been compared', () => {
		it('should carry how far apart they are', () => {
			// GIVEN an instance whose clock sits 7h25m behind the backend's — the
			//       state the production machines came back in on 2026-08-31, where
			//       everything is sent and accepted but stamped at the wrong moment
			// WHEN the response is encoded
			const exit = encode({
				...healthy,
				telemetry: { ...healthy.telemetry, clockOffsetSeconds: -26_700 },
			})

			// THEN the wire format carries it, negative meaning behind
			expect(exit._tag).toBe('Success')
		})

		it('should accept a report from a process that has not compared yet', () => {
			// GIVEN a process that has had no reply back to read a time from
			// WHEN the response is encoded without the field
			const exit = encode(healthy)

			// THEN it is accepted: absent means unknown, not zero
			expect(exit._tag).toBe('Success')
		})
	})

	describe('when a reason outside the known set is reported', () => {
		it('should be rejected', () => {
			// GIVEN a reason carrying something the backend said, rather than one of
			//       ours — the shape that would leak wording derived from a request
			//       whose headers hold the API key
			// WHEN the response is encoded
			const exit = encode({
				...healthy,
				telemetry: {
					exporting: true,
					signals: {
						traces: { failing: true, failure: 'unknown API key abcd1234' },
						logs: { failing: false },
						metrics: { failing: false },
					},
				},
			})

			// THEN the wire format refuses it
			expect(exit._tag).toBe('Failure')
		})
	})

	describe('whatever the state', () => {
		it('should carry no backend host and no status line', () => {
			// GIVEN a report that tries to add both
			// WHEN the response is encoded
			const exit = encode({
				...healthy,
				telemetry: {
					exporting: true,
					endpoint: 'api.eu1.honeycomb.io',
					signals: {
						traces: { failing: true, failure: 'rejected', status: 500 },
						logs: { failing: false },
						metrics: { failing: false },
					},
				},
			})

			// THEN neither survives: an unauthenticated endpoint names no vendor and
			//      no status
			expect(exit._tag).toBe('Success')
			const encoded = JSON.stringify(exit)
			expect(encoded).not.toContain('honeycomb')
			expect(encoded).not.toContain('500')
		})
	})
})
