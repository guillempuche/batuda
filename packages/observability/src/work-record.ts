import { Context, Effect, Option, Ref } from 'effect'

import { redactFacts } from './redact-spans'

// A record holds facts about one piece of work, so it stays small by nature —
// how the caller signed in, which tenant, which model. The cap is here for the
// case that is not that: a loop recording something per item. Without it, the
// record grows with the work and the whole thing lands on one log line, which
// the exporter then rejects and takes the real fields down with it.
const MAX_FACTS = 64

// Names how many facts were turned away, so a record that hit the cap says so
// instead of looking complete.
const DROPPED_KEY = 'record.dropped_facts'

/**
 * The facts gathered while one unit of work runs, so they can all be written
 * out together on a single line when it ends.
 *
 * Without this, a fact learned halfway through — how the caller signed in, which
 * tenant it resolved to — lands on whatever log line happened to be nearby, on a
 * different line from the outcome and the time taken. Two lines cannot be
 * grouped as one, so "how long did it take, split by how they signed in" has no
 * answer even though both facts were written down. Gathering them onto one line
 * is what makes that question answerable.
 *
 * Two kinds of work open a record: an HTTP request, and a research run. A run is
 * not part of any request — it runs on a forked fiber long after the request
 * that asked for it returned — so it opens one of its own rather than borrowing.
 */
export interface WorkRecordService {
	/** Merge facts into the open record. A repeated key keeps the newest value. */
	readonly add: (facts: Record<string, unknown>) => Effect.Effect<void>
	/** Everything gathered so far. */
	readonly read: Effect.Effect<Record<string, unknown>>
}

export class WorkRecord extends Context.Service<
	WorkRecord,
	WorkRecordService
>()('observability/WorkRecord') {}

/** Opens an empty record. Give it to the work whose facts it should gather. */
export const makeWorkRecord: Effect.Effect<WorkRecordService> = Effect.gen(
	function* () {
		const facts = yield* Ref.make<Record<string, unknown>>({})
		return {
			add: next =>
				Ref.update(facts, prev => {
					const merged: Record<string, unknown> = { ...prev }
					const previouslyDropped = merged[DROPPED_KEY]
					let dropped =
						typeof previouslyDropped === 'number' ? previouslyDropped : 0
					for (const [key, value] of Object.entries(next)) {
						// A fact already on the record is refined, not added, so refining
						// one is always allowed however full the record is.
						if (Object.hasOwn(merged, key)) {
							merged[key] = value
							continue
						}
						if (Object.keys(merged).length >= MAX_FACTS) {
							dropped++
							continue
						}
						merged[key] = value
					}
					if (dropped > 0) merged[DROPPED_KEY] = dropped
					return merged
				}),
			read: Ref.get(facts),
		}
	},
)

/**
 * Writes facts to the current span AND to the open work record.
 *
 * The record is read through `serviceOption`, so work running outside one —
 * a background fiber, a boot-time task, a test — simply keeps the span
 * attributes and drops the rest instead of failing to typecheck or blowing up.
 * That is what lets code deep in a call chain report a fact without knowing
 * whether anyone upstream is gathering it. The flip side is that a fact
 * reported where no record is open is lost silently, so opening one is the
 * caller's job to get right.
 *
 * Note that a route exempted from tracing is NOT exempted from this: the span
 * half goes nowhere but the record half still reaches the logs. Exempt routes
 * are exempt because their URL is a credential, so nothing read off such a URL
 * belongs in a fact here either.
 *
 * Facts are filtered before either half is written. Wrapping the tracer scrubs
 * span attributes only, and the record goes out on a log line rather than a
 * span, so it has to be filtered here too — otherwise this function would be a
 * way around the very thing the wrapper exists to stop.
 */
export const recordFacts = (
	facts: Record<string, unknown>,
): Effect.Effect<void> => {
	const safe = redactFacts(facts)
	return Effect.annotateCurrentSpan(safe).pipe(
		Effect.andThen(
			Effect.flatMap(Effect.serviceOption(WorkRecord), record =>
				Option.isNone(record) ? Effect.void : record.value.add(safe),
			),
		),
	)
}
