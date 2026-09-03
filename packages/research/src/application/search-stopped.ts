/**
 * Why a run stopped looking for companies.
 *
 * A run looks in more than one stretch — the gathering passes, and the extra
 * passes sent out for a part of the request nothing answered — and each can end
 * for its own reason. Only one reason is reported, so this is where the several
 * are read down to the one worth telling the reader.
 *
 * It lives apart from both because it belongs to neither: the loop knows
 * nothing of the passes around it, so a reason held there would be one stretch
 * describing all of them.
 *
 * Why any of it matters: a list of three companies means the market holds
 * three, or it means the looking was stopped at three. Those call for opposite
 * next steps, and nothing else a finished run reports tells them apart.
 */

import type { CoveragePassVerdict } from './request-parts'

/**
 * Why one stretch of looking ended.
 *
 * Worded for the reader rather than for the machinery, because these values are
 * stored on the finished run and read there — the same choice every other enum
 * a run reports itself with already makes.
 *
 * Only `finished_looking` says nothing wanted to carry on. The rest say
 * something stopped it while it still had more to do.
 */
export type SearchStopped =
	| 'finished_looking'
	| 'round_cap_reached'
	| 'context_full'
	| 'deadline_reached'
	| 'budget_exhausted'
	| 'provider_refused'

/**
 * How hard each reason bound the run.
 *
 * The money and the clock run on across the whole run, so a stretch that ran out
 * of either leaves no room for looking after it. A round cap and a full prompt
 * are counted per stretch and start again at the next one, so a run can meet
 * them and carry on. Settling binds nothing at all.
 */
const HOW_BINDING: Record<SearchStopped, number> = {
	finished_looking: 0,
	round_cap_reached: 1,
	context_full: 1,
	// Counted with the per-stretch ceilings: the stretch it happened in ended,
	// and the run went on to what comes after with the money and the clock it
	// still had. It is not one of our own ceilings, which is why it is its own
	// reason rather than being folded into the round cap — a reader told the cap
	// was reached would go and raise a number that never stopped anything.
	provider_refused: 1,
	deadline_reached: 2,
	budget_exhausted: 2,
}

/**
 * Whether a value read back off a stored run is one of the reasons above.
 *
 * Needed because a finished run's findings are read back as plain JSON, so what
 * sits there could be anything: nothing at all on a run stored before this was
 * recorded, or a word a later build knows and this one has never heard of.
 *
 * Asked of `HOW_BINDING` rather than of a list of its own, so a reason added
 * there is recognised here without anyone remembering to add it twice. Own keys
 * only: every object answers to `toString`, and a run naming that as its reason
 * must not read as a known one.
 */
export const isSearchStopped = (value: unknown): value is SearchStopped =>
	typeof value === 'string' && Object.hasOwn(HOW_BINDING, value)

/**
 * The reason to report for a run that looked in more than one stretch.
 *
 * Keeps whichever bound the run hardest, so a later stretch settling cannot
 * hide an earlier ceiling, and an earlier ceiling cannot hide a harder one
 * after it — naming the round cap on a run that in fact ran out of money sends
 * the reader to raise a limit that was never what stopped it.
 *
 * Ties keep the earlier one, which is the one every stretch after it worked
 * under.
 */
export const mostBindingStop = (
	soFar: SearchStopped,
	next: SearchStopped,
): SearchStopped => (HOW_BINDING[next] > HOW_BINDING[soFar] ? next : soFar)

/**
 * Whether the looking was cut off rather than ending because nothing wanted to
 * carry on. Asked here so a reason added above cannot read as a ceiling in one
 * place and as the looking settling in another.
 */
export const wasCutOff = (reason: SearchStopped): boolean =>
	reason !== 'finished_looking'

/**
 * The chase for a part of the request nothing answered, read as a reason the
 * looking stopped — or null where it did not stop it.
 *
 * A chase that ended because every part was answered took nothing away from the
 * run, and neither did one that never had a part to chase. The rest each ran
 * out of something.
 */
export const coverageStoppedLooking = (
	verdict: CoveragePassVerdict | null,
): SearchStopped | null => {
	switch (verdict) {
		case 'passes_spent':
			return 'round_cap_reached'
		case 'deadline_margin':
			return 'deadline_reached'
		case 'budget_margin':
			return 'budget_exhausted'
		case 'provider_failed':
			return 'provider_refused'
		default:
			return null
	}
}
