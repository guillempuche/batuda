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

export {
	CompanyEnrichmentV1Schema,
	CompetitorScanV1Schema,
	ContactDiscoveryV1Schema,
	FreeformSchema,
	ProspectScanV1Schema,
}
