import { Effect, Schema } from 'effect'
import type { SqlError } from 'effect/unstable/sql'

import { isTerminalResearchStatus } from '@batuda/domain'
import { SchemaNameSchema } from '@batuda/research'

// A UUID-shaped identifier, validated at the MCP parameter boundary. Rejecting
// a malformed id here means it never reaches SQL as an invalid uuid cast, which
// would otherwise surface a raw Postgres error to the caller.
export const Uuid = Schema.String.check(Schema.isUUID())

// schema_name constrained to the server's closed set, so an unknown name is
// rejected up front instead of creating a run that only fails at phase 0.
export const SchemaNameParam = SchemaNameSchema

// A research query: present and length-bounded. Stops empty prompts from
// creating junk runs and caps oversized input that would otherwise waste spend
// once real providers are wired in.
export const ResearchQuery = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(8000),
)

// How long a caller is willing to wait, in whole seconds and at least one. A
// negative or a not-a-number makes the wait expire before it begins, handing
// back a run that had no chance to finish as if the research came back empty.
export const MaxWaitSeconds = Schema.Number.check(
	Schema.isInt(),
	Schema.isGreaterThanOrEqualTo(1),
)

// Swap an infrastructure SqlError for a redacted defect so the MCP layer returns
// a generic message instead of dumping the Postgres driver error — statement,
// connection details, driver stack — to the client. The lifecycle/service calls
// behind these tools fail only with SqlError, so we collapse it to a defect (like
// the prior `Effect.orDie`). A string defect (not `new Error`) keeps even our own
// source path out of the rendered cause.
export const redactDbErrors = <A, R>(
	effect: Effect.Effect<A, SqlError.SqlError, R>,
): Effect.Effect<A, never, R> =>
	effect.pipe(Effect.catchTag('SqlError', () => Effect.die('internal error')))

// A run waiting for a free slot starts the moment one of the few that run at
// once frees up, so it is worth checking back sooner; a run already working
// gets through a round in roughly half a minute.
const POLL_AFTER_QUEUED_MS = 15_000
const POLL_AFTER_RUNNING_MS = 20_000

/**
 * How long to leave a research run alone before asking about it again.
 *
 * A run takes minutes — far longer than a caller can hold a request open — so
 * whoever started it has to come back and ask, and this says when. Nothing
 * comes back once the run has ended, which is what tells them to stop asking.
 */
export const pollAfterMs = (status: string): number | undefined =>
	isTerminalResearchStatus(status)
		? undefined
		: status === 'queued'
			? POLL_AFTER_QUEUED_MS
			: POLL_AFTER_RUNNING_MS
