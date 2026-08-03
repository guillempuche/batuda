/**
 * Rewrites a run's extracted size / country to the CRM's fixed codes, and keeps
 * its industry as written.
 *
 * The extractor emits these fields in whatever words the source page used ("50
 * employees", "France"), and size and country really do have a fixed set of
 * codes, so those are mapped by deterministic rules — model-independent, so they
 * do not regress if the extract model changes. Industry no longer has a fixed
 * set: each organisation keeps its own list, so the trade is kept as written and
 * only what was never a trade is blanked (a URL, an email, a whole sentence,
 * "N/A", a qualitative size).
 * It runs in the phase-2 guard chain after value-provenance and before
 * applicability, so a proposal whose only field is blanked ends up empty and is
 * dropped downstream.
 */

import {
	COMPANY_SIZE_RANGES,
	type CompanySizeRange,
	isBuyingRole,
} from '@batuda/domain'

// Trim, lowercase, and strip accents so "Manufactura"/"manufactura" and
// "Girona"/"girona" fold onto one keyword table.
const normalize = (raw: string): string =>
	raw
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')

// Text that can never be a category value — a link, an email, an empty string, or
// a "no value" placeholder — is always blanked, before any keyword match.
const isHardJunk = (n: string): boolean =>
	n === '' ||
	n.includes('://') ||
	n.includes('@') ||
	['n/a', 'na', 'none', 'null', 'unknown', 'tbd', '-'].includes(n)

// More than five words reads as a whole sentence rather than the name of a
// trade. A model that answers the question in prose is saying it did not find a
// trade, and storing the sentence would put it in the organisation's list.
const isSentence = (n: string): boolean => n.split(/\s+/).length > 5

/**
 * Keep the trade the evidence names, rather than deciding which of a fixed few
 * it resembles.
 *
 * This used to fold every value into one of nine words the app shipped with, so
 * "artisanal cheese production" was stored as "other" and the real trade was
 * gone — and the keyword rules were ordered substring matches, which filed
 * "Consultoría industrial" under manufacturing. Each organisation now keeps its
 * own list, so the trade is worth keeping as written.
 *
 * What is still thrown away is what was never a trade: a URL, an address, a
 * sentence the model wrote instead of a label.
 */
export const cleanIndustryLabel = (raw: string): string | null => {
	const n = normalize(raw)
	if (isHardJunk(n)) return null
	if (isSentence(n)) return null
	return raw.trim().replace(/\s+/g, ' ')
}

export const mapSizeRange = (raw: string): CompanySizeRange | null => {
	const n = normalize(raw)
	if (isHardJunk(n)) return null
	if ((COMPANY_SIZE_RANGES as readonly string[]).includes(n))
		return n as CompanySizeRange
	// Take the first integer — a single head-count, or the lower bound of an
	// "N-M" / "N to M" range — and bucket it; the top band is open, so a very large
	// number lands there. A qualitative size ("SME", "small") has no integer → null.
	// Strip a thousands separator sitting between digits first ("1,700" / "1.700"
	// employees), or the match would read "1" and bucket a 1,700-person company as 1-10.
	const firstInt = n.replace(/(?<=\d)[.,](?=\d)/g, '').match(/\d+/)?.[0]
	if (firstInt === undefined) return null
	const count = Number(firstInt)
	if (!Number.isFinite(count) || count <= 0) return null
	if (count <= 10) return '1-10'
	if (count <= 50) return '11-50'
	if (count <= 200) return '51-200'
	if (count <= 500) return '201-500'
	if (count <= 1000) return '501-1000'
	if (count <= 5000) return '1001-5000'
	if (count <= 25000) return '5001-25000'
	if (count <= 100000) return '25001-100000'
	return '100001+'
}

// Common country names → ISO 3166-1 alpha-2, so the extractor's "France" / "United
// Kingdom" become the FR / GB the CRM stores and the golden set scores against. Keys
// are accent-folded and lowercased (matching `normalize`). Not exhaustive on purpose;
// extend as new targets appear.
const COUNTRY_NAME_TO_ALPHA2: Record<string, string> = {
	france: 'FR',
	'united kingdom': 'GB',
	uk: 'GB',
	'great britain': 'GB',
	britain: 'GB',
	england: 'GB',
	scotland: 'GB',
	wales: 'GB',
	spain: 'ES',
	espana: 'ES',
	'united states': 'US',
	'united states of america': 'US',
	usa: 'US',
	germany: 'DE',
	deutschland: 'DE',
	italy: 'IT',
	italia: 'IT',
	portugal: 'PT',
	netherlands: 'NL',
	'the netherlands': 'NL',
	holland: 'NL',
	belgium: 'BE',
	switzerland: 'CH',
	austria: 'AT',
	ireland: 'IE',
	sweden: 'SE',
	norway: 'NO',
	denmark: 'DK',
	finland: 'FI',
	poland: 'PL',
	'czech republic': 'CZ',
	czechia: 'CZ',
	greece: 'GR',
	hungary: 'HU',
	romania: 'RO',
	canada: 'CA',
	mexico: 'MX',
	brazil: 'BR',
	brasil: 'BR',
	argentina: 'AR',
	chile: 'CL',
	colombia: 'CO',
	peru: 'PE',
	paraguay: 'PY',
	uruguay: 'UY',
	ecuador: 'EC',
	australia: 'AU',
	'new zealand': 'NZ',
	japan: 'JP',
	china: 'CN',
	india: 'IN',
	singapore: 'SG',
	'hong kong': 'HK',
	'south korea': 'KR',
	korea: 'KR',
	'united arab emirates': 'AE',
	uae: 'AE',
	'saudi arabia': 'SA',
	israel: 'IL',
	turkey: 'TR',
	turkiye: 'TR',
	'south africa': 'ZA',
	morocco: 'MA',
	egypt: 'EG',
	russia: 'RU',
}

// Fold the model's country to an ISO alpha-2 code: keep a code it already emitted,
// map a known country name, and leave anything else untouched (never dropping a real
// value we simply don't have a code for). Hard junk — a URL, an email, a placeholder —
// is blanked like the other fields.
export const mapCountry = (raw: string): string | null => {
	const n = normalize(raw)
	if (isHardJunk(n)) return null
	if (/^[a-z]{2}$/.test(n)) return n.toUpperCase()
	const iso = COUNTRY_NAME_TO_ALPHA2[n]
	return iso ?? raw
}

// The words a model reaches for when naming somebody's part in a purchase, and
// the part each one means. Written as fragments so "Economic Buyer", "the
// economic buyer" and "economic_buyer" all land in the same place.
//
// Without this the raw phrase is stored as typed, and everything downstream asks
// "is this one of the five?" and gets no. A real budget holder written up as
// "Decision maker" would therefore read as somebody who does not decide — the
// exact person the whole taxonomy exists to surface, quietly dropped.
const BUYING_ROLE_RULES: ReadonlyArray<
	readonly [string, ReadonlyArray<string>]
> = [
	[
		'economic_buyer',
		[
			'economic buyer',
			'economic_buyer',
			'budget',
			'decision maker',
			'decision-maker',
			'decision_maker',
			'decisionmaker',
			'owner',
			'founder',
			'signer',
			'approver',
		],
	],
	[
		'champion',
		['champion', 'advocate', 'sponsor', 'internal supporter', 'promoter'],
	],
	[
		'gatekeeper',
		[
			'gatekeeper',
			'gate keeper',
			'procurement',
			'purchasing',
			'assistant',
			'receptionist',
			'secretar',
		],
	],
	[
		'technical_evaluator',
		[
			'technical evaluator',
			'technical_evaluator',
			'evaluator',
			'technical',
			'engineer',
			'quality',
		],
	],
	['user', ['end user', 'end-user', 'user', 'operator']],
]

/**
 * Fold a model's words for somebody's part in a purchase onto the fixed set.
 *
 * Unmappable is null, which drops the field — deliberately harsher than the
 * industry mapper's fallback to "other". There is no "some other part" here:
 * saying nothing about how somebody decides is honest, while inventing a part
 * would put a made-up person in front of a salesperson.
 */
export const mapBuyingRole = (raw: string): string | null => {
	const n = normalize(raw)
	if (isHardJunk(n)) return null
	if (isBuyingRole(n)) return n
	for (const [code, keywords] of BUYING_ROLE_RULES) {
		if (keywords.some(k => n.includes(k))) return code
	}
	return null
}

const MAPPERS: Record<string, (raw: string) => string | null> = {
	industry: cleanIndustryLabel,
	country: mapCountry,
	// The size band is named twice because it is reached two ways: a run's own
	// findings spell it as the research schema does, while a proposed CRM change
	// spells it the way the company record does.
	size_range: mapSizeRange,
	sizeRange: mapSizeRange,
	// Named twice for the same reason as the size band: a run's own findings
	// spell it as the research schema does, a proposed CRM change as the record
	// does.
	buying_role: mapBuyingRole,
	buyingRole: mapBuyingRole,
}

export interface VocabularyResult {
	readonly findings: unknown
	/** Values rewritten to a different code. */
	readonly mapped: number
	/** Unmappable values whose key was dropped. */
	readonly blanked: number
}

export const constrainVocabulary = (findings: unknown): VocabularyResult => {
	let mapped = 0
	let blanked = 0

	// A field value may be a bare string or a { value, source_id } wrapper (the
	// per-field-citations shape); read and write .value in that case so this stays
	// decoupled from that slice.
	const rawOf = (value: unknown): string | null => {
		if (typeof value === 'string') return value
		if (
			value !== null &&
			typeof value === 'object' &&
			typeof (value as { value?: unknown }).value === 'string'
		)
			return (value as { value: string }).value
		return null
	}
	const withValue = (original: unknown, next: string): unknown =>
		typeof original === 'string'
			? next
			: { ...(original as Record<string, unknown>), value: next }

	const walk = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(walk)
		if (value === null || typeof value !== 'object') return value
		const out: Record<string, unknown> = {}
		for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
			const mapper = MAPPERS[key]
			const raw = mapper ? rawOf(v) : null
			if (mapper && raw !== null) {
				const code = mapper(raw)
				if (code === null) {
					// Drop the key entirely — a missing optional field is the valid
					// "no value", and an emptied proposal is dropped by the applicability
					// guard that runs next.
					blanked++
					continue
				}
				if (code !== raw) mapped++
				out[key] = withValue(v, code)
				continue
			}
			out[key] = walk(v)
		}
		return out
	}

	return { findings: walk(findings), mapped, blanked }
}
