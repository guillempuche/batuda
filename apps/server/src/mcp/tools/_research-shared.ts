import { Effect, Schema } from 'effect'
import type { SqlError } from 'effect/unstable/sql'

import { isTerminalResearchStatus } from '@batuda/domain'
import { SchemaNameSchema } from '@batuda/research'

// A UUID-shaped identifier, validated at the MCP parameter boundary. Rejecting
// a malformed id here means it never reaches SQL as an invalid uuid cast, which
// would otherwise surface a raw Postgres error to the caller.
export const Uuid = Schema.String.check(Schema.isUUID())

// The same check, carrying a note about where the id comes from. Kept apart
// from `Uuid` rather than built on it: the note has to go on before the check,
// because `.annotate()` on a schema that already has one hangs the note off
// the check instead, where the parameter a client reads never picks it up.
export const describedUuid = (description: string) =>
	Schema.String.annotate({ description }).check(Schema.isUUID())

// What each kind of run is for, in the words the web app already offers a
// person picking between them. Written once so the two tools that start a run
// cannot drift into describing the same choice differently.
export const SCHEMA_GUIDANCE =
	'Pick schema_name for the shape of answer you need. ' +
	'`prospect_scan_v1` finds companies matching a profile — industry, size, location — when you want net-new companies to add as leads. ' +
	'`company_enrichment_v1` fills industry, size, location, contacts, competitors and proposed CRM updates for a company you already have. ' +
	'`contact_discovery_v1` finds decision-makers and operational contacts at one company, when you need names, emails, phones and roles to reach out. ' +
	'`competitor_scan_v1` maps direct competitors with strengths, weaknesses, and a market-maturity summary. ' +
	'`freeform` writes an open-ended brief and returns no structured list — pick it only when the question fits no fixed shape, such as a history, a market trend, or an opinion piece.'

// schema_name constrained to the server's closed set, so an unknown name is
// rejected up front instead of creating a run that only fails at phase 0.
// Required, not optional: the choice decides whether the answer can hold a list
// of companies at all, so a caller states it rather than leaving it to be
// guessed from the question.
export const SchemaNameParam = SchemaNameSchema.annotate({
	description:
		'The shape of answer this run produces; see the tool description for what each one is for. There is no default — a question about which companies exist, answered as `freeform`, comes back as prose with no list of companies in it.',
})

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

// Both are the soonest it is worth asking again, not how long the work takes: a
// round closing the gaps left across a long list of companies spends minutes
// scraping and searching. A queued run gets the shorter of the two, since all
// that has to happen is one of the few slots that run at once coming free.
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
