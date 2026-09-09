/**
 * Turning a scanned prospect into the company row that creates it.
 *
 * A scan writes what the pages said, and the CRM only takes what it can store —
 * a country as two letters, a web address that is one. The two disagree often
 * enough that half the prospects ever scanned carry a country the CRM refuses,
 * and the request is checked against its shape in the browser, so a single bad
 * field used to lose the whole lead before anything left the page.
 *
 * So a field that cannot be stored is left out and named, rather than taken
 * along to be refused. The lead is what the person asked for; the country was a
 * detail, and one they can type in afterwards.
 *
 * Free of JSX and of the translation macros, like the other logic beside these
 * components: what was dropped comes back as a word the component looks up, so
 * the sentence a person reads stays where the sentences live.
 */

import { WEBSITE_ADDRESS_PATTERN } from '@batuda/domain'
import { mapCountry } from '@batuda/research/application/vocabulary-guard'

/** A field left out because nothing storable could be made of what the run said. */
export type DroppedLeadField = 'country' | 'website'

/** What a scan row offers up, as far as creating a company needs to know. */
export interface ProspectLeadSource {
	readonly name: string
	readonly industry?: string | undefined
	readonly countries?: ReadonlyArray<string> | undefined
	readonly location?: string | undefined
	readonly website?: string | undefined
	readonly social_profiles?:
		| ReadonlyArray<{ readonly kind: string; readonly value: string }>
		| undefined
}

export interface LeadPayload {
	readonly payload: {
		readonly name: string
		readonly slug: string
		readonly status: 'prospect'
		readonly industry?: string
		readonly country?: string
		readonly location?: string
		readonly website?: string
		readonly socialProfiles?: ReadonlyArray<{
			readonly kind: string
			readonly value: string
		}>
	}
	/** Empty when everything the run said could be carried across. */
	readonly dropped: ReadonlyArray<DroppedLeadField>
}

/**
 * The country a company row can hold, or nothing.
 *
 * A scan may name several — every country the company has a place in — and the
 * row holds the one it is registered in, which is the first. The words the run
 * used are folded to a code by the same rule the pipeline folds them with, so
 * "Spain" and "España" reach the CRM as the "ES" a person can then filter on.
 */
const storableCountry = (
	countries: ReadonlyArray<string> | undefined,
): string | undefined => {
	const first = countries?.[0]?.trim()
	if (first === undefined || first === '') return undefined
	const folded = mapCountry(first)?.toUpperCase()
	return folded !== undefined && /^[A-Z]{2}$/.test(folded) ? folded : undefined
}

/** Only pages that say both what platform they are and where. */
const usableProfiles = (source: ProspectLeadSource) =>
	(source.social_profiles ?? [])
		.filter(p => p.kind.trim() !== '' && p.value.trim() !== '')
		.map(p => ({ kind: p.kind.trim(), value: p.value.trim() }))

/**
 * The slug is passed in rather than built here because it carries a random
 * suffix, and a function that answers differently each time cannot be tested by
 * asking it twice.
 */
export const buildLeadPayload = (
	source: ProspectLeadSource,
	slug: string,
): LeadPayload => {
	const dropped: DroppedLeadField[] = []

	const country = storableCountry(source.countries)
	if (country === undefined && (source.countries?.[0]?.trim() ?? '') !== '')
		dropped.push('country')

	const website = source.website?.trim()
	const storableWebsite =
		website !== undefined &&
		website !== '' &&
		WEBSITE_ADDRESS_PATTERN.test(website)
			? website
			: undefined
	if (storableWebsite === undefined && (website ?? '') !== '')
		dropped.push('website')

	const profiles = usableProfiles(source)

	return {
		payload: {
			name: source.name,
			slug,
			status: 'prospect',
			...(source.industry ? { industry: source.industry } : {}),
			...(country ? { country } : {}),
			...(source.location ? { location: source.location } : {}),
			...(storableWebsite ? { website: storableWebsite } : {}),
			...(profiles.length > 0 ? { socialProfiles: profiles } : {}),
		},
		dropped,
	}
}
