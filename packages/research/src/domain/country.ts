import { Schema } from 'effect'

// Countries with a national business-registry adapter. Closed set: each entry
// needs a provider builder and a vendor-table row (below), so adding a country
// is a data change here, not a new code branch.
export const REGISTRY_COUNTRIES = ['ES', 'GB'] as const
export type RegistryCountry = (typeof REGISTRY_COUNTRIES)[number]

// True when a country has a national registry adapter. Expects an already
// upper-cased code (callers normalize first), so it stays an exact match and
// can narrow the type.
export const isRegistryCountry = (cc: string): cc is RegistryCountry =>
	(REGISTRY_COUNTRIES as readonly string[]).includes(cc)

// Any ISO 3166-1 alpha-2 code the agent may target. Open on purpose: a company
// in a country without a registry is still a valid target — it routes to an
// explicit no_registry result rather than being unrepresentable.
export const AcceptedCountry = Schema.String.check(
	Schema.isPattern(/^[A-Za-z]{2}$/),
)
export type AcceptedCountry = Schema.Schema.Type<typeof AcceptedCountry>

// Turn a model-supplied place hint into a two-letter country code (upper-case),
// or nothing when it isn't clearly a country. Handles a bare code ("US"/"us")
// or a language-and-region hint ("en-US"/"es_ES") by keeping just the region.
// Anything else (a full country name, junk) is dropped, because sending an
// unrecognized country to the search API is rejected outright and fails the run.
export const parseCountryAlpha2 = (
	raw: string | undefined,
): string | undefined => {
	if (raw == null) return undefined
	const trimmed = raw.trim()
	if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase()
	const region = /^[A-Za-z]{2,3}[-_]([A-Za-z]{2})$/.exec(trimmed)?.[1]
	return region ? region.toUpperCase() : undefined
}

// A web address whose country-code suffix names a registry country. ".uk" is what
// British companies use, though the country's own code is GB, so the two are listed
// side by side rather than one derived from the other.
const REGISTRY_COUNTRY_BY_TLD: Record<string, RegistryCountry> = {
	es: 'ES',
	uk: 'GB',
	gb: 'GB',
}

export const registryCountryForHost = (
	host: string | undefined,
): RegistryCountry | undefined => {
	const tld = host?.toLowerCase().split('.').pop()
	return tld !== undefined ? REGISTRY_COUNTRY_BY_TLD[tld] : undefined
}

/**
 * Which national register to consult for a run, from the surest signal to the
 * weakest. What we already recorded about the company is the best answer — that
 * field means "the country this company is in", exactly the question. A caller's
 * place hint comes next: it is about where to search from, which usually but not
 * always coincides. A web address ending in a country's own suffix is the last
 * resort, since plenty of Spanish and British companies use a .com. Nothing
 * recognizable means no lookup rather than a guess.
 */
export const resolveRegistryCountry = (args: {
	readonly subjectCountry: string | undefined
	readonly locationHint: string | undefined
	readonly anchorHost: string | undefined
}): RegistryCountry | undefined => {
	for (const raw of [args.subjectCountry, args.locationHint]) {
		const cc = parseCountryAlpha2(raw)
		if (cc !== undefined && isRegistryCountry(cc)) return cc
	}
	return registryCountryForHost(args.anchorHost)
}

export const REGISTRY_VENDORS_BY_COUNTRY = {
	ES: ['stub', 'librebor', 'none'] as const,
	GB: ['stub', 'companies-house', 'none'] as const,
} satisfies Record<RegistryCountry, ReadonlyArray<string>>

export const REPORT_VENDORS_BY_COUNTRY = {
	ES: ['stub', 'einforma', 'none'] as const,
	GB: ['none'] as const,
} satisfies Record<RegistryCountry, ReadonlyArray<string>>
