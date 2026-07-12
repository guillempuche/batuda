/**
 * Rewrites a run's extracted industry / region / size to the CRM's fixed codes.
 *
 * The extractor emits these fields in whatever words the source page used
 * ("manufacturing", "Catalonia", "50 employees"), but the CRM stores a fixed set
 * of codes. This guard maps each value to the closest code by deterministic
 * keyword rules — model-independent, so it does not regress if the extract model
 * changes — sending a real-but-uncategorized industry to 'other' and blanking
 * true junk (a URL, an email, a sentence, "N/A", a qualitative size). It runs in
 * the phase-2 guard chain after value-provenance and before applicability, so a
 * proposal whose only field is blanked ends up empty and is dropped downstream.
 */

import {
	CRM_INDUSTRIES,
	CRM_REGIONS,
	CRM_SIZE_RANGES,
	type CrmIndustry,
	type CrmRegion,
	type CrmSizeRange,
} from '../domain/crm-vocabulary'

// Trim, lowercase, and strip accents so "Manufactura"/"manufactura" and
// "Girona"/"girona" fold onto one keyword table.
const normalize = (raw: string): string =>
	raw
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')

// Text that is plainly not a category value — a link, an email, a "no value"
// placeholder, or a whole sentence — is blanked, not mapped.
const isJunk = (n: string): boolean =>
	n === '' ||
	n.includes('://') ||
	n.includes('@') ||
	['n/a', 'na', 'none', 'null', 'unknown', 'tbd', '-'].includes(n) ||
	n.split(/\s+/).length > 5

// Industry keyword table, most specific bucket first so a broad word ("servei")
// never shadows a specific one ("transport"). Stems span Catalan, Spanish, and
// English so a page in any of the three maps the same way.
const INDUSTRY_RULES: ReadonlyArray<
	readonly [CrmIndustry, ReadonlyArray<string>]
> = [
	[
		'transport',
		[
			'transport',
			'logist',
			'freight',
			'carrier',
			'fleet',
			'shipping',
			'courier',
		],
	],
	[
		'hostaleria',
		['hotel', 'hostal', 'allotjament', 'alojamiento', 'hospitality', 'turis'],
	],
	['restauració', ['restaur', 'cuina', 'cocina', 'dining', 'catering', 'cafe']],
	[
		'construcció',
		['constru', 'obra', 'building', 'contractor', 'builder', 'reforma'],
	],
	[
		'manufactura',
		['manufactur', 'fabric', 'factory', 'producc', 'industrial', 'maker'],
	],
	[
		'distribució',
		['distribu', 'majorista', 'mayorista', 'wholesale', 'supplier'],
	],
	[
		'retail',
		[
			'retail',
			'botiga',
			'tienda',
			'shop',
			'store',
			'commerce',
			'comerc',
			'comercio',
			'apparel',
			'fashion',
			'moda',
		],
	],
	[
		'serveis',
		[
			'servei',
			'servic',
			'consult',
			'assessor',
			'software',
			'saas',
			'tech',
			'financ',
			'bank',
			'banc',
			'agenc',
			'legal',
			'marketing',
		],
	],
]

export const mapIndustry = (raw: string): CrmIndustry | null => {
	const n = normalize(raw)
	if (isJunk(n)) return null
	if ((CRM_INDUSTRIES as readonly string[]).includes(n)) return n as CrmIndustry
	for (const [code, keywords] of INDUSTRY_RULES) {
		if (keywords.some(k => n.includes(k))) return code
	}
	// A plausible label matching no bucket is a real-but-uncategorized industry →
	// 'other', never blanked (only junk is blanked).
	return 'other'
}

const REGION_RULES: ReadonlyArray<readonly [CrmRegion, ReadonlyArray<string>]> =
	[
		['cat', ['catalu', 'catalo', 'barcelona', 'girona', 'lleida', 'tarragona']],
		['ara', ['arago', 'zaragoza', 'saragossa', 'huesca', 'osca', 'teruel']],
		[
			'cv',
			[
				'valenc',
				'comunitat valenciana',
				'comunidad valenciana',
				'alicante',
				'alacant',
				'castell',
			],
		],
	]

export const mapRegion = (raw: string): CrmRegion | null => {
	const n = normalize(raw)
	if (isJunk(n)) return null
	if ((CRM_REGIONS as readonly string[]).includes(n)) return n as CrmRegion
	for (const [code, keywords] of REGION_RULES) {
		if (keywords.some(k => n.includes(k))) return code
	}
	// A place outside the CRM's regional domain (Madrid, London) → no region.
	return null
}

export const mapSizeRange = (raw: string): CrmSizeRange | null => {
	const n = normalize(raw)
	if (isJunk(n)) return null
	if ((CRM_SIZE_RANGES as readonly string[]).includes(n))
		return n as CrmSizeRange
	// Take the first integer — a single head-count, or the lower bound of an
	// "N-M" / "N to M" range — and bucket it; a value above the top bracket falls
	// to the closest one. A qualitative size ("SME", "small") has no integer → null.
	// Strip a thousands separator sitting between digits first ("1,700" / "1.700"
	// employees), or the match would read "1" and bucket a 1,700-person company as 1-5.
	const firstInt = n.replace(/(?<=\d)[.,](?=\d)/g, '').match(/\d+/)?.[0]
	if (firstInt === undefined) return null
	const count = Number(firstInt)
	if (!Number.isFinite(count) || count <= 0) return null
	if (count <= 5) return '1-5'
	if (count <= 10) return '6-10'
	if (count <= 25) return '11-25'
	if (count <= 50) return '26-50'
	return '51-200'
}

const MAPPERS: Record<string, (raw: string) => string | null> = {
	industry: mapIndustry,
	region: mapRegion,
	// Match the size key in either casing: findings may carry it snake_cased
	// (`size_range`) or camelCased (`sizeRange`).
	size_range: mapSizeRange,
	sizeRange: mapSizeRange,
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
