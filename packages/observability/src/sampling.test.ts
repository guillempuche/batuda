// Thinning traces is only safe if a trace is kept or dropped whole. These pin
// that: half a trace exported is worse to read than none of it, and a route
// exempted for carrying a secret in its URL must never be revived here.

import { Option, type Tracer } from 'effect'
import { describe, expect, it } from 'vitest'

import { parseKeepRate, samplingTracer } from './sampling'

// A tracer that keeps the options it was handed, so a test can read the
// decision back.
const recordingTracer = () => {
	const seen: Array<{ sampled: boolean }> = []
	const tracer = {
		span: (options: { sampled: boolean }) => {
			seen.push({ sampled: options.sampled })
			return { sampled: options.sampled } as unknown as Tracer.Span
		},
	} as unknown as Tracer.Tracer
	return { tracer, seen }
}

const parentSpan = (sampled: boolean) =>
	({
		_tag: 'Span',
		spanId: 'parent',
		traceId: 'trace',
		sampled,
	}) as unknown as Tracer.AnySpan

const newSpan = (
	tracer: Tracer.Tracer,
	options?: {
		readonly parent?: Tracer.AnySpan
		readonly root?: boolean
		readonly sampled?: boolean
	},
) =>
	tracer.span({
		name: 'test',
		parent:
			options?.parent === undefined
				? Option.none()
				: Option.some(options.parent),
		annotations: undefined as never,
		links: [],
		startTime: 0n,
		kind: 'internal',
		root: options?.root ?? false,
		sampled: options?.sampled ?? true,
	})

describe('samplingTracer', () => {
	describe('when every trace is meant to be kept', () => {
		it('should keep a trace that starts here', () => {
			// GIVEN the default keep rate, which changes nothing
			const { tracer, seen } = recordingTracer()

			// WHEN a trace starts
			newSpan(samplingTracer(tracer, 1))

			// THEN it is kept
			expect(seen[0]?.sampled).toBe(true)
		})

		it('should still drop one something upstream already dropped', () => {
			// GIVEN a route exempted from tracing because its URL carries a token,
			// which reaches the tracer already marked as not to be sent
			const { tracer, seen } = recordingTracer()

			// WHEN it starts a span
			newSpan(samplingTracer(tracer, 1), { sampled: false })

			// THEN the keep rate does not revive it — the token must not be exported
			expect(seen[0]?.sampled).toBe(false)
		})
	})

	describe('when no trace is meant to be kept', () => {
		it('should drop a trace that starts here', () => {
			// GIVEN a keep rate of nothing
			const { tracer, seen } = recordingTracer()

			// WHEN a trace starts
			newSpan(samplingTracer(tracer, 0))

			// THEN it is dropped
			expect(seen[0]?.sampled).toBe(false)
		})
	})

	describe('when a span hangs below one already decided', () => {
		it('should keep a child of a kept trace even at a keep rate of nothing', () => {
			// GIVEN a trace already being kept
			const { tracer, seen } = recordingTracer()

			// WHEN a span opens below it, under a rate that would drop a new trace
			newSpan(samplingTracer(tracer, 0), { parent: parentSpan(true) })

			// THEN it is kept anyway — a kept trace missing its middle reads as a
			// gap in the work rather than as a span nobody sent
			expect(seen[0]?.sampled).toBe(true)
		})

		it('should drop a child of a dropped trace even when keeping everything', () => {
			// GIVEN a trace already dropped
			const { tracer, seen } = recordingTracer()

			// WHEN a span opens below it, under a rate that keeps everything
			newSpan(samplingTracer(tracer, 1), { parent: parentSpan(false) })

			// THEN it is dropped too, so no orphan arrives without its parent
			expect(seen[0]?.sampled).toBe(false)
		})

		it('should decide afresh when the span asks to start its own trace', () => {
			// GIVEN a kept parent in scope, but a span that asks to be a root
			const { tracer, seen } = recordingTracer()

			// WHEN it opens under a keep rate of nothing
			newSpan(samplingTracer(tracer, 0), {
				parent: parentSpan(true),
				root: true,
			})

			// THEN it takes its own decision rather than the parent's, because it is
			// a separate piece of work and not part of that trace
			expect(seen[0]?.sampled).toBe(false)
		})
	})

	describe('when only a share of traces is meant to be kept', () => {
		it('should keep some and drop some', () => {
			// GIVEN a rate that keeps half
			const { tracer, seen } = recordingTracer()
			const sampling = samplingTracer(tracer, 0.5)

			// WHEN many traces start
			for (let index = 0; index < 2000; index++) newSpan(sampling)

			// THEN the decision actually varies — an all-or-nothing outcome here
			// would mean the rate was being ignored
			const kept = seen.filter(span => span.sampled).length
			expect(kept).toBeGreaterThan(0)
			expect(kept).toBeLessThan(seen.length)
		})
	})
})

// The keep rate is read from an env var, so what a typo does matters more than
// what a correct value does. These pin that nothing unusable can either stop the
// process or silently switch tracing off.
describe('parseKeepRate', () => {
	describe('when the value is usable', () => {
		it('should keep it as given', () => {
			// GIVEN a share written properly
			// WHEN parsed
			// THEN it is used as-is
			expect(parseKeepRate('0.25')).toBe(0.25)
			expect(parseKeepRate('1')).toBe(1)
			expect(parseKeepRate(' 0.5 ')).toBe(0.5)
		})

		it('should honour a deliberate zero', () => {
			// GIVEN someone turning tracing off on purpose
			// WHEN parsed
			// THEN it means nothing is kept — this is a real setting, not a typo
			expect(parseKeepRate('0')).toBe(0)
		})
	})

	describe('when the value is out of range', () => {
		it('should pull it back into range', () => {
			// GIVEN a share above one or below zero
			// WHEN parsed
			// THEN it is clamped rather than refused
			expect(parseKeepRate('5')).toBe(1)
			expect(parseKeepRate('-1')).toBe(0)
		})
	})

	describe('when the value cannot be used at all', () => {
		it('should fall back to keeping everything', () => {
			// GIVEN a typo — a comma decimal, a word, an infinity
			// WHEN parsed
			// THEN everything is kept. A knob that only thins traces must never
			// stop the process, and `Config.number` would fail the whole config
			expect(parseKeepRate('0,25')).toBe(1)
			expect(parseKeepRate('half')).toBe(1)
			expect(parseKeepRate('Infinity')).toBe(1)
			expect(parseKeepRate('NaN')).toBe(1)
		})

		it('should treat blank as unset rather than as zero', () => {
			// GIVEN a var set to nothing, or to spaces
			// WHEN parsed
			// THEN everything is kept — `Number('')` is 0, so leaving this to
			// `Number` would switch tracing off without saying so
			expect(parseKeepRate('')).toBe(1)
			expect(parseKeepRate('   ')).toBe(1)
		})
	})
})
