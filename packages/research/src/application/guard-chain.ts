/**
 * The shape the phase-2 guard chain is written in.
 *
 * Extraction hands back what the model claimed; a dozen guards then decide what
 * survives — citations that resolve to a fetched page, values that appear in the
 * evidence, contacts that belong to the target, and so on.
 *
 * A step is a `GuardLink` and the chain is an array of them, so the order the
 * guards run in is the array's order and nothing else. Each link takes the
 * findings the previous ones kept and returns what it keeps, so a link cannot
 * quietly read around the chain, and the run loop below is the only place that
 * threads them together.
 *
 * Links also hand back the span attributes the phase publishes, which the chain
 * gathers on their behalf so the caller isn't holding a dozen result names in
 * scope at once.
 */

import { Effect } from 'effect'

/** One step of the chain. `name` identifies it in the chain's own tests. */
export interface GuardLink {
	readonly name: string
	readonly run: (findings: unknown) => Effect.Effect<{
		readonly findings: unknown
		readonly spanCounts?: Readonly<Record<string, number>>
	}>
}

/** What a whole chain produced: the surviving findings, and what it reported. */
export interface GuardChainResult {
	readonly findings: unknown
	readonly spanCounts: Record<string, number>
}

/**
 * Run the links in order, carrying each one's kept findings into the next and
 * collecting what they report on the way through. An empty chain is a no-op that
 * returns the findings untouched.
 */
export const runGuardChain = (
	links: ReadonlyArray<GuardLink>,
	initial: unknown,
): Effect.Effect<GuardChainResult> =>
	Effect.gen(function* () {
		let findings = initial
		const spanCounts: Record<string, number> = {}
		for (const link of links) {
			const outcome = yield* link.run(findings)
			findings = outcome.findings
			Object.assign(spanCounts, outcome.spanCounts ?? {})
		}
		return { findings, spanCounts }
	})
