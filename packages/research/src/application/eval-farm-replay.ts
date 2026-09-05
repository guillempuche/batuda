/**
 * Replays rows a discovery scan already returned past a candidate rule, and says
 * what that rule would have done to each of them.
 *
 * ## Why a replay and not a pass of the eval
 *
 * The golden markets are three country-wide requests. The thing this measures is
 * a page written for ONE TOWN — "<trade> in <municipality>" — and a country-wide
 * request barely meets those, so a billable pass over the golden set can move a
 * long way without saying anything about this at all. The rows here came back
 * from real municipality scans, and the answer for each of them has already been
 * decided by reading it, so a pass costs nothing, reaches no vendor, and gives
 * the same number twice.
 *
 * ## Why three answers and not "junk or not"
 *
 * Two different things wear the same address shape, and telling them apart is
 * the whole job:
 *
 *  - **A network.** One operator, a domain per trade and town, each filed as its
 *    own "company". Its own pages say what it is — a cluster of OTHER firms it
 *    passes work to. There is no company here, and the row should go.
 *  - **A real firm's town pages.** An ordinary business writes one landing page
 *    per town it will travel to. The firm exists and belongs on the list; what is
 *    wrong is the row's PLACE, read off a page that says where the firm will go
 *    rather than where it is. Dropping these deletes real companies.
 *
 * A rule graded on one number can score well by dropping both, which is the
 * expensive way to be wrong. So the score keeps them apart and reports the rows a
 * rule would delete BY NAME: a count says a rule is 3% wrong, a name says which
 * company somebody paid to find would have gone.
 *
 * ## What a row carries, and what it does not
 *
 * Only what a rule can read off the answer — the name, the address, the place the
 * row states, and the pages it cites. No page text and no fetch: a rule that needs
 * to read the page is a rule this cannot grade, which is deliberate. The point of
 * this file is to find out whether the shape of an address is enough.
 *
 * The labels are read by a person, not derived from the addresses, and the
 * difference matters. One row of the network reached the list citing a finance
 * profile and nothing of the network's own, so no rule that reads hosts can ever
 * catch it. Labelling it by its hosts would quietly turn that row into a pass;
 * labelled for what it is, every host rule reports it as the miss it is.
 */

/** What a row is, established by reading it rather than by any rule here. */
export type FarmLabel =
	/** An operator's own page filed as a company. There is no company. */
	| 'network'
	/** A real firm, whose place was read off a page about a town it serves. */
	| 'serves_not_in'
	/** An ordinary row. Whatever a rule does to this one, it should be nothing. */
	| 'ok'

/** What a candidate rule says to do with a row. */
export type FarmVerdict =
	/** Take the row off the list. */
	| 'drop'
	/** Keep the company, refuse the place the row states. */
	| 'refuse_place'
	/** Leave it alone. */
	| 'keep'

/** One row of a scan, as much of it as a rule is allowed to read. */
export interface FarmRow {
	readonly id: string
	/** The towns the run asked about, in the words the request used. */
	readonly askedAbout: ReadonlyArray<string>
	readonly name: string
	/** The row's own website, unwrapped, or null when it stated none. */
	readonly website: string | null
	/** Where the row says the company is, unwrapped, or null. */
	readonly statedPlace: string | null
	/**
	 * Every address the row rests on, the website among them rather than beside
	 * them. A rule asking whether a row rests on some host has one list to read,
	 * so it cannot pass a row by forgetting that the website is an address too —
	 * which is the same silent miss this file exists to catch.
	 */
	readonly addresses: ReadonlyArray<string>
	readonly label: FarmLabel
}

/**
 * A candidate rule, handed the whole list at once and answering by row id.
 *
 * The whole list, not a row at a time, because the answer for one row lives in
 * the others. An operator filing itself as several companies gives itself away
 * across the rows it produced, never inside any one of them — and a rule handed
 * one row could not see that however well it was written. A rule that really does
 * read a row on its own is lifted with `rowByRow` and loses nothing.
 *
 * A row the answer leaves out is kept: doing nothing is the safe verdict, and a
 * rule that reaches no conclusion should not be read as reaching one.
 */
export type FarmJudge = (
	rows: ReadonlyArray<FarmRow>,
) => ReadonlyMap<string, FarmVerdict>

/** Turn a rule that reads one row at a time into one that reads the list. */
export const rowByRow =
	(judge: (row: FarmRow) => FarmVerdict): FarmJudge =>
	rows =>
		new Map(rows.map(row => [row.id, judge(row)]))

export interface FarmReplayScore {
	readonly rows: number
	/** Network rows the rule took off the list, of all the network rows there are. */
	readonly networkDropped: number
	readonly networkTotal: number
	/** Town-page rows whose place the rule refused, of all the town-page rows. */
	readonly placeRefused: number
	readonly placeTotal: number
	/**
	 * Real companies the rule would have deleted, by name. The expensive mistake,
	 * and the one a single accuracy figure hides: somebody paid to find these.
	 */
	readonly companiesDeleted: ReadonlyArray<string>
	/**
	 * Ordinary rows whose place the rule refused for no reason. Cheaper than a
	 * deletion — the company survives wearing a doubt it did not earn — and still
	 * a cost, so it is counted apart rather than folded in.
	 */
	readonly placesRefusedInError: ReadonlyArray<string>
}

// Every label there is, written as a record rather than a list so the two cannot
// drift: a member added to `FarmLabel` and not to this is a type error here, and
// a key here that the union does not have is a type error too.
const LABELS: Record<FarmLabel, true> = {
	network: true,
	serves_not_in: true,
	ok: true,
}

const isFarmLabel = (value: unknown): value is FarmLabel =>
	typeof value === 'string' && Object.hasOwn(LABELS, value)

export type FarmRowParseResult =
	| { readonly ok: true; readonly value: FarmRow }
	| { readonly ok: false; readonly error: string }

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null

/**
 * The result of reading a field a row may leave out, but must not state as the
 * wrong kind of thing.
 *
 * Left out is a real answer — a row can cite nothing and state no place. A value
 * of the wrong shape is not, and the two must not be read the same way: an
 * `addresses` written as one bare string instead of a list, read as "no
 * addresses", takes the row's evidence away without saying so, and every rule
 * graded against that row then reports a miss it did not earn. So absence passes
 * and a wrong shape is refused, which is the same reason an unlabelled row is
 * refused below.
 */
type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false }

// The same reading runs over each entry as over the field: a blank one is an
// author leaving something out and is skipped, while an entry that is not text at
// all is the wrong shape and refuses the row. Dropping that one quietly would
// take an address off a row and cost a rule a catch it had earned.
const readTexts = (value: unknown): Read<ReadonlyArray<string>> => {
	if (value === undefined || value === null) return { ok: true, value: [] }
	if (!Array.isArray(value)) return { ok: false }
	const texts: Array<string> = []
	for (const item of value) {
		if (item === undefined || item === null) continue
		if (typeof item !== 'string') return { ok: false }
		if (item.trim() !== '') texts.push(item)
	}
	return { ok: true, value: texts }
}

const readTextOrNull = (value: unknown): Read<string | null> => {
	if (value === undefined || value === null) return { ok: true, value: null }
	if (typeof value !== 'string') return { ok: false }
	return { ok: true, value: value.trim() === '' ? null : value }
}

const textOrNull = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() !== '' ? value : null

/**
 * Read one row of a corpus file.
 *
 * A row missing its label is refused rather than defaulted to `ok`: an unlabelled
 * row silently read as ordinary would make every rule look better than it is,
 * which is the one direction this must not be wrong in.
 */
export const parseFarmRow = (raw: unknown): FarmRowParseResult => {
	const row = asRecord(raw)
	if (row === null) return { ok: false, error: 'row is not an object' }

	const id = textOrNull(row['id'])
	if (id === null) return { ok: false, error: 'row has no id' }

	const name = textOrNull(row['name'])
	if (name === null) return { ok: false, error: `${id}: row has no name` }

	const label = row['label']
	if (!isFarmLabel(label)) {
		return {
			ok: false,
			error: `${id}: label must be one of network, serves_not_in, ok`,
		}
	}

	const askedAbout = readTexts(row['askedAbout'])
	if (!askedAbout.ok) {
		return { ok: false, error: `${id}: askedAbout must be a list of strings` }
	}
	const addresses = readTexts(row['addresses'])
	if (!addresses.ok) {
		return { ok: false, error: `${id}: addresses must be a list of strings` }
	}
	const website = readTextOrNull(row['website'])
	if (!website.ok)
		return { ok: false, error: `${id}: website must be a string` }
	const statedPlace = readTextOrNull(row['statedPlace'])
	if (!statedPlace.ok) {
		return { ok: false, error: `${id}: statedPlace must be a string` }
	}

	return {
		ok: true,
		value: {
			id,
			askedAbout: askedAbout.value,
			name,
			website: website.value,
			statedPlace: statedPlace.value,
			addresses: addresses.value,
			label,
		},
	}
}

/**
 * Read a whole corpus, keeping the rows that parse and naming each one that does
 * not — so a single malformed row cannot quietly shrink the set a rule is graded
 * against.
 *
 * A repeated id is refused, and only became worth refusing when a rule started
 * answering by id: two rows sharing one would take each other's verdict, and the
 * corpus would grade a rule on an answer it never gave.
 */
export const parseFarmCorpus = (
	raw: unknown,
): {
	readonly rows: ReadonlyArray<FarmRow>
	readonly errors: ReadonlyArray<string>
} => {
	if (!Array.isArray(raw))
		return { rows: [], errors: ['corpus is not an array'] }
	const rows: Array<FarmRow> = []
	const errors: Array<string> = []
	const seen = new Set<string>()
	for (const entry of raw) {
		const result = parseFarmRow(entry)
		if (result.ok && seen.has(result.value.id)) {
			errors.push(`${result.value.id}: id is used by more than one row`)
			continue
		}
		if (result.ok) seen.add(result.value.id)
		if (result.ok) rows.push(result.value)
		else errors.push(result.error)
	}
	return { rows, errors }
}

/**
 * Put every row to the rule and count what it did.
 *
 * The judge is handed in, the way the guards that call a model hand theirs in, so
 * this stays pure and a rule can be graded without any of the pipeline around it.
 */
export const scoreFarmReplay = (
	rows: ReadonlyArray<FarmRow>,
	judge: FarmJudge,
): FarmReplayScore => {
	let networkDropped = 0
	let networkTotal = 0
	let placeRefused = 0
	let placeTotal = 0
	const companiesDeleted: Array<string> = []
	const placesRefusedInError: Array<string> = []

	// Asked once, for the whole list. An answer naming a row this corpus does not
	// hold is left where it is: the same reading the place check takes of a verdict
	// about a row it never asked about.
	const answer = judge(rows)

	for (const row of rows) {
		const verdict = answer.get(row.id) ?? 'keep'
		if (row.label === 'network') {
			networkTotal++
			if (verdict === 'drop') networkDropped++
			continue
		}
		// Everything below is a real company, so a drop is a deletion whichever of
		// the two remaining labels the row carries.
		if (verdict === 'drop') companiesDeleted.push(row.name)
		if (row.label === 'serves_not_in') {
			placeTotal++
			if (verdict === 'refuse_place') placeRefused++
			continue
		}
		if (verdict === 'refuse_place') placesRefusedInError.push(row.name)
	}

	return {
		rows: rows.length,
		networkDropped,
		networkTotal,
		placeRefused,
		placeTotal,
		companiesDeleted,
		placesRefusedInError,
	}
}

/**
 * The shipped operator check, as a rule this can grade.
 *
 * It lives here rather than in whatever command happens to run it, for the
 * reason the house keeps its logic out of the CLI: a bridge written at the call
 * site is a bridge nothing tests, and this one decides every number anybody
 * quotes about the rule.
 *
 * The bridging is real work, not a formality. The check takes a findings tree
 * and answers with the rows it KEPT, so the ids have to be carried through it
 * and diffed on the way out. And it has to be asked one run at a time: it reads
 * hosts across a whole list, so rows from two different scans handed to it
 * together would be read against each other in a list no scan ever produced.
 */
export const networkGuardJudge =
	(check: {
		readonly drop: (
			findings: unknown,
			listField: string,
			places: ReadonlyArray<string>,
		) => { readonly findings: unknown }
		readonly placesOf: (place: string) => ReadonlyArray<string>
	}): FarmJudge =>
	rows => {
		const byRun = new Map<string, Array<FarmRow>>()
		for (const row of rows) {
			const runKey = JSON.stringify(row.askedAbout)
			const group = byRun.get(runKey)
			if (group === undefined) byRun.set(runKey, [row])
			else group.push(row)
		}

		const verdicts = new Map<string, FarmVerdict>()
		for (const group of byRun.values()) {
			const places = [
				...new Set(
					group.flatMap(row => row.askedAbout.flatMap(check.placesOf)),
				),
			]
			const { findings: kept } = check.drop(
				{
					prospects: group.map(row => ({
						id: row.id,
						name: row.name,
						...(row.website === null ? {} : { website: row.website }),
						citations: row.addresses.map(address => ({ source_id: address })),
					})),
				},
				'prospects',
				places,
			)
			// Diffed by id rather than by name: a run repeats a name across rows far
			// more often than it repeats an id, and joined by name two rows would
			// take each other's verdict.
			const survived = new Set(
				(kept as { prospects: ReadonlyArray<{ id: string }> }).prospects.map(
					prospect => prospect.id,
				),
			)
			for (const row of group) {
				verdicts.set(row.id, survived.has(row.id) ? 'keep' : 'drop')
			}
		}
		return verdicts
	}
