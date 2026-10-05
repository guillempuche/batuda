/**
 * Puts rows that scans already returned — and rows they removed — back to the
 * check that decides whether a row is a company of the kind asked for, and says
 * which of them it would remove.
 *
 * ## Why this and not a pass of the eval
 *
 * A market pass takes half an hour a run, costs real money, and moves more from
 * one run to the next than most changes to this check move it. The check itself
 * is one cheap question to a model about rows that are already written down, so
 * asking it again costs cents and takes seconds — provided the answer is not
 * read back from a cache, and provided the rows are asked the way a run asks
 * them: a run's list together, in the run's own batches, never pooled across
 * runs, because which rows share a batch changes the answers.
 *
 * ## What it can and cannot say
 *
 * It says what the check does to a list that exists. It cannot say what a wrong
 * removal costs the rest of a run — a firm struck off in the first round is not
 * there to have its gaps filled in the second — so a change that looks free
 * here is still owed one real run.
 *
 * The labels are a person's. A label written by the model under test, or by
 * whoever wrote the wording under test without reading the firm's own site,
 * measures agreement and nothing else.
 */
import { Effect } from 'effect'

import { isBareHost } from './eval-golden'
import { isPlainObject } from './guard-shapes'
import { judgedRowKey } from './judged-rows'
import {
	dropNonCompanies,
	type OrganisationKindGuardJudge,
} from './organisation-kind-guard'

/** What a row is, established by reading about the firm rather than by the check. */
export type KindLabel =
	/** A firm of the kind the request asked for. Removing it is the costly mistake. */
	| 'company'
	/** A body, a directory, a portal, or a firm that only sells to the kind asked for. */
	| 'other'

export interface KindRow {
	readonly name: string
	/**
	 * The row's own words as the check reads them: `why_relevant`, `description`
	 * and `industry`, whichever the row has, joined with " · ". A removed row is
	 * stored that way already; a kept row has to be joined by whoever builds the file.
	 */
	readonly describedAs: string
	/** The bare host of the website the row gave, or null when it gave none. */
	readonly websiteHost: string | null
	/** Null until somebody has read about the firm; an unlabelled row is asked and not scored. */
	readonly label: KindLabel | null
}

/** One run's list: what was asked, and every row the check saw. */
export interface KindRun {
	readonly id: string
	/** The request in the requester's words, for whoever labels and reads the report. */
	readonly request: string
	/**
	 * What sort of question it was ("installers", "makers", "engineering",
	 * "signal"). The score is read per sort, because a wording that is right for
	 * one is exactly what breaks another.
	 */
	readonly requestKind: string
	readonly rows: ReadonlyArray<KindRow>
}

export type KindCorpusParseResult =
	| { readonly ok: true; readonly value: KindRun }
	| { readonly ok: false; readonly error: string }

const readText = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const parseKindRow = (
	raw: unknown,
): { ok: true; value: KindRow } | { ok: false; error: string } => {
	if (!isPlainObject(raw))
		return { ok: false, error: 'a row must be an object' }
	const name = readText(raw['name'])
	if (name === null) return { ok: false, error: 'a row needs a name' }
	const describedAs = raw['describedAs']
	if (typeof describedAs !== 'string') {
		return {
			ok: false,
			error: `row "${name}" needs a describedAs (empty if the row said nothing of itself)`,
		}
	}
	const websiteHost = raw['websiteHost']
	// Refused rather than tidied: an address the check cannot read is a row asked
	// without its site, which scores like any other and says nothing of it.
	if (websiteHost !== null && !isBareHost(websiteHost)) {
		return {
			ok: false,
			error: `row "${name}" needs a websiteHost written bare and lower-case ("acme.example"), or null for a row that gave no website`,
		}
	}
	const label = raw['label']
	if (label !== null && label !== 'company' && label !== 'other') {
		return {
			ok: false,
			error: `row "${name}" has a label that is neither "company", "other" nor null`,
		}
	}
	return {
		ok: true,
		value: {
			name,
			describedAs: describedAs.trim(),
			websiteHost,
			label,
		},
	}
}

export const parseKindRun = (raw: unknown): KindCorpusParseResult => {
	if (!isPlainObject(raw))
		return { ok: false, error: 'a run must be an object' }
	const id = readText(raw['id'])
	if (id === null) return { ok: false, error: 'a run needs an id' }
	const request = readText(raw['request'])
	if (request === null)
		return { ok: false, error: `run "${id}" needs the request it answered` }
	const requestKind = readText(raw['requestKind'])
	if (requestKind === null) {
		return {
			ok: false,
			error: `run "${id}" needs a requestKind saying what sort of question it was`,
		}
	}
	const rawRows = raw['rows']
	if (!Array.isArray(rawRows) || rawRows.length === 0)
		return { ok: false, error: `run "${id}" needs a non-empty rows array` }
	const rows: KindRow[] = []
	for (const rawRow of rawRows) {
		const row = parseKindRow(rawRow)
		if (!row.ok) return { ok: false, error: `run "${id}": ${row.error}` }
		rows.push(row.value)
	}
	// The check files its answers under a row's folded name, legal form and all
	// stripped, so two rows that fold to one key are one question with two labels
	// waiting to disagree.
	const firstNamed = new Map<string, string>()
	for (const row of rows) {
		const key = judgedRowKey(row.name) ?? row.name.toLowerCase()
		const earlier = firstNamed.get(key)
		if (earlier !== undefined) {
			return {
				ok: false,
				error: `run "${id}" names the same firm twice ("${earlier}", "${row.name}") — a row is asked once per run`,
			}
		}
		firstNamed.set(key, row.name)
	}
	return { ok: true, value: { id, request, requestKind, rows } }
}

export const parseKindCorpus = (
	raw: unknown,
): {
	readonly runs: ReadonlyArray<KindRun>
	readonly errors: ReadonlyArray<string>
} => {
	if (!Array.isArray(raw))
		return { runs: [], errors: ['the corpus must be a JSON array of runs'] }
	const runs: KindRun[] = []
	const errors: string[] = []
	for (const item of raw) {
		const run = parseKindRun(item)
		if (run.ok) runs.push(run.value)
		else errors.push(run.error)
	}
	const ids = runs.map(run => run.id)
	for (const id of new Set(
		ids.filter((id, index) => ids.indexOf(id) !== index),
	))
		errors.push(`two runs share the id "${id}"`)
	return { runs, errors }
}

/** The names the check removed from one run's list, asked the way a run asks. */
export const removedFromRun = <E, R>(
	run: KindRun,
	judge: OrganisationKindGuardJudge<E, R>,
): Effect.Effect<ReadonlySet<string>, E, R> =>
	dropNonCompanies(
		{
			rows: run.rows.map(row => ({
				name: row.name,
				why_relevant: row.describedAs,
				...(row.websiteHost === null
					? {}
					: { website: `https://${row.websiteHost}/` }),
			})),
		},
		'rows',
		judge,
	).pipe(Effect.map(result => new Set(result.dropped.map(row => row.name))))

export interface KindReaskScore {
	/** Rows somebody labelled; the rest were asked and are counted nowhere else. */
	readonly labelled: number
	readonly unlabelled: number
	readonly companies: number
	readonly others: number
	/** Firms of the kind asked for that the check removed — by run and name. */
	readonly wronglyRemoved: ReadonlyArray<string>
	/** Rows that are not such firms and stayed — by run and name. */
	readonly wronglyKept: ReadonlyArray<string>
}

const scoreRows = (
	runs: ReadonlyArray<KindRun>,
	removedByRun: ReadonlyMap<string, ReadonlySet<string>>,
): KindReaskScore => {
	let labelled = 0
	let unlabelled = 0
	let companies = 0
	let others = 0
	const wronglyRemoved: string[] = []
	const wronglyKept: string[] = []
	for (const run of runs) {
		const removed = removedByRun.get(run.id) ?? new Set<string>()
		for (const row of run.rows) {
			if (row.label === null) {
				unlabelled++
				continue
			}
			labelled++
			const wasRemoved = removed.has(row.name)
			if (row.label === 'company') {
				companies++
				if (wasRemoved) wronglyRemoved.push(`${run.id}: ${row.name}`)
			} else {
				others++
				if (!wasRemoved) wronglyKept.push(`${run.id}: ${row.name}`)
			}
		}
	}
	return {
		labelled,
		unlabelled,
		companies,
		others,
		wronglyRemoved,
		wronglyKept,
	}
}

/**
 * One asking of the whole corpus, scored per sort of request and over all of
 * them. `removedByRun` holds, for each run id, the names the check removed.
 */
export const scoreKindReask = (
	runs: ReadonlyArray<KindRun>,
	removedByRun: ReadonlyMap<string, ReadonlySet<string>>,
): {
	readonly overall: KindReaskScore
	readonly byRequestKind: Readonly<Record<string, KindReaskScore>>
} => {
	const byRequestKind: Record<string, KindReaskScore> = {}
	for (const requestKind of new Set(runs.map(run => run.requestKind))) {
		byRequestKind[requestKind] = scoreRows(
			runs.filter(run => run.requestKind === requestKind),
			removedByRun,
		)
	}
	return { overall: scoreRows(runs, removedByRun), byRequestKind }
}

/**
 * How far the two counts moved between askings of the same corpus. The check's
 * answers are a model's, so a second asking differs a little; a change to the
 * check has shown something only when it moves a count outside this range.
 */
export const spreadOf = (
	askings: ReadonlyArray<KindReaskScore>,
): {
	readonly wronglyRemoved: { readonly least: number; readonly most: number }
	readonly wronglyKept: { readonly least: number; readonly most: number }
} | null => {
	if (askings.length === 0) return null
	const range = (counts: ReadonlyArray<number>) => ({
		least: Math.min(...counts),
		most: Math.max(...counts),
	})
	return {
		wronglyRemoved: range(askings.map(score => score.wronglyRemoved.length)),
		wronglyKept: range(askings.map(score => score.wronglyKept.length)),
	}
}
