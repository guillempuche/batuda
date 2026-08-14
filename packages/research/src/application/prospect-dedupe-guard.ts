/**
 * Folds the rows of one discovery scan that are the same company into one row.
 *
 * A broad search meets a company on a directory, again in a ranking, and again in a
 * news piece, and each meeting can spell it differently — "Cobra Instalaciones y
 * Servicios" and "COBRA INSTALACIONES Y SERVICIOS SA" are one company written twice.
 * Nothing else in the chain catches it: the other duplicate check compares a row
 * against companies already on file, never against another row of the same answer.
 * A list of 62 that is 52 companies is the reader's problem to sort out by hand,
 * and it is the same work every time the scan runs.
 *
 * Two rows are the same company when either their names or their sites say so:
 *  - the same name once its legal form is off the end, so "…y Servicios" and
 *    "…Y SERVICIOS SA" meet, and accents fold on the way;
 *  - the same site host, which catches the pair a rename or a trade name hides.
 * Either alone is enough, and sameness carries: A meeting B by name and B meeting C
 * by host makes all three one company, which is what they are.
 *
 * A branch office is the third route, and neither of those two can see it. A company
 * publishes a page per branch, and the scan brings back the company once and each
 * branch again — "Terre Solaire" beside "Terre Solaire – agence Lyon". The names are
 * not the same name, and a branch page rarely carries a site of its own, so there is
 * no host either. What the run can see is the shape: a row whose name is another
 * row's name and then some, ending in the very town this row says it sits in. That
 * reads as one company's own branch, and it reads that way in any language, without
 * knowing what "agence" means. See `branchOfficeParents` for why the shape has to be
 * that tight — "one name starts the other" alone would fold two real companies that
 * merely open with the same word.
 *
 * The first row stays and the later ones fill its gaps — a tax id one meeting found
 * and the other did not, the site only the ranking printed — with their citations
 * added to its own. Nothing is overwritten: where both rows state a field, the first
 * one's reading is the one the checks upstream already weighed. Dropping the later
 * rows outright would throw away everything the run paid to find on them, which is
 * the reason this merges instead of filtering.
 *
 * Branches are the one exception to both of those, because they are the one case
 * where the later rows are about somewhere else. The company's own name survives
 * even when the list met a branch first, and every branch's town is kept beside the
 * others rather than the first arrival standing for all of them — a company working
 * from four towns is worth knowing about, and four towns is what the run found.
 *
 * It runs after the website check, so a member-directory address several rows shared
 * is already gone by the time a host counts as evidence two rows are one company.
 */

import {
	collapse,
	DISTINCTIVE_NAME_LENGTH,
	foldTokens,
	nameCore,
	nameCoreTokens,
	withoutFormDots,
} from './entity-guard'
import { isPlainObject } from './guard-shapes'
import { hostOf, isBareWebAddress } from './source-key'

// The host of a row's own site, or null when the field holds nothing an address can
// be read from. Null is also what a branch page looks like: it is the head office
// that registers the domain, and the branch is a page on it at most.
const siteHostOf = (row: Record<string, unknown>): string | null => {
	const website = row['website']
	return typeof website === 'string' && isBareWebAddress(website)
		? hostOf(website)
		: null
}

/**
 * What a row is filed under: its name with the legal form off the end, and the host
 * of its site. Either identifies the company on its own. A key nothing can be read
 * from is left out rather than becoming a key every thin row shares.
 *
 * Exported because the fold here is not the only place one company can arrive
 * twice: a later round that looks again for a company's missing fields matches what
 * it finds against the list, and matching on anything looser would file the same
 * company under its fuller legal name as somebody new.
 */
export const discoveryRowIdentityKeys = (
	row: Record<string, unknown>,
): ReadonlyArray<string> => {
	const keys: Array<string> = []
	const name = row['name']
	if (typeof name === 'string') {
		// A name that is nothing but a legal form leaves no core to file under. It
		// still has to file under something, or two rows carrying the same useless
		// name have no key to meet on and the list keeps every copy of it.
		const core = nameCore(withoutFormDots(name))
		const filedAs = core === '' ? collapse(name) : core
		if (filedAs !== '') keys.push(`name:${filedAs}`)
	}
	const host = siteHostOf(row)
	if (host !== null) keys.push(`host:${host}`)
	return keys
}

// Whether one name says another name and then more, word for word — "Terre Solaire"
// starts "Terre Solaire – agence Lyon". Whole words, because the letters alone would
// also have "Terre Solaire" start "Terres Solaires", which is a different company.
const saysThenMore = (
	name: ReadonlyArray<string>,
	opening: ReadonlyArray<string>,
): boolean =>
	opening.length < name.length && opening.every((word, at) => name[at] === word)

/**
 * For each row that reads as another row's branch office, which row it belongs to,
 * both named by their place in the list.
 *
 * A row is one of another's branches when all four hold:
 *  - its name says that row's name and then more;
 *  - it carries no site of its own, so it is not claiming a separate presence — and
 *    a branch that gives the head office's address has already met it on the host;
 *  - it says where it is;
 *  - and its name **ends** on a word of that place. This is the whole of the rule's
 *    safety. "One name starts the other" would fold "Terre Solaire" into a real and
 *    different "Terre Solaire Energie"; asking that the name end on the town the row
 *    itself claims does not, because "Energie" is not where anyone is. It is also
 *    the reason there is no list of the words a branch is announced with — "agence",
 *    "sucursal", "Niederlassung" — which would only be the languages somebody
 *    thought of: the row tells us its own town, so nothing has to be known in
 *    advance. It is the last word rather than any word, so that a joiner the place
 *    happens to share — "Acme del Norte" sitting in "Puerto del Rosario" — cannot
 *    pass for the town.
 *
 * A branch hangs off the longest name it could hang off, never every one of them.
 * With "Acme", "Acme Solar" and "Acme Solar Lyon" on one list, the last belongs to
 * "Acme Solar"; letting it belong to both would drag "Acme" and "Acme Solar" into
 * one company through it, and those two are exactly the pair this must keep apart.
 *
 * A name too short to stand for a company on its own is no anchor for anybody's
 * branches, so it is passed over rather than collecting every longer name on the
 * list.
 *
 * What this still cannot tell apart: a company whose whole name is the trade it
 * works in, sitting on a list beside unrelated firms called that trade and a town.
 * "Electricidad" would take "Electricidad Madrid" and "Electricidad Barcelona" for
 * its branches. Requiring the row above to be present at all is what bounds it —
 * the pattern alone folds nothing — and going further means judging a name generic,
 * which is a list of trade words in whichever languages somebody thought of.
 *
 * Exported because the measurement of how many duplicates a list still holds reads
 * a returned list with the same eyes the fold does. A shape the fold acts on and
 * the count cannot see would report a clean list every time.
 */
export const branchOfficeParents = (
	rows: ReadonlyArray<unknown>,
): ReadonlyMap<number, number> => {
	const names = rows.map(row =>
		isPlainObject(row) && typeof row['name'] === 'string'
			? nameCoreTokens(withoutFormDots(row['name']))
			: null,
	)
	// Long enough to stand for a company, worked out once per row rather than again
	// for every longer name it is held up against.
	const anchors = names.map(
		name => name !== null && name.join('').length >= DISTINCTIVE_NAME_LENGTH,
	)
	const parents = new Map<number, number>()
	rows.forEach((row, at) => {
		const name = names[at]
		if (!isPlainObject(row) || name == null) return
		if (siteHostOf(row) !== null) return
		const place = row['location']
		if (typeof place !== 'string') return
		const town = new Set(foldTokens(place))
		const trailing = name[name.length - 1]
		if (trailing === undefined || !town.has(trailing)) return

		let hangsOff: number | undefined
		let longest = 0
		names.forEach((opening, openingAt) => {
			if (opening === null || !anchors[openingAt]) return
			if (!saysThenMore(name, opening) || opening.length <= longest) return
			hangsOff = openingAt
			longest = opening.length
		})
		if (hangsOff !== undefined) parents.set(at, hangsOff)
	})
	return parents
}

// What tells two citations apart: the page each names, as written. Only the case
// and the space around it are ignored — every other character of an address does
// real work, and folding them away would file "/about-us" and "/aboutus" as one
// page and quietly drop the second one's evidence.
const citationKey = (citation: unknown): string =>
	isPlainObject(citation) && typeof citation['source_id'] === 'string'
		? citation['source_id'].trim().toLowerCase()
		: JSON.stringify(citation)

// The citations of both rows, with a page cited twice kept once. A row's evidence is
// the reason to believe it, so a merge that dropped half of it would leave the
// surviving row looking thinner than the run's actual reading.
const mergeCitations = (kept: unknown, added: unknown): unknown => {
	if (!Array.isArray(kept)) return Array.isArray(added) ? added : kept
	if (!Array.isArray(added)) return kept
	const seen = new Set(kept.map(citationKey))
	const extra = added.filter(citation => {
		const key = citationKey(citation)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
	return extra.length === 0 ? kept : [...kept, ...extra]
}

// Whether a place is one of those already named, allowing for one of the two being
// written at more detail — "Lyon" beside "Lyon, Rhône" is one town said twice, and
// listing both would invent a branch the company has not got. Every word of one has
// to appear in the other, rather than one address merely reading inside the other:
// "Roa" sits inside "Roanne" letter for letter, and those are two towns.
const alreadyNamed = (places: string, place: string): boolean => {
	const words = foldTokens(place)
	return places.split(';').some(named => {
		const already = foldTokens(named)
		// One of the two comes apart into no words at all — a place written in a
		// script this folding drops, like "東京". Fall back to the text as written, so
		// a place the code cannot read is added rather than quietly lost: a town
		// stated twice is a small harm beside a town the run found and threw away.
		if (words.length === 0 || already.length === 0)
			return named.trim().toLowerCase() === place.trim().toLowerCase()
		return (
			already.every(word => words.includes(word)) ||
			words.every(word => already.includes(word))
		)
	})
}

// The places already named, plus one more when it is not among them. When a fold puts
// a company's branches onto the row that stays, each branch states the only place it
// has, and keeping whichever arrived first would drop the rest with nothing said.
// Semicolons separate them because a single place is written with commas in it
// already ("Alcobendas, Madrid"), and joining on those would read as one long address.
const alsoAt = (places: unknown, added: string): string => {
	const held = typeof places === 'string' ? places : ''
	const place = added.trim()
	if (place === '') return held
	if (held.trim() === '') return place
	return alreadyNamed(held, place) ? held : `${held}; ${place}`
}

// Fold a later meeting of the same company into the row that stays: fields it never
// filled get filled, and the pages behind the later row are added to its own.
//
// `alsoElsewhere` says this fold is a branch joining its company rather than one
// company met twice. It is the only case where the later row speaks about somewhere
// else, so it is the only one whose place is added to what the row already names
// instead of filling a gap and nothing more.
const foldInto = (
	kept: Record<string, unknown>,
	later: Record<string, unknown>,
	alsoElsewhere: boolean,
): Record<string, unknown> => {
	const merged: Record<string, unknown> = { ...kept }
	for (const [field, value] of Object.entries(later)) {
		if (value === undefined || value === null) continue
		if (field === 'citations') {
			merged['citations'] = mergeCitations(kept['citations'], value)
			continue
		}
		if (field === 'location' && alsoElsewhere && typeof value === 'string') {
			// A row that names nowhere leaves the field as it found it, rather than
			// putting an empty reading where there was no field at all.
			const places = alsoAt(merged['location'], value)
			if (places !== '') merged['location'] = places
			continue
		}
		const held = merged[field]
		if (held === undefined || held === null) merged[field] = value
	}
	return merged
}

export interface DedupeResult {
	readonly findings: unknown
	/** How many rows were folded into an earlier row for being the same company. */
	readonly merged: number
}

/**
 * `listField` is the key holding this scan's companies — `prospects` or
 * `competitors`. Anything else passes through untouched: a run about one named
 * company has no list of its own to compare.
 */
export const dedupeDiscoveryRows = (
	findings: unknown,
	listField: string | undefined,
): DedupeResult => {
	if (listField === undefined) return { findings, merged: 0 }

	let merged = 0
	const dedupe = (rows: ReadonlyArray<unknown>): ReadonlyArray<unknown> => {
		// Which company each row belongs to, named by the earliest row of that
		// company. Worked out in full before anything is folded, because a row can
		// join two rows that were until then separate — one by name, the other by
		// site — and folding as it goes would settle on whichever of the two it
		// happened to meet first, leaving the other behind as a duplicate. The list
		// arrives in whatever order the model wrote it, so that would make the answer
		// depend on the order.
		const companyOfRow = rows.map((_, at) => at)
		const companyOf = (at: number): number => {
			let row = at
			let of = companyOfRow[row]
			while (of !== undefined && of !== row) {
				row = of
				of = companyOfRow[row]
			}
			return row
		}
		const sameCompany = (a: number, b: number): void => {
			const one = companyOf(a)
			const other = companyOf(b)
			if (one === other) return
			// The earlier row names the company, so the list keeps the order it met
			// them in however the two rows turn out to be joined up.
			companyOfRow[Math.max(one, other)] = Math.min(one, other)
		}
		const rowOfKey = new Map<string, number>()
		rows.forEach((row, at) => {
			if (!isPlainObject(row)) return
			for (const key of discoveryRowIdentityKeys(row)) {
				const seen = rowOfKey.get(key)
				if (seen === undefined) rowOfKey.set(key, at)
				else sameCompany(seen, at)
			}
		})
		const parentOfBranch = branchOfficeParents(rows)
		for (const [branch, parent] of parentOfBranch) sameCompany(parent, branch)

		// The company a branch belongs to, following the chain up when a branch hangs
		// off a branch. Every step shortens the name, so this always comes to a stop.
		const companyItself = (at: number): number => {
			let row = at
			let parent = parentOfBranch.get(row)
			while (parent !== undefined) {
				row = parent
				parent = parentOfBranch.get(row)
			}
			return row
		}

		// One row per company, in the order the list first met it — under the company's
		// own name, even where the list met one of its branches first. A reader given
		// "Terre Solaire – agence Lyon" for a company working from five towns has been
		// told the wrong thing about it, and which row a search happened to rank first
		// is no reason to say it.
		const keptAt = new Map<number, number>()
		const kept: Array<unknown> = []
		rows.forEach((row, at) => {
			if (!isPlainObject(row)) {
				kept.push(row)
				return
			}
			const company = companyOf(at)
			const index = keptAt.get(company)
			if (index === undefined) {
				keptAt.set(company, kept.length)
				const headOffice = rows[companyItself(at)]
				const headOfficeName = isPlainObject(headOffice)
					? headOffice['name']
					: undefined
				kept.push(
					typeof headOfficeName === 'string' && headOfficeName !== row['name']
						? { ...row, name: headOfficeName }
						: row,
				)
				return
			}
			// This row speaks about somewhere else than the one it is joining when it is
			// a branch, or when it is the company itself arriving after one of its
			// branches took the place that stays. Another reading of the same branch is
			// neither, and its place fills a gap like any other field.
			const held = kept[index]
			const elsewhere = parentOfBranch.has(at) || companyItself(company) === at
			kept[index] = isPlainObject(held) ? foldInto(held, row, elsewhere) : row
			merged++
		})
		return kept
	}

	const walk = (value: unknown, key?: string): unknown => {
		if (Array.isArray(value)) {
			return key === listField ? dedupe(value) : value.map(item => walk(item))
		}
		if (isPlainObject(value)) {
			return Object.fromEntries(
				Object.entries(value).map(([k, v]) => [k, walk(v, k)] as const),
			)
		}
		return value
	}

	return { findings: walk(findings), merged }
}
