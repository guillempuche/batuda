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
 * The first row stays and the later ones fill its gaps — a tax id one meeting found
 * and the other did not, the site only the ranking printed — with their citations
 * added to its own. Nothing is overwritten: where both rows state a field, the first
 * one's reading is the one the checks upstream already weighed. Dropping the later
 * rows outright would throw away everything the run paid to find on them, which is
 * the reason this merges instead of filtering.
 *
 * It runs after the website check, so a member-directory address several rows shared
 * is already gone by the time a host counts as evidence two rows are one company.
 */

import { collapse, nameCore, withoutFormDots } from './entity-guard'
import { isPlainObject } from './guard-shapes'
import { hostOf, isBareWebAddress } from './source-key'

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
	const website = row['website']
	if (typeof website === 'string' && isBareWebAddress(website)) {
		const host = hostOf(website)
		if (host !== null) keys.push(`host:${host}`)
	}
	return keys
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

// Fold a later meeting of the same company into the row that stays: fields it never
// filled get filled, and the pages behind the later row are added to its own.
const foldInto = (
	kept: Record<string, unknown>,
	later: Record<string, unknown>,
): Record<string, unknown> => {
	const merged: Record<string, unknown> = { ...kept }
	for (const [field, value] of Object.entries(later)) {
		if (value === undefined || value === null) continue
		if (field === 'citations') {
			merged['citations'] = mergeCitations(kept['citations'], value)
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

		// One row per company, in the order the list first met it.
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
				kept.push(row)
				return
			}
			const held = kept[index]
			kept[index] = isPlainObject(held) ? foldInto(held, row) : row
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
