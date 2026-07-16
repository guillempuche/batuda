import { Schema } from 'effect'

import {
	Citation,
	DiscoveredExisting,
	PendingPaidAction,
	ProposedUpdate,
} from './_shared'

export const ProspectScanV1Schema = Schema.Struct({
	prospects: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			website: Schema.optionalKey(Schema.String).annotate({
				description:
					"The prospect's own official website. It must belong to the named company — not a directory/aggregator profile page and not another company that happened to appear in search results.",
			}),
			tax_id: Schema.optionalKey(Schema.String),
			industry: Schema.optionalKey(Schema.String),
			country: Schema.optionalKey(
				Schema.String.annotate({
					description: 'ISO 3166-1 alpha-2 country code, e.g. US, ES, DE.',
				}),
			),
			why_relevant: Schema.String,
			pain_indicators: Schema.optionalKey(Schema.Array(Schema.String)),
			citations: Schema.Array(Citation),
		}),
	),
	discovered_existing: Schema.optionalKey(Schema.Array(DiscoveredExisting)),
	proposed_updates: Schema.optionalKey(Schema.Array(ProposedUpdate)),
	pending_paid_actions: Schema.optionalKey(Schema.Array(PendingPaidAction)),
})
