import { type LangCode, langCodes } from './index'

/* Canonical page identifiers. These are the router's internal page keys —
 * decoupled from user-facing URL segments so the URL structure can evolve
 * without renaming components or refs. */
export type PageId =
	| 'home'
	| 'automations'
	| 'ai-agents'
	| 'about'
	| 'discovery-call'
	| 'dept-finance'
	| 'dept-operations'
	| 'dept-sales'
	| 'dept-admin'
	| 'dept-customer-service'
	| 'dept-procurement'
	| 'dept-hr'
	| 'dept-legal'
	| 'dept-marketing'
	| 'dept-management'
	| 'cases-index'

/* For each (pageId, lang), slugs[0] is the canonical localized slug, and
 * slugs[1..] are accepted aliases that redirect (via URL rewrite) to the
 * canonical one. The English entry's first slug is also the global canonical
 * used as the router's internal key — see `resolveCanonicalSlug`. The tuple
 * type `[string, ...string[]]` encodes the non-empty-array invariant so the
 * first-element lookups below don't need null checks. */
type SlugList = readonly [string, ...string[]]
type SlugTable = Record<PageId, Record<LangCode, SlugList>>

const SLUGS: SlugTable = {
	home: {
		ca: [''],
		es: [''],
		en: [''],
	},
	automations: {
		ca: ['automatitzacions'],
		es: ['automatizaciones'],
		en: ['automations'],
	},
	'ai-agents': {
		ca: ['agents-ia'],
		es: ['agentes-ia'],
		en: ['ai-agents'],
	},
	about: {
		ca: ['guillem', 'taller'],
		es: ['guillem', 'taller'],
		en: ['guillem', 'workshop', 'about'],
	},
	'discovery-call': {
		ca: ['parlem'],
		es: ['hablemos'],
		en: ['lets-talk'],
	},
	'dept-finance': {
		ca: ['departaments/finances'],
		es: ['departamentos/finanzas'],
		en: ['departments/finance'],
	},
	'dept-operations': {
		ca: ['departaments/operacions'],
		es: ['departamentos/operaciones'],
		en: ['departments/operations'],
	},
	'dept-sales': {
		ca: ['departaments/vendes'],
		es: ['departamentos/ventas'],
		en: ['departments/sales'],
	},
	'dept-admin': {
		ca: ['departaments/admin'],
		es: ['departamentos/admin'],
		en: ['departments/admin'],
	},
	'dept-customer-service': {
		ca: ['departaments/atencio-client'],
		es: ['departamentos/atencion-cliente'],
		en: ['departments/customer-service'],
	},
	'dept-procurement': {
		ca: ['departaments/compres'],
		es: ['departamentos/compras'],
		en: ['departments/procurement'],
	},
	'dept-hr': {
		ca: ['departaments/rrhh'],
		es: ['departamentos/rrhh'],
		en: ['departments/hr'],
	},
	'dept-legal': {
		ca: ['departaments/legal'],
		es: ['departamentos/legal'],
		en: ['departments/legal'],
	},
	'dept-marketing': {
		ca: ['departaments/marketing'],
		es: ['departamentos/marketing'],
		en: ['departments/marketing'],
	},
	'dept-management': {
		ca: ['departaments/direccio'],
		es: ['departamentos/direccion'],
		en: ['departments/management'],
	},
	'cases-index': {
		ca: ['casos'],
		es: ['casos'],
		en: ['cases'],
	},
}

/* Flat lookup indices built once at module load so the rewrite functions
 * stay O(1) per request. Rewrites run on every navigation — avoid any
 * per-call iteration over the table. */
const CANONICAL_TO_PAGE_ID = new Map<string, PageId>()
const LOCALIZED_TO_PAGE_ID = new Map<string, PageId>()

for (const pageId of Object.keys(SLUGS) as PageId[]) {
	const table = SLUGS[pageId]
	CANONICAL_TO_PAGE_ID.set(table.en[0], pageId)
	for (const lang of langCodes) {
		for (const slug of table[lang]) {
			LOCALIZED_TO_PAGE_ID.set(`${lang}:${slug}`, pageId)
		}
	}
}

/* Input rewrite: browser URL (possibly aliased) → router's canonical English
 * slug. Returns null if the localized slug is not recognised, so the router
 * can let the 404 path handle it. */
export function resolveLocalizedSlug(
	lang: LangCode,
	localizedSlug: string,
): string | null {
	const pageId = LOCALIZED_TO_PAGE_ID.get(`${lang}:${localizedSlug}`)
	if (!pageId) return null
	return SLUGS[pageId].en[0]
}

/* Output rewrite: router's canonical English slug → the canonical localized
 * slug (always slugs[0], never an alias) so `rel=canonical` and the browser
 * URL always point at one canonical form per language. */
export function localizeSlug(
	lang: LangCode,
	canonicalSlug: string,
): string | null {
	const pageId = CANONICAL_TO_PAGE_ID.get(canonicalSlug)
	if (!pageId) return null
	return SLUGS[pageId][lang][0]
}

export function resolveCanonicalSlug(canonicalSlug: string): PageId | null {
	return CANONICAL_TO_PAGE_ID.get(canonicalSlug) ?? null
}

export function buildPublicPath(pageId: PageId, lang: LangCode): string {
	const slug = SLUGS[pageId][lang][0]
	return slug === '' ? `/${lang}` : `/${lang}/${slug}`
}

/* Used by <link rel="alternate" hrefLang="..."> — returns one entry per
 * supported language pointing at the canonical URL for that language. The
 * `hrefLang` field matches React's camelCase JSX prop name so the result
 * spreads directly into a `links` meta object. */
export function getAlternates(
	pageId: PageId,
): { hrefLang: LangCode; href: string }[] {
	return langCodes.map(lang => ({
		hrefLang: lang,
		href: buildPublicPath(pageId, lang),
	}))
}

/* Bare-path fallback: when a user hits e.g. `/guillem` with no language
 * prefix, find which page that segment belongs to in any language so the
 * lang-layout `beforeLoad` can redirect to `/:detectedLang/:canonicalSlug`. */
export function findPageByBareSlug(segment: string): PageId | null {
	for (const lang of langCodes) {
		const pageId = LOCALIZED_TO_PAGE_ID.get(`${lang}:${segment}`)
		if (pageId) return pageId
	}
	return null
}
