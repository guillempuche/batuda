import { Effect, Schema } from 'effect'
import type { SqlError } from 'effect/unstable/sql'

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
