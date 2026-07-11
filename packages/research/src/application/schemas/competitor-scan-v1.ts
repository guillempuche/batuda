import { Schema } from 'effect'

import {
	Citation,
	DiscoveredExisting,
	LenientNumber,
	PendingPaidAction,
	ProposedUpdate,
} from './_shared'

export const CompetitorScanV1Schema = Schema.Struct({
	competitors: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			website: Schema.optionalKey(Schema.String).annotate({
				description:
					"The competitor's own official website. It must belong to the named competitor — not a directory/aggregator profile page and not another company that happened to appear in search results.",
			}),
			description: Schema.optionalKey(Schema.String),
			strengths: Schema.optionalKey(Schema.Array(Schema.String)),
			weaknesses: Schema.optionalKey(Schema.Array(Schema.String)),
			overlap: Schema.optionalKey(Schema.String),
			citations: Schema.Array(Citation),
		}),
	),
	market_summary: Schema.optionalKey(
		Schema.Struct({
			total_competitors_found: LenientNumber,
			market_maturity: Schema.optionalKey(Schema.String),
			key_differentiators: Schema.optionalKey(Schema.Array(Schema.String)),
			citations: Schema.Array(Citation),
		}),
	),
	discovered_existing: Schema.optionalKey(Schema.Array(DiscoveredExisting)),
	proposed_updates: Schema.optionalKey(Schema.Array(ProposedUpdate)),
	pending_paid_actions: Schema.optionalKey(Schema.Array(PendingPaidAction)),
})
