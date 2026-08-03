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
 *   wrong-company rate   did it confidently return some OTHER company's data (the
 *                        look-alike failure this harness exists to catch)? A run that
 *                        returned the known-correct company's data but never reached
 *                        its official site is a grounding miss, not a look-alike, and
 *                        is judged against the golden rather than counted here.
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

import { foldLabel } from '@batuda/domain'

/**
 * The enrichment scalars we can check against an objective golden answer. Free-text
 * fields (current tools, tags) are left out because there is no single correct
 * value to score them against. Snake case matches the extraction schema's field
 * names.
 *
 * A company's mailbox, telephone number and registration number are in because each
 * has exactly one right answer that can be written down and checked. Adding them
 * costs nothing in the two per-field figures — a row that states no expected value
 * for a field is skipped for that field, in both the precision and the recall
 * count — but it does change the empty rate, and deliberately so: a run whose only
 * real find was the mailbox printed on the company's contact page used to be filed
 * alongside the runs that found nothing at all.
 *
 * The company's website is deliberately NOT in. It is already the thing grounding is
 * measured on — a golden row's `officialDomain` — so scoring it here would report
 * the same success twice and make a change to grounding look twice as large.
 */
export const SCORABLE_FIELDS = [
	'industry',
	'size_range',
	'country',
	'location',
	'email',
	'phone',
	'tax_id',
] as const

export type ScorableField = (typeof SCORABLE_FIELDS)[number]

/**
 * Size/reach buckets a golden company can be tagged with, so a regression that
 * hits only one segment (a niche or small company, the hardest to research) shows
 * up in a per-bucket breakdown instead of being averaged away. `big` = a
 * household name; `small` = an SMB with a light web presence; `niche` = a
 * specialist with little third-party coverage.
 */
export const GOLDEN_BUCKETS = ['big', 'small', 'niche'] as const

export type GoldenBucket = (typeof GOLDEN_BUCKETS)[number]

/** The run outcomes that end a run; a run in any of these is what the eval scores. */
export type TerminalStatus =
	| 'succeeded'
	| 'succeeded_low_confidence'
	| 'no_reliable_data'
	| 'failed'
	| 'cancelled'

/** Succeeded-class outcomes — a thin (low-confidence) success still carries findings to score. */
export const isSucceeded = (status: TerminalStatus): boolean =>
	status === 'succeeded' || status === 'succeeded_low_confidence'

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
	/**
	 * The company's own website host — the primary proof the run reached the target.
	 * Null for a company that has no site of its own, where the proof is an alt
	 * domain (a register entry, a directory page) or a register lookup instead.
	 */
	readonly officialDomain: string | null
	/** Other hosts that still prove the target was reached (a registry profile, a known subsidiary). */
	readonly altDomains?: ReadonlyArray<string>
	/** Known-correct field values. Only fields listed here are scored for precision. */
	readonly fields: Partial<Record<ScorableField, string>>
	/** People the company is known to publish; scores whether the run recovered them
	 * *with a title* — the recall the focused contacts pass exists to lift. */
	readonly contacts?: ReadonlyArray<{ readonly name: string }>
	/** Size/reach segment, so quality can be reported per bucket, not just overall. */
	readonly bucket?: GoldenBucket
}

/**
 * What a run came back with, counted rather than judged against a known answer.
 * Without this, a run that returns four right scalars and nothing else scores
 * the same as one that returns a full picture — the opposite of what a rich
 * profile is worth.
 */
export interface ProfileFullness {
	/** Profile fields the shape asks for, and how many carry a real value. */
	readonly fieldsTotal: number
	readonly fieldsFilled: number
	/** People named, whether or not a title came with them. */
	readonly contactsNamed: number
	/** Of those, how many carry a title — the ones worth writing to. */
	readonly contactsTitled: number
}

/**
 * A normalized view of what one run produced, adapted from the run row + its
 * findings by the caller. Keeping the adapter out of here is deliberate: the
 * findings shape changes when citations move per-field, but this view — and so
 * every metric below — does not.
 */
export interface RunOutcome {
	readonly status: TerminalStatus
	/** What the run was billed and what it consumed; absent when not read back. */
	readonly usage?: RunUsage
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
	/** How full the profile came back, across the whole output shape. */
	readonly profile?: ProfileFullness
}

// What one run was billed, and what it consumed getting there — read back from
// the run's own row, so it is what was recorded rather than a live tally.
export interface RunUsage {
	/** Everything the run was billed, in whole cents. */
	readonly costCents: number
	/** Of that, what the metered per-call lookups cost. */
	readonly paidCostCents: number
	readonly tokensIn: number
	readonly tokensOut: number
	/** Provider credits consumed, totalled across every provider. */
	readonly creditsUsed: number
	/**
	 * The models that answered this run, keyed `<tier>@<model>` with the number
	 * of calls each took. A tier listed twice fell back partway through — which
	 * matters when reading the score, since the run was then partly the work of
	 * a model the pass was not set up to measure.
	 */
	readonly callsByModel?: Record<string, number>
}

export interface RunScore {
	readonly id: string
	/** What this run cost, carried through so a pass can be totalled and compared. */
	readonly usage?: RunUsage
	readonly grounded: boolean
	readonly wrongCompany: boolean
	/**
	 * Whether a wrong company got as far as finishing clean — the most that could
	 * ever reach a record unwatched. An upper bound, not a count of what would:
	 * writing anything without a person also needs the organisation to have asked
	 * for it, the value to be a way of reaching somebody rather than a judgement,
	 * and that address to have come back reachable. None of which is knowable
	 * here. Read it as "how much even had the chance", and expect the real number
	 * to be far lower.
	 */
	readonly wrongCompanyAutoApplicable: boolean
	/** Whether the run finished flagged as needing somebody to read it. */
	readonly lowConfidence: boolean
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
	/** The golden row's size/reach bucket, carried through so scores can be grouped. */
	readonly bucket?: GoldenBucket
	/** The golden row's expected country (ISO alpha-2), for a by-country breakdown. */
	readonly country?: string
	/** How full the profile came back, independent of the golden answers. */
	readonly profile?: ProfileFullness
}

export interface EvalSummary {
	readonly runs: number
	readonly groundingAccuracy: number
	readonly wrongCompanyRate: number
	/**
	 * Share of runs that shipped another company's data and finished clean — the
	 * most that could ever be written with nobody looking. An upper bound: see
	 * `wrongCompanyAutoApplicable` for the conditions it cannot see.
	 */
	readonly wrongCompanyAutoApplicableRate: number
	/** Share of runs that finished flagged as needing somebody to read them. */
	readonly lowConfidenceRate: number
	readonly emptyRate: number
	/** Micro-averaged correct ÷ filled across all runs; null when nothing was filled to check. */
	readonly fieldPrecision: number | null
	/** Micro-averaged correct ÷ known across all runs; null when the golden set specified no fields. */
	readonly fieldRecall: number | null
	/** Micro-averaged known people recovered *with a title* ÷ known people, across all
	 * runs; null when no golden row listed expected contacts. */
	readonly contactRecall: number | null
	/**
	 * Profile fields filled per run, averaged over the runs that reported it, and
	 * the shape's own field count to read it against.
	 */
	readonly fieldsFilledPerRun: number | null
	readonly profileFieldsTotal: number | null
	/** People named per run, and how many of those carry a title. */
	readonly contactsNamedPerRun: number | null
	readonly contactsTitledPerRun: number | null
	/** What one run cost on average, in cents; null when no run reported a cost. */
	readonly costPerRun: number | null
	/** What one usable run cost — the total spread over the runs that grounded,
	 * so the runs that found nothing are counted as waste rather than ignored. */
	readonly costPerGroundedRun: number | null
	/** Of the average run cost, what the metered per-call lookups accounted for. */
	readonly paidCostPerRun: number | null
	readonly tokensPerRun: number | null
	/** Provider credits one run consumed on average. */
	readonly creditsPerRun: number | null
	/**
	 * How many calls each model answered across the whole pass, keyed
	 * `<tier>@<model>`. Read this before the quality numbers: a tier that shows
	 * up under two models did not measure the one it was set up to measure, and
	 * the split says how far off that reading is.
	 */
	readonly callsByModel: Record<string, number>
	/**
	 * The share of runs where some tier answered on more than one model. Zero
	 * means every run stayed on its first choice and the scores speak for it.
	 */
	readonly cascadedRunRate: number | null
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

// Titles a page prints before a name ("Sir James Dyson", "Dr Jane Roe"): not part of
// the name, so a leading one is dropped before matching. "Don"/"Doña" are deliberately
// absent — "Don" is also a real given name (Don Draper), and dropping it would lose a
// real person. Only stripped when two tokens remain, so a short "Dr Dre" keeps both.
const HONORIFICS = new Set([
	'sir',
	'dame',
	'lord',
	'lady',
	'mr',
	'mrs',
	'ms',
	'miss',
	'mx',
	'dr',
	'prof',
	'professor',
	'rev',
	'reverend',
	'hon',
	'madam',
	'madame',
])

// Everyday short forms folded to the formal name a company usually publishes, so a
// golden "Pete Roever" matches a run's "Peter Roever". Kept small and English; since a
// match still needs the surname too (≥2 tokens), folding a first name can't collapse
// two genuinely different people.
const NICKNAMES: Record<string, string> = {
	pete: 'peter',
	rob: 'robert',
	bob: 'robert',
	robbie: 'robert',
	bill: 'william',
	billy: 'william',
	tony: 'anthony',
	jim: 'james',
	jimmy: 'james',
	mike: 'michael',
	dave: 'david',
	tom: 'thomas',
	tommy: 'thomas',
	dan: 'daniel',
	danny: 'daniel',
	dick: 'richard',
	rick: 'richard',
	matt: 'matthew',
	greg: 'gregory',
	ben: 'benjamin',
	ed: 'edward',
	eddie: 'edward',
	andy: 'andrew',
	ron: 'ronald',
	ken: 'kenneth',
	joe: 'joseph',
	steve: 'steven',
	nick: 'nicholas',
	tim: 'timothy',
	charlie: 'charles',
}

const stripHonorific = (
	tokens: ReadonlyArray<string>,
): ReadonlyArray<string> =>
	tokens.length > 2 && HONORIFICS.has(tokens[0] ?? '')
		? tokens.slice(1)
		: tokens

// A person's name as its accent-folded, lower-cased word tokens, with a leading
// honorific dropped and each token folded to its formal form. Single-character tokens
// (a middle initial) are kept, so two people who differ only by initial stay distinct.
const nameTokens = (name: string): ReadonlyArray<string> => {
	const rawTokens = foldDiacritics(name)
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(token => token.length > 0)
	return stripHonorific(rawTokens).map(token => NICKNAMES[token] ?? token)
}

// Two names refer to the same person when the shorter one's tokens are all in the
// longer's — so "Andrew Smith" matches "Andrew J. Smith" without matching a
// different Smith. A lone shared token (just a first name) is too weak to confirm
// the same person, so the shorter name must carry at least two tokens. Shared with
// the contact-discovery eval, so both agree on what "same person" means. Conservative
// on purpose: an unmatched real person is a miss the eval should show, not paper over.
export const contactNameMatches = (
	expected: string,
	actual: string,
): boolean => {
	const e = nameTokens(expected)
	const a = nameTokens(actual)
	const [small, big] = e.length <= a.length ? [e, new Set(a)] : [a, new Set(e)]
	if (small.length < 2) return false
	return small.every(token => big.has(token))
}

/**
 * A trade is whatever the page calls it, on both sides: the golden holds the
 * wording a person would expect, and the pipeline keeps the wording it read. So
 * this asks whether the two namings are the same trade, not whether they are the
 * same string.
 *
 * `foldLabel` is the same rule the CRM uses to decide that two spellings are one
 * trade, so a difference this accepts is a difference that would land on one
 * entry there. On top of it, a shared stem — a prefix at least half the expected
 * name's length, minimum four characters, starting some word of what was read —
 * covers the endings a language puts on the same word ("fusteria" against
 * "fusteries", "manufacturing" against "manufacturer").
 *
 * A real miss still reads as one: a bank reported as "banking" against an
 * expected "insurance" shares no stem, which is the signal the eval is for.
 */
const industryMatches = (expected: string, actual: string): boolean => {
	const foldedExpected = foldLabel(expected)
	const foldedActual = foldLabel(actual)
	if (foldedExpected.length === 0 || foldedActual.length === 0) return false
	if (
		foldedActual.includes(foldedExpected) ||
		foldedExpected.includes(foldedActual)
	)
		return true
	const stem = foldedExpected.slice(
		0,
		Math.max(4, Math.ceil(foldedExpected.length / 2)),
	)
	return foldedActual.split(' ').some(word => word.startsWith(stem))
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
	// A telephone number is printed a dozen ways for the same line — spaces, dots,
	// brackets, a country code on one page and not the next — so only the digits
	// are compared, and only the last nine of them, which is a full national number
	// everywhere the pipeline researches. Anything shorter is compared whole.
	if (field === 'phone') {
		const lastDigits = (value: string): string => {
			const digits = value.replace(/\D/g, '')
			return digits.length > 9 ? digits.slice(-9) : digits
		}
		const expectedDigits = lastDigits(expected)
		return expectedDigits !== '' && lastDigits(actual) === expectedDigits
	}
	// A registration number is written with and without its punctuation and its
	// country prefix, so it is compared on its letters and digits alone.
	if (field === 'tax_id') {
		const bare = (value: string): string =>
			value.replace(/[^a-z0-9]/gi, '').toUpperCase()
		const expectedBare = bare(expected)
		return expectedBare !== '' && bare(actual) === expectedBare
	}
	// An email address, a country code and a size band are all values the pipeline
	// is meant to emit verbatim, so they hold to an exact match.
	return normalizedActual === normalizedExpected
}

// Global cities so common that a company being there says little about which company
// it is — a location match on one of these is too weak to confirm the run reached the
// right company. Normalized once so lookups match the folded field value.
const MEGACITIES = new Set(
	[
		'london',
		'paris',
		'madrid',
		'barcelona',
		'berlin',
		'milan',
		'rome',
		'new york',
		'new york city',
		'nyc',
		'los angeles',
		'chicago',
		'san francisco',
		'boston',
		'dublin',
		'amsterdam',
		'lisbon',
		'tokyo',
		'singapore',
		'hong kong',
		'shanghai',
		'beijing',
		'mumbai',
		'delhi',
		'mexico city',
		'sao paulo',
		'buenos aires',
		'toronto',
		'sydney',
	].map(normalizeText),
)

// Whether the run's location matches the golden's AND that location is specific enough
// to identify the company (not a global capital). Used only to judge that a run
// reached the right company when it never touched the official domain — a stronger
// signal than a coarse industry code, which is shared by many firms.
const specificLocationAgrees = (
	expected: GoldenExpectation,
	outcome: RunOutcome,
): boolean => {
	const goldenLocation = expected.fields.location
	const actual = outcome.fields.location
	if (goldenLocation === undefined || !isFilled(actual)) return false
	// Judge the city (the part before any region/country) against the megacity list,
	// so "London, UK" is recognised as generic just as bare "London" is.
	const goldenCity = normalizeText(
		goldenLocation.split(',')[0] ?? goldenLocation,
	)
	if (MEGACITIES.has(goldenCity)) return false
	return fieldMatches('location', goldenLocation, actual)
}

/** Score one run against its golden expectation. */
export const scoreRun = (
	expected: GoldenExpectation,
	outcome: RunOutcome,
): RunScore => {
	const anchors = [
		...(expected.officialDomain === null ? [] : [expected.officialDomain]),
		...(expected.altDomains ?? []),
	].map(normalizeDomain)
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
	const empty = !isSucceeded(outcome.status) || !anyFilled

	// Contact recall: of the people we know the company publishes, how many the run
	// returned WITH a title — a named person with no title doesn't count, since a
	// titleless contact is the gap the focused pass exists to close. A name match
	// WITHOUT a title still proves the run reached the right company, so track that
	// separately to judge wrong-company below.
	const expectedContacts = expected.contacts ?? []
	let contactsFound = 0
	let anyContactMatched = false
	for (const person of expectedContacts) {
		const matches = outcome.contacts.filter(found =>
			contactNameMatches(person.name, found.name),
		)
		if (matches.length === 0) continue
		anyContactMatched = true
		if (matches.some(found => isFilled(found.role))) contactsFound++
	}

	// "Wrong company" is the look-alike bug: a confident run that shipped some OTHER
	// company's data. A run that returned the known-correct company's data yet never
	// reached its official site is a grounding-proxy miss, not a look-alike, so it is
	// excused here. The agreement bar is deliberately high — a matched known person, or
	// a location specific enough to identify the company — so a real look-alike (a
	// different person in a different place) is still caught; a coarse industry code or
	// a global capital is too generic to qualify.
	const agreesWithGolden =
		anyContactMatched || specificLocationAgrees(expected, outcome)
	const wrongCompany =
		isSucceeded(outcome.status) && !empty && !grounded && !agreesWithGolden

	// The same look-alike, narrowed to the runs that finished clean. A run marked
	// as needing review is caught by the person reading it, so it cannot be in the
	// count of what got far enough to be written unwatched.
	const lowConfidence = outcome.status === 'succeeded_low_confidence'
	const wrongCompanyAutoApplicable = wrongCompany && !lowConfidence

	return {
		id: expected.id,
		grounded,
		wrongCompany,
		wrongCompanyAutoApplicable,
		lowConfidence,
		empty,
		fieldsExpected,
		fieldsScored,
		fieldsCorrect,
		contactsExpected: expectedContacts.length,
		contactsFound,
		...(outcome.profile !== undefined ? { profile: outcome.profile } : {}),
		...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
		...(expected.bucket !== undefined ? { bucket: expected.bucket } : {}),
		...(expected.fields.country !== undefined
			? { country: expected.fields.country }
			: {}),
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
			wrongCompanyAutoApplicableRate: 0,
			lowConfidenceRate: 0,
			emptyRate: 0,
			fieldPrecision: null,
			fieldRecall: null,
			contactRecall: null,
			fieldsFilledPerRun: null,
			profileFieldsTotal: null,
			contactsNamedPerRun: null,
			contactsTitledPerRun: null,
			costPerRun: null,
			costPerGroundedRun: null,
			paidCostPerRun: null,
			tokensPerRun: null,
			creditsPerRun: null,
			callsByModel: {},
			cascadedRunRate: null,
		}
	}

	let grounded = 0
	let wrong = 0
	let wrongAutoApplicable = 0
	let lowConfidence = 0
	let empty = 0
	let runsWithProfile = 0
	let profileFieldsTotal = 0
	let totalFieldsFilled = 0
	let totalContactsNamed = 0
	let totalContactsTitled = 0
	const callsByModel: Record<string, number> = {}
	let cascadedRuns = 0
	let totalExpected = 0
	let totalScored = 0
	let totalCorrect = 0
	let totalContactsExpected = 0
	let totalContactsFound = 0
	// Only runs that reported a cost count toward the averages, so a pass that
	// never read them back shows no figure rather than a misleadingly low one.
	let runsWithUsage = 0
	let totalCostCents = 0
	let totalPaidCostCents = 0
	let totalTokensIn = 0
	let totalTokensOut = 0
	let totalCredits = 0
	for (const score of scores) {
		if (score.grounded) grounded++
		if (score.wrongCompany) wrong++
		if (score.wrongCompanyAutoApplicable) wrongAutoApplicable++
		if (score.lowConfidence) lowConfidence++
		if (score.empty) empty++
		if (score.profile !== undefined) {
			runsWithProfile++
			// Every run is measured against the same profile shape, so this is the
			// same number each time round — kept as scale for the filled count, not
			// something to add up.
			profileFieldsTotal = score.profile.fieldsTotal
			totalFieldsFilled += score.profile.fieldsFilled
			totalContactsNamed += score.profile.contactsNamed
			totalContactsTitled += score.profile.contactsTitled
		}
		totalExpected += score.fieldsExpected
		totalScored += score.fieldsScored
		totalCorrect += score.fieldsCorrect
		totalContactsExpected += score.contactsExpected
		totalContactsFound += score.contactsFound
		if (score.usage !== undefined) {
			runsWithUsage++
			totalCostCents += score.usage.costCents
			totalPaidCostCents += score.usage.paidCostCents
			totalTokensIn += score.usage.tokensIn
			totalTokensOut += score.usage.tokensOut
			totalCredits += score.usage.creditsUsed
			for (const [key, calls] of Object.entries(
				score.usage.callsByModel ?? {},
			)) {
				callsByModel[key] = (callsByModel[key] ?? 0) + calls
			}
			// A tier naming two models in one run answered partly on each, which
			// is what makes that run's score a reading of something other than the
			// models the pass set out to measure.
			const tiers = Object.keys(score.usage.callsByModel ?? {}).map(
				key => key.split('@')[0] ?? key,
			)
			if (new Set(tiers).size < tiers.length) cascadedRuns += 1
		}
	}

	return {
		runs,
		groundingAccuracy: grounded / runs,
		wrongCompanyRate: wrong / runs,
		wrongCompanyAutoApplicableRate: wrongAutoApplicable / runs,
		lowConfidenceRate: lowConfidence / runs,
		emptyRate: empty / runs,
		fieldPrecision: totalScored === 0 ? null : totalCorrect / totalScored,
		fieldRecall: totalExpected === 0 ? null : totalCorrect / totalExpected,
		contactRecall:
			totalContactsExpected === 0
				? null
				: totalContactsFound / totalContactsExpected,
		fieldsFilledPerRun:
			runsWithProfile === 0 ? null : totalFieldsFilled / runsWithProfile,
		profileFieldsTotal: runsWithProfile === 0 ? null : profileFieldsTotal,
		contactsNamedPerRun:
			runsWithProfile === 0 ? null : totalContactsNamed / runsWithProfile,
		contactsTitledPerRun:
			runsWithProfile === 0 ? null : totalContactsTitled / runsWithProfile,
		costPerRun: runsWithUsage === 0 ? null : totalCostCents / runsWithUsage,
		costPerGroundedRun:
			runsWithUsage === 0 || grounded === 0 ? null : totalCostCents / grounded,
		paidCostPerRun:
			runsWithUsage === 0 ? null : totalPaidCostCents / runsWithUsage,
		tokensPerRun:
			runsWithUsage === 0
				? null
				: (totalTokensIn + totalTokensOut) / runsWithUsage,
		creditsPerRun: runsWithUsage === 0 ? null : totalCredits / runsWithUsage,
		callsByModel,
		cascadedRunRate: runsWithUsage === 0 ? null : cascadedRuns / runsWithUsage,
	}
}

/**
 * Group scores by a key (a bucket, a country) and summarize each group, so a
 * regression confined to one segment is visible instead of averaged into the
 * whole-set numbers. Keys are returned in first-seen order.
 */
export const groupSummaries = (
	scores: ReadonlyArray<RunScore>,
	keyOf: (score: RunScore) => string,
): Record<string, EvalSummary> => {
	const groups = new Map<string, RunScore[]>()
	for (const score of scores) {
		const key = keyOf(score)
		const group = groups.get(key)
		if (group) group.push(score)
		else groups.set(key, [score])
	}
	const summaries: Record<string, EvalSummary> = {}
	for (const [key, group] of groups) {
		summaries[key] = summarizeScores(group)
	}
	return summaries
}
