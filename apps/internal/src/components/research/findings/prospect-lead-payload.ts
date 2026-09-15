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
 *
 * The attribute values the scan read off the company travel too, each with the
 * page it was read on, so the company arrives already carrying the facts the
 * organisation asks every company for.
 */

import type { AttributeValue, AttributeValueInput } from '@batuda/domain'
import { WEBSITE_ADDRESS_PATTERN } from '@batuda/domain'
import { mapCountry } from '@batuda/research/application/vocabulary-guard'

import type { AttributeDeclaration } from '#/components/instructions/attribute-shapes'
import {
	declaredAttributes,
	type FoundAttribute,
	narrowFoundAttributes,
} from './found-attributes'

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
	readonly tax_id?: string | undefined
	readonly contacts?:
		| ReadonlyArray<{ readonly name: string; readonly role?: string }>
		| undefined
	/** The values under the organisation's own keys, as the findings carry them. */
	readonly attributes?: Record<string, unknown> | undefined
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
		readonly taxId?: string
		readonly contacts?: ReadonlyArray<{
			readonly name: string
			readonly role?: string
		}>
		readonly attributes?: Readonly<Record<string, AttributeValueInput>>
		readonly researchId?: string
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
 * One value as creating a company takes it.
 *
 * A value the run tied to a page travels with that page and the words on it, so
 * the run is recorded as what found it. One it could not tie to a page travels
 * bare and lands as the person's own value: naming a page nothing fetched would
 * be refused, and inventing one would turn a missing citation into a false one.
 */
const withEvidence = (
	found: FoundAttribute,
	value: AttributeValue,
): AttributeValueInput =>
	found.sourceId === null
		? value
		: {
				value,
				source_id: found.sourceId,
				...(found.quote === null ? {} : { quote: found.quote }),
			}

/**
 * The attribute values the scan read, as creating a company takes them.
 *
 * Only what a declaration will take: the server turns down the whole create on
 * the first key it does not recognise, so one retired fact would otherwise cost
 * every row of the run its button.
 */
const leadAttributes = (
	source: ProspectLeadSource,
	declarations: ReadonlyArray<AttributeDeclaration> | null,
): Readonly<Record<string, AttributeValueInput>> => {
	const entries: Array<[string, AttributeValueInput]> = declaredAttributes(
		narrowFoundAttributes(source.attributes),
		declarations,
	).map(found => [found.key, withEvidence(found, found.value)])
	// Built from entries rather than by assigning keys: the keys are written by a
	// model, and assigning one called `__proto__` reaches the prototype setter.
	return Object.fromEntries(entries)
}

/**
 * The web address is passed in rather than built here, so the caller decides
 * what a company is filed under and this stays a plain reading of the row.
 *
 * `researchId` names the run whose pages the values were read on; without it the
 * server has no way to tell an attribute the run found from one a person typed.
 *
 * `declarations` is what the organisation declares, or null when the page does
 * not know yet — see `leadAttributes`.
 */
export const buildLeadPayload = (
	source: ProspectLeadSource,
	slug: string,
	researchId?: string | null,
	declarations?: ReadonlyArray<AttributeDeclaration> | null,
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
	const taxId = source.tax_id?.trim()
	// Only people with a name to file them under. A row carrying a title and
	// nobody to hang it on would become a contact nobody can be asked for.
	const people = (source.contacts ?? []).flatMap(person => {
		const name = person.name?.trim() ?? ''
		if (name === '') return []
		const role = person.role?.trim()
		return [role ? { name, role } : { name }]
	})

	const attributes = leadAttributes(source, declarations ?? null)
	const hasAttributes = Object.keys(attributes).length > 0

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
			...(taxId ? { taxId } : {}),
			...(people.length > 0 ? { contacts: people } : {}),
			...(hasAttributes ? { attributes } : {}),
			// Sent only alongside values: on its own the run's id changes nothing
			// about the company, and it is only there to tie a value to a page.
			...(hasAttributes && researchId ? { researchId } : {}),
		},
		dropped,
	}
}
