import { Schema } from 'effect'

import {
	Citation,
	DiscoveredExisting,
	PendingPaidAction,
	ProposedUpdate,
} from './_shared'

export const CompanyEnrichmentV1Schema = Schema.Struct({
	enrichment: Schema.Struct({
		industry: Schema.optionalKey(Schema.String),
		size_range: Schema.optionalKey(Schema.String),
		pain_points: Schema.optionalKey(Schema.String),
		current_tools: Schema.optionalKey(Schema.String).annotate({
			description:
				"The company's own business or operations software (e.g. TMS, ERP, CRM, WMS, load boards). Exclude generic website infrastructure that appears on any site — reCAPTCHA, analytics, CDNs, cookie/consent banners.",
		}),
		products_fit: Schema.optionalKey(Schema.Array(Schema.String)),
		tags: Schema.optionalKey(Schema.Array(Schema.String)),
		location: Schema.optionalKey(Schema.String),
		region: Schema.optionalKey(Schema.String),
		address: Schema.optionalKey(Schema.String),
		citations: Schema.Array(Citation),
	}),
	competitors: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				website: Schema.optionalKey(Schema.String).annotate({
					description:
						"The competitor's own official website. It must belong to the named competitor — not a directory/aggregator profile page and not another company that happened to appear in search results.",
				}),
				why: Schema.optionalKey(Schema.String),
				citations: Schema.Array(Citation),
			}),
		),
	),
	contacts: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				role: Schema.optionalKey(Schema.String),
				email: Schema.optionalKey(Schema.String),
				phone: Schema.optionalKey(Schema.String),
				citations: Schema.Array(Citation),
			}),
		),
	),
	discovered_existing: Schema.optionalKey(Schema.Array(DiscoveredExisting)),
	proposed_updates: Schema.optionalKey(Schema.Array(ProposedUpdate)),
	pending_paid_actions: Schema.optionalKey(Schema.Array(PendingPaidAction)),
})
