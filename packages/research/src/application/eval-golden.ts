/**
 * Parses the golden set — the list of companies with a known-correct answer that
 * the eval scores every run against — into the typed `GoldenExpectation` the scorer
 * reads.
 *
 * A row arrives the way the observability platform stores it: the research query as
 * the "input", and the known answer as the "expected output" (arbitrary JSON, which
 * a CSV export hands back as a string). Validation is strict and returns a friendly
 * reason per bad row — a typo in the golden data (a mis-spelled field, a missing
 * official domain) has to fail loudly, because a wrong "correct answer" silently
 * poisons every number the harness reports.
 *
 * A row asks for a company or for a market, and the answer says which. A company row
 * names the company's own address, which is the proof a run reached the right one. A
 * market row names a whole market instead — the parts it asks for and the
 * organisations known not to be companies there — and needs no address, because there
 * is no single company for the run to have reached. A row that asks for neither
 * still fails.
 */

import {
	GOLDEN_BUCKETS,
	type GoldenBucket,
	type GoldenExpectation,
	type KnownCompany,
	type MarketExpectation,
	type MarketPart,
	SCORABLE_FIELDS,
	type ScorableField,
} from './eval-scoring'
import { isSocialPlatformHost } from './social-sites'
import { termTokens } from './term-match'

/**
 * A raw golden row before validation: an id, the research query (the dataset
 * "input"), and the known-correct answer (the dataset "expected output") as
 * arbitrary JSON or a JSON string.
 */
export interface RawGoldenRow {
	readonly id: string
	readonly query: string
	readonly expectedOutput: unknown
}

export type GoldenParseResult =
	| { readonly ok: true; readonly value: GoldenExpectation }
	| { readonly ok: false; readonly error: string }

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null

// The expected output is a JSON string after a CSV export, or an already-parsed
// object over the API; accept either.
const parseExpectedOutput = (raw: unknown): Record<string, unknown> | null => {
	if (typeof raw === 'string') {
		try {
			return asRecord(JSON.parse(raw))
		} catch {
			return null
		}
	}
	return asRecord(raw)
}

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
	Array.isArray(value) && value.every(item => typeof item === 'string')

type KnownCompaniesParseResult =
	| {
			readonly ok: true
			readonly value: ReadonlyArray<KnownCompany> | undefined
	  }
	| { readonly ok: false; readonly error: string }

// A host as the scorer compares it: no scheme, no `www.`, no path, lower-case.
// Anything that is not one — an address with a path, a sentence — is refused
// rather than tidied, since a host nobody can match reads as a firm never found.
const BARE_HOST = /^(?!www\.)[a-z0-9-]+(\.[a-z0-9-]+)+$/

export const isBareHost = (value: unknown): value is string =>
	typeof value === 'string' && BARE_HOST.test(value)

/**
 * The firms a market row names as known to exist. Absent is fine and means none
 * are written down; present, every entry has to be usable, because a firm the
 * scorer cannot match would count as missed on every pass.
 */
const parseKnownCompanies = (raw: unknown): KnownCompaniesParseResult => {
	if (raw === undefined) return { ok: true, value: undefined }
	if (!Array.isArray(raw) || raw.length === 0) {
		return {
			ok: false,
			error:
				'knownCompanies must be a non-empty array (leave the key out when no firms are written down)',
		}
	}
	const known: Array<KnownCompany> = []
	for (const item of raw) {
		const entry = asRecord(item)
		const name = entry?.['name']
		if (typeof name !== 'string' || termTokens(name).length === 0) {
			return {
				ok: false,
				error: 'each knownCompanies entry needs a name this eval can read',
			}
		}
		const host = entry?.['host']
		if (host !== null && !isBareHost(host)) {
			return {
				ok: false,
				error: `knownCompanies entry "${name}" needs a host written bare and lower-case ("acme.example"), or null for a firm with no site of its own`,
			}
		}
		// A social page is never read as a firm's own site, so a host there could
		// never match and the firm would be found by name alone; null says that.
		if (host !== null && isSocialPlatformHost(host)) {
			return {
				ok: false,
				error: `knownCompanies entry "${name}" gives a social platform as its host; a page there is not the firm's own site, so write null`,
			}
		}
		const from = entry?.['from']
		if (typeof from !== 'string' || from.trim() === '') {
			return {
				ok: false,
				error: `knownCompanies entry "${name}" needs a from saying where the firm was found`,
			}
		}
		known.push({ name: name.trim(), host, from: from.trim() })
	}
	return { ok: true, value: known }
}

type MarketParseResult =
	| { readonly ok: true; readonly value: MarketExpectation }
	| { readonly ok: false; readonly error: string }

/**
 * Validate the block that makes a row a request for a whole market rather than for
 * one company: what the market is called, the parts it asks for, and the
 * organisations known not to be companies there.
 *
 * As strict as the rest of this file, and for the same reason. Every figure a market
 * is graded on divides by something this block states, so a mis-typed key does not
 * make a number wrong in a way anyone would notice — it makes a whole market's
 * organisation-kind score read a clean 100% for want of anything to check against.
 */
const parseMarket = (raw: unknown): MarketParseResult => {
	const market = asRecord(raw)
	if (market === null)
		return { ok: false, error: 'market must be a JSON object' }

	const name = market['name']
	if (typeof name !== 'string' || name.trim() === '') {
		return { ok: false, error: 'market needs a name' }
	}

	const rawParts = market['parts']
	if (!Array.isArray(rawParts) || rawParts.length === 0) {
		return { ok: false, error: 'market needs a non-empty parts array' }
	}
	const parts: Array<MarketPart> = []
	for (const item of rawParts) {
		const part = asRecord(item)
		const id = part?.['id']
		if (typeof id !== 'string' || id.trim() === '') {
			return { ok: false, error: 'each market part needs an id' }
		}
		const terms = part?.['terms']
		if (!isStringArray(terms) || terms.length === 0) {
			return {
				ok: false,
				error: `market part "${id}" needs a non-empty terms array`,
			}
		}
		// Held to the words the scorer reads, not to whether the string looks empty: a
		// term of punctuation alone survives a blank check and still folds to nothing,
		// so it could never place a row and the part would read unanswered for good.
		const unreadableTerm = terms.find(term => termTokens(term).length === 0)
		if (unreadableTerm !== undefined) {
			return {
				ok: false,
				// Named, and said as what it is. A term written in a script this
				// reading has no letters for has plenty of words in it — telling
				// somebody otherwise sends them looking for a typo that is not there.
				error: `market part "${id}" has a term this eval cannot read: ${unreadableTerm}`,
			}
		}
		parts.push({ id, terms })
	}

	// Required, not optional, and empty is a legitimate answer that has to be typed
	// out. A market whose trade bodies nobody has listed yet scores a perfect
	// organisation-kind precision, and that reading has to be a stated "none known"
	// rather than something a forgotten key produces by accident.
	const notCompanies = market['notCompanies']
	if (!isStringArray(notCompanies)) {
		return {
			ok: false,
			error:
				'market needs a notCompanies array of the organisations known not to be companies (empty if none are known yet)',
		}
	}
	// Same reading as the terms above. An entry that folds to no words matches
	// nothing, so it quietly raises the very figure it was typed in to lower.
	const unreadableEntry = notCompanies.find(
		entry => termTokens(entry).length === 0,
	)
	if (unreadableEntry !== undefined) {
		return {
			ok: false,
			error: `a notCompanies entry this eval cannot read: ${unreadableEntry}`,
		}
	}

	const knownCompanies = parseKnownCompanies(market['knownCompanies'])
	if (!knownCompanies.ok) return knownCompanies

	const placeWords = market['placeWords']
	if (placeWords !== undefined) {
		if (!isStringArray(placeWords) || placeWords.length === 0) {
			return {
				ok: false,
				error:
					"placeWords must be a non-empty array of the asked place's own names (leave the key out when none are written down)",
			}
		}
		const unreadableWord = placeWords.find(
			word => termTokens(word).length === 0,
		)
		if (unreadableWord !== undefined) {
			return {
				ok: false,
				error: `a placeWords entry this eval cannot read: ${unreadableWord}`,
			}
		}
	}

	return {
		ok: true,
		value: {
			name,
			parts,
			notCompanies,
			...(knownCompanies.value !== undefined
				? { knownCompanies: knownCompanies.value }
				: {}),
			...(isStringArray(placeWords) ? { placeWords } : {}),
		},
	}
}

/** Validate one raw row into a `GoldenExpectation`, or explain why it can't be. */
export const parseGoldenRow = (row: RawGoldenRow): GoldenParseResult => {
	if (row.query.trim().length === 0) {
		return { ok: false, error: 'query is empty' }
	}
	const answer = parseExpectedOutput(row.expectedOutput)
	if (answer === null) {
		return { ok: false, error: 'expected output is not a JSON object' }
	}

	// Which question this row asks is settled before anything else is checked, so a
	// row that asks the wrong two at once is told that first rather than being sent
	// away to correct the spelling of a key it should not carry at all.
	//
	// A row asks about one company or about a market, never both. Every company key
	// beside a market block turns a correct "does not apply" into a wrong number: an
	// address makes the search graded on reaching a company nobody named, so it
	// reports nought grounding, and a `fields: { country: "ES" }` written next to a
	// market already called ES reports nought field recall and invents a country
	// group. Both read as the pipeline failing, which is why this refuses rather than
	// picking one meaning. A key present but carrying nothing claims nothing, so it
	// is not the conflict.
	const rawMarket = answer['market']
	const claimsSomething = (value: unknown): boolean =>
		value !== undefined && (!Array.isArray(value) || value.length > 0)
	if (rawMarket !== undefined) {
		const alsoNamed = [
			'officialDomain',
			'altDomains',
			'fields',
			'contacts',
		].filter(key => claimsSomething(answer[key]))
		if (alsoNamed.length > 0) {
			return {
				ok: false,
				error: `a market row cannot also carry ${alsoNamed.join(', ')} — those grade a run against one named company`,
			}
		}
	}

	const rawAltDomains = answer['altDomains']
	if (rawAltDomains !== undefined && !isStringArray(rawAltDomains)) {
		return { ok: false, error: 'altDomains must be an array of strings' }
	}

	// A row asking for a whole market names no one company, so there is no company
	// site for the run to have reached and no address to demand of it below.
	let market: MarketExpectation | undefined
	if (rawMarket !== undefined) {
		const parsed = parseMarket(rawMarket)
		if (!parsed.ok) return { ok: false, error: parsed.error }
		market = parsed.value
	}

	// A row has to name at least one address that proves the run reached the right
	// company, but it does not have to be the company's own site. Some companies
	// have no site at all — a market stall, a family workshop, a jobbing builder —
	// and they are exactly the hard cases worth measuring. For one of those, the
	// proof is a register entry or a directory page, given as an alt domain.
	// Insisting on an official domain kept every such company out of the set.
	const rawOfficialDomain = answer['officialDomain']
	const officialDomain =
		typeof rawOfficialDomain === 'string' && rawOfficialDomain.trim().length > 0
			? rawOfficialDomain
			: null
	const altDomains = rawAltDomains ?? []
	if (
		market === undefined &&
		officialDomain === null &&
		altDomains.length === 0
	) {
		return {
			ok: false,
			error:
				'expected output needs an officialDomain, or altDomains for a company with no website of its own, or a market block for a request that asks for a whole market',
		}
	}

	const fields: Partial<Record<ScorableField, string>> = {}
	const rawFields = answer['fields']
	if (rawFields !== undefined) {
		const fieldsRecord = asRecord(rawFields)
		if (fieldsRecord === null) {
			return { ok: false, error: 'fields must be a JSON object' }
		}
		for (const [key, value] of Object.entries(fieldsRecord)) {
			if (!SCORABLE_FIELDS.includes(key as ScorableField)) {
				return {
					ok: false,
					error: `unknown field "${key}" (allowed: ${SCORABLE_FIELDS.join(', ')})`,
				}
			}
			if (typeof value !== 'string') {
				return { ok: false, error: `field "${key}" must be a string` }
			}
			fields[key as ScorableField] = value
		}
	}

	// Expected people, given as a name string or a `{ name }` object. Optional —
	// only rows that list them are scored for contact recall.
	const contacts: Array<{ name: string }> = []
	const rawContacts = answer['contacts']
	if (rawContacts !== undefined) {
		if (!Array.isArray(rawContacts)) {
			return { ok: false, error: 'contacts must be an array' }
		}
		for (const item of rawContacts) {
			const name = typeof item === 'string' ? item : asRecord(item)?.['name']
			if (typeof name !== 'string' || name.trim() === '') {
				return {
					ok: false,
					error: 'each contact must be a name string or a { name } object',
				}
			}
			contacts.push({ name })
		}
	}

	// Size/reach bucket, so the harness can report quality per segment. Optional,
	// but a value that is not a known bucket fails loudly like any other typo.
	const rawBucket = answer['bucket']
	if (
		rawBucket !== undefined &&
		!GOLDEN_BUCKETS.includes(rawBucket as GoldenBucket)
	) {
		return {
			ok: false,
			error: `unknown bucket "${String(rawBucket)}" (allowed: ${GOLDEN_BUCKETS.join(', ')})`,
		}
	}

	return {
		ok: true,
		value: {
			id: row.id,
			query: row.query,
			officialDomain,
			...(rawAltDomains !== undefined ? { altDomains: rawAltDomains } : {}),

			fields,
			...(contacts.length > 0 ? { contacts } : {}),
			...(rawBucket !== undefined ? { bucket: rawBucket as GoldenBucket } : {}),
			...(market !== undefined ? { market } : {}),
		},
	}
}

/**
 * Validate a whole golden set, keeping the good rows and collecting a reason for
 * each bad one — so one malformed row cannot silently drop the whole set.
 */
export const parseGoldenSet = (
	rows: ReadonlyArray<RawGoldenRow>,
): {
	readonly golden: ReadonlyArray<GoldenExpectation>
	readonly errors: ReadonlyArray<{
		readonly id: string
		readonly error: string
	}>
} => {
	const golden: GoldenExpectation[] = []
	const errors: Array<{ id: string; error: string }> = []
	for (const row of rows) {
		const result = parseGoldenRow(row)
		if (result.ok) golden.push(result.value)
		else errors.push({ id: row.id, error: result.error })
	}
	return { golden, errors }
}
