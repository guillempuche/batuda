import type { Schema } from 'effect'

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

export {
	CompanyEnrichmentV1Schema,
	CompetitorScanV1Schema,
	ContactDiscoveryV1Schema,
	FreeformSchema,
	ProspectScanV1Schema,
}
