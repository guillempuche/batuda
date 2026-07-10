/**
 * Pure scoring for the research eval harness. Given a company's known-correct
 * answer (the golden expectation) and a normalized view of what one research run
 * produced, it computes the four numbers the harness reports:
 *
 *   grounding accuracy   did the run actually reach the *target* company's own site?
 *   field precision      of the fields it filled that we have a true answer for,
 *                        how many are right?
 *   wrong-company rate   did it confidently return data without reaching the target
 *                        (the look-alike failure this harness exists to catch)?
 *   empty rate           did it return no usable data at all?
 *
 * Grounding is judged by which pages the run *fetched*, not which its findings cite:
 * once per-field citations point at whichever page stated each fact, a run that
 * correctly reached the target's own site still cites third-party pages per field,
 * so citation hosts no longer track "reached the right company" — the fetch log does.
 */

/**
 * The enrichment scalars we can check against an objective golden answer. Free-text
 * fields (pain points, tags) are left out because there is no single correct value
 * to score them against. Snake case matches the extraction schema's field names.
 */
export const SCORABLE_FIELDS = [
	'industry',
	'size_range',
	'region',
	'location',
	'address',
] as const

export type ScorableField = (typeof SCORABLE_FIELDS)[number]

/** The run outcomes that end a run; a run in any of these is what the eval scores. */
export type TerminalStatus =
	| 'succeeded'
	| 'no_reliable_data'
	| 'failed'
	| 'cancelled'

/**
 * One company's known-correct answer. This lives in code as a type; the actual
 * rows live in the eval dataset (Latitude), so a new company is added there, not
 * here.
 */
export interface GoldenExpectation {
	readonly id: string
	/** What the run is asked to research — a name, or name + location for a generic name. */
	readonly query: string
	/** The company's own official website host — the primary proof the target was reached. */
	readonly officialDomain: string
	/** Other hosts that still prove the target was reached (a registry profile, a known subsidiary). */
	readonly altDomains?: ReadonlyArray<string>
	/** Known-correct field values. Only fields listed here are scored for precision. */
	readonly fields: Partial<Record<ScorableField, string>>
}

/**
 * A normalized view of what one run produced, adapted from the run row + its
 * findings by the caller. Keeping the adapter out of here is deliberate: the
 * findings shape changes when citations move per-field, but this view — and so
 * every metric below — does not.
 */
export interface RunOutcome {
	readonly status: TerminalStatus
	/**
	 * Hosts of the sources the run fetched — the pages it actually reached. The run
	 * reaching the target's own site is what proves it researched the right company;
	 * once that is confirmed, per-field citations are free to point at whichever
	 * fetched page stated each fact (a registry, a directory), not only the homepage.
	 */
	readonly reachedDomains: ReadonlyArray<string>
	/** Extracted enrichment scalars; a missing/blank value counts as unfilled. */
	readonly fields: Partial<Record<ScorableField, string | null>>
}

export interface RunScore {
	readonly id: string
	readonly grounded: boolean
	readonly wrongCompany: boolean
	readonly empty: boolean
	/** Golden fields we have a true answer for (recall's denominator). */
	readonly fieldsExpected: number
	/** Golden fields the run actually filled, so we could check them (precision's denominator). */
	readonly fieldsScored: number
	/** Of the filled-and-checkable fields, how many matched (the shared numerator). */
	readonly fieldsCorrect: number
}

export interface EvalSummary {
	readonly runs: number
	readonly groundingAccuracy: number
	readonly wrongCompanyRate: number
	readonly emptyRate: number
	/** Micro-averaged correct ÷ filled across all runs; null when nothing was filled to check. */
	readonly fieldPrecision: number | null
	/** Micro-averaged correct ÷ known across all runs; null when the golden set specified no fields. */
	readonly fieldRecall: number | null
}

/**
 * Bare registrable host, lowercased, without scheme / `www.` / path — so
 * "https://www.Acme.com/contact" and "acme.com" compare equal.
 */
const normalizeDomain = (value: string): string => {
	const withoutScheme = value
		.trim()
		.toLowerCase()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
	const host = withoutScheme.split('/')[0] ?? withoutScheme
	return host.replace(/^www\./, '')
}

/** Case- and space-insensitive text, for comparing enum-ish field values. */
const normalizeText = (value: string): string =>
	value.trim().toLowerCase().replace(/\s+/g, ' ')

const isFilled = (value: string | null | undefined): value is string =>
	typeof value === 'string' && value.trim().length > 0

const foldDiacritics = (value: string): string =>
	value.normalize('NFD').replace(/\p{Diacritic}/gu, '')

/**
 * Industry is an open free-text field: the pipeline reports it in the source page's
 * language ("manufacturing") while the golden holds the CRM's own code
 * ("manufactura"). Catalan and English share a Latin stem for most of these codes,
 * so match on that shared stem — a prefix at least half the code's length (min 4
 * chars) that starts some word in the extracted value — instead of an exact string.
 * A real categorization gap (a bank reported as "banking" vs the code "serveis")
 * still counts as a miss, which is the quality signal the eval wants to keep.
 */
const industryMatches = (expected: string, actual: string): boolean => {
	const foldedExpected = foldDiacritics(expected)
	const foldedActual = foldDiacritics(actual)
	if (
		foldedActual.includes(foldedExpected) ||
		foldedExpected.includes(foldedActual)
	)
		return true
	const stem = foldedExpected.slice(
		0,
		Math.max(4, Math.ceil(foldedExpected.length / 2)),
	)
	return foldedActual.split(/[^a-z0-9]+/).some(word => word.startsWith(stem))
}

const fieldMatches = (
	field: ScorableField,
	expected: string,
	actual: string,
): boolean => {
	const normalizedExpected = normalizeText(expected)
	const normalizedActual = normalizeText(actual)
	if (normalizedExpected.length === 0 || normalizedActual.length === 0)
		return false
	// An address or location is written differently by every source (order,
	// abbreviations, postcode placement), so accept either string containing the
	// other rather than demanding a character-exact match.
	if (field === 'address' || field === 'location') {
		return (
			normalizedActual.includes(normalizedExpected) ||
			normalizedExpected.includes(normalizedActual)
		)
	}
	if (field === 'industry') {
		return industryMatches(normalizedExpected, normalizedActual)
	}
	// region and size_range are codes the pipeline is meant to emit verbatim, so
	// they hold to an exact match.
	return normalizedActual === normalizedExpected
}

/** Score one run against its golden expectation. */
export const scoreRun = (
	expected: GoldenExpectation,
	outcome: RunOutcome,
): RunScore => {
	const anchors = [expected.officialDomain, ...(expected.altDomains ?? [])].map(
		normalizeDomain,
	)
	const grounded = outcome.reachedDomains.some(reached => {
		const host = normalizeDomain(reached)
		// The official host itself, or a subdomain of it (careers.acme.com,
		// us.acme.com) — both are the company's own pages, so both prove the run
		// reached the target. A look-alike host never ends with ".<official>".
		return anchors.some(
			anchor => host === anchor || host.endsWith(`.${anchor}`),
		)
	})

	let fieldsExpected = 0
	let fieldsScored = 0
	let fieldsCorrect = 0
	for (const field of SCORABLE_FIELDS) {
		const expectedValue = expected.fields[field]
		if (expectedValue === undefined) continue
		// Recall's denominator: every field we have a true answer for.
		fieldsExpected++
		const actual = outcome.fields[field]
		// Precision's denominator: only the ones the run actually filled.
		if (!isFilled(actual)) continue
		fieldsScored++
		if (fieldMatches(field, expectedValue, actual)) fieldsCorrect++
	}

	const anyFilled = SCORABLE_FIELDS.some(field =>
		isFilled(outcome.fields[field]),
	)
	const empty = outcome.status !== 'succeeded' || !anyFilled
	// Confident (succeeded, non-empty) yet it never reached the target's own site =
	// the look-alike bug: it returned some other company's data as a success.
	const wrongCompany = outcome.status === 'succeeded' && !empty && !grounded

	return {
		id: expected.id,
		grounded,
		wrongCompany,
		empty,
		fieldsExpected,
		fieldsScored,
		fieldsCorrect,
	}
}

/** Roll per-run scores up into the four rates the harness reports. */
export const summarizeScores = (
	scores: ReadonlyArray<RunScore>,
): EvalSummary => {
	const runs = scores.length
	if (runs === 0) {
		return {
			runs: 0,
			groundingAccuracy: 0,
			wrongCompanyRate: 0,
			emptyRate: 0,
			fieldPrecision: null,
			fieldRecall: null,
		}
	}

	let grounded = 0
	let wrong = 0
	let empty = 0
	let totalExpected = 0
	let totalScored = 0
	let totalCorrect = 0
	for (const score of scores) {
		if (score.grounded) grounded++
		if (score.wrongCompany) wrong++
		if (score.empty) empty++
		totalExpected += score.fieldsExpected
		totalScored += score.fieldsScored
		totalCorrect += score.fieldsCorrect
	}

	return {
		runs,
		groundingAccuracy: grounded / runs,
		wrongCompanyRate: wrong / runs,
		emptyRate: empty / runs,
		fieldPrecision: totalScored === 0 ? null : totalCorrect / totalScored,
		fieldRecall: totalExpected === 0 ? null : totalCorrect / totalExpected,
	}
}
