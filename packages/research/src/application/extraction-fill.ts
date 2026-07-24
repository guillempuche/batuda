/**
 * Measures how much of a company profile each extraction pass actually filled.
 *
 * The most common failure is the model returning almost nothing — an all-empty
 * profile that then reads as a clean run, because every other counter in the
 * pipeline records what was thrown *away* and there was never anything to throw.
 * This counts what was present to begin with, at each stage, so an empty answer
 * shows up as a number rather than looking healthy.
 */

import { CompanyEnrichmentV1Schema } from './schemas/company-enrichment-v1'

// The company-profile fields, taken from the schema itself so the list can never
// drift from what the model is actually asked to fill.
export const ENRICHMENT_FIELDS: ReadonlyArray<string> = Object.keys(
	CompanyEnrichmentV1Schema.fields.enrichment.fields,
)

// A field holds something usable when it carries a real value. Most fields pair a
// value with the source that backs it; the tag field is a plain list. A field a
// guard emptied (`{value: null}`) counts as unfilled.
const isFilled = (field: unknown): boolean => {
	if (Array.isArray(field)) return field.length > 0
	if (field === null || typeof field !== 'object') return false
	const value = (field as { value?: unknown }).value
	return typeof value === 'string' && value.trim() !== ''
}

const enrichmentOf = (findings: unknown): Record<string, unknown> => {
	if (findings === null || typeof findings !== 'object') return {}
	const enrichment = (findings as { enrichment?: unknown }).enrichment
	return enrichment !== null && typeof enrichment === 'object'
		? (enrichment as Record<string, unknown>)
		: {}
}

export interface EnrichmentFill {
	/** How many profile fields the schema asks for. */
	readonly total: number
	/** How many carry a real value at this stage. */
	readonly filled: number
	/** The names of the fields still empty. */
	readonly missing: ReadonlyArray<string>
}

export const enrichmentFill = (findings: unknown): EnrichmentFill => {
	const enrichment = enrichmentOf(findings)
	const missing = ENRICHMENT_FIELDS.filter(
		field => !isFilled(enrichment[field]),
	)
	return {
		total: ENRICHMENT_FIELDS.length,
		filled: ENRICHMENT_FIELDS.length - missing.length,
		missing,
	}
}

// A contact carries a title when its `role` holds a real value — a `role` of
// `{value: null}` counts as untitled, the same as a missing one.
export const hasTitle = (contact: unknown): boolean => {
	if (contact === null || typeof contact !== 'object') return false
	const role = (contact as { role?: unknown }).role
	if (role === null || typeof role !== 'object') return false
	const value = (role as { value?: unknown }).value
	return typeof value === 'string' && value.trim() !== ''
}

const contactsOf = (findings: unknown): ReadonlyArray<unknown> => {
	if (findings === null || typeof findings !== 'object') return []
	const contacts = (findings as { contacts?: unknown }).contacts
	return Array.isArray(contacts) ? contacts : []
}

const isNamed = (contact: unknown): boolean =>
	contact !== null &&
	typeof contact === 'object' &&
	typeof (contact as { name?: unknown }).name === 'string' &&
	(contact as { name: string }).name.trim() !== ''

export interface ContactFill {
	/** How many named people the pass returned. */
	readonly named: number
	/** How many of those carry a title. */
	readonly titled: number
}

export const contactFill = (findings: unknown): ContactFill => {
	const named = contactsOf(findings).filter(isNamed)
	return { named: named.length, titled: named.filter(hasTitle).length }
}
