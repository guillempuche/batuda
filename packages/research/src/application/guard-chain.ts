/**
 * The shape the phase-2 guard chain is written in.
 *
 * Extraction hands back what the model claimed; a dozen guards then decide what
 * survives — citations that resolve to a fetched page, values that appear in the
 * evidence, contacts that belong to the target, and so on. That sequence used to
 * be a long imperative run of "call the guard, reassign the findings, log what it
 * dropped", where a step's place in the order — the whole of its contract with
 * its neighbours — was visible only by reading every line between.
 *
 * Here a step is a `GuardLink` and the chain is an array of them, so the order is
 * the array's order and nothing else. Each link takes the findings the previous
 * ones kept and returns what it keeps, so a link cannot quietly read around the
 * chain, and the run loop below is the only place that threads them together.
 *
 * Links also report two things the chain collects on their behalf: the span
 * attributes the phase publishes (assembled from the links, rather than from a
 * dozen result names all held in scope at once), and the model tokens a link
 * spent, since some links ask a model to judge what the deterministic ones kept.
 */

import { Effect } from 'effect'

/** One step of the chain. `name` identifies it in the chain's own tests. */
export interface GuardLink {
	readonly name: string
	readonly run: (findings: unknown) => Effect.Effect<{
		readonly findings: unknown
		readonly spanCounts?: Readonly<Record<string, number>>
		readonly outputTokens?: number
	}>
}

/** What a whole chain produced: the surviving findings, and what it reported. */
export interface GuardChainResult {
	readonly findings: unknown
	readonly spanCounts: Record<string, number>
	readonly outputTokens: number
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
		let outputTokens = 0
		for (const link of links) {
			const outcome = yield* link.run(findings)
			findings = outcome.findings
			Object.assign(spanCounts, outcome.spanCounts ?? {})
			outputTokens += outcome.outputTokens ?? 0
		}
		return { findings, spanCounts, outputTokens }
	})
