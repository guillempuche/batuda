/**
 * What the pipeline's own guards counted while a run worked, read off its logs.
 *
 * The guards already write their counts as span attributes, but a run opens its
 * own record inside itself, so one handed in from outside is shadowed and never
 * reaches them. What does survive is the log line: every guard reports under a
 * `research.` message and annotates it with the run it belongs to, which is the
 * one thing tying a count back to the row being scored.
 *
 * Nothing here knows any guard by name. Whatever numbers a `research.` line
 * carries are kept under `<message>.<field>`, so a guard added later shows up in
 * the report with no change on this side.
 */

import { type Layer, Logger, References } from 'effect'

/** The numbers one log line contributed, keyed `<message>.<field>`. */
export const factsFromLogLine = (
	message: unknown,
	annotations: Readonly<Record<string, unknown>>,
): Record<string, number> => {
	const line = guardLineName(message, annotations)
	if (line === null) return {}
	const facts: Record<string, number> = {}
	for (const [field, value] of Object.entries(annotations))
		if (typeof value === 'number' && Number.isFinite(value))
			facts[`${line}.${field}`] = value
	return facts
}

// The line a run writes about itself when it finishes. Its numbers are what the
// run cost and how many calls answered it, which the report already carries in
// `usage` — reading them here would print the same figures twice, under a
// heading about what the guards took out.
const RUN_SUMMARY_LINE = 'research.run'

// A log's message arrives as the arguments it was written with, so the name is
// the first string among them; a line that annotates its own `event` names
// itself there instead.
const guardLineName = (
	message: unknown,
	annotations: Readonly<Record<string, unknown>>,
): string | null => {
	const first = Array.isArray(message) ? message[0] : message
	const named =
		typeof first === 'string' && first.startsWith('research.')
			? first
			: annotations['event']
	if (typeof named !== 'string' || !named.startsWith('research.')) return null
	return named === RUN_SUMMARY_LINE ? null : named
}

export interface GuardFacts {
	/** Installed alongside the existing loggers, so a run still prints as it did. */
	readonly layer: Layer.Layer<never>
	/** What one run reported, or undefined when it reported nothing. */
	readonly forRun: (researchId: string) => Record<string, number> | undefined
}

export const makeGuardFacts = (): GuardFacts => {
	const perRun = new Map<string, Record<string, number>>()

	const layer = Logger.layer(
		[
			Logger.make(options => {
				const annotations = options.fiber.getRef(
					References.CurrentLogAnnotations,
				)
				const researchId = annotations['research_id']
				if (typeof researchId !== 'string' || researchId === '') return
				const facts = factsFromLogLine(options.message, annotations)
				if (Object.keys(facts).length === 0) return
				// Summed rather than replaced: a guard reports once per pass over the
				// findings, and a run makes several.
				const running = perRun.get(researchId) ?? {}
				for (const [key, value] of Object.entries(facts))
					running[key] = (running[key] ?? 0) + value
				perRun.set(researchId, running)
			}),
		],
		{ mergeWithExisting: true },
	)

	return { layer, forRun: researchId => perRun.get(researchId) }
}

/**
 * The mean per run of every key any run reported, over the whole pass — so a
 * guard that fired on one run of twenty reads as the fraction it is.
 */
export const meanFactsPerRun = (
	runs: ReadonlyArray<{ readonly facts?: Readonly<Record<string, number>> }>,
): ReadonlyArray<{ readonly key: string; readonly mean: number }> => {
	if (runs.length === 0) return []
	const totals = new Map<string, number>()
	for (const run of runs)
		for (const [key, value] of Object.entries(run.facts ?? {}))
			totals.set(key, (totals.get(key) ?? 0) + value)
	return [...totals.entries()]
		.map(([key, total]) => ({ key, mean: total / runs.length }))
		.sort((a, b) => a.key.localeCompare(b.key))
}
