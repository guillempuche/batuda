import { Schema } from 'effect'

import {
	Citation,
	DiscoveredExisting,
	LenientNumber,
	PendingPaidAction,
	ProposedUpdate,
	SocialProfile,
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
							"The prospect's own official website, and the page you read it on — the site the company itself runs. It must belong to the named company: not a directory/aggregator profile page, not another company that happened to appear in search results, and not a page on a social platform. A company's Facebook, Instagram or LinkedIn page goes in `social_profiles`, never here, even when it is the only web presence you can find. Leave it out rather than assembling an address from the company's name: a guessed domain is worse than none.",
					}),
				),
			),
			// Where the company can be found on a platform, which is not the same
			// question as its website and must not be answered in that field: a page
			// on Facebook belongs to whoever opened the account, and a reader sent
			// there instead of to the company's own site has been misled.
			social_profiles: Schema.optionalKey(Schema.Array(SocialProfile)),
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
			// A request confined to one country puts the same code on every row, which
			// tells a reader working through the list nothing; the town and the
			// province are what decide who to call first, and a search that turns up a
			// company almost always turns those up with it.
			// Paired with the page it was read on, like the website and the headcount
			// above. Written bare, it was the one field on this row that no check
			// could reach: the per-field guard only grades a value that names its
			// source, so a place nothing supported — the requested area, with the
			// towns around it in brackets — travelled all the way onto a CRM record
			// and then onto a map.
			location: Schema.optionalKey(
				Sourced(
					Schema.String.annotate({
						description:
							'Where the company is, written the way the evidence writes it — the town, the province, or both ("Córdoba", "Alcobendas, Madrid"). Only when a source states it for this company: name the page you read it on. The area the request asked about is not an answer — a company is somewhere, and the places it will travel to are a different question.',
					}),
				),
			),
			employee_estimate: Schema.optionalKey(
				Sourced(
					LenientNumber.annotate({
						description:
							'How many people work there, as a single whole number, only when a source states it (a page, a profile, a directory entry). Leave it out rather than guessing — a size band is not enough.',
					}),
				),
			),
			// The one field every row has to fill, so it is where a row is asked to say
			// what the organisation IS before saying why it matches. That is what lets
			// a check downstream tell a company from the trade body that represents
			// companies — the two are indistinguishable from the other fields, and a
			// body states neither a size nor a place to be filtered on.
			why_relevant: Schema.String.annotate({
				description:
					'What this organisation is in its own right first — an installer, a manufacturer, a distributor, and roughly how big — and then why it matches the request.',
			}),
			// The marked-candidate half of "keep what you could not confirm". Without
			// somewhere to record the doubt, a run asked not to drop an unconfirmed
			// company has only two ways to answer: drop it anyway, or report it as
			// solid. Both lose the one thing the reader needs to know.
			unconfirmed_reason: Schema.optionalKey(
				Schema.String.annotate({
					description:
						'Only about whether this is a real, trading company: fill it when the evidence names the company but does not establish that it exists and trades, saying in a few words what is missing. Never drop a company for want of that — list it with this instead. A field you could not confirm is not a reason to fill this: leave that field out and this one too.',
				}),
			),
			citations: Schema.Array(Citation),
		}),
	),
	discovered_existing: Schema.optionalKey(Schema.Array(DiscoveredExisting)),
	proposed_updates: Schema.optionalKey(Schema.Array(ProposedUpdate)),
	pending_paid_actions: Schema.optionalKey(Schema.Array(PendingPaidAction)),
})
