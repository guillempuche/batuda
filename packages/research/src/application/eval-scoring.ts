/**
 * Pure scoring for the research eval harness. Given a company's known-correct
 * answer (the golden expectation) and a normalized view of what one research run
 * produced, it computes the numbers the harness reports:
 *
 *   grounding accuracy   did the run actually reach the *target* company's own site?
 *   field precision      of the fields it filled that we have a true answer for,
 *                        how many are right?
 *   contact recall       of the people the company is known to publish, how many
 *                        came back *with a title* — contacts sit outside the scorable
 *                        field set, so a run can pass every field yet lose the
 *                        decision-makers' titles, the exact gap this metric watches.
 *   wrong-company rate   did it confidently return data without reaching the target
 *                        (the look-alike failure this harness exists to catch)?
 *   empty rate           did it return no usable data at all?
 *
 * Grounding is judged by which pages the run *fetched*, not which its findings cite:
 * once per-field citations point at whichever page stated each fact, a run that
 * correctly reached the target's own site still cites third-party pages per field,
 * so citation hosts no longer track "reached the right company" — the fetch log does.
 * A run is also grounded without fetching the target's site at all when an official
 * company-register lookup resolved the target by legal name — an independent proof
 * the right entity was reached.
 */

/**
 * The enrichment scalars we can check against an objective golden answer. Free-text
 * fields (pain points, tags) are left out because there is no single correct value
 * to score them against. Snake case matches the extraction schema's field names.
 */
export const SCORABLE_FIELDS = [
	'industry',
	'size_range',
	'country',
	'location',
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
	/** People the company is known to publish; scores whether the run recovered them
	 * *with a title* — the recall the focused contacts pass exists to lift. */
	readonly contacts?: ReadonlyArray<{ readonly name: string }>
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
	/** Contacts the run extracted (after the guards), each with the title it found
	 * or null — a named person recovered without a title still counts as titleless. */
	readonly contacts: ReadonlyArray<{
		readonly name: string
		readonly role: string | null
	}>
	/**
	 * Whether an official-registry lookup this run resolved the target company by
	 * its legal name. Independent of the fetched pages: a company confirmed in the
	 * register was reached even if its own site was never scraped.
	 */
	readonly registryConfirmed?: boolean
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
	/** Known-published people we expected the run to recover (contact recall's denominator). */
	readonly contactsExpected: number
	/** Of those, how many the run returned *with a title* (contact recall's numerator). */
	readonly contactsFound: number
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
	/** Micro-averaged known people recovered *with a title* ÷ known people, across all
	 * runs; null when no golden row listed expected contacts. */
	readonly contactRecall: number | null
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
export const normalizeText = (value: string): string =>
	value.trim().toLowerCase().replace(/\s+/g, ' ')

const isFilled = (value: string | null | undefined): value is string =>
	typeof value === 'string' && value.trim().length > 0

/** Strip accents so "García" and "Garcia" compare equal. */
export const foldDiacritics = (value: string): string =>
	value.normalize('NFD').replace(/\p{Diacritic}/gu, '')

// A person's name as its accent-folded, lower-cased word tokens. Single-character
// tokens (a middle initial) are kept, so two people who differ only by initial stay
// distinct — the same tokenizing the contact-discovery eval uses.
const nameTokens = (name: string): ReadonlyArray<string> =>
	foldDiacritics(name)
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(token => token.length > 0)

// Two names refer to the same person when the shorter one's tokens are all in the
// longer's — so "Andrew Smith" matches "Andrew J. Smith" without matching a
// different Smith. A lone shared token (just a first name) is too weak to confirm
// the same person, so the shorter name must carry at least two tokens — the same
// rule the contact-discovery eval uses, so both agree on what "same person" means.
// Conservative on purpose: an unmatched real person is a miss the eval should show,
// not paper over.
const contactNameMatches = (expected: string, actual: string): boolean => {
	const e = nameTokens(expected)
	const a = nameTokens(actual)
	const [small, big] = e.length <= a.length ? [e, new Set(a)] : [a, new Set(e)]
	if (small.length < 2) return false
	return small.every(token => big.has(token))
}

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
	// A location is written differently by every source (order, abbreviations,
	// postcode placement), so accept either string containing the other rather than
	// demanding a character-exact match.
	if (field === 'location') {
		return (
			normalizedActual.includes(normalizedExpected) ||
			normalizedExpected.includes(normalizedActual)
		)
	}
	if (field === 'industry') {
		return industryMatches(normalizedExpected, normalizedActual)
	}
	// country and size_range are codes the pipeline is meant to emit verbatim, so
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
	// Reached the target either by fetching its own site (or a subdomain / alt
	// domain), or by resolving it in the official company register — a registry
	// confirmation grounds a company whose own site was never scraped.
	const grounded =
		outcome.registryConfirmed === true ||
		outcome.reachedDomains.some(reached => {
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

	// Contact recall: of the people we know the company publishes, how many the run
	// returned WITH a title — a named person with no title doesn't count, since a
	// titleless contact is the gap the focused pass exists to close.
	const expectedContacts = expected.contacts ?? []
	let contactsFound = 0
	for (const person of expectedContacts) {
		const match = outcome.contacts.some(
			found =>
				isFilled(found.role) && contactNameMatches(person.name, found.name),
		)
		if (match) contactsFound++
	}

	return {
		id: expected.id,
		grounded,
		wrongCompany,
		empty,
		fieldsExpected,
		fieldsScored,
		fieldsCorrect,
		contactsExpected: expectedContacts.length,
		contactsFound,
	}
}

/** Roll per-run scores up into the rates the harness reports. */
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
			contactRecall: null,
		}
	}

	let grounded = 0
	let wrong = 0
	let empty = 0
	let totalExpected = 0
	let totalScored = 0
	let totalCorrect = 0
	let totalContactsExpected = 0
	let totalContactsFound = 0
	for (const score of scores) {
		if (score.grounded) grounded++
		if (score.wrongCompany) wrong++
		if (score.empty) empty++
		totalExpected += score.fieldsExpected
		totalScored += score.fieldsScored
		totalCorrect += score.fieldsCorrect
		totalContactsExpected += score.contactsExpected
		totalContactsFound += score.contactsFound
	}

	return {
		runs,
		groundingAccuracy: grounded / runs,
		wrongCompanyRate: wrong / runs,
		emptyRate: empty / runs,
		fieldPrecision: totalScored === 0 ? null : totalCorrect / totalScored,
		fieldRecall: totalExpected === 0 ? null : totalCorrect / totalExpected,
		contactRecall:
			totalContactsExpected === 0
				? null
				: totalContactsFound / totalContactsExpected,
	}
}
