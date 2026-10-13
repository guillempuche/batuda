import type { Cause } from 'effect'
import { Cause as CauseModule, SchemaIssue } from 'effect'

// A crash's cause is the most useful thing it leaves behind, so it is kept in
// full rather than summarised — but bounded. A cause wrapping a driver error can
// carry the failing statement and the values in it, and an unbounded one would
// ship a whole request payload, or a whole email, to the log exporter — which
// flushes every second.
//
// Note this bounds the size, not the content: error text can still name business
// data incidentally, which is why observability retention is short.
const MAX_CAUSE_CHARS = 4000

/**
 * Renders a cause for a log line, cut to a length a log exporter can carry.
 *
 * Lives in the shared package because every process that exports logs needs it,
 * not just the one that happened to need it first.
 */
export const boundedCause = (cause: Cause.Cause<unknown>): string => {
	const text = printed(withReadableErrors(cause))
	if (text.length <= MAX_CAUSE_CHARS) return text
	return `${text.slice(0, MAX_CAUSE_CHARS)}… (${text.length - MAX_CAUSE_CHARS} more characters)`
}

const formatIssue = SchemaIssue.makeFormatterDefault()

/**
 * The same error, with a failed schema check spelled out in its message.
 *
 * Building a value that breaks its schema throws a bare "Schema validation
 * failed", with the details kept on the error's `cause` — which a printed cause
 * shows as a dump of the schema's internals. The details' own wording names the
 * field and what it expected, so it goes into the message instead. The failure
 * is often wrapped (`Effect.try` puts it under an `UnknownError`), so the chain
 * of causes is followed down to it.
 */
export const readableError = <A>(error: A): A | Error =>
	readableAt(error, MAX_CAUSE_DEPTH)

// How far down a chain of causes to look; a chain can loop back on itself.
const MAX_CAUSE_DEPTH = 8

const readableAt = <A>(error: A, depthLeft: number): A | Error => {
	if (!(error instanceof Error) || depthLeft === 0) return error
	if (SchemaIssue.isIssue(error.cause)) {
		const readable = new Error(`${error.message}: ${formatIssue(error.cause)}`)
		// Replaced through a function, so a `$&` or `$'` in the message is kept
		// rather than expanded.
		if (error.stack !== undefined)
			readable.stack = error.stack.replace(
				error.message,
				() => readable.message,
			)
		return readable
	}
	const cause = readableAt(error.cause, depthLeft - 1)
	if (cause === error.cause) return error
	// A copy that prints as the original does, over the readable cause.
	const copy = Object.assign(new Error(error.message), error, { cause })
	copy.name = error.name
	if (error.stack !== undefined) copy.stack = error.stack
	return copy
}

// The printer follows a chain of causes without end, so one that loops back on
// itself throws. This is the crash log of last resort, so it falls back to the
// top error alone rather than losing the crash.
const printed = (cause: Cause.Cause<unknown>): string => {
	try {
		return CauseModule.pretty(cause)
	} catch {
		return `${String(CauseModule.squash(cause))} (its causes loop back on themselves and are left out)`
	}
}

// Each failure and crash with its error made readable, keeping the span it
// happened in. Only ever printed, so swapping the errors changes nothing else.
const withReadableErrors = (
	cause: Cause.Cause<unknown>,
): Cause.Cause<unknown> => {
	let changed = false
	const reasons = cause.reasons.map(reason => {
		const annotations = CauseModule.reasonAnnotations(reason)
		if (CauseModule.isDieReason(reason)) {
			const defect = readableError(reason.defect)
			if (defect === reason.defect) return reason
			changed = true
			return CauseModule.makeDieReason(defect).annotate(annotations)
		}
		if (CauseModule.isFailReason(reason)) {
			const error = readableError(reason.error)
			if (error === reason.error) return reason
			changed = true
			return CauseModule.makeFailReason(error).annotate(annotations)
		}
		return reason
	})
	return changed ? CauseModule.fromReasons(reasons) : cause
}
