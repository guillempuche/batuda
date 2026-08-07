import { Schema } from 'effect'

import {
	Citation,
	DiscoveredExisting,
	LenientNumber,
	PendingPaidAction,
	ProposedUpdate,
	Sourced,
} from './_shared'

export const CompetitorScanV1Schema = Schema.Struct({
	competitors: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			website: Schema.optionalKey(
				Sourced(
					Schema.String.annotate({
						description:
							"The competitor's own official website, and the page you read it on. It must belong to the named competitor — not a directory/aggregator profile page and not another company that happened to appear in search results. Leave it out rather than assembling an address from the company's name: a guessed domain is worse than none.",
					}),
				),
			),
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
