import { Schema } from 'effect'

import { CompanyEnrichmentV1Schema } from './company-enrichment-v1'
import { CompetitorScanV1Schema } from './competitor-scan-v1'
import { ContactDiscoveryV1Schema } from './contact-discovery-v1'
import { FreeformSchema } from './freeform'
import { ProspectScanV1Schema } from './prospect-scan-v1'

// Closed set of server-compiled Effect Schemas. Versioned so schemas can
// evolve without breaking old runs. Callers pass schema_name as a string;
// the service resolves it here for LanguageModel.generateObject.
export const schemaRegistry: Record<string, Schema.Top> = {
	freeform: FreeformSchema,
	company_enrichment_v1: CompanyEnrichmentV1Schema,
	competitor_scan_v1: CompetitorScanV1Schema,
	contact_discovery_v1: ContactDiscoveryV1Schema,
	prospect_scan_v1: ProspectScanV1Schema,
}

export type SchemaName = keyof typeof schemaRegistry

// Runtime tuple of the registry's keys, so the API boundary can reject an
// unknown schema_name up front instead of letting a doomed run be created.
// Kept in sync with schemaRegistry above (a closed, rarely-changing set).
export const schemaNames = [
	'freeform',
	'company_enrichment_v1',
	'competitor_scan_v1',
	'contact_discovery_v1',
	'prospect_scan_v1',
] as const

// The same closed set as an Effect Schema, so HTTP/MCP boundaries can validate
// schema_name with one import instead of re-deriving the literal union (which
// widens to plain string when the tuple is read across a package boundary).
export const SchemaNameSchema = Schema.Literals(schemaNames)

// Fields every schema carries that are not something to go and find out: they
// are how a run hands work back to the CRM, and the prompt covers them where it
// explains that work.
const PLUMBING_FIELDS = new Set([
	'proposed_updates',
	'pending_paid_actions',
	'discovered_existing',
])

/**
 * The fields inside a block of them, seeing past an optional wrapper.
 *
 * A list of repeated things — the people, the competitors — is deliberately not
 * opened up. Naming it is what the searching agent needs: it has to know to go
 * and find people at all. Spelling out each person's own fields is a detail for
 * whoever writes them down afterwards, and every extra word here competes for
 * the attention of a small model that has little to spare.
 */
const innerFields = (field: unknown): Record<string, unknown> | undefined => {
	const seen = new Set<unknown>()
	let current = field
	while (
		current !== null &&
		typeof current === 'object' &&
		!seen.has(current)
	) {
		seen.add(current)
		const own = (current as { fields?: Record<string, unknown> }).fields
		if (own !== undefined) return own
		current = (current as { schema?: unknown }).schema
	}
	return undefined
}

/**
 * The names of everything a run of this kind is expected to come back with,
 * read off the schema itself so the two can never drift apart.
 *
 * The agent doing the searching is told the schema only by name, which tells it
 * nothing: it goes looking for the facts the instructions happen to mention and
 * leaves the rest of the profile empty, never having been told those fields
 * exist. A nested block is listed as `block.field`, since that is how the
 * output is shaped. Empty for a run that writes a brief rather than a profile.
 */
export const schemaFieldNames = (schemaName: string): ReadonlyArray<string> => {
	const schema = schemaRegistry[schemaName]
	const fields = (schema as { fields?: Record<string, unknown> } | undefined)
		?.fields
	if (fields === undefined) return []
	const names: string[] = []
	for (const [key, field] of Object.entries(fields)) {
		if (PLUMBING_FIELDS.has(key)) continue
		const nested = innerFields(field)
		if (nested === undefined) {
			names.push(key)
			continue
		}
		for (const inner of Object.keys(nested)) names.push(`${key}.${inner}`)
	}
	return names
}

export {
	CompanyEnrichmentV1Schema,
	CompetitorScanV1Schema,
	ContactDiscoveryV1Schema,
	FreeformSchema,
	ProspectScanV1Schema,
}
