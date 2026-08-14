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
 * A search for a whole market answers with a list rather than a profile, so none of
 * the above is the question it should be graded on. Counting how many companies came
 * back would have called a 62-row list healthy when 23 of the rows were trade bodies,
 * 10 were the same company twice, and four of the five trades asked for were missing.
 * A market is graded on what was actually wrong with that list instead:
 *
 *   organisation kind    how many rows are the kind of organisation that was asked for
 *   request coverage     how many of the parts the request named came back with a row
 *   duplicate rate       whether the fold that joins two rows of one company still
 *                        holds — see its own note for what it cannot see
 *   location fill        how many rows say what town or province the company is in
 *
 * The row count is still reported, as the scale those four read against rather than
 * as the grade — it is also what checking that every row is a real company would
 * cost, so it needs a reading of its own before that check exists.
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

import { discoveryRowIdentityKeys } from './prospect-dedupe-guard'

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
 * Whether the run got far enough to say something about what it was asked.
 *
 * Wider than succeeding. A search that looked and found nothing ends as no
 * reliable data, and that is an answer about the market — the one a change that
 * empties a search has to be caught by. A run that died or was stopped never
 * reached an answer, and reading its empty hands as "this market has nothing in
 * it" would blame the market for an outage.
 */
const endedWithAnAnswer = (status: TerminalStatus): boolean =>
	status !== 'failed' && status !== 'cancelled'

/**
 * One part of a request that asks for several — a trade, a service, a segment —
 * with the wordings that place a returned row in it.
 *
 * The wordings are golden data, never a list in here. Which trades a market has is
 * a fact about the world, so no list of the trades or countries expected of a run
 * belongs in code. A golden set is where the expected answers already live, so they
 * cost nothing there.
 */
export interface MarketPart {
	readonly id: string
	/** Wordings that place a row in this part, in whichever languages the market answers in. */
	readonly terms: ReadonlyArray<string>
}

/**
 * What a request for a whole market asks for, when a golden row is a market rather
 * than one company. A scan answers with a list, so nothing a profile is graded on —
 * reaching one company's site, filling that company's fields — is a question here.
 */
export interface MarketExpectation {
	/** What this market is called, and the key a per-market breakdown groups on. */
	readonly name: string
	/** The parts the request names; coverage is how many came back with a row. */
	readonly parts: ReadonlyArray<MarketPart>
	/**
	 * Organisations known not to be companies in this market — the trade bodies,
	 * federations and system operators a search for a trade runs straight through
	 * on its way to the members.
	 *
	 * Naming them is what makes the count evidence rather than an opinion, and it is
	 * the only thing that can see past the organisation-kind guard's own languages:
	 * that guard reads Spanish, Catalan and English, so asking it again here would
	 * agree with itself and report every market clean. A body this list does not name
	 * still passes unmeasured, which is the honest limit of the figure.
	 */
	readonly notCompanies: ReadonlyArray<string>
}

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
	/**
	 * Present when this row asks for a market rather than one company. The two are
	 * one type because a pass runs one or the other and every figure below already
	 * reports nothing when it had nothing to judge.
	 */
	readonly market?: MarketExpectation
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
	 * The companies a discovery scan came back with. Empty for a run that answers
	 * with a profile rather than a list. This is what a scan is asked for, so it is
	 * what a scan has to be scored on — each row carrying the four things the market
	 * figures read: who it is, where it is, what it says it does, and its web
	 * address, which is one of the two things that tell two rows apart.
	 */
	readonly companies: ReadonlyArray<{
		readonly name: string
		/** The address the row carries, as written, or null when it carries none. */
		readonly website: string | null
		/** The town or province the row states, or null when it states none. */
		readonly location: string | null
		/** The row's own words about what it is and why it matched, run together. */
		readonly describedAs: string
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

/**
 * What one scan's list got right, counted against the market it was asked for.
 *
 * Counts rather than rates, so a pass adds them up and then divides once: a market
 * that came back with sixty rows then weighs sixty rows against a six-row market's
 * six, instead of each contributing one equal rate to an average.
 */
export interface MarketScore {
	/** Which market this run answered for — the key a per-market breakdown groups on. */
	readonly name: string
	/**
	 * Rows the scan came back with. The scale the figures below read against, and
	 * what checking that every row is a real company would cost, so it is reported
	 * in its own right rather than only as a denominator.
	 */
	readonly rowsReturned: number
	/** Of those, how many are not an organisation the golden names as not a company. */
	readonly rowsRightKind: number
	/**
	 * Of the rows returned — every one of them, including any the golden names as not
	 * a company — how many say where the company is. The field is asked for a town or
	 * a province, but any stated place counts here — a row answering with the country
	 * alone is filled as far as this can tell, and the request having named that
	 * country is not something a count of rows can know.
	 */
	readonly rowsLocated: number
	/** How many rows are another row's company written a second time. */
	readonly rowsDuplicated: number
	/** Parts the request named — the trades, services or segments it asked for. */
	readonly partsExpected: number
	/** Of those, how many came back with at least one row. */
	readonly partsAnswered: number
}

export interface RunScore {
	readonly id: string
	/** What this run cost, carried through so a pass can be totalled and compared. */
	readonly usage?: RunUsage
	readonly grounded: boolean
	/**
	 * Whether reaching a particular company was a question for this row at all. A
	 * market names no company to reach, so counting it as a grounding failure would
	 * report a whole scan pass at zero for answering the question it was asked.
	 */
	readonly groundable: boolean
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
	/** What the list got right, present only for a row that asked for a market. */
	readonly market?: MarketScore
}

export interface EvalSummary {
	readonly runs: number
	/**
	 * Of the runs that were asked to reach a particular company, the share that
	 * reached it. Null for a pass of market requests, which name no company to reach
	 * — the alternative reads zero and says the pass failed at something nobody asked
	 * it to do.
	 */
	readonly groundingAccuracy: number | null
	/**
	 * The look-alike figures, over the same runs as grounding and null for the same
	 * reason: a market request answers with a list, so there is no other company it
	 * could have come back with instead.
	 */
	readonly wrongCompanyRate: number | null
	/**
	 * Share of runs that shipped another company's data and finished clean — the
	 * most that could ever be written with nobody looking. An upper bound: see
	 * `wrongCompanyAutoApplicable` for the conditions it cannot see.
	 */
	readonly wrongCompanyAutoApplicableRate: number | null
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
	 * The four market figures, each micro-averaged over every market request in the
	 * pass rather than averaged across markets, so a sixty-row market weighs sixty
	 * rows against a six-row one's six.
	 *
	 * Null means there was nothing to divide by, which happens two ways, and the row
	 * count below tells them apart: no market request in the pass at all, where the
	 * row count is null too, or markets that ran and came back with no rows, where it
	 * is nought. Coverage is the exception — it divides by the parts a request named,
	 * so a market that found nothing still reads nought rather than nothing.
	 */
	readonly organisationKindPrecision: number | null
	readonly requestCoverage: number | null
	readonly duplicateRate: number | null
	readonly locationFill: number | null
	/**
	 * Rows one market request came back with on average. Not a quality figure —
	 * it is the scale the four above read against, and the reading that says what
	 * a change bought or cost in results.
	 */
	readonly rowsPerScan: number | null
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
	/**
	 * What one usable run cost: what the runs asked to reach a company spent, over
	 * how many of them reached it, so the ones that found nothing count as waste
	 * rather than being ignored. A market request is outside both halves — it is not
	 * asked to reach anybody, and its spend billed to the company runs would read as
	 * a cost blow-up rather than as the different job it is.
	 */
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

/**
 * A value's words with the accents taken off, so "Instalación" and "instalacion" are
 * one word and punctuation between two words never runs them into one.
 *
 * Exported so the golden data can be held to the same reading: a wording that folds
 * to no words can never place a row or name an organisation, and refusing it where it
 * is written beats accepting it and silently measuring nothing.
 */
export const termTokens = (value: string): ReadonlyArray<string> =>
	foldDiacritics(value)
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(token => token.length > 0)

// Below this length a term's word has to match a whole word. A three-letter word is
// the opening of far too many unrelated ones — "gas" starts "gasto" — while a longer
// one is long enough that only its own endings follow it, so "instalacion electrica"
// reaches "instalaciones eléctricas" without the golden listing every ending of
// every trade in every language.
const TERM_PREFIX_MIN_CHARS = 5

// Whether a term's words appear among a row's words, in order and next to each
// other. A long enough word matches as an opening, because Spanish, Catalan and
// French put an ending on every word of a phrase, not only on the last one.
const termAppearsIn = (
	term: ReadonlyArray<string>,
	words: ReadonlyArray<string>,
): boolean => {
	if (term.length === 0) return false
	for (let at = 0; at + term.length <= words.length; at++) {
		const matches = term.every((token, offset) => {
			const word = words[at + offset] ?? ''
			return token.length >= TERM_PREFIX_MIN_CHARS
				? word.startsWith(token)
				: word === token
		})
		if (matches) return true
	}
	return false
}

/**
 * How many of a request's parts came back with at least one row that answers them.
 *
 * Only rows that are the kind of organisation asked for are read. A trade's own
 * federation names that trade in its title, so counting it would mark the part
 * answered by the very body that has no work to sell — and a list holding the solar
 * association and no solar company is the answer this figure exists to catch.
 */
const partsAnsweredBy = (
	rows: RunOutcome['companies'],
	parts: ReadonlyArray<MarketPart>,
): number => {
	const rowWords = rows.map(row => termTokens(`${row.name} ${row.describedAs}`))
	return parts.filter(part =>
		part.terms.some(term => {
			const tokens = termTokens(term)
			return rowWords.some(words => termAppearsIn(tokens, words))
		}),
	).length
}

/**
 * Whether a row is one of the organisations the golden names as not a company.
 *
 * The listed name has to appear in the row's name as those words, in that order,
 * next to each other. A run writes a body's name longer than the golden does —
 * "FENIE — Federación Nacional de Empresarios de Instalaciones" — so the listed name
 * sitting inside the row's is what catches it.
 *
 * Whole words rather than a run of letters, because a body is usually known by its
 * initials and three letters land inside an unrelated name by accident: "RTE" sits
 * in the middle of "Norte Instalaciones", and "FFB" inside "Groupe FFBat".
 *
 * Next to each other rather than merely present, because the words of a body's name
 * are the trade's ordinary words scattered through many a company's: an unordered
 * test reads "Eléctrica del Norte, Red de Instaladores" as the grid operator. Order
 * does not save every case — a listed name short enough to sit inside a real company
 * name still matches it — which is why the golden lists the name a body is known by
 * rather than a fragment of it. And only in that direction — asking whether the row's words all
 * sit inside the listed name marks any company named after its own trade as a body,
 * from "Instalaciones y Energía" to a French "Génie Électrique et Climatique".
 * Counting a body where there is none marks a real company as the wrong kind, which
 * overstates the very problem being measured.
 *
 * Two rules on the golden data follow. List the name a body is actually known by,
 * specific enough to be its own — "Red Eléctrica" alone names half the installers in
 * the country — and list its initials as an entry of their own, because an acronym
 * shares no words with what it stands for.
 *
 * What is left over, and cannot be read off a name: a company trading under a body's
 * initials, like the retailer FENIE Energía beside the federation FENIE. It reads as
 * the body. Asking the model what an organisation is would settle it; a name cannot.
 */
const isKnownNonCompany = (
	name: string,
	notCompanies: ReadonlyArray<string>,
): boolean => {
	const words = termTokens(name)
	return notCompanies.some(listed => {
		const listedWords = termTokens(listed)
		if (listedWords.length === 0) return false
		// A body known by its initials shares that word with the companies trading
		// under it — the retailer FENIE Energía beside the federation FENIE, Grupo
		// Unef Solar beside UNEF, RTE Ascenseurs beside the grid operator. One word
		// on its own is only conclusive when it is the whole of what the row is
		// called; spelled-out names carry enough words to be found inside a longer
		// one safely.
		if (listedWords.length === 1)
			return words.length === 1 && words[0] === listedWords[0]
		return words.some((_, at) =>
			listedWords.every((word, offset) => words[at + offset] === word),
		)
	})
}

/**
 * How many rows are another row's company a second time: the rows, less the
 * companies they turn out to be.
 *
 * Two rows are one company when they share a name with the legal form off the end or
 * share a site host, and sameness carries — the same keys the scan itself folds rows
 * on.
 *
 * Reusing those keys is what this number is worth and what bounds it. The list it
 * reads has already been folded on them, so nothing it can see should be left: it
 * answers "is that fold still running and still doing its job", and it moves the
 * moment the answer is no. It cannot answer whether the keys are the right ones.
 *
 * That bound is wider than it sounds, and a live market search shows it: a company
 * came back once under its own name and four more times as that name plus the town
 * of a branch office, none of the four carrying a site. Neither key sees them — the
 * name is not the same name and there is no host to share — so the fold leaves all
 * five and this reads zero duplicates over a list that plainly repeats one company.
 * Reading it as "no repeats in this list" is wrong; it means "no repeats of the kind
 * these keys can tell". Counting those needs a hand-marked answer to score against,
 * which is a different measurement from this one.
 *
 * A row nothing can be read from — a name that is all punctuation, no address —
 * files under no key and so counts as its own company. That is the safe direction:
 * it never claims a duplicate it cannot show.
 */
const duplicatedRows = (rows: RunOutcome['companies']): number => {
	// Each company found so far, as the keys its rows filed under. A row meeting one
	// of them is that company again; a row meeting two proves those two were one
	// company all along, so they merge.
	const companies: Array<Set<string>> = []
	for (const row of rows) {
		const keys = discoveryRowIdentityKeys({
			name: row.name,
			...(row.website === null ? {} : { website: row.website }),
		})
		const matched = companies.filter(company =>
			keys.some(key => company.has(key)),
		)
		const mergeInto = matched[0]
		if (mergeInto === undefined) {
			companies.push(new Set(keys))
			continue
		}
		for (const key of keys) mergeInto.add(key)
		for (const other of matched.slice(1)) {
			for (const key of other) mergeInto.add(key)
			companies.splice(companies.indexOf(other), 1)
		}
	}
	return rows.length - companies.length
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
	// A run has found something when it filled a profile field OR came back with
	// companies: a scan answers with a list and never fills a profile, so asking
	// only about fields files every scan alongside the runs that found nothing.
	const empty =
		!isSucceeded(outcome.status) ||
		(!anyFilled && outcome.companies.length === 0)

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
	// Only a run that answered about one company can have answered about the wrong
	// one. Both halves of the test below — reaching the golden domain, and matching
	// its contacts or its city — are written against a single expected company, so
	// a scan's list of others has nothing here to be judged against and would read
	// as wrong simply for being a list.
	const aboutOneCompany = outcome.companies.length === 0
	const wrongCompany =
		aboutOneCompany &&
		isSucceeded(outcome.status) &&
		!empty &&
		!grounded &&
		!agreesWithGolden

	// The same look-alike, narrowed to the runs that finished clean. A run marked
	// as needing review is caught by the person reading it, so it cannot be in the
	// count of what got far enough to be written unwatched.
	const lowConfidence = outcome.status === 'succeeded_low_confidence'
	const wrongCompanyAutoApplicable = wrongCompany && !lowConfidence

	// What the list got right, for a row that asked for a market.
	//
	// Only a run that reached an answer is measured. A run that died — a provider
	// outage, or the whole-run time limit cutting a long search short — returns no
	// rows, and counting it would put the parts it was asked for into the denominator
	// with nothing in the numerator: one crashed run out of two halves the coverage
	// figure and reads as a regression the research never had.
	//
	// A search that looked and found nothing is the opposite case and has to count.
	// It ends as no reliable data rather than a success, so asking only whether the
	// run succeeded would throw away the very reading that catches a change which
	// empties a market — and with one run per market, throw away the whole market
	// with it.
	const expectedMarket = expected.market
	const rightKindRows = outcome.companies.filter(
		row =>
			expectedMarket === undefined ||
			!isKnownNonCompany(row.name, expectedMarket.notCompanies),
	)
	const market: MarketScore | undefined =
		expectedMarket === undefined || !endedWithAnAnswer(outcome.status)
			? undefined
			: {
					name: expectedMarket.name,
					rowsReturned: outcome.companies.length,
					rowsRightKind: rightKindRows.length,
					rowsLocated: outcome.companies.filter(row => isFilled(row.location))
						.length,
					rowsDuplicated: duplicatedRows(outcome.companies),
					partsExpected: expectedMarket.parts.length,
					// Coverage counts the parts the request named rather than the rows, so
					// a market that came back with nothing still reports it — none of them
					// answered — instead of dropping out of the figure.
					partsAnswered: partsAnsweredBy(rightKindRows, expectedMarket.parts),
				}

	return {
		id: expected.id,
		grounded,
		groundable: expected.market === undefined,
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
		...(market !== undefined ? { market } : {}),
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
			groundingAccuracy: null,
			wrongCompanyRate: null,
			wrongCompanyAutoApplicableRate: null,
			lowConfidenceRate: 0,
			emptyRate: 0,
			fieldPrecision: null,
			fieldRecall: null,
			contactRecall: null,
			organisationKindPrecision: null,
			requestCoverage: null,
			duplicateRate: null,
			locationFill: null,
			rowsPerScan: null,
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
	let groundable = 0
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
	let groundableCostCents = 0
	let groundedRunsWithUsage = 0
	let totalPaidCostCents = 0
	let totalTokensIn = 0
	let totalTokensOut = 0
	let totalCredits = 0
	// The market figures, totalled as counts and divided once at the end, so a
	// sixty-row market weighs sixty rows against a six-row one's six.
	let scansScored = 0
	let totalRowsReturned = 0
	let totalRowsRightKind = 0
	let totalRowsLocated = 0
	let totalRowsDuplicated = 0
	let totalPartsExpected = 0
	let totalPartsAnswered = 0
	for (const score of scores) {
		// Only a run that was asked to reach a particular company can be counted for
		// having reached it.
		if (score.groundable) {
			groundable++
			if (score.grounded) grounded++
		}
		// The cost figure below divides by this rather than by every grounded run,
		// so that a run whose spend was never read back cannot sit in the divisor
		// with nothing above the line and drag the figure under the plain per-run cost.
		if (score.groundable && score.grounded && score.usage !== undefined)
			groundedRunsWithUsage++
		// The look-alike counts ask the same question grounding does — was this the
		// company we sent it after — so a market request is outside them too. It can
		// never be a look-alike, and leaving it in the denominator quietly waters the
		// rate down with runs that had no way to fail it.
		if (score.groundable) {
			if (score.wrongCompany) wrong++
			if (score.wrongCompanyAutoApplicable) wrongAutoApplicable++
		}
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
		if (score.market !== undefined) {
			scansScored++
			totalRowsReturned += score.market.rowsReturned
			totalRowsRightKind += score.market.rowsRightKind
			totalRowsLocated += score.market.rowsLocated
			totalRowsDuplicated += score.market.rowsDuplicated
			totalPartsExpected += score.market.partsExpected
			totalPartsAnswered += score.market.partsAnswered
		}
		totalExpected += score.fieldsExpected
		totalScored += score.fieldsScored
		totalCorrect += score.fieldsCorrect
		totalContactsExpected += score.contactsExpected
		totalContactsFound += score.contactsFound
		if (score.usage !== undefined) {
			runsWithUsage++
			totalCostCents += score.usage.costCents
			// What a usable run cost divides by the runs that grounded, so only what
			// those runs spent belongs on top of it. A market request grounds nothing
			// and can cost more than a profile run, so counting its spend here would
			// bill it to the handful of company runs and read as a cost blow-up.
			if (score.groundable) groundableCostCents += score.usage.costCents
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

	// A market that came back with no rows at all has nothing to judge per row, but
	// its coverage still reads — none of the parts was answered, which is the whole
	// point of the figure.
	const perRow = (total: number): number | null =>
		totalRowsReturned === 0 ? null : total / totalRowsReturned

	return {
		runs,
		groundingAccuracy: groundable === 0 ? null : grounded / groundable,
		wrongCompanyRate: groundable === 0 ? null : wrong / groundable,
		wrongCompanyAutoApplicableRate:
			groundable === 0 ? null : wrongAutoApplicable / groundable,
		lowConfidenceRate: lowConfidence / runs,
		emptyRate: empty / runs,
		fieldPrecision: totalScored === 0 ? null : totalCorrect / totalScored,
		fieldRecall: totalExpected === 0 ? null : totalCorrect / totalExpected,
		contactRecall:
			totalContactsExpected === 0
				? null
				: totalContactsFound / totalContactsExpected,
		organisationKindPrecision: perRow(totalRowsRightKind),
		requestCoverage:
			totalPartsExpected === 0 ? null : totalPartsAnswered / totalPartsExpected,
		duplicateRate: perRow(totalRowsDuplicated),
		locationFill: perRow(totalRowsLocated),
		rowsPerScan: scansScored === 0 ? null : totalRowsReturned / scansScored,
		fieldsFilledPerRun:
			runsWithProfile === 0 ? null : totalFieldsFilled / runsWithProfile,
		profileFieldsTotal: runsWithProfile === 0 ? null : profileFieldsTotal,
		contactsNamedPerRun:
			runsWithProfile === 0 ? null : totalContactsNamed / runsWithProfile,
		contactsTitledPerRun:
			runsWithProfile === 0 ? null : totalContactsTitled / runsWithProfile,
		costPerRun: runsWithUsage === 0 ? null : totalCostCents / runsWithUsage,
		costPerGroundedRun:
			groundedRunsWithUsage === 0
				? null
				: groundableCostCents / groundedRunsWithUsage,
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
