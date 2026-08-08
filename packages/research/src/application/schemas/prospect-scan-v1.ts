import { Schema } from 'effect'

import {
	Citation,
	DiscoveredExisting,
	LenientNumber,
	PendingPaidAction,
	ProposedUpdate,
	Sourced,
} from './_shared'

export const ProspectScanV1Schema = Schema.Struct({
	prospects: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			website: Schema.optionalKey(
				Sourced(
					Schema.String.annotate({
						description:
							"The prospect's own official website, and the page you read it on. It must belong to the named company — not a directory/aggregator profile page and not another company that happened to appear in search results. Leave it out rather than assembling an address from the company's name: a guessed domain is worse than none.",
					}),
				),
			),
			tax_id: Schema.optionalKey(Schema.String),
			industry: Schema.optionalKey(Schema.String),
			countries: Schema.optionalKey(
				Schema.Array(
					Schema.String.annotate({
						description: 'ISO 3166-1 alpha-2 country code, e.g. US, ES, DE.',
					}),
				).annotate({
					description:
						'Every country the company has a place in — a plant, an office, a depot — not only the one it is registered in, and listed with the registered one first. A firm headquartered in one country and manufacturing in another belongs in both: a request for one of them is asking about a company that operates there, and naming only the registration would read as a company that does not.',
				}),
			),
			employee_estimate: Schema.optionalKey(
				Sourced(
					LenientNumber.annotate({
						description:
							'How many people work there, as a single whole number, only when a source states it (a page, a profile, a directory entry). Leave it out rather than guessing — a size band is not enough.',
					}),
				),
			),
			why_relevant: Schema.String,
			citations: Schema.Array(Citation),
		}),
	),
	discovered_existing: Schema.optionalKey(Schema.Array(DiscoveredExisting)),
	proposed_updates: Schema.optionalKey(Schema.Array(ProposedUpdate)),
	pending_paid_actions: Schema.optionalKey(Schema.Array(PendingPaidAction)),
})
