import type { Cause } from 'effect'
import { Cause as CauseModule } from 'effect'

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
	const text = CauseModule.pretty(cause)
	if (text.length <= MAX_CAUSE_CHARS) return text
	return `${text.slice(0, MAX_CAUSE_CHARS)}… (${text.length - MAX_CAUSE_CHARS} more characters)`
}
