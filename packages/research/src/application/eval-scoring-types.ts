/**
 * The shapes the eval scores against, and the two text helpers both halves of the
 * scoring share.
 *
 * A golden row's known answer, one run's outcome, the score of a run, and the rates a
 * whole pass rolls up to. They live apart from the scoring itself because a company row
 * and a market row are graded by entirely different code and share only these — see
 * eval-scoring-company.ts and eval-scoring-market.ts.
 */

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
export const endedWithAnAnswer = (status: TerminalStatus): boolean =>
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
		/**
		 * Whether two independent websites established the company, one of them its
		 * own site. False on a row carrying no verdict, which is the right reading
		 * rather than a missing one: nothing established that company.
		 */
		readonly confirmed: boolean
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
	 * How the kind of each row was settled: named in the golden file, ruled on by a
	 * model, or left alone because nothing decided it.
	 *
	 * Reported because a pass where the model faltered part way through produces one
	 * percentage out of two different methods, and reading that as a single figure
	 * would hide the change. A pass that asked no model is all `unjudged` bar the
	 * rows the golden file named, which is what this figure always was.
	 */
	readonly rowsGoldenListed: number
	readonly rowsJudged: number
	readonly rowsUnjudged: number
	/**
	 * Rows the scan came back with. The scale the figures below read against, and
	 * what checking that every row is a real company would cost, so it is reported
	 * in its own right rather than only as a denominator.
	 */
	readonly rowsReturned: number
	/**
	 * Of the rows returned, how many the run established as real companies.
	 *
	 * Counted over every row rather than the right-kind ones, so it answers "how
	 * much of what came back does the run stand behind" — the figure the recall
	 * cost of requiring two independent sources is read off. A pass whose rows
	 * carry no verdict reads nought, which is what it confirmed.
	 */
	readonly rowsConfirmed: number
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

/**
 * How one field went, kept beside the counts so a report can say which field missed
 * and what came back instead.
 *
 * The counts alone say a run got three of five right, and answering "which three"
 * then costs another pass over the whole set — hours, and real money. Every one of
 * these is read off what the run already returned, so keeping them costs nothing.
 */
export interface FieldOutcome {
	readonly field: ScorableField
	/** The known-correct value from the golden row. */
	readonly expected: string
	/** What the run filled in, or null where it filled nothing. */
	readonly got: string | null
	/** Whether this field counted toward precision — only a filled field does. */
	readonly scored: boolean
	/** Whether what came back matched, by that field's own matching rule. */
	readonly correct: boolean
}

export interface RunScore {
	readonly id: string
	/** What this run cost, carried through so a pass can be totalled and compared. */
	readonly usage?: RunUsage
	/**
	 * Field by field, for the fields the golden row states an answer for. The rates
	 * are computed from the same comparisons, so this adds no judgement of its own —
	 * it only keeps the reasons the counts threw away.
	 */
	readonly fields: ReadonlyArray<FieldOutcome>
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
	/**
	 * Of every row that came back, the share the run established as a real
	 * company. This is where requiring two independent sources shows up: it is
	 * meant to fall below the row count, and how far is the cost of the check.
	 * Read it beside `rowsPerScan` — a pass can hold its confirmation rate up by
	 * returning fewer rows, and only the two together say what happened.
	 */
	readonly confirmationRate: number | null
	/**
	 * How organisation-kind precision was arrived at: the share of rows a model
	 * ruled on, and the share the golden file had already named.
	 *
	 * Printed beside it because the two are not the same measurement. A pass where
	 * the model answered for every row and one where it fell over halfway both
	 * produce a single percentage, and without these the second reads as the first.
	 * What is neither judged nor listed was left alone, and counted as a company.
	 */
	readonly rowsJudgedShare: number | null
	readonly rowsGoldenListedShare: number | null
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

/** Case- and space-insensitive text, for comparing enum-ish field values. */
export const normalizeText = (value: string): string =>
	value.trim().toLowerCase().replace(/\s+/g, ' ')
