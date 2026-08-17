import { Option, type Tracer } from 'effect'

/**
 * Turns the configured keep rate into a usable share, 0..1.
 *
 * Parsed here rather than with `Config.number` because that fails on anything
 * unparseable, and a failed config stops the process booting — `withDefault`
 * only covers a value that is missing, not one that is malformed. A typo in a
 * knob that merely thins traces must never take the server down, so anything
 * unusable falls back to keeping everything.
 *
 * A blank string is spelled out because `Number('')` is 0, which would switch
 * tracing off silently — the one outcome a mistyped knob must not cause.
 */
export const parseKeepRate = (text: string): number => {
	const trimmed = text.trim()
	const value = trimmed === '' ? Number.NaN : Number(trimmed)
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
}

/**
 * Wraps a tracer so only a share of traces is kept. `OtlpTracer` drops a span
 * whose `sampled` is false at export time, so an unsampled trace costs a little
 * memory and nothing else.
 *
 * Only traces thin out — never logs. Every request still writes its one closing
 * line, so the record of what happened stays complete; what gets thinner is the
 * tree of detail hanging off it, which is the expensive part.
 *
 * The decision is made once, on the span that starts the trace, and every span
 * below inherits it. Deciding per span would send half a trace and leave the
 * other half as orphans, which is worse to read than either keeping or dropping
 * the whole thing.
 *
 * This decides at the START of a trace, before the outcome is known, so it
 * cannot preferentially keep the ones that failed. Keeping every failure means
 * holding spans until the work ends and deciding then — that is a job for a
 * collector in front of the vendor, not for this process.
 */
export const samplingTracer = (
	inner: Tracer.Tracer,
	keepRate: number,
): Tracer.Tracer => ({
	...inner,
	span(options) {
		const parent = Option.getOrUndefined(options.parent)
		// `options.root` asks for a fresh trace even when a parent is in scope, so
		// it gets its own decision rather than the parent's.
		const inheriting = parent !== undefined && !options.root
		return inner.span({
			...options,
			// Never revives a span something upstream already dropped — a route
			// exempted by `TracerDisabledWhen` arrives here with `sampled: false`.
			// Both ends of the range answer without drawing a number, so turning
			// tracing fully on or fully off costs nothing per span.
			sampled:
				options.sampled &&
				(inheriting
					? parent.sampled
					: keepRate >= 1 || (keepRate > 0 && Math.random() < keepRate)),
		})
	},
})
