import { Schema } from 'effect'

import {
	Citation,
	DiscoveredExisting,
	PendingPaidAction,
	ProposedUpdate,
	Sourced,
} from './_shared'

export const CompanyEnrichmentV1Schema = Schema.Struct({
	enrichment: Schema.Struct({
		industry: Schema.optionalKey(Sourced(Schema.String)),
		size_range: Schema.optionalKey(Sourced(Schema.String)),
		pain_points: Schema.optionalKey(Sourced(Schema.String)),
		current_tools: Schema.optionalKey(
			Sourced(
				Schema.String.annotate({
					description:
						"The company's own business or operations software (e.g. TMS, ERP, CRM, WMS, load boards). Exclude generic website infrastructure that appears on any site — reCAPTCHA, analytics, CDNs, cookie/consent banners.",
				}),
			),
		),
		products_fit: Schema.optionalKey(Schema.Array(Schema.String)),
		tags: Schema.optionalKey(Schema.Array(Schema.String)),
		location: Schema.optionalKey(Sourced(Schema.String)),
		country: Schema.optionalKey(
			Sourced(
				Schema.String.annotate({
					description:
						'ISO 3166-1 alpha-2 country code, e.g. US, ES, DE — the country the company is based in.',
				}),
			),
		),
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
				role: Schema.optionalKey(Sourced(Schema.String)),
				email: Schema.optionalKey(Sourced(Schema.String)),
				phone: Schema.optionalKey(Sourced(Schema.String)),
			}),
		),
	),
	discovered_existing: Schema.optionalKey(Schema.Array(DiscoveredExisting)),
	proposed_updates: Schema.optionalKey(Schema.Array(ProposedUpdate)),
	pending_paid_actions: Schema.optionalKey(Schema.Array(PendingPaidAction)),
})
